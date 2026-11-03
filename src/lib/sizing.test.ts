import { describe, expect, it } from 'vitest'
import {
  AHTV_VARIANTS,
  dpiFlag,
  downFor,
  effectiveDpi,
  getPlacement,
  placementsFor,
  proposeWidth,
  selectVariant,
  sizeFromWidth,
  type Variant,
} from './sizing'

describe('AHTV variant selection', () => {
  it('picks an exact listed size without a note', () => {
    const c = selectVariant(11, 11)!
    expect(c.variant.label).toBe('11x11')
    expect(c.exact).toBe(true)
    expect(c.note).toBeNull()
  })

  it('is orientation-agnostic: a 6x5 design uses the cheaper 5x6 variant', () => {
    const c = selectVariant(6, 5)!
    expect(c.variant.label).toBe('5x6')
    expect(c.variant.price).toBe(1.59)
    expect(c.rotated).toBe(true)
    expect(c.note).toBeNull() // same size, just turned
  })

  it('13x11 design uses 11x13 ($5.50), not 13x11 ($6.49)', () => {
    const c = selectVariant(13, 11)!
    expect(c.variant.label).toBe('11x13')
    expect(c.variant.price).toBe(5.5)
  })

  it('cheapest, not smallest: 8x9 goes to 9x9 ($3.50) even though 8x10 has less area ($3.99)', () => {
    const c = selectVariant(8, 9)!
    expect(c.variant.label).toBe('9x9')
    const smallestCovering = AHTV_VARIANTS.filter(
      (v) => (8 <= v.w && 9 <= v.h) || (8 <= v.h && 9 <= v.w),
    ).sort((a, b) => a.w * a.h - b.w * b.h)[0]
    expect(smallestCovering.label).toBe('8x10')
    expect(c.variant.price).toBeLessThan(smallestCovering.price)
    expect(c.note).toMatch(/8\.00 in wide x 9\.00 in tall/)
  })

  it('12x20 is not a listed size: it gets the custom-size note', () => {
    const c = selectVariant(12, 20)!
    expect(c.exact).toBe(false)
    expect(c.note).toMatch(/12\.00 in wide x 20\.00 in tall/)
    // With the full price list, 18x20 covers 12x20 and is cheaper than 20x20.
    expect(c.variant.label).toBe('18x20')
    expect(c.variant.price).toBeLessThan(AHTV_VARIANTS.find((v) => v.label === '20x20')!.price)
  })

  it("12x20 -> 20x20 + note on AHTV's own example list (no 18x20 variant)", () => {
    const list = AHTV_VARIANTS.filter((v) => v.label !== '18x20')
    const c = selectVariant(12, 20, list)!
    expect(c.variant.label).toBe('20x20')
    expect(c.covers).toBe(true)
    expect(c.note).toContain('20x20')
    expect(c.note).toContain('12.00 in wide x 20.00 in tall')
  })

  it('falls back to the smallest variant whose longest side covers the longest side', () => {
    const list: Variant[] = [
      { label: '10x20', w: 10, h: 20, price: 5 },
      { label: '20x8', w: 20, h: 8, price: 4 },
      { label: '4x4', w: 4, h: 4, price: 1 },
    ]
    const c = selectVariant(12, 20, list)!
    expect(c.covers).toBe(false)
    expect(c.variant.label).toBe('20x8')
    expect(c.note).not.toBeNull()
  })

  it('returns null when bigger than every variant', () => {
    expect(selectVariant(21, 10)).toBeNull()
  })

  it('compares price, never area, across the whole list', () => {
    for (let w = 1; w <= 20; w += 0.5) {
      for (let h = 1; h <= 20; h += 0.5) {
        const c = selectVariant(w, h)
        if (!c) continue
        const cheapest = Math.min(
          ...AHTV_VARIANTS.filter((v) => (w <= v.w && h <= v.h) || (w <= v.h && h <= v.w)).map((v) => v.price),
        )
        expect(c.variant.price).toBe(cheapest)
      }
    }
  })
})

