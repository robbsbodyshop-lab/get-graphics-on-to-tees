import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Section, Status, fmtInt } from './ui'
import { useStudio } from './studio'
import type { ExportedDesign } from './studio'
import { JobSheetPanel } from './JobSheetPanel'
import { GangSheet } from './GangSheet'
import { useIccName } from './exportInfo'

type Bg = 'checker' | 'black' | 'shirt'
const BGS: { v: Bg; label: string; text: string }[] = [
  { v: 'checker', label: 'Checkerboard background', text: 'Checkerboard' },
  { v: 'black', label: 'Black background', text: 'Black' },
  { v: 'shirt', label: 'Shirt-color background', text: 'Shirt color' },
]
const pct1 = (f: number) => `${(f * 100).toFixed(1)}%`
const pct0 = (f: number) => `${Math.round(f * 100)}%`

function ExportCheckPanel({ d }: { d: ExportedDesign }): ReactElement {
  const { r } = useStudio()
  const c = d.report.check
  const icc = useIccName(d.pngUrl)
  const b = c.brightness
  const closeLevel = c.garmentClose > 0.25 ? 'error' : c.garmentClose >= 0.1 ? 'warn' : 'ok'
  return (
    <div className="excheck">
      <h4>Export check (from the file's real pixels)</h4>
      <Status level={c.partial === 0 ? 'ok' : 'error'}>
        Fully clear / fully solid / partly clear: {pct1(c.clearFraction)} / {pct1(c.solidFraction)} / {fmtInt(c.partial)} px
      </Status>
      <Status level="ok">
        Size: {fmtInt(c.widthPx)} × {fmtInt(c.heightPx)} px = {(c.widthPx / 300).toFixed(2)} × {(c.heightPx / 300).toFixed(2)} in at 300 DPI
      </Status>
      <Status level={c.hiddenColor === 0 ? 'ok' : 'error'}>
        Hidden color under transparent pixels: {fmtInt(c.hiddenColor)} px (cleared {fmtInt(d.report.hiddenColorCleared)} px)
      </Status>
      {icc === undefined ? (
        <Status level="info">Color profile: checking the file…</Status>
      ) : icc !== null && /srgb/i.test(icc) ? (
        <Status level="ok">Color profile: sRGB ICC profile embedded</Status>
      ) : (
        <Status level="warn">Color profile: no sRGB ICC profile found in the file</Status>
      )}
      <Status level="info">
        Ink colors: {fmtInt(c.uniqueColors)} distinct colors; {pct0(c.saturated)} saturated accents
      </Status>
      <Status level="info">
        Ink brightness: pure white {pct0(b.pureWhite)} · light {pct0(b.light)} · mid {pct0(b.mid)} · dark {pct0(b.dark)} · black {pct0(b.black)}
      </Status>
      <Status level={closeLevel}>
        <span>
          Ink vs shirt: {pct0(c.garmentClose)} of the ink is within 40 brightness levels of {r.colorName}
          {closeLevel === 'error' && (
            <span className="excheck__advice">Make a separate export for this shirt color, add contrast, or pick a contrasting shirt.</span>
          )}
        </span>
      </Status>
      {d.report.specks.tinyDots > 0 && (
        <Status level="info">Tiny dots removed: {fmtInt(d.report.specks.tinyDots)} dots under 0.01 in removed (they would not transfer)</Status>
      )}
    </div>
  )
}


function Result({ d, onThicken, thickened }: { d: ExportedDesign; onThicken: () => void; thickened: boolean }): ReactElement {
  const st = d.report.strokes
  const { r } = useStudio()
  const [bg, setBg] = useState<Bg>('shirt')
  const [zoom, setZoom] = useState<1 | 2 | 3>(2)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Open on the middle of the art rather than the empty top-left margin, and keep it centred on zoom.
  useEffect(() => {
    const box = boxRef.current
    if (!open || !box) return
    box.scrollLeft = (d.widthPx * zoom - box.clientWidth) / 2
    box.scrollTop = (d.heightPx * zoom - box.clientHeight) / 2
  }, [open, zoom, d.widthPx, d.heightPx])
  const bgStyle = bg === 'shirt' ? { background: r.colorHex } : bg === 'black' ? { background: '#000' } : undefined
  return (
    <div className="result">
      <h3>{d.label}</h3>
      <dl className="kv">
        <dt>File</dt>
        <dd>{d.fileName}</dd>
        <dt>Final size</dt>
        <dd>{fmtInt(d.widthPx)} × {fmtInt(d.heightPx)} px = {d.widthIn.toFixed(2)} × {d.heightIn.toFixed(2)} in at 300 DPI</dd>
        <dt>Upscaled with</dt>
        <dd>{d.upscaledWith}</dd>
        <dt>Semi-transparent pixels</dt>
        <dd>{fmtInt(d.report.semiTransparentAfter)}</dd>
      </dl>
      {st && !st.flagged && <Status level="ok">Stroke check passed: no strokes or gaps thinner than 0.04 in.</Status>}
      {st && st.flagged && (
        <>
          {st.messages.map((m) => (
            <Status key={m} level="warn">{m}</Status>
          ))}
          <button type="button" className="btn btn--small" onClick={onThicken} disabled={thickened}>
            Thicken strokes 1 px
          </button>
          {thickened && <span className="muted small"> Turned on: export again to apply it.</span>}
        </>
      )}
      <ExportCheckPanel d={d} />
      <details className="details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Check at 100%</summary>
        <p className="muted small">Upscalers invent detail. Look at text and logos up close, over black and over the shirt color (scroll the box).</p>
        <div className="inspect-controls">
          <fieldset>
            <legend>Background</legend>
            {BGS.map((o) => (
              <div className="radio" key={o.v}>
                <label>
                  <input type="radio" name={`bg-${d.id}`} checked={bg === o.v} onChange={() => setBg(o.v)} aria-label={o.label} />
                  <span aria-hidden="true">{o.text}</span>
                </label>
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>Zoom</legend>
            {([1, 2, 3] as const).map((z) => (
              <div className="radio" key={z}>
                <label>
                  <input type="radio" name={`zoom-${d.id}`} checked={zoom === z} onChange={() => setZoom(z)} aria-label={`Zoom ${z}×`} />
                  <span aria-hidden="true">{z}×</span>
                </label>
              </div>
            ))}
          </fieldset>
        </div>
        <div ref={boxRef} className={`actual ${bg === 'checker' ? 'checker' : ''}`} style={bgStyle} tabIndex={0} role="group" aria-label={`${d.label} at ${zoom}× zoom on ${BGS.find((o) => o.v === bg)?.text.toLowerCase()}, scrollable`}>
          <img className="pix" src={d.pngUrl} width={d.widthPx * zoom} height={d.heightPx * zoom} alt={`Exported ${d.fileName} at ${zoom * 100} percent`} />
        </div>
      </details>
      <a className="btn btn--small" href={d.pngUrl} download={d.fileName}>Download again</a>
    </div>
  )
}

export function ExportSection(): ReactElement {
  const { exp, runExport, cancelExport, source, settings, addThicken, preview } = useStudio()
  const running = exp.status === 'running'
  return (
    <Section id="export" num={7} title="Export" lead="PNG-24 with true transparency, sRGB, 300 DPI embedded, trimmed to the art plus a 0.1 in margin. Not mirrored unless you turned that on.">
      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={runExport} disabled={!source || running || preview.status === 'error'}>
          Export PNG
        </button>
        {running && (
          <button type="button" className="btn" onClick={cancelExport}>
            Cancel
          </button>
        )}
      </div>
      {!source && <p className="muted small">Upload artwork first.</p>}
      {running && (
        <div className="progress">
          <label htmlFor="exp-progress">{exp.stage}…</label>
          <progress id="exp-progress" max={100} value={Math.round(exp.fraction * 100)} />
        </div>
      )}
      <div data-testid="export-status" aria-live="polite" role="status">
        {exp.status === 'done' && <Status level="ok">{exp.message}</Status>}
        {exp.status === 'error' && <Status level="error">{exp.message}</Status>}
        {running && <Status level="info">Exporting… {exp.stage}</Status>}
      </div>
      {exp.results.map((d) => (
        <Result key={d.id} d={d} onThicken={addThicken} thickened={settings.thicken} />
      ))}
      <JobSheetPanel />
      <GangSheet />
    </Section>
  )
}
