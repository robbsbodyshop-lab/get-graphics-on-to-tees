import { describe, expect, it } from 'vitest'
import { createImage, fillRect } from './image/core'
import { clearHiddenColor, inspectExport } from './exportCheck'

describe('export check', () => {
  it('counts clear / solid / partial pixels and hidden color under transparency', () => {
    const img = createImage(10, 10)
    fillRect(img, 0, 0, 10, 10, [255, 255, 255, 0]) // transparent but white underneath
    fillRect(img, 0, 0, 5, 10, [200, 30, 30, 255])
    fillRect(img, 5, 0, 1, 10, [10, 10, 10, 128])
    const c = inspectExport(img, '#141414')
    expect(c.solid).toBe(50)
    expect(c.partial).toBe(10)
    expect(c.clear).toBe(40)
    expect(c.hiddenColor).toBe(40)
    expect(c.uniqueColors).toBe(2)
    expect(c.saturated).toBeCloseTo(50 / 60)
  })

  it('clearHiddenColor zeroes RGB only where alpha is 0', () => {
    const img = createImage(4, 1)
    img.data.set([250, 250, 250, 0, 9, 9, 9, 255, 0, 0, 0, 0, 1, 2, 3, 0])
    expect(clearHiddenColor(img)).toBe(2)
    expect(Array.from(img.data)).toEqual([0, 0, 0, 0, 9, 9, 9, 255, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(inspectExport(img, '#000000').hiddenColor).toBe(0)
  })

  it('measures how much of the ink is close to the shirt color', () => {
    const img = createImage(10, 1)
    fillRect(img, 0, 0, 6, 1, [150, 150, 150, 255]) // mid gray
    fillRect(img, 6, 0, 4, 1, [250, 250, 250, 255]) // white
    const onGrey = inspectExport(img, '#9c9c9c')
    expect(onGrey.garmentClose).toBeCloseTo(0.6)
    const onBlack = inspectExport(img, '#141414')
    expect(onBlack.garmentClose).toBe(0)
    expect(onBlack.brightness.pureWhite).toBeCloseTo(0.4)
    expect(onBlack.brightness.mid).toBeCloseTo(0.6)
  })
})
