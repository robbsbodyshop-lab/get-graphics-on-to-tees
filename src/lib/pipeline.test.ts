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

describe('pipeline fixes from the session playbook', () => {
  /** Light-gray art with a red accent and soft edges, on a transparent background whose hidden RGB is white. */
  function playbookArt(): RGBAImage {
    const img = createImage(240, 240)
    fillRect(img, 0, 0, 240, 240, [255, 255, 255, 0]) // transparent, but white underneath
    fillRect(img, 30, 30, 180, 180, [205, 205, 205, 255]) // light gray panel
    fillRect(img, 60, 60, 120, 60, [160, 160, 160, 255]) // mid gray
    fillRect(img, 100, 140, 40, 30, [200, 30, 30, 255]) // red hat
    fillRect(img, 20, 20, 200, 10, [205, 205, 205, 110]) // soft fringe
    fillRect(img, 70, 175, 60, 25, [8, 8, 8, 255]) // dark panel (the shirt's black)
    return img
  }

  it('clears hidden color under transparent pixels and keeps the red accent', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { knockoutGarment: true, halftone: { enabled: true, mode: 'alpha' } })
    const { image, report } = await runPipeline({ source: playbookArt(), settings: s, garmentHex: '#141414', printWidthIn: 2, strokeCheck: false })
    expect(report.check.partial).toBe(0)
    expect(report.check.hiddenColor).toBe(0)
    expect(report.hiddenColorCleared).toBeGreaterThan(0)
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] === 0) expect(image.data[i] | image.data[i + 1] | image.data[i + 2]).toBe(0)
    }
    expect(report.check.saturated).toBeGreaterThan(0.01) // the red survived
    expect(report.check.brightness.black).toBe(0) // the dark panel became shirt
  })

  it('luminance halftone keeps light art on a dark shirt (light tones get more ink there)', async () => {
    const src = createImage(200, 200)
    fillRect(src, 20, 20, 160, 160, [215, 215, 215, 255])
    const s = mergeSettings(DEFAULT_SETTINGS, { halftone: { enabled: true, mode: 'luminance', ink: 'original' } })
    const onBlack = await runPipeline({ source: src, settings: s, garmentHex: '#141414', printWidthIn: 2, strokeCheck: false })
    const onWhite = await runPipeline({ source: src, settings: s, garmentHex: '#ffffff', printWidthIn: 2, strokeCheck: false })
    const ink = (img: RGBAImage) => {
      let n = 0
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 255) n++
      return n
    }
    expect(ink(onBlack.image)).toBeGreaterThan(ink(onWhite.image) * 3)
    expect(onBlack.report.messages.some((m) => m.includes('Tones halftone kept only'))).toBe(false)
    expect(onWhite.report.messages.some((m) => m.includes('Tones halftone kept only'))).toBe(true)
  })

  it('removes dots smaller than 0.01 in, even inside a halftone', async () => {
    const src = createImage(300, 60)
    for (let x = 0; x < 300; x++) fillRect(src, x, 0, 1, 60, [255, 255, 255, Math.round((x / 299) * 255)])
    const s = mergeSettings(DEFAULT_SETTINGS, { halftone: { enabled: true, mode: 'alpha' } })
    const { image, report } = await runPipeline({ source: src, settings: s, garmentHex: '#141414', printWidthIn: 3, strokeCheck: false })
    expect(report.specks.tinyDots).toBeGreaterThan(0)
    // No opaque island smaller than 3 px across remains.
    const { width: w, height: h, data } = image
    const seen = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) {
      if (seen[p] || data[p * 4 + 3] === 0) continue
      let x0 = w, x1 = -1, y0 = h, y1 = -1
      const stack = [p]
      seen[p] = 1
      while (stack.length) {
        const q = stack.pop()!
        const x = q % w, y = (q - x) / w
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const r = ny * w + nx
          if (!seen[r] && data[r * 4 + 3] > 0) { seen[r] = 1; stack.push(r) }
        }
      }
      expect(Math.max(x1 - x0 + 1, y1 - y0 + 1)).toBeGreaterThanOrEqual(3)
    }
  })

  it('warns when most of the ink is close to the shirt color', async () => {
    const src = createImage(100, 100)
    fillRect(src, 10, 10, 80, 80, [150, 150, 150, 255])
    const { report } = await runPipeline({ source: src, settings: DEFAULT_SETTINGS, garmentHex: '#9a9a9a', printWidthIn: 2, strokeCheck: false })
    expect(report.check.garmentClose).toBeGreaterThan(0.9)
    expect(report.messages.some((m) => m.includes('washed out on this shirt'))).toBe(true)
  })

  it('warns when a garment knockout on a mid-tone shirt deletes most of the art', async () => {
    const src = createImage(100, 100)
    fillRect(src, 10, 10, 80, 80, [150, 150, 150, 255])
    fillRect(src, 40, 40, 10, 10, [255, 255, 255, 255])
    const s = mergeSettings(DEFAULT_SETTINGS, { knockoutGarment: true, tolerance: 12 })
    const { report } = await runPipeline({ source: src, settings: s, garmentHex: '#969696', printWidthIn: 2, strokeCheck: false })
    expect(report.messages.some((m) => m.includes('Knocking out the shirt color removed'))).toBe(true)
  })
})

describe('posterize warnings', () => {
  it('warns when posterize shifts smooth tones a lot', async () => {
    const src = createImage(256, 40)
    for (let x = 0; x < 256; x++) fillRect(src, x, 0, 1, 40, [x, Math.round(x * 0.7), 255 - x, 255])
    const s = mergeSettings(DEFAULT_SETTINGS, { posterize: { enabled: true, colors: 2 } })
    const { report } = await runPipeline({ source: src, settings: s, garmentHex: '#ffffff', printWidthIn: 2, strokeCheck: false })
    expect(report.messages.some((m) => m.startsWith('Posterize changed'))).toBe(true)
  })
})
