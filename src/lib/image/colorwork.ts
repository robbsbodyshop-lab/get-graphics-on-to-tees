import type { Lab, RGB, RGBAImage } from '../types'
import { deltaE76, srgbToLab } from './color'

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

const MAX_SAMPLES = 20000
const MAX_ITERS = 15
const RESCUE_ITERS = 5
const OUTLIER_DE = 20 // sample this far from every centre counts as an outlier
const GROUP_DE = 15 // greedy outlier grouping radius
const MERGE_DE = 2 // centres closer than this are merged
const OUTLIER_FRAC = 0.002 // a rescued group must be >= 0.2% of the sample
const ACCENT_FRAC = 0.001 // ... or 0.1% when it is a saturated accent
const ACCENT_CHROMA = 25
const MIN_GROUP_PX = 8
const MAX_GROUPS = 32

/** Reduce to `colors` flat colours (k-means in Lab over pixels with alpha > 0). */
export function posterize(img: RGBAImage, colors: number, seed = 1): { palette: RGB[] } {
  const { data } = img
  const n = img.width * img.height
  let opaque = 0
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] > 0) opaque++
  if (opaque === 0 || colors < 1) return { palette: [] }

  // Deterministic sample.
  const m = Math.min(MAX_SAMPLES, opaque)
  const stride = opaque / m
  const sL = new Float64Array(m)
  const sA = new Float64Array(m)
  const sB = new Float64Array(m)
  const sR = new Uint8Array(m)
  const sG = new Uint8Array(m)
  const sBl = new Uint8Array(m)
  let seen = 0
  let next = 0
  let got = 0
  for (let p = 0; p < n && got < m; p++) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    if (seen >= next) {
      const lab = srgbToLab(data[i], data[i + 1], data[i + 2])
      sL[got] = lab.L
      sA[got] = lab.a
      sB[got] = lab.b
      sR[got] = data[i]
      sG[got] = data[i + 1]
      sBl[got] = data[i + 2]
      got++
      next = got * stride
    }
    seen++
  }
  const cnt = got
  const k = Math.min(colors, cnt)
  const rng = mulberry32(seed * 7919 + 13)

  // k-means++ init.
  const cL = new Float64Array(k)
  const cA = new Float64Array(k)
  const cB = new Float64Array(k)
  const d2 = new Float64Array(cnt).fill(Infinity)
  let first = Math.floor(rng() * cnt)
  for (let c = 0; c < k; c++) {
    if (c > 0) {
      let total = 0
      for (let i = 0; i < cnt; i++) total += d2[i]
      if (total <= 0) {
        first = Math.floor(rng() * cnt)
      } else {
        let r = rng() * total
        first = cnt - 1
        for (let i = 0; i < cnt; i++) {
          r -= d2[i]
          if (r <= 0) {
            first = i
            break
          }
        }
      }
    }
    cL[c] = sL[first]
    cA[c] = sA[first]
    cB[c] = sB[first]
    for (let i = 0; i < cnt; i++) {
      const dl = sL[i] - cL[c]
      const da = sA[i] - cA[c]
      const db = sB[i] - cB[c]
      const d = dl * dl + da * da + db * db
      if (d < d2[i]) d2[i] = d
    }
  }

  const alive = new Uint8Array(k).fill(1)
  const assign = new Int32Array(cnt).fill(-1)
  const d1sq = new Float64Array(cnt) // squared distance to the nearest centre
  const d2sq = new Float64Array(cnt) // squared distance to the second nearest (Infinity if none)
  const sumL = new Float64Array(k)
  const sumA = new Float64Array(k)
  const sumB = new Float64Array(k)
  const num = new Int32Array(k)

  /** Assign every sample to its nearest live centre; returns how many changed. */
  const assignAll = (): number => {
    let changed = 0
    for (let i = 0; i < cnt; i++) {
      let best = -1
      let bd = Infinity
      let sd = Infinity
      for (let c = 0; c < k; c++) {
        if (!alive[c]) continue
        const dl = sL[i] - cL[c]
        const da = sA[i] - cA[c]
        const db = sB[i] - cB[c]
        const d = dl * dl + da * da + db * db
        if (d < bd) { sd = bd; bd = d; best = c }
        else if (d < sd) sd = d
      }
      if (assign[i] !== best) changed++
      assign[i] = best
      d1sq[i] = bd
      d2sq[i] = sd
    }
    return changed
  }
  const tally = () => {
    sumL.fill(0); sumA.fill(0); sumB.fill(0); num.fill(0)
    for (let i = 0; i < cnt; i++) {
      const c = assign[i]
      sumL[c] += sL[i]; sumA[c] += sA[i]; sumB[c] += sB[i]; num[c]++
    }
  }
  const lloyd = (maxIters: number) => {
    for (let it = 0; it < maxIters; it++) {
      const changed = assignAll()
      tally()
      for (let c = 0; c < k; c++) {
        if (!alive[c]) continue
        if (num[c] > 0) {
          cL[c] = sumL[c] / num[c]
          cA[c] = sumA[c] / num[c]
          cB[c] = sumB[c] / num[c]
        } else alive[c] = 0 // empty cluster: free the slot
      }
      if (changed === 0) break
    }
  }
  /** Merge live centres closer than Delta E 2 (the smaller one is dropped). */
  const mergeClose = (): boolean => {
    let any = false
    for (;;) {
      assignAll()
      tally()
      let bi = -1
      let bj = -1
      for (let i = 0; i < k; i++) {
        if (!alive[i]) continue
        for (let j = i + 1; j < k; j++) {
          if (!alive[j]) continue
          const dl = cL[i] - cL[j]
          const da = cA[i] - cA[j]
          const db = cB[i] - cB[j]
          if (dl * dl + da * da + db * db < MERGE_DE * MERGE_DE) { bi = i; bj = j; break }
        }
        if (bi >= 0) break
      }
      if (bi < 0) return any
      const keep = num[bi] >= num[bj] ? bi : bj
      const drop = keep === bi ? bj : bi
      const tot = num[keep] + num[drop]
      if (tot > 0) {
        cL[keep] = (cL[keep] * num[keep] + cL[drop] * num[drop]) / tot
        cA[keep] = (cA[keep] * num[keep] + cA[drop] * num[drop]) / tot
        cB[keep] = (cB[keep] * num[keep] + cB[drop] * num[drop]) / tot
      }
      alive[drop] = 0
      any = true
    }
  }
  /** Largest qualifying group of samples far (Delta E > 20) from every centre. Needs fresh assignAll(). */
  const bestOutlierGroup = (): Lab | null => {
    const minAll = Math.max(MIN_GROUP_PX, Math.ceil(cnt * ACCENT_FRAC))
    const minGroup = Math.max(MIN_GROUP_PX, Math.ceil(cnt * OUTLIER_FRAC))
    const lim2 = OUTLIER_DE * OUTLIER_DE
    const gl: number[] = []
    const ga: number[] = []
    const gb: number[] = []
    const gn: number[] = []
    let outliers = 0
    for (let i = 0; i < cnt; i++) {
      if (d1sq[i] <= lim2) continue
      outliers++
      let bg = -1
      let bd = Infinity
      for (let g = 0; g < gn.length; g++) {
        const dl = sL[i] - gl[g] / gn[g]
        const da = sA[i] - ga[g] / gn[g]
        const db = sB[i] - gb[g] / gn[g]
        const d = dl * dl + da * da + db * db
        if (d < bd) { bd = d; bg = g }
      }
      if (bg < 0 || (bd > GROUP_DE * GROUP_DE && gn.length < MAX_GROUPS)) {
        gl.push(sL[i]); ga.push(sA[i]); gb.push(sB[i]); gn.push(1)
      } else {
        gl[bg] += sL[i]; ga[bg] += sA[i]; gb[bg] += sB[i]; gn[bg]++
      }
    }
    if (outliers < minAll) return null
    let pick = -1
    for (let g = 0; g < gn.length; g++) {
      const n = gn[g]
      const chroma = Math.hypot(ga[g], gb[g]) / n
      const need = chroma > ACCENT_CHROMA ? minAll : minGroup
      if (n >= need && (pick < 0 || n > gn[pick])) pick = g
    }
    if (pick < 0) return null
    return { L: gl[pick] / gn[pick], a: ga[pick] / gn[pick], b: gb[pick] / gn[pick] }
  }
  /** The live centre whose removal costs least, skipping ones whose members would become outliers. */
  const leastUseful = (): number => {
    const cost = new Float64Array(k)
    const far = new Int32Array(k)
    const lim2 = OUTLIER_DE * OUTLIER_DE
    for (let i = 0; i < cnt; i++) {
      const c = assign[i]
      if (d2sq[i] === Infinity) return -1
      cost[c] += d2sq[i] - d1sq[i]
      if (d2sq[i] > lim2) far[c]++
    }
    const maxFar = Math.max(MIN_GROUP_PX, Math.ceil(cnt * OUTLIER_FRAC))
    let best = -1
    for (let c = 0; c < k; c++) {
      if (!alive[c] || far[c] >= maxFar) continue
      if (best < 0 || cost[c] < cost[best]) best = c
    }
    return best
  }

  lloyd(MAX_ITERS)
  for (let r = 0; r < colors && k > 1; r++) {
    mergeClose() // leaves a fresh assignment
    const g = bestOutlierGroup()
    if (!g) break
    let slot = alive.indexOf(0)
    if (slot < 0) slot = leastUseful()
    if (slot < 0) break
    cL[slot] = g.L; cA[slot] = g.a; cB[slot] = g.b
    alive[slot] = 1
    lloyd(RESCUE_ITERS)
  }
  mergeClose()
  // Member RGB means for the final assignment (mergeClose left it fresh).
  const mR = new Float64Array(k)
  const mG = new Float64Array(k)
  const mB = new Float64Array(k)
  num.fill(0)
  for (let i = 0; i < cnt; i++) {
    const best = assign[i]
    mR[best] += sR[i]; mG[best] += sG[i]; mB[best] += sBl[i]; num[best]++
  }

  const palette: RGB[] = []
  const black = srgbToLab(0, 0, 0)
  const white = srgbToLab(255, 255, 255)
  for (let c = 0; c < k; c++) {
    if (!alive[c] || num[c] === 0) continue
    let col: RGB = { r: Math.round(mR[c] / num[c]), g: Math.round(mG[c] / num[c]), b: Math.round(mB[c] / num[c]) }
    const lab: Lab = { L: cL[c], a: cA[c], b: cB[c] }
    if (deltaE76(lab, black) < 3) col = { r: 0, g: 0, b: 0 }
    else if (deltaE76(lab, white) < 3) col = { r: 255, g: 255, b: 255 }
    if (!palette.some((p) => p.r === col.r && p.g === col.g && p.b === col.b)) palette.push(col)
  }

  // Map every pixel to the nearest palette colour (memoised on 15-bit colour).
  const pl = palette.map((p) => srgbToLab(p.r, p.g, p.b))
  const cache = new Int16Array(32768).fill(-1)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    let idx = cache[key]
    if (idx < 0) {
      const lab = srgbToLab((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4)
      let bd = Infinity
      idx = 0
      for (let c = 0; c < pl.length; c++) {
        const d = deltaE76(lab, pl[c])
        if (d < bd) { bd = d; idx = c }
      }
      cache[key] = idx
    }
    const pc = palette[idx]
    data[i] = pc.r
    data[i + 1] = pc.g
    data[i + 2] = pc.b
  }
  return { palette }
}

