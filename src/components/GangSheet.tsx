import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { GANG_SHEET_WIDTH_IN, packGangSheet, type PackResult } from '../lib/pack'
import type { GangRequest, GangResponse } from '../workers/gang.worker'
import { Status } from './ui'
import { useStudio } from './studio'

export function GangSheet(): ReactElement {
  const { gang: designs, removeGang } = useStudio()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [gap, setGap] = useState(0.5)
  const [pack, setPack] = useState<PackResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])

  // Designs changed: the old packing no longer matches.
  const key = designs.map((d) => d.id).join('|')
  useEffect(() => {
    setPack(null)
  }, [key])

  const nameOf = useMemo(() => Object.fromEntries(designs.map((d) => [d.id, d.fileName])), [designs])

  const doPack = () => {
    setError(null)
    setPack(
      packGangSheet(
        designs.map((d) => ({ id: d.id, w: d.widthIn, h: d.heightIn, qty: qty[d.id] ?? 1 })),
        { gap },
      ),
    )
  }

  const download = () => {
    if (!pack || pack.orderLength === null) return
    setError(null)
    setBusy(true)
    setProgress('Starting…')
    workerRef.current?.terminate()
    const w = new Worker(new URL('../workers/gang.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    const images: GangRequest['images'] = {}
    const transfer: Transferable[] = []
    const used = new Set(pack.placements.map((p) => p.id))
    for (const d of designs) {
      if (!used.has(d.id)) continue
      const buf = d.image.data.slice().buffer as ArrayBuffer
      images[d.id] = { width: d.image.width, height: d.image.height, buffer: buf }
      transfer.push(buf)
    }
    const orderLength = pack.orderLength
    w.onmessage = (e: MessageEvent<GangResponse>) => {
      const m = e.data
      if (m.type === 'progress') setProgress(m.text)
      else if (m.type === 'error') {
        setBusy(false)
        setError(m.message)
        w.terminate()
      } else {
        const url = URL.createObjectURL(new Blob([m.png], { type: 'image/png' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `gang-sheet_22x${orderLength}in_300dpi.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        setBusy(false)
        setProgress('Done: gang sheet downloaded.')
        w.terminate()
      }
    }
    w.onerror = (e) => {
      setBusy(false)
      setError(e.message || 'The gang sheet worker crashed.')
    }
    const req: GangRequest = { placements: pack.placements, lengthIn: orderLength, images }
    w.postMessage(req, transfer)
  }

  const sheetLen = pack ? (pack.orderLength ?? pack.usedLength) : 0

  return (
    <details className="details gang">
      <summary>Gang sheet (optional)</summary>
      <p className="muted small">Pack exported designs on a 22 in wide sheet. Pieces rotate to fit. Keep at least 0.25 in between designs; 0.5 in is safer.</p>
      {designs.length === 0 ? (
        <p className="muted small">Export a design first: every export is added to this list.</p>
      ) : (
        <>
          {designs.map((d) => (
            <div className="field" key={d.id}>
              <label htmlFor={`qty-${d.id}`}>Copies of {d.fileName}</label>
              <input
                id={`qty-${d.id}`}
                type="number"
                min={0}
                max={200}
                step={1}
                value={qty[d.id] ?? 1}
                onChange={(e) => setQty({ ...qty, [d.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
              <button type="button" className="btn btn--small" onClick={() => removeGang(d.id)} aria-label={`Remove ${d.fileName} from the gang sheet list`}>
                Remove
              </button>
            </div>
          ))}
          <div className="field">
            <label htmlFor="gang-gap">Gap between designs (in)</label>
            <input id="gang-gap" type="number" min={0.25} step={0.05} value={gap} onChange={(e) => setGap(Math.max(0.25, Number(e.target.value) || 0.25))} />
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={doPack}>Pack gang sheet</button>
            <button type="button" className="btn" onClick={download} disabled={!pack || pack.orderLength === null || pack.placements.length === 0 || busy}>
              Download gang sheet PNG
            </button>
          </div>
          <div aria-live="polite">
            {busy && <Status level="info">{progress}</Status>}
            {!busy && progress.startsWith('Done') && !error && <Status level="ok">{progress}</Status>}
            {error && <Status level="error">{error}</Status>}
          </div>
          {pack && (
            <div className="packed">
              <svg
                viewBox={`0 0 ${GANG_SHEET_WIDTH_IN} ${Math.max(1, sheetLen)}`}
                role="img"
                aria-label={`Gang sheet preview, ${GANG_SHEET_WIDTH_IN} inches wide and ${sheetLen} inches long, ${pack.placements.length} pieces`}
                className="packed__svg"
              >
                <rect x={0} y={0} width={GANG_SHEET_WIDTH_IN} height={Math.max(1, sheetLen)} className="packed__sheet" />
                {pack.placements.map((p, i) => (
                  <g key={`${p.id}-${p.copy}`}>
                    <rect x={p.x} y={p.y} width={p.w} height={p.h} className="packed__piece" />
                    <text x={p.x + p.w / 2} y={p.y + p.h / 2} className="packed__label" textAnchor="middle" dominantBaseline="middle">
                      {i + 1}
                    </text>
                  </g>
                ))}
              </svg>
              <dl className="kv">
                <dt>Pieces placed</dt>
                <dd>{pack.placements.length}</dd>
                <dt>Used length</dt>
                <dd>{pack.usedLength.toFixed(2)} in</dd>
                <dt>Length to order</dt>
                <dd>{pack.orderLength !== null ? `${pack.orderLength} in (22 in wide)` : 'More than 1000 in: split into several sheets'}</dd>
              </dl>
              {pack.unplaced.length > 0 && (
                <Status level="warn">
                  Not placed (wider than the sheet): {pack.unplaced.map((u) => `${nameOf[u.id] ?? u.id} copy ${u.copy + 1}`).join(', ')}
                </Status>
              )}
            </div>
          )}
        </>
      )}
    </details>
  )
}
