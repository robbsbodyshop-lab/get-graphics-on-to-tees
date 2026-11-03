import type { Lab, RGB } from '../types'

// sRGB (D65) <-> CIE L*a*b*. Delta E is CIE76 (Euclidean distance in Lab): simple, fast enough
// for per-pixel work on 6000 px images, and what the knockout tolerance slider (2..25) is measured in.

const LINEAR = new Float64Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const XN = 0.95047
const YN = 1.0
const ZN = 1.08883
const EPS = 216 / 24389
const KAPPA = 24389 / 27

function f(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116
}

/** 0..255 sRGB channels -> Lab. Channels are rounded and clamped. */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const R = LINEAR[clamp8(r)]
  const G = LINEAR[clamp8(g)]
  const B = LINEAR[clamp8(b)]
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / XN
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / YN
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / ZN
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export function deltaE76(p: Lab, q: Lab): number {
  const dL = p.L - q.L
  const da = p.a - q.a
  const db = p.b - q.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

/** Relative luminance (WCAG / Rec.709 on linearized sRGB), 0..1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[clamp8(r)] + 0.7152 * LINEAR[clamp8(g)] + 0.0722 * LINEAR[clamp8(b)]
}

/** Perceptual lightness L* / 100, 0..1. Use this for tone -> halftone coverage. */
export function lightness01(r: number, g: number, b: number): number {
  const y = relativeLuminance(r, g, b)
  return (116 * f(y) - 16) / 100
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Bad hex color: ${hex}`)
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(c: RGB): string {
  const h = (v: number) => clamp8(v).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/**
 * Returns a predicate "is this 24-bit color within `tol` Delta E of any target?" backed by a
 * lazily filled 16M-entry cache (16 MB), so per-pixel tests on huge images stay cheap.
 */
export function makeColorMatcher(targets: RGB[], tol: number): (r: number, g: number, b: number) => boolean {
  const labs = targets.map((t) => srgbToLab(t.r, t.g, t.b))
  if (labs.length === 0) return () => false
  const cache = new Uint8Array(1 << 24) // 0 unknown, 1 no, 2 yes
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b
    const c = cache[key]
    if (c !== 0) return c === 2
    const lab = srgbToLab(r, g, b)
    let hit = false
    for (const t of labs) {
      if (deltaE76(lab, t) <= tol) {
        hit = true
        break
      }
    }
    cache[key] = hit ? 2 : 1
    return hit
  }
}
