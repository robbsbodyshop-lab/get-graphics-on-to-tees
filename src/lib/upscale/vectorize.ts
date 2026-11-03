import ImageTracer from 'imagetracerjs'
import type { RGBAImage } from '../types'

// "Vectorize instead" for logos and text with 8 or fewer colors: trace with imagetracerjs, then
// rasterize the paths at the final size with OffscreenCanvas (works inside the worker).

/** Colors that each cover at least 0.5% of the ink, quantized to 16 levels per channel. */
export function dominantColorCount(img: RGBAImage): number {
  const counts = new Map<number, number>()
  let ink = 0
  const d = img.data
  const step = Math.max(1, Math.floor(d.length / 4 / 400000)) * 4
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] < 128) continue
    ink++
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (ink === 0) return 0
  let n = 0
  for (const c of counts.values()) if (c / ink >= 0.005) n++
  return n
}

export function traceToSvg(img: RGBAImage, colors: number): string {
  return ImageTracer.imagedataToSVG(
    { width: img.width, height: img.height, data: img.data },
    {
      numberofcolors: Math.max(2, Math.min(16, colors + 1)),
      colorsampling: 2,
      colorquantcycles: 4,
      ltres: 0.5,
      qtres: 0.5,
      pathomit: 8,
      rightangleenhance: true,
      blurradius: 0,
      strokewidth: 0,
      linefilter: false,
      roundcoords: 2,
      viewbox: true,
      desc: false,
    },
  )
}

interface TracedPath {
  fill: string
  opacity: number
  d: string
}

export function parseTracedSvg(svg: string): { width: number; height: number; paths: TracedPath[] } {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  const width = vb ? parseFloat(vb[1]) : 1
  const height = vb ? parseFloat(vb[2]) : 1
  const paths: TracedPath[] = []
  const re = /<path\b([^>]*)\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    const attrs = m[1]
    const fill = /fill="([^"]+)"/.exec(attrs)?.[1] ?? 'rgb(0,0,0)'
    const opacity = parseFloat(/opacity="([^"]+)"/.exec(attrs)?.[1] ?? '1')
    const d = /d="([^"]+)"/.exec(attrs)?.[1]
    if (d) paths.push({ fill, opacity, d })
  }
  return { width, height, paths }
}

export async function vectorizeUpscale(src: RGBAImage, width: number, height: number, onProgress: (f: number) => void): Promise<RGBAImage> {
  const colors = Math.max(2, dominantColorCount(src))
  onProgress(0.1)
  const svg = traceToSvg(src, colors)
  onProgress(0.6)
  const { width: vw, height: vh, paths } = parseTracedSvg(svg)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available')
  ctx.scale(width / vw, height / vh)
  for (const p of paths) {
    if (p.opacity < 0.5) continue // transparent layer
    ctx.fillStyle = p.fill
    ctx.fill(new Path2D(p.d))
  }
  onProgress(1)
  const data = ctx.getImageData(0, 0, width, height).data
  return { width, height, data: new Uint8ClampedArray(data.buffer) }
}
