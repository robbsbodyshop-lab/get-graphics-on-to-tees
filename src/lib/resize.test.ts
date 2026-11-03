import { describe, it, expect } from 'vitest'
import { bleedColors, resizeLanczos } from './resize'
import { createImage, fillRect } from './image/core'

describe('resizeLanczos', () => {
  it('produces exact sizes up and down', () => {
    const img = createImage(40, 30)
    fillRect(img, 0, 0, 40, 30, [10, 20, 30, 255])
    for (const [w, h] of [[100, 77], [13, 9], [40, 30], [1, 1]]) {
      const o = resizeLanczos(img, w, h)
      expect(o.width).toBe(w)
      expect(o.height).toBe(h)
      expect(o.data.length).toBe(w * h * 4)
    }
  })

  it('keeps a constant opaque colour constant', () => {
    const img = createImage(37, 29)
    fillRect(img, 0, 0, 37, 29, [200, 100, 50, 255])
    for (const [w, h] of [[111, 87], [11, 8]]) {
      const o = resizeLanczos(img, w, h)
      for (let i = 0; i < o.data.length; i += 4) {
        expect(Math.abs(o.data[i] - 200)).toBeLessThanOrEqual(1)
        expect(Math.abs(o.data[i + 1] - 100)).toBeLessThanOrEqual(1)
        expect(Math.abs(o.data[i + 2] - 50)).toBeLessThanOrEqual(1)
        expect(o.data[i + 3]).toBe(255)
      }
    }
  })

  it('has no dark fringe on red-on-transparent', () => {
    const img = createImage(30, 30) // transparent black
    fillRect(img, 10, 10, 10, 10, [255, 0, 0, 255])
    for (const [w, h] of [[90, 90], [14, 14]]) {
      const o = resizeLanczos(img, w, h)
      let seen = 0
      for (let i = 0; i < o.data.length; i += 4) {
        if (o.data[i + 3] > 0) {
          seen++
          expect(o.data[i]).toBeGreaterThanOrEqual(250)
          expect(o.data[i + 1]).toBeLessThanOrEqual(2)
          expect(o.data[i + 2]).toBeLessThanOrEqual(2)
        }
      }
      expect(seen).toBeGreaterThan(0)
    }
  })
})

describe('bleedColors', () => {
  it('fills transparent RGB without touching alpha', () => {
    const img = createImage(20, 20)
    fillRect(img, 8, 8, 4, 4, [10, 200, 30, 255])
    const alpha = Uint8Array.from({ length: 400 }, (_, i) => img.data[i * 4 + 3])
    bleedColors(img, 5)
    for (let i = 0; i < 400; i++) expect(img.data[i * 4 + 3]).toBe(alpha[i])
    // pixel 3 away from the square is within reach of 5 iterations
    const i = (10 * 20 + 5) * 4
    expect([img.data[i], img.data[i + 1], img.data[i + 2]]).toEqual([10, 200, 30])
    // far corner (more than 5 px away) stays untouched
    expect(img.data[0]).toBe(0)
  })
})
