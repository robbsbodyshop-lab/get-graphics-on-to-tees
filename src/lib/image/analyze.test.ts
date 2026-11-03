import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { analyzeImage } from './analyze'

describe('analyzeImage', () => {
  it('counts alpha classes and distinct colors', () => {
    const img = createImage(8, 6)
    fillRect(img, 0, 0, 2, 2, [255, 0, 0, 255]) // 4 red opaque
    fillRect(img, 2, 0, 2, 1, [0, 255, 0, 128]) // 2 green semi
    fillRect(img, 4, 0, 1, 1, [1, 1, 1, 255]) // quantizes with 0..7
    fillRect(img, 5, 0, 1, 1, [7, 7, 7, 255]) // same bucket
    fillRect(img, 6, 0, 1, 1, [8, 8, 8, 255]) // new bucket
    fillRect(img, 7, 0, 1, 1, [200, 200, 200, 0]) // transparent: ignored
    const r = analyzeImage(img)
    expect(r.width).toBe(8)
    expect(r.height).toBe(6)
    expect(r.aspectLabel).toBe('4:3')
    expect(r.opaqueCount).toBe(7)
    expect(r.semiTransparentCount).toBe(2)
    expect(r.transparentCount).toBe(48 - 9)
    expect(r.hasAlpha).toBe(true)
    expect(r.distinctColors).toBe(4)
  })
  it('labels odd ratios and opaque images', () => {
    const img = createImage(1000, 750)
    expect(analyzeImage(img).aspectLabel).toBe('4:3')
    expect(analyzeImage(createImage(145, 100)).aspectLabel).toBe("1.45:1")
    const solid = createImage(2, 2)
    fillRect(solid, 0, 0, 2, 2, [1, 2, 3, 255])
    const s = analyzeImage(solid)
    expect(s.hasAlpha).toBe(false)
    expect(s.aspectLabel).toBe('1:1')
  })
})
