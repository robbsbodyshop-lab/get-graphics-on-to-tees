import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { checkStrokes } from './strokes'

const opts = { minStrokePx: 12, minGapPx: 12, minDetailPx: 45 }
const ink: [number, number, number, number] = [0, 0, 0, 255]

describe('checkStrokes', () => {
  it('flags a 4 px line', () => {
    const img = createImage(200, 100)
    fillRect(img, 20, 48, 160, 4, ink)
    const r = checkStrokes(img, opts)
    expect(r.thinStrokePixels).toBe(640)
    expect(r.thinStrokeFraction).toBeCloseTo(1)
    expect(r.flagged).toBe(true)
    expect(r.messages.join(' ')).toMatch(/thinner than 0\.04 in/)
  })
  it('does not flag a solid block', () => {
    const img = createImage(120, 120)
    fillRect(img, 20, 20, 60, 60, ink)
    const r = checkStrokes(img, opts)
    expect(r.thinStrokePixels).toBe(0)
    expect(r.thinGapPixels).toBe(0)
    expect(r.smallDetailCount).toBe(0)
    expect(r.flagged).toBe(false)
    expect(r.messages).toEqual([])
  })
  it('finds a 3 px gap between two blocks', () => {
    const img = createImage(200, 100)
    fillRect(img, 10, 10, 80, 80, ink)
    fillRect(img, 93, 10, 80, 80, ink)
    const r = checkStrokes(img, opts)
    expect(r.thinGapPixels).toBeGreaterThan(0)
    expect(r.flagged).toBe(true)
  })
  it('counts small details', () => {
    const img = createImage(200, 100)
    fillRect(img, 10, 10, 60, 60, ink)
    fillRect(img, 100, 10, 10, 10, ink)
    fillRect(img, 130, 10, 12, 12, ink)
    const r = checkStrokes(img, opts)
    expect(r.smallDetailCount).toBe(2)
    expect(r.flagged).toBe(true)
  })
  it('ignores protected pixels', () => {
    const img = createImage(200, 100)
    fillRect(img, 20, 48, 160, 4, ink)
    fillRect(img, 100, 5, 6, 6, ink)
    const protect = new Uint8Array(200 * 100).fill(1)
    const r = checkStrokes(img, { ...opts, protect })
    expect(r.thinStrokePixels).toBe(0)
    expect(r.smallDetailCount).toBe(0)
    expect(r.flagged).toBe(false)
  })
})
