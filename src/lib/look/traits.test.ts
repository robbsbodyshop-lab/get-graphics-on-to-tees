/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../png'
import type { RGBAImage } from '../types'
import { describeImage } from './traits'

function blank(w: number, h: number, rgba: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]
    data[i + 1] = rgba[1]
    data[i + 2] = rgba[2]
    data[i + 3] = rgba[3]
  }
  return { width: w, height: h, data }
}

function setPx(img: RGBAImage, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * img.width + x) * 4
  img.data[i] = rgba[0]
  img.data[i + 1] = rgba[1]
  img.data[i + 2] = rgba[2]
  img.data[i + 3] = rgba[3]
}

function fillRect(img: RGBAImage, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPx(img, x, y, rgba)
}

/** Deterministic pseudo-random 0..255. */
function rng(seed: number) {
  let s = seed
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24)
}

describe('describeImage', () => {
  it('flat logo on white: solid background, flat kind, ink excludes the background', () => {
    const img = blank(200, 200, [255, 255, 255, 255])
    fillRect(img, 50, 50, 150, 150, [0, 0, 0, 255])
    fillRect(img, 80, 80, 120, 120, [220, 30, 30, 255])
    const t = describeImage(img)
    expect(t.width).toBe(200)
    expect(t.height).toBe(200)
    expect(t.hasAlpha).toBe(false)
    expect(t.solidBackground).toBe(true)
    expect(t.backgroundHex).toBe('#ffffff')
    expect(t.kind).toBe('flat')
    expect(t.dominantColors).toBeLessThanOrEqual(8)
    // Ink = black square minus the red square: mostly dark, nothing light (white is the background).
    expect(t.darkInkFraction).toBeGreaterThan(0.8)
    expect(t.lightInkFraction).toBe(0)
    expect(t.saturatedFraction).toBeGreaterThan(0.1)
    expect(t.softAlphaFraction).toBe(0)
  })

  it('detects an off-white background within Delta E 10', () => {
    const img = blank(100, 100, [250, 248, 244, 255])
    fillRect(img, 30, 30, 70, 70, [20, 40, 160, 255])
    const t = describeImage(img)
    expect(t.solidBackground).toBe(true)
    expect(t.backgroundHex).toBe('#faf8f4')
  })

  it('transparent PNG with a soft drop shadow: alpha traits and no solid background', () => {
    const w = 120
    const img = blank(w, w, [0, 0, 0, 0])
    const c = w / 2
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - c, y - c)
        if (d <= 25) setPx(img, x, y, [200, 40, 40, 255])
        else if (d <= 45) setPx(img, x, y, [0, 0, 0, Math.round(255 * (1 - (d - 25) / 20) * 0.6)])
      }
    }
    const t = describeImage(img)
    expect(t.hasAlpha).toBe(true)
    expect(t.softAlphaFraction).toBeGreaterThan(0.01)
    expect(t.solidBackground).toBe(false)
    expect(t.backgroundHex).toBeNull()
    expect(t.kind).not.toBe('photo')
  })

  it('noisy gradient photo: many colors, no background, photo kind', () => {
    const w = 300
    const h = 300
    const img = blank(w, h, [0, 0, 0, 255])
    const rnd = rng(7)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = () => rnd() / 6 - 20
        setPx(img, x, y, [
          Math.min(255, Math.max(0, (x * 255) / w + n())),
          Math.min(255, Math.max(0, (y * 255) / h + n())),
          Math.min(255, Math.max(0, ((x + y) * 255) / (w + h) + n())),
          255,
        ])
      }
    }
    const t = describeImage(img)
    expect(t.hasAlpha).toBe(false)
    expect(t.solidBackground).toBe(false)
    expect(t.distinctColors).toBeGreaterThan(3000)
    expect(t.kind).toBe('photo')
  })

  it('mostly-black art on transparency has a high dark ink fraction', () => {
    const img = blank(100, 100, [0, 0, 0, 0])
    fillRect(img, 10, 10, 90, 90, [5, 5, 5, 255])
    fillRect(img, 40, 40, 60, 60, [255, 255, 255, 255])
    const t = describeImage(img)
    expect(t.hasAlpha).toBe(true)
    expect(t.darkInkFraction).toBeGreaterThan(0.9)
    expect(t.lightInkFraction).toBeGreaterThan(0.04)
    expect(t.lightInkFraction).toBeLessThan(0.1)
    expect(t.softAlphaFraction).toBe(0)
  })

  it('counts light ink on a dark opaque background', () => {
    const img = blank(100, 100, [0, 0, 0, 255])
    fillRect(img, 20, 20, 80, 80, [255, 255, 255, 255])
    const t = describeImage(img)
    expect(t.solidBackground).toBe(true)
    expect(t.backgroundHex).toBe('#000000')
    expect(t.lightInkFraction).toBeGreaterThan(0.95)
    expect(t.darkInkFraction).toBe(0)
  })

  it('samples sample/shadow.png: lots of semi-transparent pixels', async () => {
    const img = await decodePng(new Uint8Array(readFileSync('samples/shadow.png')))
    const t = describeImage(img)
    expect(t.hasAlpha).toBe(true)
    expect(t.softAlphaFraction).toBeGreaterThan(0.05)
    expect(t.solidBackground).toBe(false)
  })

  it('stays fast on a 6000 x 6000 image by sampling with a stride', () => {
    const w = 6000
    const img = blank(w, w, [255, 255, 255, 255])
    fillRect(img, 1000, 1000, 5000, 5000, [30, 30, 30, 255])
    const start = performance.now()
    const t = describeImage(img)
    const ms = performance.now() - start
    expect(t.width).toBe(w)
    expect(t.solidBackground).toBe(true)
    expect(t.kind).toBe('flat')
    expect(ms).toBeLessThan(600)
  })
})
