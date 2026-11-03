import type { RGBAImage } from './types'
import { readPngInfo } from './png'

export type SourceFormat = 'png' | 'jpg' | 'webp' | 'svg'

export interface DecodedFile {
  image: RGBAImage
  name: string
  format: SourceFormat
  pngDpi: number | null
  note: string | null
}

function formatOf(file: File): SourceFormat {
  const t = file.type.toLowerCase()
  const n = file.name.toLowerCase()
  if (t === 'image/svg+xml' || n.endsWith('.svg')) return 'svg'
  if (t === 'image/png' || n.endsWith('.png')) return 'png'
  if (t === 'image/jpeg' || n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg'
  if (t === 'image/webp' || n.endsWith('.webp')) return 'webp'
  throw new Error('Unsupported file type. Use PNG, JPG, WEBP or SVG.')
}

function readPixels(source: CanvasImageSource, w: number, h: number): RGBAImage {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.drawImage(source, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  return { width: w, height: h, data: d.data }
}

async function loadSvg(file: File): Promise<{ image: RGBAImage; note: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => {
      throw new Error('This SVG could not be read.')
    })
    const iw = img.naturalWidth || 1000
    const ih = img.naturalHeight || 1000
    const long = Math.max(iw, ih)
    const target = Math.max(long, 4000)
    const w = Math.max(1, Math.round((iw * target) / long))
    const h = Math.max(1, Math.round((ih * target) / long))
    const image = readPixels(img, w, h)
    return { image, note: `SVG rasterized at ${w}×${h} px` }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode an uploaded file to straight RGBA pixels (no color conversion, no premultiplication). */
export async function decodeFile(file: File): Promise<DecodedFile> {
  const format = formatOf(file)
  if (format === 'svg') {
    const { image, note } = await loadSvg(file)
    return { image, name: file.name, format, pngDpi: null, note }
  }
  let pngDpi: number | null = null
  if (format === 'png') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    pngDpi = readPngInfo(bytes)?.dpiX ?? null
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  } catch {
    throw new Error('This image could not be read. Is the file damaged?')
  }
  try {
    const image = readPixels(bitmap, bitmap.width, bitmap.height)
    return { image, name: file.name, format, pngDpi, note: null }
  } finally {
    bitmap.close()
  }
}
