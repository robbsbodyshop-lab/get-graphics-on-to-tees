import type { MaskKind, RGBAImage } from '../types'

/**
 * Built-in grunge masks. A mask is a size x size grayscale FIELD that tiles seamlessly; a pixel
 * is removed by distress when field value < intensity * 255. Every field is rank-equalised so
 * the removed fraction ~= intensity * 0.6 and marks grow (not multiply) as intensity rises.
 */

export const MASK_LABELS: Record<MaskKind, string> = {
  scratched: 'Scratched',
  cracked: 'Cracked ink',
  speckle: 'Speckle',
  sandblasted: 'Sandblasted',
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KIND_SALT: Record<MaskKind, number> = { scratched: 101, cracked: 202, speckle: 303, sandblasted: 404 }

/** Wrapped bilinear (smoothstep) value noise, period in px, output 0..1. */
function valueNoise(size: number, period: number, rng: () => number): Float32Array {
  const n = Math.max(1, Math.round(size / period))
  const lat = new Float32Array(n * n)
  for (let i = 0; i < lat.length; i++) lat[i] = rng()
  const out = new Float32Array(size * size)
  const step = n / size
  for (let y = 0; y < size; y++) {
    const fy = y * step
    const iy = Math.floor(fy)
    const ty = fy - iy
    const sy = ty * ty * (3 - 2 * ty)
    const r0 = (iy % n) * n
    const r1 = ((iy + 1) % n) * n
    for (let x = 0; x < size; x++) {
      const fx = x * step
      const ix = Math.floor(fx)
      const tx = fx - ix
      const sx = tx * tx * (3 - 2 * tx)
      const x0 = ix % n
      const x1 = (ix + 1) % n
      const top = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * sx
      const bot = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * sx
      out[y * size + x] = top + (bot - top) * sy
    }
  }
  return out
}

/** Rank-equalise: darkest 60 % spread over 0..255, the rest 255. */
function equalise(field: Float32Array): Uint8Array {
  const n = field.length
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = field[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const BINS = 65536
  const range = max - min || 1
  const hist = new Uint32Array(BINS)
  const bin = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(((field[i] - min) / range) * (BINS - 1)))
    bin[i] = b
    hist[b]++
  }
  const lut = new Uint8Array(BINS)
  let cum = 0
  for (let b = 0; b < BINS; b++) {
    const p = (cum + hist[b] / 2) / n
    cum += hist[b]
    lut[b] = p >= 0.6 ? 255 : Math.min(255, Math.round((p / 0.6) * 255))
  }
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = lut[bin[i]]
  return out
}

/** Shortest wrapped difference on a torus of length `size`. */
function wrapDelta(d: number, size: number): number {
  d = d - size * Math.round(d / size)
  return d
}

function scratchedField(size: number, rng: () => number): Float32Array {
  const k = size / 512
  const BG = 100
  const field = new Float32Array(size * size).fill(BG)
  const strokes = 24
  const R = 30 * k // influence radius
  for (let s = 0; s < strokes; s++) {
    const hw = (1.5 + rng() * 2) * k // half width 1.5..3.5 => width 3..7
    const strength = rng()
    const pen = (1 - strength) * 3
    let x = rng() * size
    let y = rng() * size
    let ang = rng() * Math.PI * 2
    const segs = 2 + Math.floor(rng() * 4)
    for (let g = 0; g < segs; g++) {
      ang += (rng() - 0.5) * 0.9
      const len = (50 + rng() * 120) * k
      const bx = x + Math.cos(ang) * len
      const by = y + Math.sin(ang) * len
      // Raster region around the segment (in the unwrapped frame), written with wrap.
      const minX = Math.floor(Math.min(x, bx) - R)
      const maxX = Math.ceil(Math.max(x, bx) + R)
      const minY = Math.floor(Math.min(y, by) - R)
      const maxY = Math.ceil(Math.max(y, by) + R)
      for (let yy = minY; yy <= maxY; yy++) {
        const wy = ((yy % size) + size) % size
        for (let xx = minX; xx <= maxX; xx++) {
          const wx = ((xx % size) + size) % size
          // distance in unwrapped frame (xx,yy are already unwrapped near the segment)
          const sx = bx - x
          const sy = by - y
          const l2 = sx * sx + sy * sy
          let t = ((xx - x) * sx + (yy - y) * sy) / l2
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const ex = xx - (x + sx * t)
          const ey = yy - (y + sy * t)
          const d = Math.sqrt(ex * ex + ey * ey)
          if (d > R) continue
          const v = pen + Math.max(0, d - hw) / hw
          const idx = wy * size + wx
          if (v < field[idx]) field[idx] = v
        }
      }
      x = bx
      y = by
    }
  }
  const n1 = valueNoise(size, 96 * k, rng)
  const n2 = valueNoise(size, 24 * k, rng)
  for (let i = 0; i < field.length; i++) field[i] += n1[i] * 0.01 + n2[i] * 0.002
  return field
}

