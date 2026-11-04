import type { BBox, MaskKind, ProcessSettings, RGB, RGBAImage } from './types'
import { cloneImage, countSemiTransparent, padImage } from './image/core'
import { hexToRgb, lightness01 } from './image/color'
import { knockoutColors, removeBackgroundFlood } from './image/knockout'
import { choke, hardThreshold, removeSpecks, speckSizePx, thicken } from './image/alpha'
import { alphaBBox, crop, fitCanvas, mirrorHorizontal, solidCoverage, trim } from './image/geometry'
import { addOutline, adjustContrast, colorWarnings, desaturate, posterize, posterizeShift, snapBlackWhite } from './image/colorwork'
import { applyDistress, generateMask } from './image/masks'
import { fadeEdgeHalftone, halftoneAlpha, halftoneLuminance } from './image/halftone'
import { checkStrokes, type StrokeCheck } from './image/strokes'
import { clearHiddenColor, inspectExport, type ExportCheck } from './exportCheck'
import { resizeLanczos } from './resize'
import {
  DISTRESS_TILE_IN,
  MIN_DOT_IN,
  MIN_GAP_IN,
  MIN_STROKE_IN,
  MIN_TEXT_IN,
  OUTPUT_DPI,
  SOLID_WARN,
  TRIM_MARGIN_IN,
} from './settings'

// Fixed processing order (thresholding before upscaling makes jagged edges):
//   A. at source resolution: find the art (knockout + line art) and crop to it
//   B. upscale / resize the cropped source to the final pixel size
//   C. color work -> knockout -> distress -> halftone / edge fade -> alpha threshold
//      -> speck removal -> outline -> choke / thicken -> trim + exact canvas -> mirror

export type Upscaler = (
  img: RGBAImage,
  width: number,
  height: number,
  onProgress: (fraction: number) => void,
) => Promise<RGBAImage>

export interface PipelineInput {
  source: RGBAImage
  settings: ProcessSettings
  garmentHex: string
  /** Width of the exported file in inches (art plus the 0.1 in margin on each side). */
  printWidthIn: number
  /** 300 for export; lower for fast previews. */
  dpi?: number
  /** Used when the art must grow. Defaults to Lanczos. */
  upscale?: Upscaler
  /** Measure thin strokes / gaps (about 1 s per 3000 px image). Default true. */
  strokeCheck?: boolean
  onProgress?: (stage: string, fraction: number) => void
  /** Checked between stages; throw to cancel. */
  signal?: { cancelled: boolean }
}

export interface PipelineReport {
  dpi: number
  widthPx: number
  heightPx: number
  widthIn: number
  heightIn: number
  /** Art crop in source pixels. */
  sourceCrop: BBox
  /** Source pixels per printed inch before upscaling. */
  sourceDpi: number
  upscaleFactor: number
  upscaledWith: 'none' | 'lanczos' | 'custom'
  /** Counted at source resolution, so the numbers match what the user sees in step 5. */
  sourceRemoved: { garment: number; picks: number; background: number; lineArt: number }
  removed: { garment: number; picks: number; background: number; distress: number; threshold: number; choke: number }
  /** Islands under speckMinIn, plus dots under MIN_DOT_IN (1-2 px dots that won't transfer). */
  specks: { islands: number; pixels: number; minSizePx: number; tinyDots: number }
  halftoneDots: number
  added: { outline: number; thicken: number }
  palette: string[]
  semiTransparentAfter: number
  solid: { coverage: number; warn: boolean }
  strokes: StrokeCheck | null
  colors: { saturatedFraction: number; messages: string[] }
  /** The playbook's export verification, computed on the final pixels. */
  check: ExportCheck
  /** Transparent pixels whose leftover RGB was cleared to 0,0,0. */
  hiddenColorCleared: number
  messages: string[]
}

const maskCache = new Map<MaskKind, Uint8Array>()
const MASK_SIZE = 512
function maskFor(kind: MaskKind): Uint8Array {
  let m = maskCache.get(kind)
  if (!m) {
    m = generateMask(kind, MASK_SIZE, 1)
    maskCache.set(kind, m)
  }
  return m
}

