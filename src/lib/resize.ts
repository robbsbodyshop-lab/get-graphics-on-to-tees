import type { RGBAImage } from './types'
import { createImage } from './image/core'

interface Weights {
  start: Int32Array
  count: Int32Array
  w: Float32Array // n * maxTaps
  taps: number
}

function lanczos(x: number, a: number): number {
  if (x === 0) return 1
  if (x <= -a || x >= a) return 0
  const px = Math.PI * x
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px)
}

function buildWeights(srcN: number, dstN: number, a: number): Weights {
  const scale = srcN / dstN
  const filterScale = Math.max(1, scale)
  const support = a * filterScale
  const taps = Math.ceil(support * 2) + 2
  const start = new Int32Array(dstN)
  const count = new Int32Array(dstN)
  const w = new Float32Array(dstN * taps)
  for (let i = 0; i < dstN; i++) {
    const center = (i + 0.5) * scale
    const lo = Math.max(0, Math.floor(center - support))
    const hi = Math.min(srcN - 1, Math.ceil(center + support))
    let sum = 0
    let n = 0
    for (let j = lo; j <= hi && n < taps; j++, n++) {
      const v = lanczos((j + 0.5 - center) / filterScale, a)
      w[i * taps + n] = v
      sum += v
    }
    if (sum === 0) {
      // degenerate: nearest
      const j = Math.min(srcN - 1, Math.floor(center))
      start[i] = j
      count[i] = 1
      w[i * taps] = 1
      continue
    }
    for (let k = 0; k < n; k++) w[i * taps + k] /= sum
    start[i] = lo
    count[i] = n
  }
  return { start, count, w, taps }
}

export function resizeLanczos(img: RGBAImage, width: number, height: number, a = 3): RGBAImage {
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  const sw = img.width
  const sh = img.height
  const src = img.data

  // Premultiply into float32.
  const pm = new Float32Array(sw * sh * 4)
  for (let i = 0; i < sw * sh * 4; i += 4) {
    const al = src[i + 3] / 255
    pm[i] = src[i] * al
    pm[i + 1] = src[i + 1] * al
    pm[i + 2] = src[i + 2] * al
    pm[i + 3] = src[i + 3]
  }

  // Horizontal pass: sw x sh -> width x sh
  const hw = buildWeights(sw, width, a)
  const mid = new Float32Array(width * sh * 4)
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4
    const orow = y * width * 4
    for (let x = 0; x < width; x++) {
      const s = hw.start[x]
      const n = hw.count[x]
      const wo = x * hw.taps
      let r = 0, g = 0, b = 0, al = 0
      for (let k = 0; k < n; k++) {
        const wt = hw.w[wo + k]
        const p = row + (s + k) * 4
        r += pm[p] * wt
        g += pm[p + 1] * wt
        b += pm[p + 2] * wt
        al += pm[p + 3] * wt
      }
      const o = orow + x * 4
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = al
    }
  }

  // Vertical pass, accumulate one output row at a time.
  const vw = buildWeights(sh, height, a)
  const out = createImage(width, height)
  const od = out.data
  const acc = new Float32Array(width * 4)
  const rowLen = width * 4
  for (let y = 0; y < height; y++) {
    acc.fill(0)
    const s = vw.start[y]
    const n = vw.count[y]
    for (let k = 0; k < n; k++) {
      const wt = vw.w[y * vw.taps + k]
      const base = (s + k) * rowLen
      for (let i = 0; i < rowLen; i++) acc[i] += mid[base + i] * wt
    }
    const o = y * rowLen
    for (let x = 0; x < rowLen; x += 4) {
      let al = acc[x + 3]
      if (al < 0) al = 0
      else if (al > 255) al = 255
      if (al < 0.5) {
        od[o + x] = 0; od[o + x + 1] = 0; od[o + x + 2] = 0; od[o + x + 3] = 0
        continue
      }
      const inv = 255 / al
      // Uint8ClampedArray rounds and clamps.
      od[o + x] = acc[x] * inv
      od[o + x + 1] = acc[x + 1] * inv
      od[o + x + 2] = acc[x + 2] * inv
      od[o + x + 3] = al
    }
  }
  return out
}

/** In place: give alpha-0 pixels the average colour of coloured neighbours, growing outward. */
export function bleedColors(img: RGBAImage, iterations = 8): void {
  const { width: w, height: h, data } = img
  const n = w * h
  // known[i] = 1 if pixel has a valid colour
  let known = new Uint8Array(n)
  for (let i = 0; i < n; i++) known[i] = data[i * 4 + 3] > 0 ? 1 : 0
  let next = new Uint8Array(n)
  for (let it = 0; it < iterations; it++) {
    next.set(known)
    let changed = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let r = 0, g = 0, b = 0, c = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const j = yy * w + xx
            if (!known[j]) continue
            r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; c++
          }
        }
        if (c) {
          data[i * 4] = Math.round(r / c)
          data[i * 4 + 1] = Math.round(g / c)
          data[i * 4 + 2] = Math.round(b / c)
          next[i] = 1
          changed = true
        }
      }
    }
    const t = known
    known = next
    next = t
    if (!changed) break
  }
}
