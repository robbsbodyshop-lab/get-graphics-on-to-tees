import type { RGBAImage } from '../types'

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

/** Fill a rectangle (clipped to the image) with one RGBA color. Handy in tests. */
export function fillRect(
  img: RGBAImage,
  x: number,
  y: number,
  w: number,
  h: number,
  rgba: [number, number, number, number],
): void {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(img.width, x + w)
  const y1 = Math.min(img.height, y + h)
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4
      img.data[i] = rgba[0]
      img.data[i + 1] = rgba[1]
      img.data[i + 2] = rgba[2]
      img.data[i + 3] = rgba[3]
    }
  }
}

/** Count pixels with 0 < alpha < 255. */
export function countSemiTransparent(img: RGBAImage): number {
  let n = 0
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i] < 255) n++
  return n
}

export function countOpaque(img: RGBAImage): number {
  let n = 0
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++
  return n
}

/** New image with `px` transparent pixels added on every side. */
export function padImage(img: RGBAImage, px: number): RGBAImage {
  const out = createImage(img.width + 2 * px, img.height + 2 * px)
  for (let y = 0; y < img.height; y++) {
    const src = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4)
    out.data.set(src, ((y + px) * out.width + px) * 4)
  }
  return out
}

/** Inches -> pixels at a DPI, rounded. */
export const inToPx = (inches: number, dpi = 300): number => Math.round(inches * dpi)
