// Shared contracts for DTF Prep. Every image operation works on RGBAImage so it runs the
// same in the browser (ImageData satisfies this shape), in Web Workers and in Vitest (Node).

/** Straight (non-premultiplied) 8-bit RGBA, row-major, 4 bytes per pixel. */
export interface RGBAImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface RGB {
  r: number
  g: number
  b: number
}

/** CIE L*a*b* (D65). */
export interface Lab {
  L: number
  a: number
  b: number
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export type MaskKind = 'scratched' | 'cracked' | 'speckle' | 'sandblasted'
export type Edge = 'top' | 'bottom' | 'left' | 'right'
export type GarmentFinish = 'solid' | 'heather' | 'washed' | 'mineral' | 'garment-dyed' | 'pigment'

/**
 * Every processing toggle. Presets supply a Partial<ProcessSettings>; the UI merges it over
 * DEFAULT_SETTINGS (src/lib/settings.ts). Processing order is fixed (see pipeline.ts):
 * upscale -> color work -> knockout -> distress -> halftone -> alpha threshold -> speck removal
 * -> choke / thicken -> trim -> mirror -> export.
 */
export interface ProcessSettings {
  // ---- color work ----
  /** Reduce to N flat colors (k-means in Lab over opaque pixels). */
  posterize: { enabled: boolean; colors: number }
  /** 0 = unchanged, 1 = fully grey. */
  desaturate: number
  /** -1..1, 0 = unchanged. */
  contrast: number
  /** Snap near-black (all channels <= 8) to 0,0,0 and near-white (>= 247) to 255,255,255. */
  snapBlackWhite: boolean
  /** Keyline around the art. color: hex string, or 'garment' to use the garment color. */
  outline: { enabled: boolean; px: number; color: string }

  // ---- knockout ----
  /** Remove pixels within `tolerance` Delta E of the garment color. */
  knockoutGarment: boolean
  /** Extra eyedropper picks (hex), each removed within `tolerance`. Stack order = pick order. */
  knockoutPicks: string[]
  /** Delta E (CIE76, Lab) tolerance, 2..25, default 8. */
  tolerance: number
  /** Flood fill from canvas edges (white / solid backgrounds). */
  removeBackground: boolean

  // ---- texture ----
  distress: { enabled: boolean; mask: MaskKind; intensity: number }
  /**
   * mode 'alpha': turn soft alpha (shadows, glows, feathering) into dots.
   * mode 'luminance': turn tones with luminance in [lumLo, lumHi] into dots;
   *   ink 'original' keeps each pixel's color, otherwise ink is a hex color.
   *   darkInk true: darker pixels get more coverage (dark ink on light garment).
   */
  halftone: {
    enabled: boolean
    mode: 'alpha' | 'luminance'
    lpi: number
    angle: number
    lumLo: number
    lumHi: number
    ink: string
    darkInk: boolean
  }
  /** Fade one edge into the garment through a halftone alpha gradient (never soft alpha). */
  fadeEdge: { enabled: boolean; edge: Edge; fraction: number }

  // ---- finishing ----
  /** 0..1, default 0.5. Every pixel ends as alpha 0 or 255. */
  alphaThreshold: number
  /** Delete opaque islands smaller than this many inches (converted to px at 300 DPI, as a diameter-equivalent area). */
  speckMinIn: number
  choke: boolean
  thicken: boolean
  mirror: boolean
}
