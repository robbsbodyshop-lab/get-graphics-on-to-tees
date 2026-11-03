import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { fadeEdgeHalftone, halftoneAlpha, halftoneLuminance, cellSize, spotThreshold } from './halftone'

const opts = { lpi: 55, dpi: 300, angleDeg: 22.5 }

function onFraction(img: { width: number; data: Uint8ClampedArray }, x0: number, x1: number, y0: number, y1: number) {
  let on = 0
  let tot = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      tot++
      if (img.data[(y * img.width + x) * 4 + 3] === 255) on++
    }
  return on / tot
}

describe('spot function', () => {
  it('cellSize and range', () => {
    expect(cellSize(55, 300)).toBeCloseTo(5.4545, 3)
    for (let i = 0; i < 200; i++) {
      const t = spotThreshold(i * 1.3, i * 0.7, 5.45, 0.39)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
    }
  })
})

describe('halftoneAlpha', () => {
  it('alpha 128 -> binary, ~50% on', () => {
    const img = createImage(200, 200)
    fillRect(img, 0, 0, 200, 200, [10, 20, 30, 128])
    const { dotted, mask } = halftoneAlpha(img, opts)
    let on = 0
    for (let i = 3; i < img.data.length; i += 4) {
      expect([0, 255]).toContain(img.data[i])
      if (img.data[i] === 255) on++
    }
    expect(Math.abs(on / 40000 - 0.5)).toBeLessThan(0.08)
    expect(dotted).toBe(on)
    expect(mask.every((m) => m === 1)).toBe(true)
    expect(img.data[0]).toBe(10)
  })

  it('gradient gives monotonically increasing on-fraction', () => {
    const img = createImage(200, 100)
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4
        img.data[i + 3] = 1 + Math.round((x / 199) * 253)
      }
    halftoneAlpha(img, opts)
    const fr: number[] = []
    for (let b = 0; b < 8; b++) fr.push(onFraction(img, b * 25, b * 25 + 25, 0, 100))
    for (let b = 1; b < fr.length; b++) expect(fr[b]).toBeGreaterThanOrEqual(fr[b - 1])
    expect(fr[7]).toBeGreaterThan(fr[0] + 0.5)
  })

  it('leaves alpha 0/255 untouched and masks exactly processed pixels', () => {
    const img = createImage(20, 20)
    fillRect(img, 0, 0, 10, 20, [1, 2, 3, 255])
    fillRect(img, 10, 0, 5, 20, [1, 2, 3, 100])
    const { mask } = halftoneAlpha(img, opts)
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const i = y * 20 + x
        expect(mask[i]).toBe(x >= 10 && x < 15 ? 1 : 0)
        if (x < 10) expect(img.data[i * 4 + 3]).toBe(255)
        if (x >= 15) expect(img.data[i * 4 + 3]).toBe(0)
      }
  })
})

describe('fadeEdgeHalftone', () => {
  it('fades the bottom edge', () => {
    const img = createImage(200, 200)
    fillRect(img, 0, 0, 200, 200, [200, 0, 0, 255])
    fadeEdgeHalftone(img, { ...opts, edge: 'bottom', fraction: 0.5 })
    for (let i = 3; i < img.data.length; i += 4) expect([0, 255]).toContain(img.data[i])
    expect(onFraction(img, 0, 200, 0, 50)).toBe(1)
    expect(onFraction(img, 0, 200, 190, 200)).toBeLessThan(0.15)
    expect(onFraction(img, 0, 200, 100, 150)).toBeGreaterThan(onFraction(img, 0, 200, 150, 200))
  })
})

describe('halftoneLuminance', () => {
  it('grey ramp: darker bands get more dots, ink colour used', () => {
    const img = createImage(200, 50)
    for (let y = 0; y < 50; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4
        const v = Math.round((x / 199) * 255)
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
    halftoneLuminance(img, { ...opts, lumLo: 0, lumHi: 1, ink: '#ff0000', darkInk: true })
    const fr: number[] = []
    for (let b = 0; b < 8; b++) fr.push(onFraction(img, b * 25, b * 25 + 25, 0, 50))
    for (let b = 1; b < fr.length; b++) expect(fr[b]).toBeLessThanOrEqual(fr[b - 1])
    expect(fr[0]).toBeGreaterThan(0.9)
    expect(fr[7]).toBeLessThan(0.1)
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i + 3] === 255) {
        expect([img.data[i], img.data[i + 1], img.data[i + 2]]).toEqual([255, 0, 0])
      }
  })
})
