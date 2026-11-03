import type { RGB, RGBAImage } from '../types'
import { makeColorMatcher } from './color'

/** Make every pixel within `toleranceDE` (CIE76) of any target transparent. */
export function knockoutColors(img: RGBAImage, colors: RGB[], toleranceDE: number): { removed: number } {
  if (colors.length === 0) return { removed: 0 }
  const match = makeColorMatcher(colors, toleranceDE)
  const d = img.data
  let removed = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    if (match(d[i], d[i + 1], d[i + 2])) {
      d[i + 3] = 0
      removed++
    }
  }
  return { removed }
}

function edgeReference(img: RGBAImage): RGB | null {
  const { width: w, height: h, data: d } = img
  const count = new Uint32Array(32768)
  const sr = new Float64Array(32768)
  const sg = new Float64Array(32768)
  const sb = new Float64Array(32768)
  let any = false
  const visit = (p: number) => {
    const i = p * 4
    if (d[i + 3] === 0) return
    any = true
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)
    count[k]++
    sr[k] += d[i]
    sg[k] += d[i + 1]
    sb[k] += d[i + 2]
  }
  for (let x = 0; x < w; x++) {
    visit(x)
    if (h > 1) visit((h - 1) * w + x)
  }
  for (let y = 1; y < h - 1; y++) {
    visit(y * w)
    if (w > 1) visit(y * w + w - 1)
  }
  if (!any) return null
  let best = 0
  for (let k = 1; k < 32768; k++) if (count[k] > count[best]) best = k
  const n = count[best]
  return { r: Math.round(sr[best] / n), g: Math.round(sg[best] / n), b: Math.round(sb[best] / n) }
}

/** Flood-fill the background from the canvas edges (4-connected), then clean the halo. */
export function removeBackgroundFlood(
  img: RGBAImage,
  toleranceDE: number,
  opts?: { reference?: RGB; fringeRings?: number },
): { removed: number; reference: RGB | null } {
  const { width: w, height: h, data: d } = img
  const reference = opts?.reference ?? edgeReference(img)
  if (!reference || w === 0 || h === 0) return { removed: 0, reference: null }
  const rings = opts?.fringeRings ?? 1
  const match = makeColorMatcher([reference], toleranceDE)
  const n = w * h
  const flooded = new Uint8Array(n) // 1 = reached by the fill (background)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  let removed = 0

  const tryPush = (p: number) => {
    if (flooded[p]) return
    const i = p * 4
    if (d[i + 3] === 0 || match(d[i], d[i + 1], d[i + 2])) {
      flooded[p] = 1
      queue[tail++] = p
    }
  }
  for (let x = 0; x < w; x++) {
    tryPush(x)
    tryPush((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    tryPush(y * w)
    tryPush(y * w + w - 1)
  }
  while (head < tail) {
    const p = queue[head++]
    const i = p * 4
    if (d[i + 3] !== 0) {
      d[i + 3] = 0
      removed++
    }
    const x = p % w
    if (x > 0) tryPush(p - 1)
    if (x < w - 1) tryPush(p + 1)
    if (p >= w) tryPush(p - w)
    if (p < n - w) tryPush(p + w)
  }

  if (rings > 0 && removed > 0) {
    const matchWide = makeColorMatcher([reference], toleranceDE * 2.5)
    for (let ring = 0; ring < rings; ring++) {
      let marked = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x
          const i = p * 4
          if (d[i + 3] === 0 || flooded[p] === 1) continue
          if (!matchWide(d[i], d[i + 1], d[i + 2])) continue
          let adj = false
          for (let dy = -1; dy <= 1 && !adj; dy++) {
            const yy = y + dy
            if (yy < 0 || yy >= h) continue
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue
              if (flooded[yy * w + xx] === 1) {
                adj = true
                break
              }
            }
          }
          if (adj) {
            flooded[p] = 2 // pending
            marked++
          }
        }
      }
      if (marked === 0) break
      for (let p = 0; p < n; p++) {
        if (flooded[p] === 2) {
          flooded[p] = 1
          d[p * 4 + 3] = 0
          removed++
        }
      }
    }
  }
  return { removed, reference }
}
