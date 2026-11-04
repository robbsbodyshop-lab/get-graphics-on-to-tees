import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { addOutline, adjustContrast, colorWarnings, desaturate, posterize, posterizeShift, snapBlackWhite } from './colorwork'
import type { RGB, RGBAImage } from '../types'
import { deltaE76, srgbToLab } from './color'

describe('posterize', () => {
  it('reduces to <= 4 opaque colours', () => {
    const img = createImage(100, 100)
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        const i = (y * 100 + x) * 4
        img.data[i] = (x * 255) / 99
        img.data[i + 1] = (y * 255) / 99
        img.data[i + 2] = ((x + y) * 255) / 198
        img.data[i + 3] = x < 5 ? 0 : 255
      }
    const { palette } = posterize(img, 4, 2)
    expect(palette.length).toBeLessThanOrEqual(4)
    const set = new Set<string>()
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i + 3] > 0) set.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
      else expect(img.data[i + 3]).toBe(0)
    expect(set.size).toBeLessThanOrEqual(4)
    expect(set.size).toBeGreaterThan(1)
  })
  it('keeps pure black and white exact', () => {
    const img = createImage(40, 20)
    fillRect(img, 0, 0, 20, 20, [2, 1, 3, 255])
    fillRect(img, 20, 0, 20, 20, [253, 254, 252, 255])
    const { palette } = posterize(img, 2)
    expect(palette).toContainEqual({ r: 0, g: 0, b: 0 })
    expect(palette).toContainEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('addOutline', () => {
  it('adds a ring of the right width', () => {
    const img = createImage(60, 60)
    fillRect(img, 20, 20, 20, 20, [255, 0, 0, 255])
    const { added } = addOutline(img, 3, { r: 0, g: 0, b: 0 })
    const a = (x: number, y: number) => img.data[(y * 60 + x) * 4 + 3]
    for (let d = 1; d <= 3; d++) expect(a(30, 20 - d)).toBe(255)
    expect(a(30, 16)).toBe(0)
    expect(a(16, 30)).toBe(0)
    expect(a(39 + 3, 30)).toBe(255)
    // corner: distance (3,3)=4.24 > 3 -> not filled
    expect(a(17, 17)).toBe(0)
    // 4 sides * 20 * 3 + 4 quarter-discs-ish corners
    expect(added).toBeGreaterThanOrEqual(240)
    expect(added).toBeLessThanOrEqual(240 + 4 * 9)
    expect(img.data[(18 * 60 + 30) * 4]).toBe(0)
    expect(img.data[(25 * 60 + 25) * 4]).toBe(255) // original untouched
  })
  it('clips at borders', () => {
    const img = createImage(10, 10)
    fillRect(img, 0, 0, 5, 5, [1, 1, 1, 255])
    expect(() => addOutline(img, 4, { r: 0, g: 0, b: 0 })).not.toThrow()
  })
})

describe('snap / tone', () => {
  it('snapBlackWhite', () => {
    const img = createImage(3, 1)
    img.data.set([5, 8, 0, 255, 250, 248, 255, 255, 100, 100, 100, 255])
    const r = snapBlackWhite(img)
    expect(r.snapped).toBe(2)
    expect(Array.from(img.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255])
  })
  it('desaturate and contrast', () => {
    const img = createImage(1, 1)
    img.data.set([255, 0, 0, 255])
    desaturate(img, 1)
    expect(img.data[0]).toBe(img.data[1])
    const c = createImage(1, 1)
    c.data.set([100, 150, 128, 255])
    adjustContrast(c, 0)
    expect(Array.from(c.data)).toEqual([100, 150, 128, 255])
    adjustContrast(c, 0.5)
    expect(c.data[0]).toBeLessThan(100)
    expect(c.data[1]).toBeGreaterThan(150)
  })
})

describe('colorWarnings', () => {
  it('flags saturated orange, not grey', () => {
    const o = createImage(20, 20)
    fillRect(o, 0, 0, 20, 20, [255, 128, 0, 255])
    const w = colorWarnings(o)
    expect(w.saturatedFraction).toBe(1)
    expect(w.messages[0]).toMatch(/orange/)
    const g = createImage(20, 20)
    fillRect(g, 0, 0, 20, 20, [128, 128, 128, 255])
    const wg = colorWarnings(g)
    expect(wg.saturatedFraction).toBe(0)
    expect(wg.messages).toEqual([])
  })
  it('counts near black / white', () => {
    const img = createImage(2, 1)
    img.data.set([10, 10, 10, 255, 250, 250, 250, 255])
    const w = colorWarnings(img)
    expect(w.nearBlackNotPure).toBe(1)
    expect(w.nearWhiteNotPure).toBe(1)
  })
  it('warnings clear after snapBlackWhite with the default tolerance', () => {
    const img = createImage(100, 100)
    fillRect(img, 0, 0, 100, 100, [128, 128, 128, 255])
    fillRect(img, 0, 0, 100, 3, [250, 250, 250, 255])
    fillRect(img, 0, 3, 100, 3, [5, 5, 5, 255])
    const before = colorWarnings(img)
    expect(before.nearWhiteNotPure).toBeGreaterThan(0)
    expect(before.nearBlackNotPure).toBeGreaterThan(0)
    expect(before.messages.length).toBe(2)
    expect(before.messages.every((m) => m.endsWith('Turn on Snap near-black/white to fix it.'))).toBe(true)
    snapBlackWhite(img)
    const after = colorWarnings(img)
    expect(after.nearWhiteNotPure).toBe(0)
    expect(after.nearBlackNotPure).toBe(0)
    expect(after.messages).toEqual([])
  })
})

const dE = (a: RGB, b: RGB) => deltaE76(srgbToLab(a.r, a.g, a.b), srgbToLab(b.r, b.g, b.b))

describe('posterize small accents', () => {
  it('keeps a 0.6% red patch among grays and returns the full palette', () => {
    const img = createImage(200, 200)
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const v = Math.round(60 + (170 * x) / 199)
        fillRect(img, x, y, 1, 1, [v, v, v, 255])
      }
    fillRect(img, 150, 150, 20, 12, [200, 30, 30, 255]) // 240 px = 0.6%
    const red: RGB = { r: 200, g: 30, b: 30 }
    for (const seed of [1, 2, 3]) {
      const work = { width: 200, height: 200, data: new Uint8ClampedArray(img.data) }
      const { palette } = posterize(work, 6, seed)
      expect(palette.length).toBe(6)
      const near = palette.find((p) => dE(p, red) < 10)
      expect(near).toBeDefined()
      for (let y = 150; y < 162; y++)
        for (let x = 150; x < 170; x++) {
          const i = (y * 200 + x) * 4
          expect([work.data[i], work.data[i + 1], work.data[i + 2]]).toEqual([near!.r, near!.g, near!.b])
        }
    }
  })
  it('does not invent colours for a 3-colour image', () => {
    const img = createImage(60, 20)
    fillRect(img, 0, 0, 20, 20, [200, 30, 30, 255])
    fillRect(img, 20, 0, 20, 20, [30, 160, 60, 255])
    fillRect(img, 40, 0, 20, 20, [90, 90, 200, 255])
    const orig = new Uint8ClampedArray(img.data)
    const { palette } = posterize(img, 6)
    expect(palette.length).toBeLessThanOrEqual(3)
    expect(Array.from(img.data)).toEqual(Array.from(orig))
  })
})

describe('posterizeShift', () => {
  const patch = (c: [number, number, number]): RGBAImage => {
    const im = createImage(10, 10)
    fillRect(im, 0, 0, 10, 10, [c[0], c[1], c[2], 255])
    return im
  }
  it('reports a lost accent when red turns gray', () => {
    const r = posterizeShift(patch([200, 30, 30]), patch([110, 100, 100]))
    expect(r.lostAccentFraction).toBeGreaterThan(0.9)
    expect(r.shiftedFraction).toBeGreaterThan(0.9)
  })
  it('is zero for identical images', () => {
    const r = posterizeShift(patch([200, 30, 30]), patch([200, 30, 30]))
    expect(r.lostAccentFraction).toBe(0)
    expect(r.shiftedFraction).toBe(0)
  })
})
