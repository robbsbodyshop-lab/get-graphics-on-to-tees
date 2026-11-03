/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createImage, fillRect, countSemiTransparent } from './image/core'
import { decodePng, encodePng, readPngInfo } from './png'
import { exportFileName, runPipeline } from './pipeline'
import { DEFAULT_SETTINGS, mergeSettings } from './settings'
import { getPreset } from './presets'
import type { RGBAImage } from './types'

function onlyBinaryAlpha(img: RGBAImage): boolean {
  return countSemiTransparent(img) === 0
}

/** A 300x200 "logo on white" with anti-aliased-ish grey edges and JPEG-like noise. */
function logoOnWhite(): RGBAImage {
  const img = createImage(300, 200)
  fillRect(img, 0, 0, 300, 200, [252, 252, 252, 255])
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (i * 7919) % 5
    img.data[i] -= n
    img.data[i + 1] -= n
    img.data[i + 2] -= n
  }
  fillRect(img, 59, 39, 182, 122, [150, 150, 150, 255]) // soft edge ring
  fillRect(img, 60, 40, 180, 120, [10, 10, 10, 255]) // black block
  fillRect(img, 90, 70, 120, 60, [220, 30, 30, 255]) // red inner
  return img
}

describe('pipeline', () => {
  it('logo on white: background removed, exact width, binary alpha', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { removeBackground: true })
    const { image, report } = await runPipeline({ source: logoOnWhite(), settings: s, garmentHex: '#141414', printWidthIn: 4, strokeCheck: false })
    expect(image.width).toBe(1200)
    expect(onlyBinaryAlpha(image)).toBe(true)
    expect(report.sourceRemoved.background).toBeGreaterThan(300 * 200 - 182 * 122 - 10)
    // Art is 4 in minus 0.1 in margins; height follows the 180x120 art (+ edge ring) aspect.
    expect(report.heightPx).toBeGreaterThan(700)
    expect(report.heightPx).toBeLessThan(850)
    expect(report.upscaleFactor).toBeGreaterThan(5)
    expect(report.messages.some((m) => m.includes('check text and logos at 100%'))).toBe(true)
  })

  it('Horror / metal on black: near-black knocked out, binary alpha', async () => {
    const preset = getPreset('horror-metal')!
    const s = mergeSettings(DEFAULT_SETTINGS, preset.settings)
    const img = createImage(200, 200)
    fillRect(img, 0, 0, 200, 200, [5, 5, 5, 255])
    fillRect(img, 40, 40, 120, 120, [240, 240, 240, 255])
    fillRect(img, 80, 80, 40, 40, [180, 0, 0, 255])
    const { image } = await runPipeline({ source: img, settings: s, garmentHex: '#141414', printWidthIn: 3, strokeCheck: false })
    expect(image.width).toBe(900)
    expect(onlyBinaryAlpha(image)).toBe(true)
    // No near-black ink survives: the shirt is the black.
    let darkInk = 0
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] === 255 && image.data[i] < 25 && image.data[i + 1] < 25 && image.data[i + 2] < 25) darkInk++
    }
    expect(darkInk).toBe(0)
  })

  it('samples/shadow.png: soft drop shadow becomes dots with halftone on, never soft alpha', async () => {
    const src = await decodePng(new Uint8Array(readFileSync('samples/shadow.png')))
    expect(countSemiTransparent(src)).toBeGreaterThan(10000)
    const s = mergeSettings(DEFAULT_SETTINGS, { halftone: { enabled: true, mode: 'alpha' } })
    const { image, report } = await runPipeline({ source: src, settings: s, garmentHex: '#ffffff', printWidthIn: 5, strokeCheck: false })
    expect(image.width).toBe(1500)
    expect(onlyBinaryAlpha(image)).toBe(true)
    expect(report.halftoneDots).toBeGreaterThan(1000)

    const png = await encodePng(image)
    const info = readPngInfo(png)!
    expect(info.width).toBe(1500)
    expect(info.colorType).toBe(6)
    expect(info.dpiX).toBeCloseTo(300, 0)
    const back = await decodePng(png)
    expect(onlyBinaryAlpha(back)).toBe(true)
  })

  it('samples/shadow.png with defaults (no halftone): threshold still leaves binary alpha', async () => {
    const src = await decodePng(new Uint8Array(readFileSync('samples/shadow.png')))
    const { image } = await runPipeline({ source: src, settings: DEFAULT_SETTINGS, garmentHex: '#141414', printWidthIn: 4, strokeCheck: false })
    expect(image.width).toBe(1200)
    expect(onlyBinaryAlpha(image)).toBe(true)
  })

  it('every preset produces binary alpha at the exact width', async () => {
    const src = logoOnWhite()
    for (const id of ['skate-flat', 'distressed-relic', 'vintage-tour', 'stamp-outline', 'halftone-photo', 'hand-drawn', 'collage-zine', 'blackletter', 'collegiate', 'sports-throwback', 'playful', 'fade-into-garment']) {
      const s = mergeSettings(DEFAULT_SETTINGS, getPreset(id)!.settings)
      const { image } = await runPipeline({ source: src, settings: s, garmentHex: '#f0ebe0', printWidthIn: 2, dpi: 150, strokeCheck: false })
      expect(image.width, id).toBe(300)
      expect(onlyBinaryAlpha(image), id).toBe(true)
    }
  })

  it('mirror flips, outline and stroke check run', async () => {
    const img = createImage(100, 50)
    fillRect(img, 0, 0, 30, 50, [255, 0, 0, 255])
    const s = mergeSettings(DEFAULT_SETTINGS, { mirror: true, outline: { enabled: true, px: 3, color: '#000000' } })
    const { image, report } = await runPipeline({ source: img, settings: s, garmentHex: '#ffffff', printWidthIn: 1 })
    expect(image.width).toBe(300)
    expect(report.added.outline).toBeGreaterThan(0)
    expect(report.strokes).not.toBeNull()
  })

  it('throws a clear error when everything is knocked out', async () => {
    const img = createImage(20, 20)
    fillRect(img, 0, 0, 20, 20, [0, 0, 0, 255])
    const s = mergeSettings(DEFAULT_SETTINGS, { knockoutGarment: true })
    await expect(runPipeline({ source: img, settings: s, garmentHex: '#000000', printWidthIn: 2 })).rejects.toThrow(/Nothing is left/)
  })

  it('file name encodes the inch size', () => {
    expect(exportFileName(11, 9.3666)).toBe('design_11x9.37in_300dpi.png')
  })
})
