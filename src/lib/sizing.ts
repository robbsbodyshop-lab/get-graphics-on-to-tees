import ahtv from '../data/ahtv-sizes.json'
import placementsData from '../data/placements.json'

// ---------------------------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------------------------

export type PlacementSide = 'front' | 'back' | 'sleeve' | 'hat' | 'tote'
export type SizeClass = 'adult' | 'ladies' | 'youth' | 'toddler' | 'infant'

export interface Placement {
  id: string
  label: string
  side: PlacementSide
  sizeClass: 'adult' | 'youth' | 'toddler' | 'infant' | 'any'
  garmentTypes: string[]
  defaultW: number
  defaultH: number
  minW: number
  maxW: number
  maxH: number | null
  downIn: number | null
  downNote: string | null
  collarRule: 'adult-front' | null
  scalesWithSize: boolean
  offsetIn: number
  vertical: boolean
  oversize: { minW: number; maxW: number; downIn: number } | null
  notes: string
}

export const PLACEMENTS = placementsData.placements as Placement[]
export const SIZE_WIDTHS = placementsData.sizeWidthTable.widths as Record<string, number>
const COLLAR = placementsData.collarOffset

export function getPlacement(id: string): Placement {
  const p = PLACEMENTS.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown placement ${id}`)
  return p
}

const BIG_SIZES = new Set(['2XL', '3XL', '4XL', '5XL'])

/** Placements that make sense for a garment type + size class (hats and totes have their own). */
export function placementsFor(garmentType: string, sizeClass: SizeClass): Placement[] {
  const cls = sizeClass === 'ladies' ? 'adult' : sizeClass
  return PLACEMENTS.filter(
    (p) => p.garmentTypes.includes(garmentType) && (p.sizeClass === 'any' || p.sizeClass === cls),
  )
}

const round = (v: number, step: number) => Math.round(v / step) * step

/**
 * Proposed print width in inches for a placement and garment size.
 * Full front / full back scale with adult size via the size table (relative to L), rounded to
 * 0.25 in; everything else (left chest, sleeves, back neck, youth...) uses the default width.
 */
export function proposeWidth(placement: Placement, size: string, sizeClass: SizeClass, oversize = false): number {
  if (oversize && placement.oversize) return round((placement.oversize.minW + placement.oversize.maxW) / 2, 0.25)
  const adult = sizeClass === 'adult' || sizeClass === 'ladies'
  if (placement.scalesWithSize && adult && SIZE_WIDTHS[size] !== undefined) {
    return round((placement.defaultW * SIZE_WIDTHS[size]) / SIZE_WIDTHS.L, 0.25)
  }
  return placement.defaultW
}

/** Height from the art's aspect ratio (w/h), then capped by the placement's max height. */
export function sizeFromWidth(placement: Placement, widthIn: number, aspect: number): { w: number; h: number; capped: boolean } {
  let w = widthIn
  let h = w / aspect
  let capped = false
  if (placement.maxH !== null && h > placement.maxH) {
    h = placement.maxH
    w = h * aspect
    capped = true
  }
  return { w, h, capped }
}

/** Distance from the collar seam to the top of the design, or null where it doesn't apply. */
export function downFor(placement: Placement, size: string, sizeClass: SizeClass, oversize = false): number | null {
  if (oversize && placement.oversize) return placement.oversize.downIn
  if (placement.collarRule === 'adult-front') {
    if (sizeClass === 'youth') return COLLAR.youth
    return BIG_SIZES.has(size) ? COLLAR.twoXLUp : COLLAR.smallToXL
  }
  return placement.downIn
}

// ---------------------------------------------------------------------------------------------
// Garment flat dimensions for the mockup (approximate chest width and body length, inches)
// ---------------------------------------------------------------------------------------------

const ADULT_DIMS: Record<string, [number, number]> = {
  XS: [16.5, 27], S: [18, 28], M: [20, 29], L: [22, 30], XL: [24, 31],
  '2XL': [26, 32], '3XL': [28, 33], '4XL': [30, 34], '5XL': [32, 35],
}
const YOUTH_DIMS: Record<string, [number, number]> = {
  XS: [15, 20.5], S: [16, 22], M: [17, 24], L: [18, 26], XL: [19, 27],
}
const TODDLER_DIMS: Record<string, [number, number]> = {
  '2T': [12, 15], '3T': [13, 16], '4T': [14, 17], '5T': [15, 18],
}

export function garmentDims(sizeClass: SizeClass, size: string, fit: string, type: string): { bodyWidthIn: number; bodyLengthIn: number } {
  if (type === 'hat') return { bodyWidthIn: 8, bodyLengthIn: 6 }
  if (type === 'tote') return { bodyWidthIn: 15, bodyLengthIn: 16 }
  const table = sizeClass === 'youth' ? YOUTH_DIMS : sizeClass === 'toddler' || sizeClass === 'infant' ? TODDLER_DIMS : ADULT_DIMS
  let [w, l] = table[size] ?? table.L ?? table['3T'] ?? [22, 30]
  if (sizeClass === 'ladies') {
    w -= 2
    l -= 2
  }
  if (fit === 'boxy' || fit === 'oversized') {
    w += 2
    l -= fit === 'boxy' ? 1 : -1
  }
  if (type.startsWith('crop')) l = Math.round(l * 0.72)
  return { bodyWidthIn: w, bodyLengthIn: l }
}

// ---------------------------------------------------------------------------------------------
// Effective DPI flag
// ---------------------------------------------------------------------------------------------

export type DpiLevel = 'green' | 'amber' | 'red'

export interface DpiFlag {
  dpi: number
  level: DpiLevel
  label: string
  detail: string
}

/**
 * 300+ green; 200-299 amber; 150-199 amber ("low", the brief leaves this band unspecified, so it
 * is treated as amber with a stronger message); under 150 red.
 */
export function dpiFlag(dpi: number): DpiFlag {
  const d = Math.round(dpi)
  if (dpi >= 300) return { dpi: d, level: 'green', label: 'Print-ready', detail: `${d} DPI at this size: 300 or more is the DTF standard.` }
  if (dpi >= 200)
    return { dpi: d, level: 'amber', label: 'Acceptable', detail: `${d} DPI: acceptable only for large prints seen from a distance. Upscaling to 300 is recommended.` }
  if (dpi >= 150)
    return { dpi: d, level: 'amber', label: 'Low', detail: `${d} DPI: soft edges likely. Upscale before printing, or print smaller.` }
  return { dpi: d, level: 'red', label: 'Too low', detail: `${d} DPI: under 150 will look blurry or blocky. Upscale, vectorize, or find a bigger source.` }
}

export function effectiveDpi(sourcePx: number, printInches: number): number {
  return printInches > 0 ? sourcePx / printInches : 0
}

// ---------------------------------------------------------------------------------------------
// American HTV Supply variant selection
// ---------------------------------------------------------------------------------------------

export interface Variant {
  label: string
  w: number
  h: number
  price: number
}

export const AHTV_VARIANTS = ahtv.variants as Variant[]
export const AHTV_PRICE_DATE = ahtv.priceDate
export const AHTV_NOTE_LABEL = ahtv.noteFieldLabel

export interface VariantChoice {
  variant: Variant
  /** The variant's two sides cover the design in some orientation. */
  covers: boolean
  /** The design must be turned 90 degrees to fit the variant as listed. */
  rotated: boolean
  /** Design size equals a listed variant (either orientation) within 0.01 in. */
  exact: boolean
  /** Text to paste in "Leave a Note for our Designers", or null when the size is listed. */
  note: string | null
}

const EPS = 1e-6
const fmt = (v: number) => v.toFixed(2)

function coverOrientation(w: number, h: number, v: Variant): 'as-is' | 'rotated' | null {
  if (w <= v.w + EPS && h <= v.h + EPS) return 'as-is'
  if (w <= v.h + EPS && h <= v.w + EPS) return 'rotated'
  return null
}

export function customSizeNote(w: number, h: number, v: Variant): string {
  return (
    `Please print this design at its actual size: ${fmt(w)} in wide x ${fmt(h)} in tall ` +
    `(the PNG is 300 DPI at exactly that size). I ordered the ${v.label} variant because ${fmt(w)}x${fmt(h)} ` +
    `is not a listed size. Please do not scale it up to fill the ${v.label}.`
  )
}

/**
 * Orientation-agnostic: the cheapest variant whose two sides both cover the design (ties: smaller
 * area, then no rotation). If none covers it, the smallest variant whose longest side is at least
 * the design's longest side, with the custom-size note. Prices are not monotonic with size, so we
 * compare price, never area. Returns null when the design is bigger than every variant.
 */
export function selectVariant(wIn: number, hIn: number, variants: Variant[] = AHTV_VARIANTS): VariantChoice | null {
  const covering = variants
    .map((v) => ({ v, o: coverOrientation(wIn, hIn, v) }))
    .filter((c) => c.o !== null)
    .sort((a, b) => a.v.price - b.v.price || a.v.w * a.v.h - b.v.w * b.v.h || (a.o === 'as-is' ? -1 : 1) - (b.o === 'as-is' ? -1 : 1))

  if (covering.length > 0) {
    const { v, o } = covering[0]
    const exact =
      (Math.abs(v.w - wIn) < 0.01 && Math.abs(v.h - hIn) < 0.01) || (Math.abs(v.h - wIn) < 0.01 && Math.abs(v.w - hIn) < 0.01)
    return { variant: v, covers: true, rotated: o === 'rotated', exact, note: exact ? null : customSizeNote(wIn, hIn, v) }
  }

  const longest = Math.max(wIn, hIn)
  const fallback = variants
    .filter((v) => Math.max(v.w, v.h) >= longest - EPS)
    .sort((a, b) => a.w * a.h - b.w * b.h || a.price - b.price)
  if (fallback.length === 0) return null
  const v = fallback[0]
  return { variant: v, covers: false, rotated: false, exact: false, note: customSizeNote(wIn, hIn, v) }
}
