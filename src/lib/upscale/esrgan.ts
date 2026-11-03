import * as ort from 'onnxruntime-web/webgpu'
import type { RGBAImage } from '../types'
import { bleedColors, resizeLanczos } from '../resize'
import { cloneImage } from '../image/core'

// Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3-Clause, official v0.2.5.0 weights
// exported to ONNX). Input [1,3,H,W] RGB 0..1, output [1,3,4H,4W]. Runs in the pipeline worker,
// tile by tile so memory stays small and progress/cancel work. Alpha never goes through the model:
// it is resized with Lanczos and thresholded later.

// Emitted by Vite as a hashed asset next to the worker, so the URL is right in dev and in builds
// under any base path (a BASE_URL-relative path would resolve against the worker's own folder).
export const MODEL_URL = new URL('../../assets/models/realesr-general-x4v3.onnx', import.meta.url).href
const TILE = 128
const PAD = 8 // input-space overlap on each side of a tile

let sessionPromise: Promise<{ session: ort.InferenceSession; backend: string }> | null = null

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export function loadEsrgan(): Promise<{ session: ort.InferenceSession; backend: string }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
      ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
      ort.env.wasm.proxy = false
      const res = await withTimeout(fetch(MODEL_URL), 60000, 'Model download')
      if (!res.ok) throw new Error(`Model download failed (${res.status})`)
      if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Model URL returned a web page, not the model')
      const bytes = new Uint8Array(await res.arrayBuffer())
      const tryCreate = async (eps: string[], ms: number) => ({
        session: await withTimeout(ort.InferenceSession.create(bytes, { executionProviders: eps }), ms, `${eps[0]} model setup`),
        backend: eps[0],
      })
      if ('gpu' in navigator) {
        try {
          return await tryCreate(['webgpu'], 20000)
        } catch {
          // no usable GPU: fall through to CPU
        }
      }
      return await tryCreate(['wasm'], 60000)
    })()
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

/**
 * Upscale to exactly width x height. When the target is less than 4x the source, the source is
 * first reduced to target/4 so the model does no wasted work (Real-ESRGAN's own --outscale also
 * runs x4 and resamples).
 */
export async function esrganUpscale(
  src: RGBAImage,
  width: number,
  height: number,
  onProgress: (f: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<RGBAImage> {
  const { session } = await loadEsrgan()
  const alpha = resizeLanczos(src, width, height)

  let input = cloneImage(src)
  bleedColors(input, 16)
  const inW = Math.ceil(width / 4)
  const inH = Math.ceil(height / 4)
  if (inW < input.width) input = resizeLanczos(input, inW, Math.max(1, inH))

  const W = input.width
  const H = input.height
  const outW = W * 4
  const outH = H * 4
  const out = new Uint8ClampedArray(outW * outH * 4)
  const tilesX = Math.ceil(W / TILE)
  const tilesY = Math.ceil(H / TILE)
  const total = tilesX * tilesY
  let done = 0
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      if (isCancelled()) throw new Error('Cancelled')
      const x0 = tx * TILE
      const y0 = ty * TILE
      const x1 = Math.min(W, x0 + TILE)
      const y1 = Math.min(H, y0 + TILE)
      const px0 = Math.max(0, x0 - PAD)
      const py0 = Math.max(0, y0 - PAD)
      const px1 = Math.min(W, x1 + PAD)
      const py1 = Math.min(H, y1 + PAD)
      const tw = px1 - px0
      const th = py1 - py0
      const plane = tw * th
      const t = new Float32Array(3 * plane)
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const si = ((py0 + y) * W + (px0 + x)) * 4
          const di = y * tw + x
          t[di] = input.data[si] / 255
          t[plane + di] = input.data[si + 1] / 255
          t[2 * plane + di] = input.data[si + 2] / 255
        }
      }
      const result = await session.run({ [inputName]: new ort.Tensor('float32', t, [1, 3, th, tw]) })
      const o = result[outputName].data as Float32Array
      const otw = tw * 4
      const oPlane = otw * th * 4
      // copy the tile's own region (without the overlap) into the output
      for (let y = (y0 - py0) * 4; y < (y1 - py0) * 4; y++) {
        const oy = py0 * 4 + y
        for (let x = (x0 - px0) * 4; x < (x1 - px0) * 4; x++) {
          const ox = px0 * 4 + x
          const si = y * otw + x
          const di = (oy * outW + ox) * 4
          out[di] = o[si] * 255
          out[di + 1] = o[oPlane + si] * 255
          out[di + 2] = o[2 * oPlane + si] * 255
          out[di + 3] = 255
        }
      }
      for (const v of Object.values(result)) v.dispose?.()
      done++
      onProgress(done / total)
      // let progress/cancel messages through
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  let rgb: RGBAImage = { width: outW, height: outH, data: out }
  if (outW !== width || outH !== height) rgb = resizeLanczos(rgb, width, height)
  for (let i = 3; i < rgb.data.length; i += 4) rgb.data[i] = alpha.data[i]
  return rgb
}