describe('width scaling by garment size', () => {
  const front = getPlacement('adult-full-front')
  const back = getPlacement('full-back')

  it('follows the size table for full front', () => {
    const expected: Record<string, number> = {
      XS: 9, S: 10, M: 10.75, L: 11, XL: 11.25, '2XL': 11.75, '3XL': 12.25, '4XL': 12.75, '5XL': 13.25,
    }
    for (const [size, w] of Object.entries(expected)) expect(proposeWidth(front, size, 'adult')).toBe(w)
  })

  it('scales full back proportionally from its 12 in default (L = 12)', () => {
    expect(proposeWidth(back, 'L', 'adult')).toBe(12)
    expect(proposeWidth(back, 'XS', 'adult')).toBe(9.75)
    expect(proposeWidth(back, '5XL', 'adult')).toBe(14.5)
  })

  it('does not scale left chest, sleeves or back neck', () => {
    for (const id of ['left-chest', 'short-sleeve', 'long-sleeve', 'back-neck']) {
      const p = getPlacement(id)
      expect(proposeWidth(p, 'XS', 'adult')).toBe(p.defaultW)
      expect(proposeWidth(p, '5XL', 'adult')).toBe(p.defaultW)
    }
  })

  it('does not scale youth placements', () => {
    expect(proposeWidth(getPlacement('youth-full-front'), 'L', 'youth')).toBe(9)
  })

  it('oversize option uses 12-15 in, 2 in down', () => {
    expect(proposeWidth(front, 'L', 'adult', true)).toBe(13.5)
    expect(downFor(front, 'L', 'adult', true)).toBe(2)
  })

  it('collar offset: S-XL 3 in, 2XL and up 3.5 in', () => {
    expect(downFor(front, 'S', 'adult')).toBe(3)
    expect(downFor(front, 'XL', 'adult')).toBe(3)
    expect(downFor(front, '2XL', 'adult')).toBe(3.5)
    expect(downFor(front, '5XL', 'adult')).toBe(3.5)
    expect(downFor(getPlacement('youth-full-front'), 'M', 'youth')).toBe(2.25)
    expect(downFor(getPlacement('hat-front'), 'L', 'adult')).toBeNull()
  })

  it('height comes from the aspect ratio and hats cap at 3 in tall', () => {
    expect(sizeFromWidth(front, 11, 11 / 9.5).h).toBeCloseTo(9.5)
    const hat = sizeFromWidth(getPlacement('hat-front'), 5, 1)
    expect(hat.h).toBe(3)
    expect(hat.w).toBe(3)
    expect(hat.capped).toBe(true)
  })

  it('offers hoodie placements for hoodies and zip split for zip hoodies, never a zip full front', () => {
    const hoodie = placementsFor('hoodie', 'adult').map((p) => p.id)
    expect(hoodie).toContain('hoodie-full-front')
    expect(hoodie).not.toContain('adult-full-front')
    const zip = placementsFor('zip-hoodie', 'adult').map((p) => p.id)
    expect(zip).toContain('zip-hoodie-side')
    expect(zip).not.toContain('hoodie-full-front')
    expect(zip).not.toContain('adult-full-front')
  })
})

describe('effective DPI flag', () => {
  it('300 and up is green', () => {
    expect(dpiFlag(300).level).toBe('green')
    expect(dpiFlag(450).level).toBe('green')
  })
  it('200 to 299 is amber', () => {
    expect(dpiFlag(299.9).level).toBe('amber')
    expect(dpiFlag(200).level).toBe('amber')
    expect(dpiFlag(250).label).toBe('Acceptable')
  })
  it('150 to 199 is amber "Low" (gap in the brief)', () => {
    expect(dpiFlag(199).level).toBe('amber')
    expect(dpiFlag(150).label).toBe('Low')
  })
  it('under 150 is red', () => {
    expect(dpiFlag(149.9).level).toBe('red')
    expect(dpiFlag(50).level).toBe('red')
  })
  it('effective DPI is source pixels over print inches', () => {
    expect(effectiveDpi(600, 11)).toBeCloseTo(54.55, 1)
    expect(dpiFlag(effectiveDpi(600, 11)).level).toBe('red')
    expect(dpiFlag(effectiveDpi(3300, 11)).level).toBe('green')
  })
})