/**
 * Which tones get more halftone coverage. On a dark shirt lighter tones need more ink, on a light
 * shirt darker tones do; for a fixed ink, coverage follows how far each tone is from the shirt.
 */
export function halftoneDarkInk(ink: string, garmentHex: string): boolean {
  const g = hexToRgb(garmentHex)
  const gL = lightness01(g.r, g.g, g.b)
  if (ink === 'original' || ink === 'auto') return gL >= 0.5
  const c = hexToRgb(ink)
  return lightness01(c.r, c.g, c.b) < gL
}

/** Black or white, whichever contrasts with the garment. */
export function contrastInk(garmentHex: string): { hex: string; darkInk: boolean } {
  const g = hexToRgb(garmentHex)
  return lightness01(g.r, g.g, g.b) < 0.5 ? { hex: '#ffffff', darkInk: false } : { hex: '#000000', darkInk: true }
}

/** 1-bit line art: lightness < threshold -> ink (alpha 255), else transparent. */
export function applyLineArt(img: RGBAImage, threshold: number, ink: RGB | null): { removed: number } {
  const d = img.data
  let removed = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    if (lightness01(d[i], d[i + 1], d[i + 2]) < threshold) {
      if (ink) {
        d[i] = ink.r
        d[i + 1] = ink.g
        d[i + 2] = ink.b
      }
      d[i + 3] = 255
    } else {
      d[i + 3] = 0
      removed++
    }
  }
  return { removed }
}

function resolveLineInk(s: ProcessSettings, garmentHex: string): RGB | null {
  if (s.lineArt.ink === 'original') return null
  if (s.lineArt.ink === 'auto') return hexToRgb(contrastInk(garmentHex).hex)
  return hexToRgb(s.lineArt.ink)
}

/** Knockout steps shared by the source-resolution analysis pass and the final pass. */
function knockouts(img: RGBAImage, s: ProcessSettings, garmentHex: string) {
  const out = { garment: 0, picks: 0, background: 0 }
  if (s.removeBackground) out.background = removeBackgroundFlood(img, s.tolerance).removed
  if (s.knockoutGarment) out.garment = knockoutColors(img, [hexToRgb(garmentHex)], s.tolerance).removed
  if (s.knockoutPicks.length > 0) out.picks = knockoutColors(img, s.knockoutPicks.map(hexToRgb), s.tolerance).removed
  return out
}

export class PipelineError extends Error {}

