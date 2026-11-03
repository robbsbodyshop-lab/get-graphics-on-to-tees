import presetsData from '../data/presets.json'
import type { SettingsPatch } from './settings'

export interface Preset {
  id: string
  name: string
  inspiredBy: string
  description: string
  keywords: string[]
  settings: SettingsPatch
  placement?: string
  secondary?: { placement: string; widthIn: number }
  garmentColor?: string
  recommendColors?: string[]
  recommendGarments?: string[]
  mockupFinish?: 'washed' | 'mineral'
  upscale?: 'ai' | 'lanczos' | 'vectorize'
}

export const PRESETS = presetsData.presets as Preset[]
export const UNSUPPORTED_NOTE = presetsData.unsupportedNote

const UNSUPPORTED_WORDS = ['puff', 'glow', 'foil', 'flock', 'rhinestone', 'uv', 'color change', 'colour change', 'metallic', 'reflective']

export function getPreset(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/**
 * Keyword match only (no AI). Each keyword found as a whole word/phrase scores 1, multi-word
 * phrases score 2. Returns the best preset, or null when nothing matches.
 */
export function suggestPreset(text: string): { preset: Preset; score: number; matched: string[] } | null {
  const t = normalise(text)
  if (t.trim() === '') return null
  let best: { preset: Preset; score: number; matched: string[] } | null = null
  for (const preset of PRESETS) {
    const matched = preset.keywords.filter((k) => t.includes(normalise(k)))
    const score = matched.reduce((s, k) => s + (k.includes(' ') ? 2 : 1), 0)
    if (score > 0 && (!best || score > best.score)) best = { preset, score, matched }
  }
  return best
}

/** True when the text asks for an effect DTF can't do (puff, glow, foil, flock, rhinestone, UV). */
export function mentionsUnsupported(text: string): boolean {
  const t = normalise(text)
  return UNSUPPORTED_WORDS.some((w) => t.includes(normalise(w)))
}