/**
 * How much a posterize changed the ink. `shiftedFraction`: share of pixels with alpha > 0 in
 * `after` whose Delta E moved by more than 15. `lostAccentFraction`: share of those pixels that were
 * saturated before (C* > 25) and are no longer saturated after (C* < 12).
 */
export function posterizeShift(
  before: RGBAImage,
  after: RGBAImage,
): { shiftedFraction: number; lostAccentFraction: number } {
  const n = Math.min(before.width * before.height, after.width * after.height)
  const b = before.data
  const a = after.data
  let ink = 0
  let shifted = 0
  let lost = 0
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (a[i + 3] === 0) continue
    ink++
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue
    const lb = srgbToLab(b[i], b[i + 1], b[i + 2])
    const la = srgbToLab(a[i], a[i + 1], a[i + 2])
    if (deltaE76(lb, la) > 15) shifted++
    if (Math.hypot(lb.a, lb.b) > 25 && Math.hypot(la.a, la.b) < 12) lost++
  }
  return { shiftedFraction: ink ? shifted / ink : 0, lostAccentFraction: ink ? lost / ink : 0 }
}

/** Blend towards luminance grey. amount 0..1. */
export function desaturate(img: RGBAImage, amount: number): void {
  const a = Math.min(1, Math.max(0, amount))
  if (a === 0) return
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i] + (g - d[i]) * a
    d[i + 1] = d[i + 1] + (g - d[i + 1]) * a
    d[i + 2] = d[i + 2] + (g - d[i + 2]) * a
  }
}

