import { describe, it, expect } from 'vitest'
import { GANG_SHEET_WIDTH_IN, packGangSheet, renderGangSheet } from './pack'
import { createImage, fillRect } from './image/core'

describe('packGangSheet', () => {
  it('never overlaps (with gap) and stays within edges', () => {
    const items = [
      { id: 'a', w: 8, h: 11, qty: 3 },
      { id: 'b', w: 4.3, h: 4.7, qty: 7 },
      { id: 'c', w: 12, h: 3, qty: 2 },
      { id: 'd', w: 2, h: 15, qty: 2 },
    ]
    const r = packGangSheet(items, { gap: 0.4 })
    expect(r.unplaced).toEqual([])
    expect(r.placements.length).toBe(14)
    const g = r.gap / 2
    for (const p of r.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0.25 - 1e-9)
      expect(p.x + p.w).toBeLessThanOrEqual(GANG_SHEET_WIDTH_IN - 0.25 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(0.25 - 1e-9)
    }
    for (let i = 0; i < r.placements.length; i++) for (let j = i + 1; j < r.placements.length; j++) {
      const a = r.placements[i], b = r.placements[j]
      const sepX = a.x + a.w + g <= b.x - g + 1e-9 || b.x + b.w + g <= a.x - g + 1e-9
      const sepY = a.y + a.h + g <= b.y - g + 1e-9 || b.y + b.h + g <= a.y - g + 1e-9
      expect(sepX || sepY).toBe(true)
    }
  })

  it('rotates only when needed', () => {
    const a = packGangSheet([{ id: 'w', w: 21, h: 5, qty: 1 }])
    expect(a.placements[0].rotated).toBe(false)
    expect(a.placements[0].w).toBe(21)
    const b = packGangSheet([{ id: 't', w: 5, h: 21.4, qty: 1 }])
    expect(b.placements[0].rotated).toBe(true)
    expect(b.placements[0].w).toBe(21.4)
    expect(b.placements[0].h).toBe(5)
  })

  it('leaves oversize pieces unplaced', () => {
    const r = packGangSheet([{ id: 'big', w: 23, h: 23, qty: 2 }])
    expect(r.placements).toEqual([])
    expect(r.unplaced).toEqual([{ id: 'big', copy: 0 }, { id: 'big', copy: 1 }])
    expect(r.usedLength).toBe(0)
  })

  it('packs 10 copies of 10x10 into 5 shelves of 2', () => {
    const r = packGangSheet([{ id: 's', w: 10, h: 10, qty: 10 }])
    expect(r.placements.length).toBe(10)
    expect(new Set(r.placements.map((p) => p.y)).size).toBe(5)
    expect(r.usedLength).toBeCloseTo(52.5, 6)
    expect(r.orderLength).toBe(60)
  })

  it('clamps gap to 0.25', () => {
    expect(packGangSheet([{ id: 's', w: 2, h: 2, qty: 2 }], { gap: 0.05 }).gap).toBe(0.25)
    expect(packGangSheet([], { gap: 0 }).gap).toBe(0.25)
  })

  it('returns null orderLength beyond 1000 in', () => {
    const r = packGangSheet([{ id: 't', w: 21, h: 1100, qty: 1 }])
    expect(r.unplaced.length).toBe(0)
    expect(r.orderLength).toBeNull()
    const r2 = packGangSheet([{ id: 'x', w: 21, h: 21, qty: 60 }])
    expect(r2.orderLength).toBeNull()
  })
})

describe('renderGangSheet', () => {
  it('draws a rotated item clockwise at the right place', () => {
    // 2x1 px source at 10 dpi: left red, right blue. Rotated CW -> 1x2: top red, bottom blue.
    const src = createImage(2, 1)
    fillRect(src, 0, 0, 1, 1, [255, 0, 0, 255])
    fillRect(src, 1, 0, 1, 1, [0, 0, 255, 255])
    const sheet = renderGangSheet(
      [{ id: 'i', copy: 0, x: 1, y: 2, w: 0.1, h: 0.2, rotated: true }],
      { i: src }, 5, { sheetWidth: 4, dpi: 10 },
    )
    expect(sheet.width).toBe(40)
    expect(sheet.height).toBe(50)
    const px = (x: number, y: number) => Array.from(sheet.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4))
    expect(px(10, 20)).toEqual([255, 0, 0, 255])
    expect(px(10, 21)).toEqual([0, 0, 255, 255])
    expect(px(11, 20)[3]).toBe(0)
    expect(px(0, 0)[3]).toBe(0)
  })

  it('scales with nearest neighbour when sizes differ', () => {
    const src = createImage(1, 1)
    fillRect(src, 0, 0, 1, 1, [9, 8, 7, 255])
    const sheet = renderGangSheet([{ id: 'i', copy: 0, x: 0, y: 0, w: 0.5, h: 0.5, rotated: false }], { i: src }, 1, { sheetWidth: 1, dpi: 10 })
    expect(Array.from(sheet.data.subarray((4 * 10 + 4) * 4, (4 * 10 + 4) * 4 + 4))).toEqual([9, 8, 7, 255])
    expect(sheet.data[(5 * 10 + 5) * 4 + 3]).toBe(0)
  })

  it('refuses sheets over 120 megapixels', () => {
    expect(() => renderGangSheet([], {}, 1000)).toThrow(/sheet too long to render in the browser/i)
  })
})
