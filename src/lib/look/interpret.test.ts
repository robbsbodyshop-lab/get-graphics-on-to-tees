import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_NOTE } from '../presets'
import { DEFAULT_SETTINGS } from '../settings'
import { interpretLook } from './interpret'
import type { ImageTraits, LookContext, LookGarment } from './types'

const PLACEMENTS = ['adult-full-front', 'center-chest', 'left-chest', 'full-back', 'upper-back', 'back-neck', 'short-sleeve']

const COLORS = [
  { name: 'Black', hex: '#141414' },
  { name: 'White', hex: '#f7f7f5' },
  { name: 'Sport Grey', hex: '#9c9d9f' },
  { name: 'Navy', hex: '#1f2a44' },
  { name: 'Natural', hex: '#e6dcc6' },
]

function garment(name = 'Black', over: Partial<LookGarment> = {}): LookGarment {
  const c = COLORS.find((x) => x.name === name) ?? COLORS[0]
  return { colorName: c.name, colorHex: c.hex, type: 'tee', sizeClass: 'adult', availableColors: COLORS, ...over }
}

const LOGO_ON_WHITE: ImageTraits = {
  width: 1800,
  height: 1800,
  hasAlpha: false,
  softAlphaFraction: 0,
  distinctColors: 120,
  dominantColors: 3,
  solidBackground: true,
  backgroundHex: '#ffffff',
  darkInkFraction: 0.1,
  lightInkFraction: 0,
  saturatedFraction: 0.3,
  kind: 'flat',
}

const DARK_ART: ImageTraits = {
  ...LOGO_ON_WHITE,
  hasAlpha: true,
  solidBackground: false,
  backgroundHex: null,
  darkInkFraction: 0.7,
  lightInkFraction: 0.15,
  saturatedFraction: 0,
  dominantColors: 4,
  kind: 'flat',
}

const SOFT_ART: ImageTraits = {
  ...DARK_ART,
  softAlphaFraction: 0.08,
  distinctColors: 900,
  dominantColors: 14,
  darkInkFraction: 0.3,
  kind: 'illustration',
}

const PHOTO: ImageTraits = {
  width: 3000,
  height: 2000,
  hasAlpha: false,
  softAlphaFraction: 0,
  distinctColors: 9000,
  dominantColors: 60,
  solidBackground: false,
  backgroundHex: null,
  darkInkFraction: 0.2,
  lightInkFraction: 0.1,
  saturatedFraction: 0.4,
  kind: 'photo',
}

function ctx(prompt: string, traits: ImageTraits = LOGO_ON_WHITE, g: LookGarment = garment(), ids = PLACEMENTS): LookContext {
  return { prompt, traits, garment: g, availablePlacementIds: ids }
}

const text = (xs: string[]) => xs.join('\n').toLowerCase()

