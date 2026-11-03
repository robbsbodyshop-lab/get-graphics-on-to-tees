import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { alphaBBox, solidCoverage, crop, trim, fitCanvas, mirrorHorizontal } from './geometry'

describe('geometry', () => {
  it('alphaBBox honours minAlpha and empty', () => {
    const img = createImage(10, 10)
    expect(alphaBBox(img)).toBeNull()
    fillRect(img, 2, 3, 4, 2, [1, 1, 1, 100])
    expect(alphaBBox(img)).toEqual({ x: 2, y: 3, w: 4, h: 2 })
    expect(alphaBBox(img, 128)).toBeNull()
  })
  it('trim with margin pads beyond bounds', () => {
    const img = createImage(20, 20)
    fillRect(img, 0, 5, 10, 10, [9, 8, 7, 255])
    const t = trim(img, 2)
    expect(t.width).toBe(14)
    expect(t.height).toBe(14)
    expect(t.data[3]).toBe(0) // padded corner
    const i = (2 * 14 + 2) * 4
    expect([t.data[i], t.data[i + 3]]).toEqual([9, 255])
    expect(trim(createImage(5, 5), 0).width).toBe(1)
    expect(trim(createImage(5, 5), 3).height).toBe(6)
  })
  it('crop pads outside the source', () => {
    const img = createImage(4, 4)
    fillRect(img, 0, 0, 4, 4, [5, 5, 5, 255])
    const c = crop(img, { x: -2, y: -1, w: 8, h: 6 })
    expect(c.width).toBe(8)
    expect(c.data[3]).toBe(0)
    expect(c.data[(1 * 8 + 2) * 4 + 3]).toBe(255)
    expect(c.data[(1 * 8 + 6) * 4 + 3]).toBe(0)
    expect(c.data[(5 * 8 + 3) * 4 + 3]).toBe(0)
  })
  it('fitCanvas returns exact size, centred', () => {
    const img = createImage(10, 10)
    fillRect(img, 0, 0, 10, 10, [1, 1, 1, 255])
    const big = fitCanvas(img, 20, 30)
    expect([big.width, big.height]).toEqual([20, 30])
    expect(alphaBBox(big)).toEqual({ x: 5, y: 10, w: 10, h: 10 })
    const small = fitCanvas(img, 4, 6)
    expect([small.width, small.height]).toEqual([4, 6])
    expect(alphaBBox(small)).toEqual({ x: 0, y: 0, w: 4, h: 6 })
  })
  it('solidCoverage: block = 1, ring < 0.7', () => {
    const block = createImage(30, 30)
    fillRect(block, 5, 5, 20, 20, [0, 0, 0, 255])
    expect(solidCoverage(block).coverage).toBe(1)
    const ring = createImage(30, 30)
    fillRect(ring, 5, 5, 20, 20, [0, 0, 0, 255])
    fillRect(ring, 8, 8, 14, 14, [0, 0, 0, 0])
    const s = solidCoverage(ring)
    expect(s.opaque).toBe(204)
    expect(s.coverage).toBeLessThan(0.7)
    expect(solidCoverage(createImage(3, 3)).coverage).toBe(0)
  })
  it('mirrorHorizontal flips rows', () => {
    const img = createImage(3, 1)
    fillRect(img, 0, 0, 1, 1, [10, 0, 0, 255])
    mirrorHorizontal(img)
    expect(img.data[8]).toBe(10)
    expect(img.data[0]).toBe(0)
  })
})
