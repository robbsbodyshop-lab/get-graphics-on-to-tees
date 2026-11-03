import type { BBox, RGBAImage } from '../types'
import { createImage } from './core'

export function alphaBBox(img: RGBAImage, minAlpha = 1): BBox | null {
  const { width: w, height: h, data: d } = img
  let x0 = w
  let x1 = -1
  let y0 = h
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] >= minAlpha) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function solidCoverage(img: RGBAImage): { bbox: BBox | null; opaque: number; coverage: number } {
  const d = img.data
  let opaque = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) opaque++
  const bbox = alphaBBox(img, 128)
  const coverage = bbox ? opaque / (bbox.w * bbox.h) : 0
  return { bbox, opaque, coverage }
}

/** New image; regions outside the source are transparent. */
export function crop(img: RGBAImage, box: BBox): RGBAImage {
  const out = createImage(Math.max(0, box.w), Math.max(0, box.h))
  const sx0 = Math.max(0, box.x)
  const sx1 = Math.min(img.width, box.x + box.w)
  if (sx1 <= sx0) return out
  const y0 = Math.max(0, box.y)
  const y1 = Math.min(img.height, box.y + box.h)
  for (let y = y0; y < y1; y++) {
    const src = img.data.subarray((y * img.width + sx0) * 4, (y * img.width + sx1) * 4)
    out.data.set(src, ((y - box.y) * out.width + (sx0 - box.x)) * 4)
  }
  return out
}

export function trim(img: RGBAImage, marginPx: number): RGBAImage {
  const bb = alphaBBox(img)
  const m = Math.max(0, marginPx)
  if (!bb) return createImage(Math.max(1, 2 * m), Math.max(1, 2 * m))
  return crop(img, { x: bb.x - m, y: bb.y - m, w: bb.w + 2 * m, h: bb.h + 2 * m })
}

export function mirrorHorizontal(img: RGBAImage): void {
  const { width: w, height: h, data: d } = img
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0, e = w - 1; x < e; x++, e--) {
      const a = (row + x) * 4
      const b = (row + e) * 4
      for (let c = 0; c < 4; c++) {
        const t = d[a + c]
        d[a + c] = d[b + c]
        d[b + c] = t
      }
    }
  }
}

/** Exactly width x height, content centred (cropped evenly or padded with transparency). */
export function fitCanvas(img: RGBAImage, width: number, height: number): RGBAImage {
  return crop(img, {
    x: Math.floor((img.width - width) / 2),
    y: Math.floor((img.height - height) / 2),
    w: width,
    h: height,
  })
}
