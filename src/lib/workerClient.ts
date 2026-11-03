import type { WorkerRequest, WorkerResponse, UpscaleMode } from '../workers/pipeline.worker'
import type { ProcessSettings, RGBAImage } from './types'
import type { PipelineReport } from './pipeline'

export interface RunResult {
  image: RGBAImage
  report: PipelineReport
  png: Uint8Array | null
  upscaledWith: string
  areaRatio: number
}

interface Pending {
  resolve: (r: RunResult) => void
  reject: (e: Error) => void
  onProgress?: (stage: string, fraction: number) => void
}

/**
 * Owns two workers: one for live previews (restarted whenever a newer preview supersedes it) and
 * one for exports (restarted on cancel). Restarting is how cancel works: terminate() stops any
 * computation instantly, then the source is re-sent.
 */
export class PipelineClient {
  private workers: Record<'preview' | 'export', Worker | null> = { preview: null, export: null }
  private pending = new Map<number, Pending & { lane: 'preview' | 'export' }>()
  private nextId = 1
  private source: RGBAImage | null = null

  private spawn(lane: 'preview' | 'export'): Worker {
    const w = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data)
    w.onerror = (e) => {
      for (const [id, p] of this.pending) {
        if (p.lane === lane) {
          p.reject(new Error(e.message || 'Worker crashed'))
          this.pending.delete(id)
        }
      }
    }
    if (this.source) this.sendSource(w, this.source)
    this.workers[lane] = w
    return w
  }

  private worker(lane: 'preview' | 'export'): Worker {
    return this.workers[lane] ?? this.spawn(lane)
  }

  private sendSource(w: Worker, img: RGBAImage) {
    const copy = new Uint8ClampedArray(img.data) // keep our copy; transfer the clone
    const msg: WorkerRequest = { type: 'setSource', width: img.width, height: img.height, buffer: copy.buffer }
    w.postMessage(msg, [copy.buffer])
  }

  setSource(img: RGBAImage) {
    this.source = img
    for (const lane of ['preview', 'export'] as const) {
      const w = this.workers[lane]
      if (w) this.sendSource(w, img)
    }
  }

  private handle(msg: WorkerResponse) {
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') p.onProgress?.(msg.stage, msg.fraction)
    else if (msg.type === 'error') {
      this.pending.delete(msg.id)
      p.reject(new Error(msg.message))
    } else if (msg.type === 'result') {
      this.pending.delete(msg.id)
      p.resolve({
        image: { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) },
        report: msg.report,
        png: msg.png ? new Uint8Array(msg.png) : null,
        upscaledWith: msg.upscaledWith,
        areaRatio: msg.areaRatio,
      })
    } else if (msg.type === 'modelReady') {
      this.pending.delete(msg.id)
      p.resolve({ image: { width: 0, height: 0, data: new Uint8ClampedArray(0) }, report: null as unknown as PipelineReport, png: null, upscaledWith: msg.backend, areaRatio: 1 })
    }
  }

  run(
    mode: 'preview' | 'export',
    params: { settings: ProcessSettings; garmentHex: string; printWidthIn: number; upscale: UpscaleMode; previewMaxPx?: number },
    onProgress?: (stage: string, fraction: number) => void,
  ): Promise<RunResult> {
    // A newer preview makes the running one pointless: restart that worker.
    if (mode === 'preview' && [...this.pending.values()].some((p) => p.lane === 'preview')) this.cancel('preview')
    const id = this.nextId++
    const w = this.worker(mode)
    return new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, lane: mode })
      const msg: WorkerRequest = { type: 'run', id, mode, ...params }
      w.postMessage(msg)
    })
  }

  /** Download and compile the AI model in the export worker; resolves with the backend name. */
  warmModel(): Promise<string> {
    const id = this.nextId++
    const w = this.worker('export')
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve: (r) => resolve(r.upscaledWith), reject, lane: 'export' })
      w.postMessage({ type: 'warmModel', id } satisfies WorkerRequest)
    })
  }

  cancel(lane: 'preview' | 'export') {
    this.workers[lane]?.terminate()
    this.workers[lane] = null
    for (const [id, p] of this.pending) {
      if (p.lane === lane) {
        p.reject(new Error('Cancelled'))
        this.pending.delete(id)
      }
    }
  }

  dispose() {
    this.cancel('preview')
    this.cancel('export')
  }
}