function crackedField(size: number, rng: () => number): Float32Array {
  const k = size / 512
  const count = 25 + Math.floor(rng() * 36)
  const sx = new Float32Array(count)
  const sy = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    sx[i] = rng() * size
    sy[i] = rng() * size
  }
  const noise = valueNoise(size, 128 * k, rng)
  const noise2 = valueNoise(size, 40 * k, rng)
  const field = new Float32Array(size * size)
  const w0 = 4 * k // crack core width where value is flat
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f1 = Infinity
      let f2 = Infinity
      for (let i = 0; i < count; i++) {
        const dx = wrapDelta(x - sx[i], size)
        const dy = wrapDelta(y - sy[i], size)
        const d = dx * dx + dy * dy
        if (d < f1) {
          f2 = f1
          f1 = d
        } else if (d < f2) f2 = d
      }
      const gap = Math.sqrt(f2) - Math.sqrt(f1)
      const idx = y * size + x
      field[idx] = Math.max(0, gap - w0) + (noise[idx] * 14 + noise2[idx] * 4) * k
    }
  }
  return field
}

function speckleField(size: number, rng: () => number): Float32Array {
  const k = size / 512
  const BG = 100
  const field = new Float32Array(size * size).fill(BG)
  const blobs = 140
  for (let b = 0; b < blobs; b++) {
    const cx = rng() * size
    const cy = rng() * size
    const r = (3 + rng() * 9) * k
    const pen = (1 - rng()) * 3
    const R = r * 2.2
    const x0 = Math.floor(cx - R)
    const x1 = Math.ceil(cx + R)
    const y0 = Math.floor(cy - R)
    const y1 = Math.ceil(cy + R)
    for (let yy = y0; yy <= y1; yy++) {
      const wy = ((yy % size) + size) % size
      for (let xx = x0; xx <= x1; xx++) {
        const wx = ((xx % size) + size) % size
        const d = Math.hypot(xx - cx, yy - cy)
        if (d > R) continue
        const v = pen + Math.max(0, d - r) / r
        const idx = wy * size + wx
        if (v < field[idx]) field[idx] = v
      }
    }
  }
  const n1 = valueNoise(size, 64 * k, rng)
  const n2 = valueNoise(size, 24 * k, rng)
  for (let i = 0; i < field.length; i++) field[i] += n1[i] * 0.6 + n2[i] * 0.15
  return field
}

function sandblastedField(size: number, rng: () => number): Float32Array {
  const k = size / 512
  const layers: [Float32Array, number][] = [
    [valueNoise(size, 128 * k, rng), 1],
    [valueNoise(size, 64 * k, rng), 0.5],
    [valueNoise(size, 64 * k, rng), 0.25],
  ]
  const field = new Float32Array(size * size)
  for (const [n, wgt] of layers) for (let i = 0; i < field.length; i++) field[i] += n[i] * wgt
  return field
}

/** size x size grayscale field (row-major). Remove where value < intensity * 255. */
export function generateMask(kind: MaskKind, size = 512, seed = 1): Uint8Array {
  const rng = mulberry32((seed * 2654435761 + KIND_SALT[kind]) >>> 0)
  let field: Float32Array
  switch (kind) {
    case 'scratched': field = scratchedField(size, rng); break
    case 'cracked': field = crackedField(size, rng); break
    case 'speckle': field = speckleField(size, rng); break
    case 'sandblasted': field = sandblastedField(size, rng); break
  }
  return equalise(field)
}

/**
 * Tile `field` across the image (one tile spans `tilePx` pixels, nearest neighbour) and clear
 * alpha where value < intensity * 255. Binary only.
 */
export function applyDistress(
  img: RGBAImage,
  field: Uint8Array,
  fieldSize: number,
  intensity: number,
  tilePx: number,
): { removed: number } {
  const { width: w, height: h, data } = img
  const thr = intensity * 255
  if (thr <= 0) return { removed: 0 }
  const scale = fieldSize / tilePx
  const colIdx = new Int32Array(w)
  for (let x = 0; x < w; x++) colIdx[x] = Math.floor(x * scale) % fieldSize
  let removed = 0
  for (let y = 0; y < h; y++) {
    const rowBase = (Math.floor(y * scale) % fieldSize) * fieldSize
    const di = y * w * 4 + 3
    for (let x = 0; x < w; x++) {
      const i = di + x * 4
      if (data[i] > 0 && field[rowBase + colIdx[x]] < thr) {
        data[i] = 0
        removed++
      }
    }
  }
  return { removed }
}
