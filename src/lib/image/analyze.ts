import type { RGBAImage } from '../types'

export interface ImageAnalysis {
  width: number
  height: number
  aspect: number
  aspectLabel: string
  hasAlpha: boolean
  transparentCount: number
  semiTransparentCount: number
  opaqueCount: number
  distinctColors: number
}

/** "4:3" when a small-integer ratio matches within 1%, else "1.33:1". */
export function aspectLabelFor(aspect: number): string {
  if (!(aspect > 0) || !isFinite(aspect)) return '1:1'
  for (let q = 1; q <= 10; q++) {
    const p = Math.round(aspect * q)
    if (p < 1 || p > 10) continue
    if (Math.abs(p / q - aspect) / aspect <= 0.01) return `${p}:${q}`
  }
  return `${aspect.toFixed(2)}:1`
}

export function analyzeImage(img: RGBAImage): ImageAnalysis {
  const { width, height, data } = img
  let transparentCount = 0
  let semiTransparentCount = 0
  let opaqueCount = 0
  const seen = new Uint8Array(32768)
  let distinctColors = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) {
      transparentCount++
      continue
    }
    if (a === 255) opaqueCount++
    else semiTransparentCount++
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    if (seen[key] === 0) {
      seen[key] = 1
      distinctColors++
    }
  }
  const aspect = height > 0 ? width / height : 1
  return {
    width,
    height,
    aspect,
    aspectLabel: aspectLabelFor(aspect),
    hasAlpha: transparentCount + semiTransparentCount > 0,
    transparentCount,
    semiTransparentCount,
    opaqueCount,
    distinctColors,
  }
}
