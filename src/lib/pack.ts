import type { RGBAImage } from './types'
import { createImage } from './image/core'

export const GANG_SHEET_WIDTH_IN = 22
export const GANG_SHEET_LENGTHS_IN = [
  24, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 300, 400, 500, 600, 750, 1000,
]

export type GangItem = { id: string; w: number; h: number; qty: number }
export type GangPlacement = {
  id: string
  copy: number
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
}

export interface PackOptions {
  sheetWidth?: number
  gap?: number
  edge?: number
}

export interface PackResult {
  placements: GangPlacement[]
  usedLength: number
  orderLength: number | null
  unplaced: { id: string; copy: number }[]
  gap: number
}

const EPS = 1e-9

interface Shelf {
  y: number
  h: number
  x: number
}

export function packGangSheet(items: GangItem[], opts: PackOptions = {}): PackResult {
  const sheetWidth = opts.sheetWidth ?? GANG_SHEET_WIDTH_IN
  const gap = Math.max(0.25, opts.gap ?? 0.5)
  const edge = opts.edge ?? 0.25
  const right = sheetWidth - edge
  const usable = sheetWidth - 2 * edge

  interface Copy {
    id: string
    copy: number
    w: number
    h: number
    key: number
  }
  const copies: Copy[] = []
  const unplaced: { id: string; copy: number }[] = []
  for (const it of items) {
    const qty = Math.max(0, Math.floor(it.qty))
    for (let c = 0; c < qty; c++) {
      const fitsA = it.w <= usable + EPS
      const fitsB = it.h <= usable + EPS
      if (!fitsA && !fitsB) {
        unplaced.push({ id: it.id, copy: c })
        continue
      }
      const key = fitsA && fitsB ? Math.min(it.h, it.w) : fitsA ? it.h : it.w
      copies.push({ id: it.id, copy: c, w: it.w, h: it.h, key })
    }
  }
  copies.sort((a, b) => b.key - a.key)

  const shelves: Shelf[] = []
  const placements: GangPlacement[] = []
  let nextY = edge

  for (const c of copies) {
    const orients: { w: number; h: number; rotated: boolean }[] = []
    if (c.w <= usable + EPS) orients.push({ w: c.w, h: c.h, rotated: false })
    if (c.h <= usable + EPS && c.h !== c.w) orients.push({ w: c.h, h: c.w, rotated: true })

    let best: { shelf: Shelf; o: (typeof orients)[number]; waste: number } | null = null
    for (const shelf of shelves) {
      for (const o of orients) {
        if (shelf.x + o.w > right + EPS || o.h > shelf.h + EPS) continue
        const waste = shelf.h - o.h
        if (!best || waste < best.waste - EPS) best = { shelf, o, waste }
      }
    }
    if (best) {
      placements.push({
        id: c.id, copy: c.copy, x: best.shelf.x, y: best.shelf.y,
        w: best.o.w, h: best.o.h, rotated: best.o.rotated,
      })
      best.shelf.x += best.o.w + gap
      continue
    }
    let o = orients[0]
    for (const cand of orients) if (cand.h < o.h - EPS) o = cand
    const shelf: Shelf = { y: nextY, h: o.h, x: edge }
    shelves.push(shelf)
    nextY += o.h + gap
    placements.push({ id: c.id, copy: c.copy, x: shelf.x, y: shelf.y, w: o.w, h: o.h, rotated: o.rotated })
    shelf.x += o.w + gap
  }

  let usedLength = 0
  for (const p of placements) usedLength = Math.max(usedLength, p.y + p.h)
  if (placements.length) usedLength += edge
  const orderLength = GANG_SHEET_LENGTHS_IN.find((l) => l >= usedLength - EPS) ?? null
  return { placements, usedLength, orderLength, unplaced, gap }
}

const MAX_SHEET_PIXELS = 120_000_000

export function renderGangSheet(
  placements: GangPlacement[],
  images: Record<string, RGBAImage>,
  length: number,
  opts: { sheetWidth?: number; dpi?: number } = {},
): RGBAImage {
  const sheetWidth = opts.sheetWidth ?? GANG_SHEET_WIDTH_IN
  const dpi = opts.dpi ?? 300
  const W = Math.round(sheetWidth * dpi)
  const H = Math.round(length * dpi)
  if (W * H > MAX_SHEET_PIXELS) {
    throw new Error(`Sheet too long to render in the browser at ${dpi} DPI (${W}×${H} px); split it into shorter sheets.`)
  }
  const canvas = createImage(W, H)
  const dst = canvas.data
  for (const p of placements) {
    const img = images[p.id]
    if (!img) throw new Error(`Missing image for placement "${p.id}"`)
    const px0 = Math.round(p.x * dpi)
    const py0 = Math.round(p.y * dpi)
    const pw = Math.max(1, Math.round(p.w * dpi))
    const ph = Math.max(1, Math.round(p.h * dpi))
    const iw = img.width
    const ih = img.height
    const rw = p.rotated ? ih : iw // width of the (rotated) image
    const rh = p.rotated ? iw : ih
    const exact = Math.abs(rw - pw) <= 1 && Math.abs(rh - ph) <= 1
    const ow = exact ? rw : pw
    const oh = exact ? rh : ph
    const src = img.data
    for (let dy = 0; dy < oh; dy++) {
      const y = py0 + dy
      if (y < 0 || y >= H) continue
      const ry = exact ? dy : Math.min(rh - 1, Math.floor((dy * rh) / oh))
      for (let dx = 0; dx < ow; dx++) {
        const x = px0 + dx
        if (x < 0 || x >= W) continue
        const rx = exact ? dx : Math.min(rw - 1, Math.floor((dx * rw) / ow))
        // rotated 90 CW: dest(rx, ry) <- src(sx = ry, sy = ih-1-rx)
        const sx = p.rotated ? ry : rx
        const sy = p.rotated ? ih - 1 - rx : ry
        const si = (sy * iw + sx) * 4
        const di = (y * W + x) * 4
        dst[di] = src[si]
        dst[di + 1] = src[si + 1]
        dst[di + 2] = src[si + 2]
        dst[di + 3] = src[si + 3]
      }
    }
  }
  return canvas
}
