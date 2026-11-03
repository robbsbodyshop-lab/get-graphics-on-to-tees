import type { ProcessSettings } from './types'

export const DEFAULT_SETTINGS: ProcessSettings = {
  posterize: { enabled: false, colors: 6 },
  desaturate: 0,
  contrast: 0,
  snapBlackWhite: true,
  outline: { enabled: false, px: 3, color: '#000000' },
  lineArt: { enabled: false, threshold: 0.5, ink: 'original' },

  knockoutGarment: false,
  knockoutPicks: [],
  tolerance: 8,
  removeBackground: false,

  distress: { enabled: false, mask: 'cracked', intensity: 0.3 },
  halftone: { enabled: false, mode: 'alpha', lpi: 55, angle: 22.5, lumLo: 0, lumHi: 1, ink: 'original', darkInk: true },
  fadeEdge: { enabled: false, edge: 'bottom', fraction: 0.3 },

  alphaThreshold: 0.5,
  speckMinIn: 0.03,
  choke: false,
  thicken: false,
  mirror: false,
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }
export type SettingsPatch = DeepPartial<ProcessSettings>

/** Merge a (nested) partial over settings. Arrays are replaced, objects merged one level deep. */
export function mergeSettings(base: ProcessSettings, patch: SettingsPatch | undefined): ProcessSettings {
  if (!patch) return structuredClone(base)
  const out = structuredClone(base) as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = { ...(cur as object), ...(v as object) }
    } else {
      out[k] = Array.isArray(v) ? [...v] : v
    }
  }
  return out as unknown as ProcessSettings
}

/** Physical constants for the pipeline. */
export const OUTPUT_DPI = 300
export const TRIM_MARGIN_IN = 0.1
export const MIN_STROKE_IN = 0.04
export const MIN_GAP_IN = 0.04
export const MIN_TEXT_IN = 0.15
export const SOLID_WARN = 0.7
/** One distress tile spans this many inches of fabric. */
export const DISTRESS_TILE_IN = 3
