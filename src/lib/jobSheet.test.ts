import { describe, expect, it } from 'vitest'
import { buildJobSheet, type JobSheetInput } from './jobSheet'
import { selectVariant } from './sizing'

const base: JobSheetInput = {
  sourceName: 'shadow.png',
  sourcePx: { w: 1200, h: 1000 },
  lookText: 'grimy horror tee',
  presetName: 'Horror / metal',
  store: 'Aviva Dallas',
  garment: 'Gildan 5000 Heavy Cotton Tee',
  color: 'Black',
  size: 'L',
  placementLabel: 'Adult full front',
  downIn: 3,
  downNote: null,
  offsetIn: 0,
  widthIn: 11,
  heightIn: 9.2,
  variant: selectVariant(11, 9.2),
  priceDate: '2026-11-03',
  effectiveDpi: 412,
  dpiLabel: 'Print-ready',
  knockedOut: 'background',
  upscaledWith: 'none',
  warnings: [],
  quantity: 1,
}

describe('buildJobSheet', () => {
  it('includes the designer note only when the size is not a listed variant', () => {
    const custom = buildJobSheet(base)
    expect(base.variant?.note).not.toBeNull()
    expect(custom).toContain('Leave a Note for our Designers')
    expect(custom).toContain(base.variant!.note!)

    const exact = buildJobSheet({ ...base, widthIn: 10, heightIn: 12, variant: selectVariant(10, 12) })
    expect(selectVariant(10, 12)?.note).toBeNull()
    expect(exact).not.toContain('Leave a Note for our Designers')
    expect(exact).toContain('Order the 10x12 variant')
    expect(exact).toContain('$4.60')
    expect(exact).toContain('2026-11-03')
  })

  it('prints the pressing defaults and the supplier-override line', () => {
    const t = buildJobSheet(base)
    expect(t).toContain('Pre-press 3–5 s')
    expect(t).toContain('Press 300–320 °F, 10–15 s, medium-firm to firm pressure')
    expect(t).toContain("Your film supplier's spec overrides these numbers; test on scrap first.")
    expect(t).toContain('Wash inside out in cold water; tumble dry low or hang dry.')
  })

  it('orders two for a zip hoodie split and one otherwise', () => {
    expect(buildJobSheet({ ...base, quantity: 2 })).toContain('Quantity: 2')
    expect(buildJobSheet(base)).toContain('Quantity: 1')
  })

  it('lists placement, source, look and the too-large case', () => {
    const t = buildJobSheet({ ...base, variant: null, widthIn: 30, heightIn: 30, offsetIn: 3.75 })
    expect(t).toContain('shadow.png')
    expect(t).toContain('1200 x 1000 px')
    expect(t).toContain('grimy horror tee')
    expect(t).toContain('3 in below the collar seam')
    expect(t).toContain("3.75 in toward the wearer's left")
    expect(t).toContain('use a gang sheet')
  })

  it('adds export check lines only when an export check is given', () => {
    expect(buildJobSheet(base)).not.toContain('Export check:')
    const t = buildJobSheet({
      ...base,
      exportCheck: { partial: 0, clearPct: 81.1, solidPct: 18.9, hiddenColor: 0, iccSrgb: true, garmentClosePct: 12 },
    })
    expect(t).toContain('Export check: 81.1% clear, 18.9% solid, 0 partly clear pixels')
    expect(t).toContain('Hidden color under transparency: 0')
    expect(t).toContain('Color profile: sRGB ICC embedded')
    expect(t).toContain('Ink close to shirt color: 12%')
    const bad = buildJobSheet({
      ...base,
      exportCheck: { partial: 5, clearPct: 80, solidPct: 20, hiddenColor: 3, iccSrgb: false, garmentClosePct: 30 },
    })
    expect(bad).toContain('5 partly clear pixels')
    expect(bad).toContain('Color profile: no sRGB ICC profile found')
  })
})