/** Contrast around 128. amount -1..1, 0 = no-op. */
export function adjustContrast(img: RGBAImage, amount: number): void {
  const a = Math.min(0.99, Math.max(-1, amount))
  if (a === 0) return
  const f = Math.tan(((a + 1) * Math.PI) / 4)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round((v - 128) * f + 128)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
}

/** Snap tolerance shared by snapBlackWhite and colorWarnings. */
export const SNAP_TOL = 10

/** Channels all <= tol -> black; all >= 255 - tol -> white (alpha > 0 only). */
export function snapBlackWhite(img: RGBAImage, tol = SNAP_TOL): { snapped: number } {
  const d = img.data
  const hi = 255 - tol
  let snapped = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    if (r <= tol && g <= tol && b <= tol) {
      if (r !== 0 || g !== 0 || b !== 0) snapped++
      d[i] = d[i + 1] = d[i + 2] = 0
    } else if (r >= hi && g >= hi && b >= hi) {
      if (r !== 255 || g !== 255 || b !== 255) snapped++
      d[i] = d[i + 1] = d[i + 2] = 255
    }
  }
  return { snapped }
}

/**
 * Outline: transparent pixels (alpha < 128) within Euclidean distance `px` of a pixel with
 * alpha >= 128 become opaque `color`. Exact: horizontal run distance, then a vertical
 * lower-envelope (Felzenszwalb) pass, O(n).
 */
