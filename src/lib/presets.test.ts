import { describe, expect, it } from 'vitest'
import { PRESETS, mentionsUnsupported, suggestPreset } from './presets'
import { DEFAULT_SETTINGS, mergeSettings } from './settings'
import { PLACEMENTS } from './sizing'

describe('presets', () => {
  it('ships the 15 presets from the brief', () => {
    expect(PRESETS).toHaveLength(15)
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(15)
  })

  it('every preset merges into valid settings and names real placements', () => {
    const placementIds = new Set(PLACEMENTS.map((p) => p.id))
    for (const p of PRESETS) {
      const s = mergeSettings(DEFAULT_SETTINGS, p.settings)
      expect(s.tolerance).toBeGreaterThanOrEqual(2)
      expect(s.tolerance).toBeLessThanOrEqual(25)
      expect(s.halftone.lpi).toBeGreaterThanOrEqual(45)
      expect(s.halftone.lpi).toBeLessThanOrEqual(65)
      if (p.placement) expect(placementIds.has(p.placement)).toBe(true)
      if (p.secondary) expect(placementIds.has(p.secondary.placement)).toBe(true)
    }
  })

  it('merge keeps unspecified nested fields', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { halftone: { enabled: true, lpi: 50 } })
    expect(s.halftone.enabled).toBe(true)
    expect(s.halftone.lpi).toBe(50)
    expect(s.halftone.angle).toBe(DEFAULT_SETTINGS.halftone.angle)
    expect(DEFAULT_SETTINGS.halftone.enabled).toBe(false) // base not mutated
  })

  it('suggests a preset from free text', () => {
    expect(suggestPreset('creepy skull for a black metal band')?.preset.id).toBe('horror-metal')
    expect(suggestPreset('faded 90s tour tee')?.preset.id).toBe('vintage-tour')
    expect(suggestPreset('preppy golf club crest')?.preset.id).toBe('collegiate')
    expect(suggestPreset('')).toBeNull()
    expect(suggestPreset('zzz qqq')).toBeNull()
  })

  it('flags effects DTF cannot do', () => {
    expect(mentionsUnsupported('puff print logo')).toBe(true)
    expect(mentionsUnsupported('glow in the dark skull')).toBe(true)
    expect(mentionsUnsupported('clean skate logo')).toBe(false)
  })
})
