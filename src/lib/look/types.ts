import type { ProcessSettings } from '../types'

// Contract between the prompt interpreter (interpret.ts, traits.ts) and the UI.
// Prompt-first workflow: upload -> describe the look -> the app applies settings and explains them.

/** What the uploaded image looks like, measured once after upload (on a <= 1200 px copy is fine). */
export interface ImageTraits {
  width: number
  height: number
  /** Any pixel with alpha < 255. */
  hasAlpha: boolean
  /** Share of all pixels with 0 < alpha < 255 (soft shadows, glows, feathered edges). */
  softAlphaFraction: number
  /** Distinct colors at 32 levels per channel, over pixels with alpha > 0. */
  distinctColors: number
  /** Colors covering >= 0.5% of the ink at 16 levels per channel (see dominantColorCount). */
  dominantColors: number
  /** Opaque image whose border is one solid color (>= 90% of edge pixels within Delta E 10 of it). */
  solidBackground: boolean
  /** That border color, or null. */
  backgroundHex: string | null
  /** Shares of the ink (alpha >= 128; for an opaque image with a solid background, excluding the background). */
  darkInkFraction: number // lightness < 0.2
  lightInkFraction: number // lightness > 0.85
  saturatedFraction: number // HSV saturation > 0.5 and value > 0.3
  /** flat: <= 8 dominant colors; photo: opaque, no solid background and > 3000 distinct colors; else illustration. */
  kind: 'flat' | 'illustration' | 'photo'
}

export interface LookGarment {
  colorName: string
  colorHex: string
  /** MockupGarmentType, e.g. 'tee', 'hoodie', 'zip-hoodie', 'hat', 'tote'. */
  type: string
  sizeClass: string
  /** Colors the selected garment comes in (name + approximate hex). */
  availableColors: { name: string; hex: string }[]
}

export interface LookContext {
  prompt: string
  traits: ImageTraits
  garment: LookGarment
  /** Placement ids valid for the selected garment. */
  availablePlacementIds: string[]
}

export type UpscaleChoice = 'ai' | 'lanczos' | 'vectorize'

export interface LookPlan {
  /** Preset used as the starting point, or null. */
  presetId: string | null
  /** Complete settings to apply (DEFAULT_SETTINGS + preset + prompt modifiers + image rules). */
  settings: ProcessSettings
  upscale: UpscaleChoice
  /** A name from garment.availableColors when the prompt names a shirt color, else undefined. */
  garmentColor?: string
  placementId?: string
  oversize?: boolean
  /** Print width in inches when the prompt gives one. */
  widthIn?: number
  /** Mockup finish override (from the preset or words like "washed", "mineral"). */
  mockupFinish?: 'washed' | 'mineral'
  /** "What I applied and why": one plain-English sentence per bullet. */
  explanation: string[]
  /** "Tips to tweak": concrete next moves, each naming the control and step to change. */
  tips: string[]
  /** Things the prompt asked for that DTF or this app can't do, or conflicts. */
  warnings: string[]
  /** Words and phrases from the prompt the interpreter recognised. */
  matched: string[]
}
