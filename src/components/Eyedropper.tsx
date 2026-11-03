import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { rgbToHex } from '../lib/image/color'
import { Status, Swatch, fmtInt } from './ui'
import { useStudio } from './studio'

/** Big source/processed image with a click and keyboard eyedropper. */
export function Eyedropper(): ReactElement | null {
  const { source, settings, update, preview, r } = useStudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<'before' | 'after'>('before')
  const [cur, setCur] = useState({ x: 0.5, y: 0.5 })
  const [msg, setMsg] = useState<string | null>(null)
  const image = source?.image

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !image) return
    c.width = image.width
    c.height = image.height
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0)
  }, [image, view])

  if (!source || !image) {
    return <Status level="info">Upload artwork in step 1 to use the eyedropper and preview.</Status>
  }

  const pixelAt = (fx: number, fy: number) => {
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(fx * image.width)))
    const y = Math.min(image.height - 1, Math.max(0, Math.floor(fy * image.height)))
    const i = (y * image.width + x) * 4
    const d = image.data
    return { x, y, a: d[i + 3], hex: rgbToHex({ r: d[i], g: d[i + 1], b: d[i + 2] }) }
  }
  const under = pixelAt(cur.x, cur.y)

  const doPick = (fx: number, fy: number) => {
    const p = pixelAt(fx, fy)
    if (p.a === 0) {
      setMsg('That pixel is already transparent: pick a visible color.')
      return
    }
    setMsg(null)
    update((s) => {
      s.knockoutPicks = [...s.knockoutPicks, p.hex]
    })
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (view !== 'before') return
    const rect = e.currentTarget.getBoundingClientRect()
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height
    setCur({ x: fx, y: fy })
    doPick(fx, fy)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (view !== 'before') return
    const step = (e.shiftKey ? 10 : 1) / Math.max(image.width, image.height) * 8
    let { x, y } = cur
    if (e.key === 'ArrowLeft') x -= step
    else if (e.key === 'ArrowRight') x += step
    else if (e.key === 'ArrowUp') y -= step
    else if (e.key === 'ArrowDown') y += step
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      doPick(cur.x, cur.y)
      return
    } else return
    e.preventDefault()
    setCur({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) })
  }

  const removed = preview.report
    ? Object.values(preview.report.sourceRemoved).reduce((a, b) => a + b, 0) * preview.areaRatio
    : null

  return (
    <div className="eye">
      <div className="toggle" role="group" aria-label="Image shown">
        <button type="button" className="btn btn--small" aria-pressed={view === 'before'} onClick={() => setView('before')}>Before</button>
        <button type="button" className="btn btn--small" aria-pressed={view === 'after'} onClick={() => setView('after')}>After</button>
        <span className="muted small">{view === 'before' ? 'Source artwork' : 'Processed preview on the garment color'}</span>
      </div>
      <div
        className={`eye__frame ${view === 'before' ? 'checker' : ''}`}
        style={view === 'after' ? { background: r.colorHex } : undefined}
        tabIndex={view === 'before' ? 0 : -1}
        role="group"
        aria-label="Source image eyedropper. Use the arrow keys to move the crosshair and Enter to pick a color to remove. Shift makes bigger steps."
        onClick={onClick}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className="eye__canvas" hidden={view !== 'before'} />
        {view === 'after' &&
          (preview.url ? (
            <img className="eye__canvas" src={preview.url} alt="Processed preview of the artwork on the garment color" />
          ) : (
            <p className="eye__empty">No preview yet.</p>
          ))}
        {view === 'before' && (
          <span className="eye__cross" style={{ left: `${cur.x * 100}%`, top: `${cur.y * 100}%` }} aria-hidden="true" />
        )}
      </div>
      {view === 'before' ? (
        <p className="small">
          <Swatch hex={under.hex} /> Crosshair at {fmtInt(under.x)}, {fmtInt(under.y)}: <code>{under.hex}</code>
          {under.a === 0 ? ' (transparent)' : ''}. Click, or press Enter, to remove this color.
        </p>
      ) : (
        <p className="small muted">Switch to Before to pick colors.</p>
      )}
      {msg && <Status level="warn">{msg}</Status>}

      <div className="chips" aria-label="Picked colors to remove">
        {settings.knockoutPicks.length === 0 && <span className="muted small">No picked colors yet.</span>}
        {settings.knockoutPicks.map((hex, i) => (
          <span className="chip" key={`${hex}-${i}`}>
            <Swatch hex={hex} />
            <code>{hex}</code>
            <button
              type="button"
              aria-label={`Remove pick ${hex}`}
              onClick={() =>
                update((s) => {
                  s.knockoutPicks = s.knockoutPicks.filter((_, j) => j !== i)
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="btn btn--small"
          disabled={settings.knockoutPicks.length === 0}
          onClick={() =>
            update((s) => {
              s.knockoutPicks = s.knockoutPicks.slice(0, -1)
            })
          }
        >
          Undo last pick
        </button>
      </div>
      <p className="big-number" aria-live="polite">
        Pixels removed: <strong>{removed === null ? '…' : fmtInt(removed)}</strong>
      </p>
    </div>
  )
}
