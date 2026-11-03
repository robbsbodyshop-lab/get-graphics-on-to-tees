import type { Edge, RGBAImage } from '../types'
import { hexToRgb, lightness01 } from './color'

/**
 * Halftone helpers. DTF prints a white underbase under any pixel with alpha > 0, so soft alpha
 * must become binary dots. All functions mutate the image in place and return a mask of the
 * pixels they decided (1 = decided here), so the caller can protect those dots from speck removal.
 */

export type HalftoneOpts = {
  lpi: number
  dpi: number
  /** Screen angle in degrees (default 22.5). */
  angleDeg: number
  /** Coverage below this becomes 0 (default 0.12). */
  minCoverage?: number
  /** Coverage above this becomes 1 (default 0.88). */
  maxCoverage?: number
}

export const DEFAULT_MIN_COVERAGE = 0.12
export const DEFAULT_MAX_COVERAGE = 0.88

/** Halftone cell edge length in pixels. */
export function cellSize(lpi: number, dpi: number): number {
  return dpi / lpi
}

/**
 * Round-dot (cosine) spot function in [0,1]. A pixel with coverage c is ON when c > T.
 * Low coverage -> round dots, 50 % -> checkerboard, high coverage -> inverted dots.
 */
export function spotThreshold(x: number, y: number, cellPx: number, angleRad: number): number {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  const xr = x * c + y * s
  const yr = -x * s + y * c
  const u = xr / cellPx
  const v = yr / cellPx
  return 1 - (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v) + 2) / 4
}

interface Screen {
  cell: number
  cos: number
  sin: number
  lo: number
  hi: number
}

function makeScreen(o: HalftoneOpts): Screen {
  const a = (o.angleDeg ?? 22.5) * (Math.PI / 180)
  return {
    cell: cellSize(o.lpi, o.dpi),
    cos: Math.cos(a),
    sin: Math.sin(a),
    lo: o.minCoverage ?? DEFAULT_MIN_COVERAGE,
    hi: o.maxCoverage ?? DEFAULT_MAX_COVERAGE,
  }
}

const TWO_PI = 2 * Math.PI

/** Inlined spot function using the precomputed rotation. */
function spot(s: Screen, x: number, y: number): number {
  const u = (x * s.cos + y * s.sin) / s.cell
  const v = (-x * s.sin + y * s.cos) / s.cell
  return 1 - (Math.cos(TWO_PI * u) + Math.cos(TWO_PI * v) + 2) / 4
}

/** Binary decision for a coverage value 0..1. */
function isOn(s: Screen, coverage: number, x: number, y: number): boolean {
  if (coverage < s.lo) return false
  if (coverage >= s.hi) return true
  return coverage > spot(s, x, y)
}

export function halftoneAlpha(img: RGBAImage, opts: HalftoneOpts): { mask: Uint8Array; dotted: number } {
  const { width: w, height: h, data } = img
  const mask = new Uint8Array(w * h)
  const s = makeScreen(opts)
  let dotted = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const a = data[p * 4 + 3]
      if (a === 0 || a === 255) continue
      mask[p] = 1
      if (isOn(s, a / 255, x, y)) {
        data[p * 4 + 3] = 255
        dotted++
      } else {
        data[p * 4 + 3] = 0
      }
    }
  }
  return { mask, dotted }
}

export function halftoneLuminance(
  img: RGBAImage,
  opts: HalftoneOpts & { lumLo: number; lumHi: number; ink: 'original' | string; darkInk: boolean },
): { mask: Uint8Array; dotted: number } {
  const { width: w, height: h, data } = img
  const mask = new Uint8Array(w * h)
  const s = makeScreen(opts)
  const useInk = opts.ink !== 'original'
  const ink = useInk ? hexToRgb(opts.ink) : { r: 0, g: 0, b: 0 }
  let dotted = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      const a = data[i + 3]
      if (a === 0) continue
      const L = lightness01(data[i], data[i + 1], data[i + 2])
      if (L < opts.lumLo || L > opts.lumHi) continue
      mask[p] = 1
      const cov = (opts.darkInk ? 1 - L : L) * (a / 255)
      if (isOn(s, cov, x, y)) {
        if (useInk) {
          data[i] = ink.r
          data[i + 1] = ink.g
          data[i + 2] = ink.b
        }
        data[i + 3] = 255
        dotted++
      } else {
        data[i + 3] = 0
      }
    }
  }
  return { mask, dotted }
}

export function fadeEdgeHalftone(
  img: RGBAImage,
  opts: HalftoneOpts & { edge: Edge; fraction: number },
): { mask: Uint8Array; dotted: number } {
  const { width: w, height: h, data } = img
  const mask = new Uint8Array(w * h)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { mask, dotted: 0 }
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const horizontal = opts.edge === 'left' || opts.edge === 'right'
  const fraction = Math.min(0.9, Math.max(0.05, opts.fraction))
  const rampLen = Math.max(1, fraction * (horizontal ? bw : bh))
  const s = makeScreen(opts)
  let dotted = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let d: number // distance (px) from the faded edge, inward
      switch (opts.edge) {
        case 'top': d = y - y0; break
        case 'bottom': d = y1 - y; break
        case 'left': d = x - x0; break
        default: d = x1 - x; break
      }
      const ramp = (d + 0.5) / rampLen
      if (ramp >= 1) continue
      const p = y * w + x
      const a = data[p * 4 + 3]
      if (a === 0) continue
      mask[p] = 1
      if (isOn(s, (a / 255) * ramp, x, y)) {
        data[p * 4 + 3] = 255
        dotted++
      } else {
        data[p * 4 + 3] = 0
      }
    }
  }
  return { mask, dotted }
}
