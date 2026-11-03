import type { RGBAImage } from '../types'

/** Alpha < 255 -> 0 at/under threshold, otherwise 255. No semi-transparent pixel survives. */
export function hardThreshold(img: RGBAImage, threshold01: number): { madeOpaque: number; madeTransparent: number } {
  const t = Math.max(1, Math.round(threshold01 * 255))
  const d = img.data
  let madeOpaque = 0
  let madeTransparent = 0
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i]
    if (a === 0 || a === 255) continue
    if (a >= t) {
      d[i] = 255
      madeOpaque++
    } else {
      d[i] = 0
      madeTransparent++
    }
  }
  return { madeOpaque, madeTransparent }
}

/**
 * Separable square erosion/dilation of a 0/1 mask with window radius r (size 2r+1).
 * Pixels outside the image take the value `outside`. Returns a new mask.
 */
export function morphMask(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number,
  op: 'erode' | 'dilate',
  outside: 0 | 1,
): Uint8Array {
  const size = 2 * r + 1
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  const test = (cnt: number) => (op === 'erode' ? cnt === size : cnt > 0)
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w
    let cnt = 0
    for (let i = -r; i <= r; i++) cnt += i < 0 || i >= w ? outside : mask[row + i]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = test(cnt) ? 1 : 0
      const add = x + r + 1
      const sub = x - r
      cnt += (add >= w ? outside : mask[row + add]) - (sub < 0 ? outside : mask[row + sub])
    }
  }
  // vertical, row sweep with per-column counters
  const cnt = new Int32Array(w)
  for (let i = -r; i <= r; i++) {
    if (i < 0 || i >= h) {
      if (outside) for (let x = 0; x < w; x++) cnt[x]++
    } else {
      const row = i * w
      for (let x = 0; x < w; x++) cnt[x] += tmp[row + x]
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) out[row + x] = test(cnt[x]) ? 1 : 0
    const add = y + r + 1
    const sub = y - r
    for (let x = 0; x < w; x++) {
      cnt[x] += (add >= h ? outside : tmp[add * w + x]) - (sub < 0 ? outside : tmp[sub * w + x])
    }
  }
  return out
}

/** Erode the opaque (alpha > 0) region with a square of radius px. */
export function choke(img: RGBAImage, px = 1): { removed: number } {
  if (px <= 0) return { removed: 0 }
  const { width: w, height: h, data: d } = img
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0; p < n; p++) mask[p] = d[p * 4 + 3] > 0 ? 1 : 0
  const eroded = morphMask(mask, w, h, px, 'erode', 0)
  let removed = 0
  for (let p = 0; p < n; p++) {
    if (mask[p] === 1 && eroded[p] === 0) {
      d[p * 4 + 3] = 0
      removed++
    }
  }
  return { removed }
}

/** Dilate the opaque region px times (8-neighbourhood); new pixels take the mean colour of opaque neighbours. */
export function thicken(img: RGBAImage, px = 1): { added: number } {
  const { width: w, height: h, data: d } = img
  const n = w * h
  let cur = new Uint8Array(n)
  for (let p = 0; p < n; p++) cur[p] = d[p * 4 + 3] > 0 ? 1 : 0
  let next = new Uint8Array(n)
  let added = 0
  for (let iter = 0; iter < px; iter++) {
    next.set(cur)
    let changed = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (cur[p] === 1) continue
        let r = 0
        let g = 0
        let b = 0
        let c = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (cur[q] === 1) {
              r += d[q * 4]
              g += d[q * 4 + 1]
              b += d[q * 4 + 2]
              c++
            }
          }
        }
        if (c > 0) {
          const i = p * 4
          d[i] = Math.round(r / c)
          d[i + 1] = Math.round(g / c)
          d[i + 2] = Math.round(b / c)
          d[i + 3] = 255
          next[p] = 1
          changed++
        }
      }
    }
    added += changed
    const t = cur
    cur = next
    next = t
    if (changed === 0) break
  }
  return { added }
}

/**
 * Delete 8-connected islands (alpha > 0) whose bbox width AND height are both < minSizePx,
 * unless any pixel of the island is protected.
 */
export function removeSpecks(
  img: RGBAImage,
  minSizePx: number,
  protect?: Uint8Array,
): { islandsRemoved: number; pixelsRemoved: number } {
  const { width: w, height: h, data: d } = img
  const n = w * h
  const visited = new Uint8Array(n)
  const queue = new Int32Array(n)
  let tail = 0
  let islandsRemoved = 0
  let pixelsRemoved = 0
  for (let s = 0; s < n; s++) {
    if (visited[s] || d[s * 4 + 3] === 0) continue
    const start = tail
    let head = tail
    queue[tail++] = s
    visited[s] = 1
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    let prot = false
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (protect && protect[p] !== 0) prot = true
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (visited[q] || d[q * 4 + 3] === 0) continue
          visited[q] = 1
          queue[tail++] = q
        }
      }
    }
    if (maxX - minX + 1 < minSizePx && maxY - minY + 1 < minSizePx && !prot) {
      for (let k = start; k < tail; k++) d[queue[k] * 4 + 3] = 0
      islandsRemoved++
      pixelsRemoved += tail - start
    }
  }
  return { islandsRemoved, pixelsRemoved }
}

export function speckSizePx(minInches: number, dpi = 300): number {
  return Math.max(1, Math.round(minInches * dpi))
}
