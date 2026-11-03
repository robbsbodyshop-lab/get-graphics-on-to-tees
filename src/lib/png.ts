import type { RGBAImage } from './types'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null
function table(): Uint32Array {
  if (crcTable) return crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  crcTable = t
  return t
}

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = table()
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}
function put32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 255
  b[o + 1] = (v >>> 16) & 255
  b[o + 2] = (v >>> 8) & 255
  b[o + 3] = v & 255
}

async function pipe(data: Uint8Array, stream: { writable: WritableStream; readable: ReadableStream }) {
  const src = new Blob([data as unknown as BlobPart]).stream()
  const out = src.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  put32(out, 0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  put32(out, 8 + body.length, crc32(out, 4, 8 + body.length))
  return out
}

export interface EncodePngOptions {
  dpi?: number
  /** Force one filter type (0..4) for every row; default 'adaptive' (min sum of absolute values). */
  filter?: 'adaptive' | 0 | 1 | 2 | 3 | 4
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Filter all rows of an RGBA image into a raw PNG scanline stream. */
function filterRows(img: RGBAImage, mode: 'adaptive' | 0 | 1 | 2 | 3 | 4): Uint8Array {
  const { width, height } = img
  const stride = width * 4
  const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  const out = new Uint8Array(height * (stride + 1))
  const zero = new Uint8Array(stride)
  const cand: Uint8Array[] = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride))
  for (let y = 0; y < height; y++) {
    const cur = src.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? src.subarray((y - 1) * stride, y * stride) : zero
    const o = y * (stride + 1)
    if (mode === 0) {
      out[o] = 0
      out.set(cur, o + 1)
      continue
    }
    if (mode !== 'adaptive') {
      const dst = out.subarray(o + 1, o + 1 + stride)
      out[o] = mode
      fillFilter(mode, cur, prev, dst, stride)
      continue
    }
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0
    const c1 = cand[1], c2 = cand[2], c3 = cand[3], c4 = cand[4]
    for (let i = 0; i < stride; i++) {
      const x = cur[i]
      const a = i >= 4 ? cur[i - 4] : 0
      const b = prev[i]
      const c = i >= 4 ? prev[i - 4] : 0
      const v1 = (x - a) & 255
      const v2 = (x - b) & 255
      const v3 = (x - ((a + b) >> 1)) & 255
      const v4 = (x - paeth(a, b, c)) & 255
      c1[i] = v1; c2[i] = v2; c3[i] = v3; c4[i] = v4
      s0 += x < 128 ? x : 256 - x
      s1 += v1 < 128 ? v1 : 256 - v1
      s2 += v2 < 128 ? v2 : 256 - v2
      s3 += v3 < 128 ? v3 : 256 - v3
      s4 += v4 < 128 ? v4 : 256 - v4
    }
    let best = 0, bs = s0
    if (s1 < bs) { best = 1; bs = s1 }
    if (s2 < bs) { best = 2; bs = s2 }
    if (s3 < bs) { best = 3; bs = s3 }
    if (s4 < bs) { best = 4; bs = s4 }
    out[o] = best
    out.set(best === 0 ? cur : cand[best], o + 1)
  }
  return out
}

function fillFilter(type: number, cur: Uint8Array, prev: Uint8Array, dst: Uint8Array, stride: number): void {
  for (let i = 0; i < stride; i++) {
    const x = cur[i]
    const a = i >= 4 ? cur[i - 4] : 0
    const b = prev[i]
    const c = i >= 4 ? prev[i - 4] : 0
    dst[i] =
      type === 1 ? x - a : type === 2 ? x - b : type === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)
  }
}

export async function encodePng(img: RGBAImage, opts: EncodePngOptions = {}): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300
  const { width, height } = img
  const raw = filterRows(img, opts.filter ?? 'adaptive')
  const z = await pipe(raw, new CompressionStream('deflate'))

  const ihdr = new Uint8Array(13)
  put32(ihdr, 0, width)
  put32(ihdr, 4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const phys = new Uint8Array(9)
  const ppm = Math.round(dpi / 0.0254)
  put32(phys, 0, ppm)
  put32(phys, 4, ppm)
  phys[8] = 1
  const gama = new Uint8Array(4)
  put32(gama, 0, 45455)

  const parts: Uint8Array[] = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('sRGB', new Uint8Array([0])),
    chunk('gAMA', gama),
    chunk('pHYs', phys),
  ]
  const IDAT = 1 << 20
  for (let o = 0; o < z.length; o += IDAT) parts.push(chunk('IDAT', z.subarray(o, Math.min(z.length, o + IDAT))))
  parts.push(chunk('IEND', new Uint8Array(0)))
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function isPng(b: Uint8Array): boolean {
  if (b.length < 8) return false
  for (let i = 0; i < 8; i++) if (b[i] !== SIGNATURE[i]) return false
  return true
}

export interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  dpiX: number | null
  dpiY: number | null
  hasSRGB: boolean
}

export function readPngInfo(bytes: Uint8Array): PngInfo | null {
  if (!isPng(bytes) || bytes.length < 33) return null
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  let dpiX: number | null = null
  let dpiY: number | null = null
  let hasSRGB = false
  let seenHeader = false
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = u32(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const d = pos + 8
    if (d + len > bytes.length) break
    if (type === 'IHDR') {
      width = u32(bytes, d)
      height = u32(bytes, d + 4)
      bitDepth = bytes[d + 8]
      colorType = bytes[d + 9]
      seenHeader = true
    } else if (type === 'pHYs' && len >= 9) {
      if (bytes[d + 8] === 1) {
        dpiX = Math.round(u32(bytes, d) * 0.0254 * 10) / 10
        dpiY = Math.round(u32(bytes, d + 4) * 0.0254 * 10) / 10
      }
    } else if (type === 'sRGB') hasSRGB = true
    else if (type === 'IDAT' || type === 'IEND') {
      if (type === 'IEND') break
    }
    pos = d + len + 4
  }
  if (!seenHeader) return null
  return { width, height, bitDepth, colorType, dpiX, dpiY, hasSRGB }
}

export async function decodePng(bytes: Uint8Array): Promise<RGBAImage> {
  if (!isPng(bytes)) throw new Error('Not a PNG file')
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idats: Uint8Array[] = []
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = u32(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const d = pos + 8
    if (d + len > bytes.length) throw new Error('Truncated PNG')
    if (type === 'IHDR') {
      width = u32(bytes, d)
      height = u32(bytes, d + 4)
      bitDepth = bytes[d + 8]
      colorType = bytes[d + 9]
      interlace = bytes[d + 12]
    } else if (type === 'PLTE') palette = bytes.subarray(d, d + len)
    else if (type === 'tRNS') trns = bytes.subarray(d, d + len)
    else if (type === 'IDAT') idats.push(bytes.subarray(d, d + len))
    else if (type === 'IEND') break
    pos = d + len + 4
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`)
  if (interlace !== 0) throw new Error('Interlaced PNG not supported')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`)
  let zl = 0
  for (const c of idats) zl += c.length
  const zdata = new Uint8Array(zl)
  let zo = 0
  for (const c of idats) {
    zdata.set(c, zo)
    zo += c.length
  }
  const raw = await pipe(zdata, new DecompressionStream('deflate'))
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new Error('PNG data too short')

  // Unfilter in place, row by row, into a packed buffer.
  const px = new Uint8Array(height * stride)
  const bpp = channels
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]
    const s = y * (stride + 1) + 1
    const o = y * stride
    const po = o - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[s + i]
      const a = i >= bpp ? px[o + i - bpp] : 0
      const b = y > 0 ? px[po + i] : 0
      const c = i >= bpp && y > 0 ? px[po + i - bpp] : 0
      let v: number
      switch (ft) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: v = x + paeth(a, b, c); break
        default: throw new Error(`Bad PNG filter ${ft}`)
      }
      px[o + i] = v & 255
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  const n = width * height
  if (colorType === 6) out.set(px)
  else if (colorType === 2) {
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      out[i * 4] = px[j]; out[i * 4 + 1] = px[j + 1]; out[i * 4 + 2] = px[j + 2]; out[i * 4 + 3] = 255
    }
  } else if (colorType === 0) {
    for (let i = 0; i < n; i++) {
      const g = px[i]
      out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = 255
    }
  } else if (colorType === 4) {
    for (let i = 0; i < n; i++) {
      const g = px[i * 2]
      out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = px[i * 2 + 1]
    }
  } else {
    if (!palette) throw new Error('Palette PNG without PLTE')
    for (let i = 0; i < n; i++) {
      const k = px[i]
      out[i * 4] = palette[k * 3]
      out[i * 4 + 1] = palette[k * 3 + 1]
      out[i * 4 + 2] = palette[k * 3 + 2]
      out[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255
    }
  }
  return { width, height, data: out }
}