describe('interpretLook', () => {
  it('empty prompt, logo on white, black tee: removes the background and explains why', () => {
    const plan = interpretLook(ctx(''))
    expect(plan.presetId).toBeNull()
    expect(plan.settings.removeBackground).toBe(true)
    expect(text(plan.explanation)).toContain('background')
    expect(text(plan.explanation)).toContain('white background')
    expect(plan.explanation.length).toBeGreaterThanOrEqual(3)
    expect(plan.garmentColor).toBeUndefined()
    // Everything else is the defaults.
    expect(plan.settings.distress.enabled).toBe(false)
    expect(plan.settings.mirror).toBe(false)
  })

  it('horror prompt on dark art and a black tee uses horror-metal and knocks out the garment color', () => {
    const plan = interpretLook(ctx('horror skull art, let the black become the shirt', DARK_ART))
    expect(plan.presetId).toBe('horror-metal')
    expect(plan.settings.knockoutGarment).toBe(true)
    expect(plan.garmentColor).toBeUndefined() // "the black" is the art, not a shirt-color request
    expect(text(plan.explanation)).toContain('knock out garment color')
    expect(plan.matched.join(' ')).toContain('skull')
  })

  it('the same prompt naming a heather gray shirt maps to Sport Grey and turns the knockout off', () => {
    const plan = interpretLook(ctx('horror skull art on a heather gray shirt, let the black become the shirt', DARK_ART))
    expect(plan.garmentColor).toBe('Sport Grey')
    expect(plan.settings.knockoutGarment).toBe(false)
    const why = plan.explanation.find((e) => e.includes('mid-tone'))
    expect(why).toBeDefined()
    expect(why).toContain('delete real ink')
  })

  it('"white tee" and "on a black shirt" set the shirt color; "the black" alone does not', () => {
    expect(interpretLook(ctx('clean logo on a white tee', DARK_ART)).garmentColor).toBe('White')
    expect(interpretLook(ctx('skull on a navy shirt', DARK_ART, garment('Black'))).garmentColor).toBe('Navy')
    expect(interpretLook(ctx('black and white photo look', PHOTO, garment('Navy'))).garmentColor).toBeUndefined()
  })

  it('tells the user to pick a shirt color the garment does not offer', () => {
    const plan = interpretLook(ctx('white logo on a pink shirt', DARK_ART))
    expect(plan.garmentColor).toBeUndefined()
    expect(plan.tips.some((t) => t.includes('pink') && t.includes('step 3'))).toBe(true)
  })

  it('tells the user to choose a different garment type when the prompt names one', () => {
    const plan = interpretLook(ctx('big back print on a black hoodie', DARK_ART))
    expect(plan.tips.some((t) => t.includes('hoodie') && t.includes('step 3'))).toBe(true)
    const same = interpretLook(ctx('black hoodie', DARK_ART, garment('Black', { type: 'hoodie' })))
    expect(same.tips.some((t) => t.includes('You described a hoodie'))).toBe(false)
  })

  it('vintage tour tee on soft-alpha art: alpha halftone (never Tones) and light cracked distress', () => {
    const plan = interpretLook(ctx('vintage tour tee, lightly cracked', SOFT_ART))
    expect(plan.presetId).toBe('vintage-tour')
    expect(plan.settings.halftone.enabled).toBe(true)
    expect(plan.settings.halftone.mode).toBe('alpha')
    expect(plan.settings.distress).toEqual({ enabled: true, mask: 'cracked', intensity: 0.15 })
    expect(text(plan.explanation)).toContain('already has transparency')
    expect(plan.mockupFinish).toBe('washed')
  })

  it('luminance halftone is kept for an opaque photo and uses auto ink', () => {
    const plan = interpretLook(ctx('photo as halftone dots fading out at the bottom', PHOTO))
    expect(plan.presetId).toBe('halftone-photo')
    expect(plan.settings.halftone.mode).toBe('luminance')
    expect(plan.settings.halftone.ink).toBe('auto')
    expect(plan.settings.fadeEdge).toMatchObject({ enabled: true, edge: 'bottom' })
  })

  it('"2 color screen print look, left chest" on a flat logo: posterize 2 and left-chest', () => {
    const small = { ...LOGO_ON_WHITE, width: 600, height: 600 }
    const plan = interpretLook(ctx('2 color screen print look, left chest', small))
    expect(plan.settings.posterize).toEqual({ enabled: true, colors: 2 })
    expect(plan.placementId).toBe('left-chest')
    expect(plan.upscale).toBe('ai') // no "clean/logo/vector" word
    expect(plan.tips.some((t) => t.includes('Vectorize'))).toBe(true)
  })

  it('"clean" or "logo" lets a small flat logo choose Vectorize', () => {
    const small = { ...LOGO_ON_WHITE, width: 500, height: 500 }
    expect(interpretLook(ctx('crisp vector logo', small)).upscale).toBe('vectorize')
    expect(interpretLook(ctx('crisp vector logo', PHOTO)).upscale).toBe('ai')
  })

  it('turns Posterize off for a photo when the preset posterizes and the prompt did not ask for flat colors', () => {
    const plan = interpretLook(ctx('cartoon sticker', PHOTO))
    expect(plan.presetId).toBe('skate-flat')
    expect(plan.settings.posterize.enabled).toBe(false)
    expect(text(plan.explanation)).toContain('turned posterize off')
    // Asking for flat colors keeps it.
    const flat = interpretLook(ctx('cartoon sticker, 4 colors', PHOTO))
    expect(flat.settings.posterize).toEqual({ enabled: true, colors: 4 })
  })

  it('does not run the background flood fill on a photo with no solid border', () => {
    const plan = interpretLook(ctx('cartoon sticker', PHOTO))
    expect(plan.settings.removeBackground).toBe(false)
    expect(text(plan.explanation)).toContain('no solid-color border')
  })

  it('"fade the bottom into the shirt" turns on fadeEdge bottom', () => {
    const plan = interpretLook(ctx('fade the bottom into the shirt', DARK_ART))
    expect(plan.settings.fadeEdge).toEqual({ enabled: true, edge: 'bottom', fraction: 0.35 })
    const top = interpretLook(ctx('a short fade at the top', DARK_ART))
    expect(top.settings.fadeEdge).toEqual({ enabled: true, edge: 'top', fraction: 0.2 })
  })

  it('"faded" colors do not turn on the fade edge, they mute the colors', () => {
    const plan = interpretLook(ctx('faded colors', SOFT_ART))
    expect(plan.settings.fadeEdge.enabled).toBe(false)
    expect(plan.settings.desaturate).toBe(0.25)
  })

  it('warns about effects DTF cannot print', () => {
    const plan = interpretLook(ctx('puff print skull', DARK_ART))
    expect(plan.warnings).toContain(UNSUPPORTED_NOTE)
  })

  it('never turns Mirror on and warns when asked', () => {
    const plan = interpretLook(ctx('mirror it', DARK_ART))
    expect(plan.settings.mirror).toBe(false)
    expect(plan.warnings.some((w) => w.includes('Mirror'))).toBe(true)
  })

  it('"12 inch wide oversized front" sets widthIn 12 and Oversize on adult-full-front', () => {
    const plan = interpretLook(ctx('12 inch wide oversized front', DARK_ART))
    expect(plan.widthIn).toBe(12)
    expect(plan.placementId).toBe('adult-full-front')
    expect(plan.oversize).toBe(true)
  })

  it('reads sizes in several spellings and ignores nonsense', () => {
    expect(interpretLook(ctx('make it 11in', DARK_ART)).widthIn).toBe(11)
    expect(interpretLook(ctx('about 9" wide', DARK_ART)).widthIn).toBe(9)
    expect(interpretLook(ctx('3.5 inches', DARK_ART)).widthIn).toBe(3.5)
    const big = interpretLook(ctx('40 inches', DARK_ART))
    expect(big.widthIn).toBeUndefined()
    expect(big.warnings.length).toBe(1)
  })

  it('placement words map to available ids only', () => {
    expect(interpretLook(ctx('pocket logo', DARK_ART)).placementId).toBe('left-chest')
    expect(interpretLook(ctx('big back print', DARK_ART)).placementId).toBe('full-back')
    expect(interpretLook(ctx('small front big back', DARK_ART)).presetId).toBe('small-front-big-back')
    expect(interpretLook(ctx('small front big back', DARK_ART)).placementId).toBe('full-back')
    expect(interpretLook(ctx('on the sleeve', DARK_ART)).placementId).toBe('short-sleeve')
    expect(interpretLook(ctx('back neck tag', DARK_ART)).placementId).toBe('back-neck')
    const hood = interpretLook(ctx('left chest', DARK_ART, garment('Black', { type: 'hoodie' }), ['center-chest', 'hoodie-left-chest', 'full-back']))
    expect(hood.placementId).toBe('hoodie-left-chest')
    const none = interpretLook(ctx('left chest', DARK_ART, garment(), ['adult-full-front']))
    expect(none.placementId).toBeUndefined()
    expect(none.tips.some((t) => t.includes('Placement in step 4'))).toBe(true)
  })

  it('knockout is off on a mid-tone shirt even when the preset enables it', () => {
    const plan = interpretLook(ctx('skate flat logo', DARK_ART, garment('Sport Grey')))
    expect(plan.presetId).toBe('skate-flat')
    expect(plan.settings.knockoutGarment).toBe(false)
  })

  it('knockout turns on for white ink on a light shirt', () => {
    const lightInk = { ...DARK_ART, darkInkFraction: 0.1, lightInkFraction: 0.6 }
    const plan = interpretLook(ctx('', lightInk, garment('White')))
    expect(plan.settings.knockoutGarment).toBe(true)
    expect(text(plan.explanation)).toContain('white')
  })

  it('keeps Halftone off and explains the hard edges when the prompt says no dots', () => {
    const plan = interpretLook(ctx('no halftone, clean edges', SOFT_ART))
    expect(plan.settings.halftone.enabled).toBe(false)
    expect(text(plan.explanation)).toContain('alpha threshold')
  })

  it('turns soft alpha into dots with no prompt at all', () => {
    const plan = interpretLook(ctx('', SOFT_ART))
    expect(plan.settings.halftone).toMatchObject({ enabled: true, mode: 'alpha' })
    expect(text(plan.explanation)).toContain('semi-transparent')
  })

  it('color words: one color, black and white, keep colors, bold, soft', () => {
    expect(interpretLook(ctx('one color stamp', DARK_ART)).settings.lineArt).toMatchObject({ enabled: true, ink: 'auto' })
    expect(interpretLook(ctx('black and white', PHOTO)).settings.desaturate).toBe(1)
    expect(interpretLook(ctx('bold punchy', PHOTO)).settings.contrast).toBe(0.3)
    expect(interpretLook(ctx('soft low contrast', PHOTO)).settings.contrast).toBe(-0.15)
    const keep = interpretLook(ctx('skate sticker, keep the red', DARK_ART))
    expect(keep.settings.posterize.enabled).toBe(false)
    expect(interpretLook(ctx('three colors', DARK_ART)).settings.posterize).toEqual({ enabled: true, colors: 3 })
  })

  it('outline words', () => {
    expect(interpretLook(ctx('thick white keyline', DARK_ART)).settings.outline).toEqual({ enabled: true, px: 8, color: '#ffffff' })
    expect(interpretLook(ctx('sticker border', DARK_ART)).settings.outline).toEqual({ enabled: true, px: 4, color: '#000000' })
  })

  it('distress words: mask, intensity and the clean override', () => {
    expect(interpretLook(ctx('super scratched', DARK_ART)).settings.distress).toEqual({ enabled: true, mask: 'scratched', intensity: 0.5 })
    expect(interpretLook(ctx('a touch of spray speckle', DARK_ART)).settings.distress).toEqual({ enabled: true, mask: 'speckle', intensity: 0.15 })
    expect(interpretLook(ctx('worn', DARK_ART)).settings.distress).toMatchObject({ enabled: true, mask: 'sandblasted' })
    expect(interpretLook(ctx('vintage but no distress', DARK_ART)).settings.distress.enabled).toBe(false)
  })

  it('conflicting phrases: the later one wins and a warning names the conflict', () => {
    const plan = interpretLook(ctx('clean and distressed', DARK_ART))
    expect(plan.settings.distress.enabled).toBe(true)
    expect(plan.warnings.some((w) => w.includes('"clean"') && w.includes('"distressed"'))).toBe(true)
    const colors = interpretLook(ctx('full color, 2 colors', PHOTO))
    expect(colors.settings.posterize).toEqual({ enabled: true, colors: 2 })
    expect(colors.warnings.length).toBeGreaterThan(0)
  })

  it('mineral and washed finishes', () => {
    expect(interpretLook(ctx('mineral wash look', DARK_ART)).mockupFinish).toBe('mineral')
    expect(interpretLook(ctx('acid wash', DARK_ART)).mockupFinish).toBe('washed')
  })

  it('always returns complete settings and 4-8 tips, 3-8 explanations; every tip names a step or control', () => {
    const prompts = [
      '',
      'faded vintage tour tee on a black shirt, a little cracked',
      'clean 2-color logo for the left chest',
      'horror art where the black becomes the shirt',
      'photo as halftone dots fading out at the bottom',
      'sticker with a white keyline, bold, 11 inches, speckle',
    ]
    const controls = /step \d|Distress|Halftone|LPI|Posterize|Tolerance|Knock out|Fade|Color work|Alpha threshold|Placement|Print width/
    for (const p of prompts) {
      for (const tr of [LOGO_ON_WHITE, DARK_ART, SOFT_ART, PHOTO]) {
        const plan = interpretLook(ctx(p, tr))
        expect(Object.keys(plan.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
        expect(plan.tips.length).toBeGreaterThanOrEqual(4)
        expect(plan.tips.length).toBeLessThanOrEqual(8)
        expect(plan.explanation.length).toBeGreaterThanOrEqual(3)
        expect(plan.explanation.length).toBeLessThanOrEqual(8)
        for (const tip of plan.tips) expect(tip).toMatch(controls)
        for (const line of [...plan.explanation, ...plan.tips, ...plan.warnings]) {
          expect(line).not.toMatch(/[*#`]|\[\w+\]\(/) // plain text only
        }
      }
    }
  })

  it('tips quote the current values and never contradict the settings', () => {
    const plan = interpretLook(ctx('vintage tour tee, lightly cracked', SOFT_ART))
    expect(plan.tips.some((t) => t.includes('Distress intensity') && t.includes('15%'))).toBe(true)
    expect(plan.tips.some((t) => t.includes('LPI') && t.includes(String(plan.settings.halftone.lpi)))).toBe(true)
    const none = interpretLook(ctx('clean', LOGO_ON_WHITE))
    expect(none.tips.some((t) => t.includes('Distress intensity'))).toBe(false)
  })

  it('is deterministic', () => {
    for (const p of ['', 'faded vintage tour tee on a black shirt, a little cracked', 'photo as halftone dots fading out at the bottom']) {
      expect(interpretLook(ctx(p, SOFT_ART))).toEqual(interpretLook(ctx(p, SOFT_ART)))
    }
  })

  it('does not mutate DEFAULT_SETTINGS', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS)
    interpretLook(ctx('horror skull, heavily cracked, 2 colors, fade the bottom', DARK_ART))
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before)
  })
})
