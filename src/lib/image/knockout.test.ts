import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { knockoutColors, removeBackgroundFlood } from './knockout'
import { srgbToLab, deltaE76 } from './color'

const a = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]

describe('knockoutColors', () => {
  it('removes black and near-black, keeps others, exact count', () => {
    const de = (v: number) => deltaE76(srgbToLab(v, v, v), srgbToLab(0, 0, 0))
    expect(de(10)).toBeLessThanOrEqual(8)
    expect(de(40)).toBeGreaterThan(8)
    const img = createImage(10, 1)
    const colors: [number, number, number][] = [
      [0, 0, 0], [0, 0, 0], [10, 10, 10], [40, 40, 40], [255, 0, 0],
    ]
    colors.forEach((c, i) => fillRect(img, i, 0, 1, 1, [c[0], c[1], c[2], 255]))
    // 5..9 stay fully transparent and must not be counted
    const r = knockoutColors(img, [{ r: 0, g: 0, b: 0 }], 8)
    expect(r.removed).toBe(3)
    expect([0, 1, 2, 3, 4].map((x) => a(img, x, 0))).toEqual([0, 0, 0, 255, 255])
  })
})

describe('removeBackgroundFlood', () => {
  it('removes noisy white bg but not an enclosed white shape', () => {
    const img = createImage(60, 60)
    let seed = 7
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        const v = 248 + (seed % 8)
        fillRect(img, x, y, 1, 1, [v, v, v, 255])
      }
    fillRect(img, 15, 15, 30, 30, [0, 0, 0, 255]) // black ring
    fillRect(img, 22, 22, 16, 16, [255, 255, 255, 255]) // enclosed white
    const r = removeBackgroundFlood(img, 8)
    expect(r.reference).not.toBeNull()
    expect(r.reference!.r).toBeGreaterThanOrEqual(248)
    expect(a(img, 0, 0)).toBe(0)
    expect(a(img, 59, 59)).toBe(0)
    expect(a(img, 5, 30)).toBe(0)
    expect(a(img, 30, 30)).toBe(255) // enclosed white kept
    expect(a(img, 16, 16)).toBe(255) // ring kept
    expect(r.removed).toBe(3600 - 900)
  })
  it('removes a 1px anti-aliased grey fringe', () => {
    const img = createImage(40, 40)
    fillRect(img, 0, 0, 40, 40, [255, 255, 255, 255])
    fillRect(img, 10, 10, 20, 20, [0, 0, 0, 255])
    fillRect(img, 9, 9, 22, 22, [200, 200, 200, 255]) // fringe drawn first
    fillRect(img, 10, 10, 20, 20, [0, 0, 0, 255])
    const r = removeBackgroundFlood(img, 8, { fringeRings: 1 })
    expect(a(img, 9, 9)).toBe(0)
    expect(a(img, 20, 9)).toBe(0)
    expect(a(img, 10, 10)).toBe(255)
    expect(r.removed).toBe(1600 - 400)
    const keep = createImage(40, 40)
    fillRect(keep, 0, 0, 40, 40, [255, 255, 255, 255])
    fillRect(keep, 9, 9, 22, 22, [200, 200, 200, 255])
    fillRect(keep, 10, 10, 20, 20, [0, 0, 0, 255])
    removeBackgroundFlood(keep, 8, { fringeRings: 0 })
    expect(a(keep, 9, 9)).toBe(255)
  })
  it('returns null reference when edge is transparent', () => {
    const img = createImage(10, 10)
    fillRect(img, 3, 3, 4, 4, [0, 0, 0, 255])
    expect(removeBackgroundFlood(img, 8)).toEqual({ removed: 0, reference: null })
  })
})
