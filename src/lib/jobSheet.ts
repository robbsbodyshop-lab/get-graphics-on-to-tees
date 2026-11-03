import type { VariantChoice } from './sizing'
import { AHTV_NOTE_LABEL } from './sizing'
import { fmtIn } from './pipeline'

export interface JobSheetSecondary {
  label: string
  widthIn: number
  heightIn: number
  variant: VariantChoice | null
}

export interface JobSheetInput {
  sourceName: string
  sourcePx: { w: number; h: number }
  lookText: string
  presetName: string
  store: string
  /** "Gildan 5000 Heavy Cotton Tee" */
  garment: string
  color: string
  size: string
  placementLabel: string
  downIn: number | null
  downNote: string | null
  offsetIn: number
  widthIn: number
  heightIn: number
  variant: VariantChoice | null
  priceDate: string
  effectiveDpi: number
  dpiLabel: string
  knockedOut: string
  upscaledWith: string
  warnings: string[]
  /** 2 for a zip hoodie split (one transfer per side), else 1. */
  quantity: number
  secondary?: JobSheetSecondary
  /** Extra advice lines (for example washed-blank recommendations). */
  recommendations?: string[]
}

const money = (n: number) => `$${n.toFixed(2)}`

function variantLines(v: VariantChoice | null, w: number, h: number, priceDate: string): string[] {
  if (!v) return [`Too large for a single transfer (${fmtIn(w)} x ${fmtIn(h)} in): use a gang sheet.`]
  const lines = [
    `Order the ${v.variant.label} variant`,
    `Variant price: ${money(v.variant.price)} each (prices as of ${priceDate}; re-check the page before ordering)`,
  ]
  if (v.rotated) lines.push('The design fits this variant when turned 90 degrees.')
  if (v.note) {
    lines.push(`This size is not a listed variant. Paste this in "${AHTV_NOTE_LABEL}":`)
    lines.push(v.note)
  } else {
    lines.push('Print size matches a listed variant exactly: no designer note needed.')
  }
  return lines
}

/** Plain-text job sheet: headed sections, one fact per line. */
export function buildJobSheet(i: JobSheetInput): string {
  const L: string[] = []
  const section = (title: string, lines: string[]) => {
    if (L.length) L.push('')
    L.push(title.toUpperCase())
    L.push(...lines)
  }

  section('DTF job sheet', [`Prepared with DTF Prep`])
  section('Source file', [
    `File: ${i.sourceName}`,
    `Pixel size: ${i.sourcePx.w} x ${i.sourcePx.h} px`,
  ])
  section('Look', [
    `Preset: ${i.presetName || 'None'}`,
    `Look: ${i.lookText.trim() || '(not described)'}`,
  ])
  section('Garment', [
    `Store: ${i.store}`,
    `Style: ${i.garment}`,
    `Color: ${i.color}`,
    `Size: ${i.size}`,
    `Quantity: ${i.quantity}${i.quantity === 2 ? ' (zip hoodie split: one transfer for each side)' : ''}`,
  ])
  section('Placement', [
    `Placement: ${i.placementLabel}`,
    i.downIn !== null ? `Top of design: ${fmtIn(i.downIn)} in below the collar seam` : `Top of design: ${i.downNote ?? 'see placement notes'}`,
    i.offsetIn === 0
      ? 'Offset from centre: 0 in (centred)'
      : `Offset from centre: ${fmtIn(i.offsetIn)} in toward the wearer's left`,
    `Final print size: ${fmtIn(i.widthIn)} x ${fmtIn(i.heightIn)} in (includes 0.1 in transparent margin)`,
  ])
  section('Order (American HTV Supply)', variantLines(i.variant, i.widthIn, i.heightIn, i.priceDate))
  if (i.secondary) {
    const s = i.secondary
    section(`Second file: ${s.label}`, [
      `Final print size: ${fmtIn(s.widthIn)} x ${fmtIn(s.heightIn)} in`,
      ...variantLines(s.variant, s.widthIn, s.heightIn, i.priceDate),
    ])
  }
  section('Quality', [
    `Effective DPI: ${Math.round(i.effectiveDpi)} (${i.dpiLabel})`,
    `Upscaled with: ${i.upscaledWith}`,
    `Knocked out: ${i.knockedOut}`,
    ...(i.warnings.length ? i.warnings.map((w) => `Warning: ${w}`) : ['Warnings: none']),
  ])
  section('Pressing defaults', [
    'Pre-press 3–5 s',
    'Press 300–320 °F, 10–15 s, medium-firm to firm pressure',
    'Peel per your film (cold peel is the safest default)',
    'Second press 5–10 s with parchment or a Teflon sheet (linen sheet for a matte finish)',
    'Your film supplier\'s spec overrides these numbers; test on scrap first.',
  ])
  section('Care', ['Wash inside out in cold water; tumble dry low or hang dry.'])
  if (i.recommendations?.length) section('Recommended blanks', i.recommendations)
  return L.join('\n') + '\n'
}