export async function runPipeline(input: PipelineInput): Promise<{ image: RGBAImage; report: PipelineReport }> {
  const s = input.settings
  const dpi = input.dpi ?? OUTPUT_DPI
  const k = dpi / OUTPUT_DPI // scale for pixel-sized settings tuned at 300 DPI
  const progress = input.onProgress ?? (() => {})
  const check = () => {
    if (input.signal?.cancelled) throw new PipelineError('Cancelled')
  }
  const messages: string[] = []

  // ---- A. find the art at source resolution ----------------------------------------------
  progress('Finding the art', 0)
  const probe = cloneImage(input.source)
  let srcInk = 0
  for (let i = 3; i < probe.data.length; i += 4) if (probe.data[i] > 0) srcInk++
  const srcKo = knockouts(probe, s, input.garmentHex)
  const lineArtRemoved = s.lineArt.enabled ? applyLineArt(probe, s.lineArt.threshold, null).removed : 0
  // Art bounds ignore faint pixels the threshold will drop anyway.
  const thresholdAlpha = Math.max(1, Math.round(s.alphaThreshold * 255))
  const bbox = alphaBBox(probe, s.halftone.enabled || s.fadeEdge.enabled ? 1 : thresholdAlpha)
  if (!bbox) throw new PipelineError('Nothing is left after the knockout. Lower the tolerance or turn off a knockout.')
  check()

  // ---- B. scale to final size -----------------------------------------------------------
  const marginPx = Math.round(TRIM_MARGIN_IN * dpi)
  const outlinePx = s.outline.enabled ? Math.max(1, Math.round(s.outline.px * k)) : 0
  const thickenPx = s.thicken ? 1 : 0
  const canvasW = Math.round(input.printWidthIn * dpi)
  const artW = canvasW - 2 * marginPx - 2 * outlinePx - 2 * thickenPx
  if (artW < 8) throw new PipelineError('Print width is too small.')
  const scale = artW / bbox.w
  const artH = Math.max(1, Math.round(bbox.h * scale))
  let work = crop(input.source, bbox)
  let upscaledWith: PipelineReport['upscaledWith'] = 'none'
  progress('Resizing', 0)
  if (scale > 1.0001 && input.upscale) {
    work = await input.upscale(work, artW, artH, (f) => progress('Upscaling', f))
    upscaledWith = 'custom'
  } else if (Math.abs(scale - 1) > 0.0001) {
    work = resizeLanczos(work, artW, artH)
    upscaledWith = 'lanczos'
  }
  if (work.width !== artW || work.height !== artH) work = resizeLanczos(work, artW, artH)
  if (scale > 2) messages.push(`Upscaled ${scale.toFixed(1)}x. Upscalers invent detail: check text and logos at 100% before ordering.`)
  check()

  // ---- C1. color work ---------------------------------------------------------------------
  progress('Color work', 0)
  if (s.desaturate > 0) desaturate(work, s.desaturate)
  if (s.contrast !== 0) adjustContrast(work, s.contrast)
  if (s.lineArt.enabled) applyLineArt(work, s.lineArt.threshold, resolveLineInk(s, input.garmentHex))
  let palette: RGB[] = []
  if (s.posterize.enabled) {
    const before = cloneImage(work)
    palette = posterize(work, s.posterize.colors).palette
    // A cleared warning can hide damage: say when posterize moved a lot of the ink or lost an accent.
    const shift = posterizeShift(before, work)
    if (shift.lostAccentFraction > 0.002)
      messages.push(
        `Posterize turned ${(shift.lostAccentFraction * 100).toFixed(1)}% of the ink from a saturated color (an accent such as a red) to a dull one. ` +
          'Raise the color count or turn Posterize off; it suits flat logos, not photo-style or textured art.',
      )
    if (shift.shiftedFraction > 0.1)
      messages.push(
        `Posterize changed ${Math.round(shift.shiftedFraction * 100)}% of the ink noticeably (Delta E over 15); expect banding in smooth tones. Check the crop inspector after export.`,
      )
  }
  if (s.snapBlackWhite) snapBlackWhite(work)
  check()

  // ---- C2. knockout -----------------------------------------------------------------------
  progress('Knocking out', 0)
  const ko = knockouts(work, s, input.garmentHex)
  // Room for the margin, outline and thicken from here on.
  work = padImage(work, marginPx + outlinePx + thickenPx + 2)
  check()

  // ---- C3. distress -----------------------------------------------------------------------
  let distressRemoved = 0
  if (s.distress.enabled && s.distress.intensity > 0) {
    progress('Distressing', 0)
    distressRemoved = applyDistress(work, maskFor(s.distress.mask), MASK_SIZE, s.distress.intensity, DISTRESS_TILE_IN * dpi).removed
  }
  check()

  // ---- C4. halftone (protect mask keeps dots safe from speck removal) ----------------------
  let protect: Uint8Array | undefined
  let halftoneDots = 0
  let inkBeforeHalftone = 0
  if (s.halftone.enabled || s.fadeEdge.enabled) for (let i = 3; i < work.data.length; i += 4) if (work.data[i] > 0) inkBeforeHalftone++
  const mergeMask = (m: Uint8Array) => {
    if (!protect) protect = m
    else for (let i = 0; i < m.length; i++) protect[i] |= m[i]
  }
  const ht = { lpi: s.halftone.lpi, dpi, angleDeg: s.halftone.angle }
  if (s.fadeEdge.enabled) {
    progress('Fading the edge', 0)
    const r = fadeEdgeHalftone(work, { ...ht, edge: s.fadeEdge.edge, fraction: s.fadeEdge.fraction })
    mergeMask(r.mask)
    halftoneDots += r.dotted
  }
  if (s.halftone.enabled) {
    progress('Halftone', 0)
    if (s.halftone.mode === 'alpha') {
      const r = halftoneAlpha(work, ht)
      mergeMask(r.mask)
      halftoneDots += r.dotted
    } else {
      let ink = s.halftone.ink
      const darkInk = halftoneDarkInk(ink, input.garmentHex)
      if (ink === 'auto') ink = contrastInk(input.garmentHex).hex
      const r = halftoneLuminance(work, { ...ht, lumLo: s.halftone.lumLo, lumHi: s.halftone.lumHi, ink, darkInk })
      mergeMask(r.mask)
      halftoneDots += r.dotted
    }
  }
  check()

  // ---- C5. alpha threshold -> every pixel 0 or 255 ------------------------------------------
  progress('Hard edges', 0)
  const th = hardThreshold(work, s.alphaThreshold)

  // ---- C6. speck removal ------------------------------------------------------------------
  const minSpeck = speckSizePx(s.speckMinIn, dpi)
  const sp = s.speckMinIn > 0 ? removeSpecks(work, minSpeck, protect) : { islandsRemoved: 0, pixelsRemoved: 0 }
  // Dots under 0.01 in (1-2 px at 300 DPI) don't transfer reliably, halftone dots included.
  const minDot = speckSizePx(MIN_DOT_IN, dpi)
  const tiny = minDot > 1 ? removeSpecks(work, minDot) : { islandsRemoved: 0, pixelsRemoved: 0 }
  if (inkBeforeHalftone > 0 && s.halftone.enabled && s.halftone.mode === 'luminance') {
    let inkAfter = 0
    for (let i = 3; i < work.data.length; i += 4) if (work.data[i] > 0) inkAfter++
    if (inkAfter < inkBeforeHalftone * 0.5)
      messages.push(
        `The Tones halftone kept only ${Math.round((inkAfter / inkBeforeHalftone) * 100)}% of the ink. ` +
          'For art that already has a transparent background, set "Dots from" to Soft edges and shadows (alpha); Tones is for photos on a solid background.',
      )
  }
  if (s.knockoutGarment && srcInk > 0) {
    const g = hexToRgb(input.garmentHex)
    const gL = lightness01(g.r, g.g, g.b)
    const share = srcKo.garment / srcInk
    if (share > 0.3 && gL > 0.2 && gL < 0.8)
      messages.push(
        `Knocking out the shirt color removed ${Math.round(share * 100)}% of the art. On a mid-tone shirt that deletes real ink: turn the garment knockout off or lower the tolerance.`,
      )
  }
  check()

  // ---- C7. outline, choke / thicken ---------------------------------------------------------
  let outlineAdded = 0
  if (outlinePx > 0) {
    const color = s.outline.color === 'garment' ? hexToRgb(input.garmentHex) : hexToRgb(s.outline.color)
    outlineAdded = addOutline(work, outlinePx, color).added
  }
  const chokeRemoved = s.choke ? choke(work, 1).removed : 0
  const thickenAdded = s.thicken ? thicken(work, 1).added : 0
  // Safety net: nothing above may leave soft alpha, but never export it if something did.
  if (countSemiTransparent(work) > 0) hardThreshold(work, 0.5)

  // ---- C8. checks on the final art --------------------------------------------------------
  progress('Checking', 0)
  const solid = solidCoverage(work)
  if (solid.coverage > SOLID_WARN)
    messages.push(
      `The design is ${Math.round(solid.coverage * 100)}% solid inside its outline. Big solid fills feel like a plastic patch and trap sweat. ` +
        'Try, in order: delete background shapes and borders; knock out garment-color areas; halftone the fades; add distress texture; keep it open and thin.',
    )
  let strokes: StrokeCheck | null = null
  if (input.strokeCheck !== false) {
    strokes = checkStrokes(work, {
      minStrokePx: Math.round(MIN_STROKE_IN * dpi),
      minGapPx: Math.round(MIN_GAP_IN * dpi),
      minDetailPx: Math.round(MIN_TEXT_IN * dpi),
      protect,
    })
    messages.push(...strokes.messages)
    const gapFraction = strokes.thinGapPixels / Math.max(1, solid.opaque)
    if (strokes.thinStrokePixels > 0 && strokes.thinGapPixels > 0 && strokes.thinStrokeFraction < 0.01 && gapFraction < 0.01)
      messages.push(
        'Thin strokes and narrow gaps are each under 1% of the ink. Thicken fixes one and makes the other worse, so at this level it is usually fine to leave both.',
      )
  }
  const colors = colorWarnings(work)
  messages.push(...colors.messages)

  // ---- C9. trim to art + 0.1 in, exact width, mirror ---------------------------------------
  progress('Trimming', 0)
  let out = trim(work, marginPx)
  out = fitCanvas(out, canvasW, out.height)
  if (s.mirror) mirrorHorizontal(out)
  // Transparent pixels can still carry the source's RGB; some viewers show it and some RIP or
  // resize steps bleed it into edges as a fringe. Clear it so alpha 0 means nothing at all.
  const hiddenColorCleared = clearHiddenColor(out)
  const semi = countSemiTransparent(out)
  const exportCheck = inspectExport(out, input.garmentHex)
  if (exportCheck.garmentClose > 0.25)
    messages.push(
      `${Math.round(exportCheck.garmentClose * 100)}% of the ink is within 40 brightness levels of the shirt color, so it will look washed out on this shirt. ` +
        'Add contrast, pick a contrasting shirt, or make a separate export for this shirt color.',
    )
  progress('Done', 1)

  return {
    image: out,
    report: {
      dpi,
      widthPx: out.width,
      heightPx: out.height,
      widthIn: out.width / dpi,
      heightIn: out.height / dpi,
      sourceCrop: bbox,
      sourceDpi: bbox.w / (artW / dpi),
      upscaleFactor: scale,
      upscaledWith,
      sourceRemoved: { ...srcKo, lineArt: lineArtRemoved },
      removed: { ...ko, distress: distressRemoved, threshold: th.madeTransparent, choke: chokeRemoved },
      specks: { islands: sp.islandsRemoved, pixels: sp.pixelsRemoved + tiny.pixelsRemoved, minSizePx: minSpeck, tinyDots: tiny.islandsRemoved },
      halftoneDots,
      added: { outline: outlineAdded, thicken: thickenAdded },
      palette: palette.map((c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`),
      semiTransparentAfter: semi,
      solid: { coverage: solid.coverage, warn: solid.coverage > SOLID_WARN },
      strokes,
      colors: { saturatedFraction: colors.saturatedFraction, messages: colors.messages },
      check: exportCheck,
      hiddenColorCleared,
      messages,
    },
  }
}

/** "11" -> "11", 9.3667 -> "9.37": used in file names and the job sheet. */
export function fmtIn(v: number): string {
  return String(Math.round(v * 100) / 100)
}

export function exportFileName(widthIn: number, heightIn: number, suffix = ''): string {
  return `design_${fmtIn(widthIn)}x${fmtIn(heightIn)}in_300dpi${suffix}.png`
}

/** Plain-English summary of what the knockout removed, for the job sheet. */
export function knockoutSummary(r: PipelineReport, s: ProcessSettings, garmentName: string): string {
  const parts: string[] = []
  if (s.removeBackground) parts.push(`background (flood fill, Delta E ${s.tolerance})`)
  if (s.knockoutGarment) parts.push(`${garmentName} garment color (Delta E ${s.tolerance})`)
  if (s.knockoutPicks.length) parts.push(`picked colors ${s.knockoutPicks.join(', ')}`)
  if (s.lineArt.enabled) parts.push(`light tones (line art at ${Math.round(s.lineArt.threshold * 100)}%)`)
  if (s.distress.enabled) parts.push(`${s.distress.mask} distress at ${Math.round(s.distress.intensity * 100)}%`)
  if (r.specks.islands) parts.push(`${r.specks.islands} specks under ${fmtIn(s.speckMinIn)} in`)
  if (s.halftone.enabled || s.fadeEdge.enabled) parts.push(`tones converted to ${s.halftone.lpi} LPI halftone dots`)
  return parts.length ? parts.join('; ') : 'nothing'
}
