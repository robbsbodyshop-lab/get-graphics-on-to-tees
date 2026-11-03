import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { hardThreshold, choke, thicken, removeSpecks, speckSizePx } from './alpha'
import { alphaBBox } from './geometry'

const alphaAt = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3]

describe('hardThreshold', () => {
  it('leaves no semi-transparent pixels', () => {
    const img = createImage(64, 64)
    let seed = 12345
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      img.data[i + 3] = seed % 256
    }
    hardThreshold(img, 0.5)
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i] === 0 || img.data[i] === 255).toBe(true)
  })
  it('maps 127/128 around 0.5', () => {
    const img = createImage(3, 1)
    img.data[3] = 127
    img.data[7] = 128
    img.data[11] = 0
    const r = hardThreshold(img, 0.5)
    expect([img.data[3], img.data[7], img.data[11]]).toEqual([0, 255, 0])
    expect(r).toEqual({ madeOpaque: 1, madeTransparent: 1 })
  })
})

describe('choke / thicken', () => {
  it('choke shrinks 20x20 to 18x18', () => {
    const img = createImage(40, 40)
    fillRect(img, 10, 10, 20, 20, [9, 9, 9, 255])
    const r = choke(img, 1)
    expect(r.removed).toBe(400 - 324)
    expect(alphaBBox(img)).toEqual({ x: 11, y: 11, w: 18, h: 18 })
  })
  it('choke treats outside as transparent', () => {
    const img = createImage(10, 10)
    fillRect(img, 0, 0, 10, 10, [1, 2, 3, 255])
    choke(img, 1)
    expect(alphaBBox(img)).toEqual({ x: 1, y: 1, w: 8, h: 8 })
  })
  it('thicken grows to 22x22 and copies colour', () => {
    const img = createImage(40, 40)
    fillRect(img, 10, 10, 20, 20, [200, 50, 20, 255])
    const r = thicken(img, 1)
    expect(alphaBBox(img)).toEqual({ x: 9, y: 9, w: 22, h: 22 })
    expect(r.added).toBe(22 * 22 - 400)
    const i = (9 * 40 + 20) * 4
    expect([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]).toEqual([200, 50, 20, 255])
    const c = (9 * 40 + 9) * 4 // corner pixel
    expect(img.data[c + 3]).toBe(255)
    expect(img.data[c]).toBe(200)
  })
})

describe('removeSpecks', () => {
  it('removes small islands, keeps big ones and protected ones', () => {
    const img = createImage(200, 100)
    fillRect(img, 2, 2, 3, 3, [0, 0, 0, 255]) // 3x3 speck
    fillRect(img, 12, 2, 8, 8, [0, 0, 0, 255]) // 8x8 speck
    fillRect(img, 30, 2, 9, 9, [0, 0, 0, 255]) // 9x9 keep
    fillRect(img, 50, 2, 40, 40, [0, 0, 0, 255]) // keep
    fillRect(img, 100, 2, 3, 3, [0, 0, 0, 255]) // protected
    const protect = new Uint8Array(200 * 100)
    protect[3 * 200 + 101] = 1
    const r = removeSpecks(img, 9, protect)
    expect(r).toEqual({ islandsRemoved: 2, pixelsRemoved: 9 + 64 })
    expect(alphaAt(img, 3, 3)).toBe(0)
    expect(alphaAt(img, 15, 5)).toBe(0)
    expect(alphaAt(img, 34, 5)).toBe(255)
    expect(alphaAt(img, 60, 10)).toBe(255)
    expect(alphaAt(img, 101, 3)).toBe(255)
  })
  it('treats diagonal pixels as one island and speckSizePx maps inches', () => {
    expect(speckSizePx(0.03)).toBe(9)
    expect(speckSizePx(0)).toBe(1)
    const img = createImage(10, 10)
    fillRect(img, 1, 1, 1, 1, [0, 0, 0, 255])
    fillRect(img, 2, 2, 1, 1, [0, 0, 0, 255])
    expect(removeSpecks(img, 5).islandsRemoved).toBe(1)
  })
})
