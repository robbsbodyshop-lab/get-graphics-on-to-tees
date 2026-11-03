/// <reference lib="webworker" />
import type { RGBAImage } from '../lib/types'
import { renderGangSheet, type GangPlacement } from '../lib/pack'
import { encodePng } from '../lib/png'

export interface GangRequest {
  placements: GangPlacement[]
  lengthIn: number
  images: Record<string, { width: number; height: number; buffer: ArrayBuffer }>
}

export type GangResponse =
  | { type: 'progress'; text: string }
  | { type: 'done'; png: ArrayBuffer }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<GangRequest>) => {
  const post = (m: GangResponse, t: Transferable[] = []) => ctx.postMessage(m, t)
  try {
    const { placements, lengthIn, images } = e.data
    const imgs: Record<string, RGBAImage> = {}
    for (const [id, v] of Object.entries(images)) imgs[id] = { width: v.width, height: v.height, data: new Uint8ClampedArray(v.buffer) }
    post({ type: 'progress', text: `Placing ${placements.length} pieces on a 22 × ${lengthIn} in sheet…` })
    const sheet = renderGangSheet(placements, imgs, lengthIn, { dpi: 300 })
    post({ type: 'progress', text: `Encoding PNG (${sheet.width} × ${sheet.height} px)…` })
    const bytes = await encodePng(sheet, { dpi: 300 })
    const png = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    post({ type: 'done', png }, [png])
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
