/// <reference lib="webworker" />
import type { ProcessSettings, RGBAImage } from '../lib/types'
import { runPipeline, type PipelineReport, type Upscaler } from '../lib/pipeline'
import { resizeLanczos } from '../lib/resize'
import { encodePng } from '../lib/png'
import { esrganUpscale, loadEsrgan } from '../lib/upscale/esrgan'
import { vectorizeUpscale } from '../lib/upscale/vectorize'

// All heavy work happens here so the UI never freezes. Cancel = the main thread terminates this
// worker and starts a new one (see workerClient.ts).

export type UpscaleMode = 'ai' | 'lanczos' | 'vectorize'

export type WorkerRequest =
  | { type: 'setSource'; width: number; height: number; buffer: ArrayBuffer }
  | {
      type: 'run'
      id: number
      mode: 'preview' | 'export'
      settings: ProcessSettings
      garmentHex: string
      printWidthIn: number
      upscale: UpscaleMode
      /** Preview only: cap the preview width in pixels. */
      previewMaxPx?: number
    }
  | { type: 'warmModel'; id: number }

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | {
      type: 'result'
      id: number
      width: number
      height: number
      buffer: ArrayBuffer
      report: PipelineReport
      png: ArrayBuffer | null
      upscaledWith: string
      /** Ratio full-source pixels / preview-source pixels (scale removed counts by this). */
      areaRatio: number
    }
  | { type: 'error'; id: number; message: string }
  | { type: 'modelReady'; id: number; backend: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
let source: RGBAImage | null = null
let previewSource: RGBAImage | null = null
const PREVIEW_SOURCE_MAX = 1400

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer)
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'setSource') {
    source = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) }
    const long = Math.max(source.width, source.height)
    previewSource =
      long > PREVIEW_SOURCE_MAX
        ? resizeLanczos(source, Math.round((source.width * PREVIEW_SOURCE_MAX) / long), Math.round((source.height * PREVIEW_SOURCE_MAX) / long))
        : source
    return
  }
  if (msg.type === 'warmModel') {
    try {
      const { backend } = await loadEsrgan()
      post({ type: 'modelReady', id: msg.id, backend })
    } catch (err) {
      post({ type: 'error', id: msg.id, message: `AI upscaler unavailable: ${(err as Error).message}` })
    }
    return
  }
  if (msg.type !== 'run') return
  const { id } = msg
  try {
    if (!source || !previewSource) throw new Error('No image loaded')
    const preview = msg.mode === 'preview'
    const src = preview ? previewSource : source
    const dpi = preview ? Math.min(150, (msg.previewMaxPx ?? 1200) / msg.printWidthIn) : 300
    const progress = (stage: string, fraction: number) => post({ type: 'progress', id, stage, fraction })

    let upscaledWith = 'lanczos'
    let upscale: Upscaler | undefined
    if (!preview && msg.upscale === 'ai') {
      upscale = async (img, w, h, onP) => {
        try {
          const out = await esrganUpscale(img, w, h, onP)
          upscaledWith = 'Real-ESRGAN'
          return out
        } catch (err) {
          upscaledWith = `Lanczos (AI failed: ${(err as Error).message})`
          return resizeLanczos(img, w, h)
        }
      }
    } else if (msg.upscale === 'vectorize') {
      upscale = async (img, w, h, onP) => {
        try {
          const out = await vectorizeUpscale(img, w, h, onP)
          upscaledWith = 'vector trace'
          return out
        } catch (err) {
          upscaledWith = `Lanczos (trace failed: ${(err as Error).message})`
          return resizeLanczos(img, w, h)
        }
      }
    }

    const { image, report } = await runPipeline({
      source: src,
      settings: msg.settings,
      garmentHex: msg.garmentHex,
      printWidthIn: msg.printWidthIn,
      dpi,
      upscale,
      strokeCheck: !preview,
      onProgress: progress,
    })
    if (report.upscaleFactor <= 1) upscaledWith = 'none (downscaled)'
    let png: ArrayBuffer | null = null
    if (!preview) {
      progress('Encoding PNG', 0)
      const bytes = await encodePng(image, { dpi: 300 })
      png = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }
    const buffer = image.data.buffer as ArrayBuffer
    const transfer: Transferable[] = [buffer]
    if (png) transfer.push(png)
    post(
      {
        type: 'result',
        id,
        width: image.width,
        height: image.height,
        buffer,
        report,
        png,
        upscaledWith,
        areaRatio: (source.width * source.height) / (src.width * src.height),
      },
      transfer,
    )
  } catch (err) {
    post({ type: 'error', id, message: (err as Error).message })
  }
}
