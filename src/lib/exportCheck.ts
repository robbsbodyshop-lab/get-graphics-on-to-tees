import type { RGBAImage } from './types'
import { hexToRgb } from './image/color'

// The checks a careful user runs on an exported PNG before sending it to the printer
// (alpha breakdown, hidden color under transparent pixels, ink colors, ink vs shirt color),
// computed from the real pixel data so a cleared warning can't hide damage.

export interface ExportCheck {
  widthPx: number
  heightPx: number
  /** Fully transparent / fully opaque / anything in between (must be 0). */
  clear: number
  solid: number
  partial: number
  clearFraction: number
  solidFraction: number
  /** Transparent pixels that still carry RGB (must be 0 after cleanup). */
  hiddenColor: number
  /** Distinct ink colors (exact RGB). */
  uniqueColors: number
  /** Share of the ink in brightness bands (0..255, Rec.601 luma). */
  brightness: { pureWhite: number; light: number; mid: number; dark: number; black: number }
  /** Share of the ink within GARMENT_CLOSE brightness levels of the shirt. */
  garmentClose: number
  /** Share of the ink that is saturated (HSV saturation > 0.5 and value > 0.3): accents such as a red hat. */
  saturated: number
}

export const GARMENT_CLOSE = 40
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

export function inspectExport(img: RGBAImage, garmentHex: string): ExportCheck {
  const d = img.data
  const g = hexToRgb(garmentHex)
  const gl = luma(g.r, g.g, g.b)
  let clear = 0
  let solid = 0
  let partial = 0
  let hidden = 0
  let close = 0
  let sat = 0
  let pureWhite = 0
  let light = 0
  let mid = 0
  let dark = 0
  let black = 0
  const colors = new Set<number>()
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    const r = d[i]
    const gg = d[i + 1]
    const b = d[i + 2]
    if (a === 0) {
      clear++
      if (r !== 0 || gg !== 0 || b !== 0) hidden++
      continue
    }
    if (a === 255) solid++
    else partial++
    colors.add((r << 16) | (gg << 8) | b)
    const y = luma(r, gg, b)
    if (y >= 250) pureWhite++
    else if (y >= 200) light++
    else if (y >= 120) mid++
    else if (y >= 30) dark++
    else black++
    if (Math.abs(y - gl) <= GARMENT_CLOSE) close++
    const mx = Math.max(r, gg, b)
    const mn = Math.min(r, gg, b)
    if (mx > 76 && (mx - mn) / mx > 0.5) sat++
  }
  const total = d.length / 4
  const ink = solid + partial
  const f = (n: number) => (ink ? n / ink : 0)
  return {
    widthPx: img.width,
    heightPx: img.height,
    clear,
    solid,
    partial,
    clearFraction: total ? clear / total : 0,
    solidFraction: total ? solid / total : 0,
    hiddenColor: hidden,
    uniqueColors: colors.size,
    brightness: { pureWhite: f(pureWhite), light: f(light), mid: f(mid), dark: f(dark), black: f(black) },
    garmentClose: f(close),
    saturated: f(sat),
  }
}

/** Set RGB to 0,0,0 wherever alpha is 0, so no hidden color can bleed into edges in a RIP or resize. */
export function clearHiddenColor(img: RGBAImage): number {
  const d = img.data
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0 && (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0)) {
      d[i] = 0
      d[i + 1] = 0
      d[i + 2] = 0
      n++
    }
  }
  return n
}
