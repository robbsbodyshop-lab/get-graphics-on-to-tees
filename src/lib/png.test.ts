/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { crc32, decodePng, encodePng, readPngInfo } from './png'
import { srgbIccProfile } from './srgbIcc'
import type { RGBAImage } from './types'

function randomImage(w: number, h: number, seed = 1): RGBAImage {
  let s = seed
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i++) data[i] = rnd()
  for (let i = 0; i < w * h; i += 7) data[i * 4 + 3] = 0 // alpha 0, RGB kept
  return { width: w, height: h, data }
}

function chunk(type: string, body: number[]): number[] {
  const b = Uint8Array.from([...Buffer.from(type, 'latin1'), ...body])
  const c = crc32(b)
  const len = body.length
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...b,
    c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]
}

function handPng(w: number, h: number, colorType: number, rows: number[][], extra: number[][] = []): Uint8Array {
  const ihdr = [0, 0, 0, w, 0, 0, 0, h, 8, colorType, 0, 0, 0]
  const raw = Uint8Array.from(rows.flat())
  const z = [...deflateSync(raw)]
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...extra.flat(),
    ...chunk('IDAT', z), ...chunk('IEND', [])])
}

describe('png', () => {
  it('crc32 matches known value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips byte-identically incl. alpha-0 RGB', async () => {
    const img = randomImage(67, 53)
    const png = await encodePng(img)
    const back = await decodePng(png)
    expect(back.width).toBe(67)
    expect(back.height).toBe(53)
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true)
  })

  it('round-trips with every forced filter', async () => {
    const img = randomImage(31, 17, 5)
    for (const f of [0, 1, 2, 3, 4] as const) {
      const back = await decodePng(await encodePng(img, { filter: f }))
      expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true)
    }
  })

  it('is readable by Node zlib / has valid chunk CRCs', async () => {
    const png = await encodePng(randomImage(10, 10))
    let pos = 8
    while (pos < png.length) {
      const len = new DataView(png.buffer, png.byteOffset + pos).getUint32(0)
      const crc = new DataView(png.buffer, png.byteOffset + pos + 8 + len).getUint32(0)
      expect(crc32(png, pos + 4, pos + 8 + len)).toBe(crc)
      pos += 12 + len
    }
    expect(pos).toBe(png.length)
  })

  it('readPngInfo reports dpi, sRGB, header', async () => {
    const png = await encodePng(randomImage(8, 6))
    const info = readPngInfo(png)!
    expect(info.width).toBe(8)
    expect(info.height).toBe(6)
    expect(info.bitDepth).toBe(8)
    expect(info.colorType).toBe(6)
    expect(info.dpiX).toBeGreaterThan(299.9)
    expect(info.dpiX).toBeLessThan(300.1)
    expect(info.dpiY).toBeGreaterThan(299.9)
    expect(info.hasSRGB).toBe(true)
    expect(info.iccProfileName).toBe('sRGB')
    expect(readPngInfo(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('embeds the sRGB ICC profile in an iCCP chunk (and no separate sRGB chunk)', async () => {
    const png = await encodePng(randomImage(4, 4))
    const types: string[] = []
    let iccp: Uint8Array | null = null
    let pos = 8
    while (pos < png.length) {
      const len = new DataView(png.buffer, png.byteOffset + pos).getUint32(0)
      const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8))
      types.push(type)
      if (type === 'iCCP') iccp = png.subarray(pos + 8, pos + 8 + len)
      pos += 12 + len
    }
    expect(types.slice(0, 2)).toEqual(['IHDR', 'iCCP'])
    expect(types).not.toContain('sRGB')
    expect(types.indexOf('iCCP')).toBeLessThan(types.indexOf('IDAT'))
    const nul = iccp!.indexOf(0)
    expect(String.fromCharCode(...iccp!.subarray(0, nul))).toBe('sRGB')
    expect(iccp![nul + 1]).toBe(0) // compression method
    const profile = new Uint8Array(inflateSync(iccp!.subarray(nul + 2)))
    expect(profile).toEqual(srgbIccProfile())
    expect(String.fromCharCode(...profile.subarray(36, 40))).toBe('acsp') // ICC signature
  })

  it('decodes hand-built PNGs using each filter type', () => {
    // 2x3 RGB image; build rows with filters 0..4 manually.
    const px = [[10, 20, 30, 40, 50, 60], [70, 80, 90, 100, 110, 120], [5, 6, 7, 8, 9, 10], [200, 150, 100, 50, 25, 12]]
    const bpp = 3
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    const rows: number[][] = []
    for (let y = 0; y < 4; y++) {
      const ft = y === 3 ? 4 : y
      const r = [ft]
      for (let i = 0; i < 6; i++) {
        const a = i >= bpp ? px[y][i - bpp] : 0
        const b = y > 0 ? px[y - 1][i] : 0
        const c = i >= bpp && y > 0 ? px[y - 1][i - bpp] : 0
        const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : paeth(a, b, c)
        r.push((px[y][i] - pred) & 255)
      }
      rows.push(r)
    }
    return decodePng(handPng(2, 4, 2, rows)).then((img) => {
      expect(img.width).toBe(2)
      expect(img.height).toBe(4)
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
        const i = (y * 2 + x) * 4
        expect([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]])
          .toEqual([px[y][x * 3], px[y][x * 3 + 1], px[y][x * 3 + 2], 255])
      }
    })
  })

  it('decodes grey, grey+alpha and palette with tRNS', async () => {
    const g = await decodePng(handPng(2, 1, 0, [[0, 10, 200]]))
    expect(Array.from(g.data)).toEqual([10, 10, 10, 255, 200, 200, 200, 255])
    const ga = await decodePng(handPng(1, 1, 4, [[0, 77, 33]]))
    expect(Array.from(ga.data)).toEqual([77, 77, 77, 33])
    const pal = await decodePng(handPng(2, 1, 3, [[0, 1, 0]], [
      chunk('PLTE', [1, 2, 3, 4, 5, 6]), chunk('tRNS', [255, 128]),
    ]))
    expect(Array.from(pal.data)).toEqual([4, 5, 6, 128, 1, 2, 3, 255])
  })

  it('decodes samples/shadow.png', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../samples/shadow.png', import.meta.url)))
    const img = await decodePng(bytes)
    expect(img.width).toBe(1000)
    expect(img.height).toBe(800)
    let semi = 0
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && img.data[i] < 255) semi++
    expect(semi).toBeGreaterThan(1000)
  })
})
