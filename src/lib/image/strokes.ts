import type { RGBAImage } from '../types'
import { morphMask } from './alpha'

export interface StrokeCheck {
  thinStrokePixels: number
  thinStrokeFraction: number
  thinGapPixels: number
  smallDetailCount: number
  flagged: boolean
  messages: string[]
}

function kernelRadius(minPx: number): number {
  let k = Math.floor(minPx)
  if (k % 2 === 0) k -= 1
  if (k < 3) k = 3
  return (k - 1) / 2
}

const inches = (px: number) => (px / 300).toFixed(2)

export function checkStrokes(
  img: RGBAImage,
  opts: { minStrokePx: number; minGapPx: number; minDetailPx: number; protect?: Uint8Array },
): StrokeCheck {
  const { width: w, height: h, data: d } = img
  const n = w * h
  const protect = opts.protect
  const ink = new Uint8Array(n)
  let opaque = 0
  let minX = w
  let maxX = -1
  let minY = h
  let maxY = -1
  for (let p = 0; p < n; p++) {
    if (d[p * 4 + 3] > 0) {
      ink[p] = 1
      opaque++
      const x = p % w
      const y = (p - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const result: StrokeCheck = {
    thinStrokePixels: 0,
    thinStrokeFraction: 0,
    thinGapPixels: 0,
    smallDetailCount: 0,
    flagged: false,
    messages: [],
  }
  if (opaque === 0) return result

  // thin strokes: ink not present in opening(ink)
  {
    const r = kernelRadius(opts.minStrokePx)
    const opened = morphMask(morphMask(ink, w, h, r, 'erode', 0), w, h, r, 'dilate', 0)
    let c = 0
    for (let p = 0; p < n; p++) {
      if (ink[p] === 1 && opened[p] === 0 && !(protect && protect[p] !== 0)) c++
    }
    result.thinStrokePixels = c
    result.thinStrokeFraction = c / opaque
  }

  // thin gaps: transparent pixels not in opening(transparent), inside the ink bbox
  {
    const r = kernelRadius(opts.minGapPx)
    const clear = new Uint8Array(n)
    for (let p = 0; p < n; p++) clear[p] = ink[p] ^ 1
    const opened = morphMask(morphMask(clear, w, h, r, 'erode', 1), w, h, r, 'dilate', 1)
    let c = 0
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = y * w + x
        if (clear[p] === 1 && opened[p] === 0 && !(protect && protect[p] !== 0)) c++
      }
    }
    result.thinGapPixels = c
  }

  // small details: 8-connected components with bbox max(w,h) < minDetailPx
  {
    const visited = new Uint8Array(n)
    const queue = new Int32Array(n)
    let tail = 0
    let count = 0
    for (let s = 0; s < n; s++) {
      if (visited[s] || ink[s] === 0) continue
      let head = tail
      queue[tail++] = s
      visited[s] = 1
      let x0 = w
      let x1 = -1
      let y0 = h
      let y1 = -1
      let prot = false
      while (head < tail) {
        const p = queue[head++]
        const x = p % w
        const y = (p - x) / w
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        if (protect && protect[p] !== 0) prot = true
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (visited[q] || ink[q] === 0) continue
            visited[q] = 1
            queue[tail++] = q
          }
        }
      }
      if (!prot && Math.max(x1 - x0 + 1, y1 - y0 + 1) < opts.minDetailPx) count++
      tail = 0 // component data no longer needed; reuse queue (visited still guards)
    }
    result.smallDetailCount = count
  }

  const limit = Math.max(40, 0.002 * opaque)
  if (result.thinStrokePixels > limit) {
    result.messages.push(
      `About ${(result.thinStrokeFraction * 100).toFixed(1)}% of the ink is thinner than ${inches(opts.minStrokePx)} in; it may not hold on the film. Try Thicken strokes 1 px.`,
    )
  }
  if (result.thinGapPixels > limit) {
    result.messages.push(
      `Some gaps are narrower than ${inches(opts.minGapPx)} in and may fill in with adhesive or ink. Try Choke 1 px or widen the spacing.`,
    )
  }
  if (result.smallDetailCount > 0) {
    result.messages.push(
      `${result.smallDetailCount} tiny detail${result.smallDetailCount === 1 ? '' : 's'} smaller than ${inches(opts.minDetailPx)} in (small text or dots) may not stick. Enlarge them or use Remove specks.`,
    )
  }
  result.flagged = result.messages.length > 0
  return result
}