export function addOutline(img: RGBAImage, px: number, color: RGB): { added: number } {
  const { width: w, height: h, data } = img
  if (px <= 0) return { added: 0 }
  const cap = Math.ceil(px) + 1
  const hd = new Uint16Array(w * h)
  // Horizontal distance to nearest solid pixel in the row, clipped to cap.
  for (let y = 0; y < h; y++) {
    const row = y * w
    let last = -1e9
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] >= 128) last = x
      const d = x - last
      hd[row + x] = d > cap ? cap : d
    }
    last = 1e9
    for (let x = w - 1; x >= 0; x--) {
      if (data[(row + x) * 4 + 3] >= 128) last = x
      const d = last - x
      if (d < hd[row + x]) hd[row + x] = d > cap ? cap : d
    }
  }
  const lim = px * px
  const v = new Int32Array(h)
  const z = new Float64Array(h + 1)
  const f = new Float64Array(h)
  let added = 0
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const d = hd[y * w + x]
      f[y] = d * d
    }
    // Lower envelope of parabolas y -> f[y] + (q - y)^2.
    let kk = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < h; q++) {
      let s = 0
      for (;;) {
        const p = v[kk]
        s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p)
        if (s <= z[kk]) kk--
        else break
      }
      kk++
      v[kk] = q
      z[kk] = s
      z[kk + 1] = Infinity
    }
    kk = 0
    for (let q = 0; q < h; q++) {
      while (z[kk + 1] < q) kk++
      const dq = q - v[kk]
      const dist2 = dq * dq + f[v[kk]]
      if (dist2 <= lim) {
        const i = (q * w + x) * 4
        if (data[i + 3] < 128) {
          data[i] = color.r
          data[i + 1] = color.g
          data[i + 2] = color.b
          data[i + 3] = 255
          added++
        }
      }
    }
  }
  return { added }
}

export function colorWarnings(img: RGBAImage): {
  saturatedFraction: number
  nearBlackNotPure: number
  nearWhiteNotPure: number
  messages: string[]
} {
  const d = img.data
  let ink = 0
  let sat = 0
  let nearBlack = 0
  let nearWhite = 0
  const bandCount = [0, 0, 0, 0] // orange, green, blue, magenta
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    ink++
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b
    if (mx >= 1 && mx <= SNAP_TOL) nearBlack++
    if (mn >= 255 - SNAP_TOL && mn <= 254) nearWhite++
    if (mx <= 191) continue // value <= 0.75
    const delta = mx - mn
    if (delta / mx <= 0.75) continue
    let hue: number
    if (mx === r) hue = ((g - b) / delta) * 60
    else if (mx === g) hue = (2 + (b - r) / delta) * 60
    else hue = (4 + (r - g) / delta) * 60
    if (hue < 0) hue += 360
    if (hue >= 15 && hue <= 45) bandCount[0]++
    else if (hue >= 75 && hue <= 165) bandCount[1]++
    else if (hue >= 195 && hue <= 255) bandCount[2]++
    else if (hue >= 285 && hue <= 330) bandCount[3]++
    else continue
    sat++
  }
  const saturatedFraction = ink ? sat / ink : 0
  const messages: string[] = []
  if (saturatedFraction >= 0.02) {
    const names = ['orange', 'green', 'blue', 'magenta']
    const present = names.filter((_, i) => bandCount[i] / ink >= 0.005)
    const label = present.length ? present.join('/') : 'orange/blue/green/magenta'
    messages.push(
      `${Math.round(saturatedFraction * 100)}% of the ink is saturated ${label}. DTF prints these darker and duller; colours only shift down, so check a proof.`,
    )
  }
  if (ink && nearBlack / ink >= 0.01) {
    messages.push(
      `${Math.round((nearBlack / ink) * 100)}% of the ink is near-black but not pure black. Turn on Snap near-black/white to fix it.`,
    )
  }
  if (ink && nearWhite / ink >= 0.01) {
    messages.push(
      `${Math.round((nearWhite / ink) * 100)}% of the ink is near-white but not pure white. Turn on Snap near-black/white to fix it.`,
    )
  }
  return { saturatedFraction, nearBlackNotPure: nearBlack, nearWhiteNotPure: nearWhite, messages }
}
