import type { ReactElement } from 'react'
import { Section, Status, fmtInt } from './ui'
import { useStudio } from './studio'
import type { ExportedDesign } from './studio'
import { JobSheetPanel } from './JobSheetPanel'
import { GangSheet } from './GangSheet'

function Result({ d, onThicken, thickened }: { d: ExportedDesign; onThicken: () => void; thickened: boolean }): ReactElement {
  const st = d.report.strokes
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
      <details className="details">
        <summary>Check at 100%</summary>
        <p className="muted small">Upscalers invent detail. Look at text and logos at 1:1 pixels (scroll the box).</p>
        <div className="actual" tabIndex={0} role="group" aria-label={`${d.label} at 100 percent, scrollable`}>
          <img src={d.pngUrl} width={d.widthPx} height={d.heightPx} alt={`Exported ${d.fileName} at 100 percent`} />
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
