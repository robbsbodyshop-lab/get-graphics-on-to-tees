import type { Lab, RGBAImage } from '../types'
import { deltaE76, lightness01, rgbToHex, srgbToLab } from '../image/color'
import type { ImageTraits } from './types'

// Measures what an uploaded image looks like so the prompt interpreter can pick settings.
// Pure (no DOM). Large images are sampled on a grid with a stride so the work stays under about
// 1.5 million pixels whatever the input size.

const MAX_SIDE = 1200
const BG_DELTA_E = 10
const BORDER_SHARE = 0.9

/** Per 5-bit-per-channel color: cached lightness and Lab of the bucket centre. */
class ColorCache {
  private readonly state = new Uint8Array(32768)
  private readonly light = new Float32Array(32768)
  private readonly labs: (Lab | undefined)[] = new Array(32768)

  private fill(key: number): void {
    const r = (((key >> 10) & 31) << 3) | 4
    const g = (((key >> 5) & 31) << 3) | 4
    const b = ((key & 31) << 3) | 4
    this.light[key] = lightness01(r, g, b)
    this.labs[key] = srgbToLab(r, g, b)
    this.state[key] = 1
  }

  lightness(key: number): number {
    if (this.state[key] === 0) this.fill(key)
    return this.light[key]
  }

  lab(key: number): Lab {
    if (this.state[key] === 0) this.fill(key)
    return this.labs[key] as Lab
  }
}

/** The border color (mean of the most common 4-bit bucket) and the share of border pixels near it. */
function measureBorder(img: RGBAImage): { hex: string; share: number } {
  const { width: w, height: h, data } = img
  const xs = Math.max(1, Math.floor(w / 2000))
  const ys = Math.max(1, Math.floor(h / 2000))
  const picks: number[] = []
  for (let x = 0; x < w; x += xs) {
    picks.push(x, (h - 1) * w + x)
  }
  for (let y = 0; y < h; y += ys) {
    picks.push(y * w, y * w + (w - 1))
  }
  const sums = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const p of picks) {
    const i = p * 4
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    const s = sums.get(key)
    if (s) {
      s.n++
      s.r += data[i]
      s.g += data[i + 1]
      s.b += data[i + 2]
    } else sums.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] })
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const s of sums.values()) if (!best || s.n > best.n) best = s
  if (!best) return { hex: '#000000', share: 0 }
  const ref = { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) }
  const refLab = srgbToLab(ref.r, ref.g, ref.b)
  let near = 0
  for (const p of picks) {
    const i = p * 4
    if (deltaE76(srgbToLab(data[i], data[i + 1], data[i + 2]), refLab) <= BG_DELTA_E) near++
  }
  return { hex: rgbToHex(ref), share: near / picks.length }
}

export function describeImage(img: RGBAImage): ImageTraits {
  const { width, height, data } = img
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / MAX_SIDE))

  // Pass 1: alpha and color statistics over the sampled grid.
  let sampled = 0
  let transparent = 0
  let soft = 0
  const seen32 = new Uint8Array(32768)
  let distinct = 0
  const buckets16 = new Uint32Array(4096)
  let inkForDominant = 0
  let anyAlpha = false

  for (let y = 0; y < height; y += stride) {
    let i = y * width * 4
    for (let x = 0; x < width; x += stride, i += stride * 4) {
      sampled++
      const a = data[i + 3]
      if (a < 255) {
        anyAlpha = true
        if (a === 0) {
          transparent++
          continue
        }
        soft++
      }
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
      if (seen32[key] === 0) {
        seen32[key] = 1
        distinct++
      }
      if (a >= 128) {
        inkForDominant++
        buckets16[((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)]++
      }
    }
  }

  let dominant = 0
  if (inkForDominant > 0) for (let k = 0; k < 4096; k++) if (buckets16[k] / inkForDominant >= 0.005) dominant++

  // Solid background: opaque image whose border is one color.
  const hasAlpha = anyAlpha
  let solidBackground = false
  let backgroundHex: string | null = null
  let bgLab: Lab | null = null
  if (!hasAlpha && width > 0 && height > 0) {
    const border = measureBorder(img)
    if (border.share >= BORDER_SHARE) {
      solidBackground = true
      backgroundHex = border.hex
      const r = parseInt(border.hex.slice(1, 3), 16)
      const g = parseInt(border.hex.slice(3, 5), 16)
      const b = parseInt(border.hex.slice(5, 7), 16)
      bgLab = srgbToLab(r, g, b)
    }
  }

  // Pass 2: ink shares (alpha >= 128, excluding a solid background).
  const cache = new ColorCache()
  let ink = 0
  let dark = 0
  let light = 0
  let saturated = 0
  for (let y = 0; y < height; y += stride) {
    let i = y * width * 4
    for (let x = 0; x < width; x += stride, i += stride * 4) {
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      if (bgLab && deltaE76(cache.lab(key), bgLab) <= BG_DELTA_E) continue
      ink++
      const L = cache.lightness(key)
      if (L < 0.2) dark++
      else if (L > 0.85) light++
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b
      if (mx > 76 && (mx - mn) / mx > 0.5) saturated++
    }
  }

  const kind: ImageTraits['kind'] =
    dominant <= 8 ? 'flat' : !hasAlpha && !solidBackground && distinct > 3000 ? 'photo' : 'illustration'

  return {
    width,
    height,
    hasAlpha,
    softAlphaFraction: sampled > 0 ? soft / sampled : 0,
    distinctColors: distinct,
    dominantColors: dominant,
    solidBackground,
    backgroundHex,
    darkInkFraction: ink > 0 ? dark / ink : 0,
    lightInkFraction: ink > 0 ? light / ink : 0,
    saturatedFraction: ink > 0 ? saturated / ink : 0,
    kind,
  }
}
