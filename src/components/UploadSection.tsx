import { useId, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import { Section, Status, fmtInt } from './ui'
import { useStudio } from './studio'

export function UploadSection(): ReactElement {
  const { source, loading, loadError, loadFile } = useStudio()
  const [over, setOver] = useState(false)
  const hid = useId()

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) loadFile(f)
  }
  const a = source?.analysis

  return (
    <Section id="upload" num={1} title="Upload" lead="PNG, JPG, WEBP or SVG. Nothing leaves your device.">
      <div
        className={`drop ${over ? 'drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="field">
          <label htmlFor={hid}>Upload artwork</label>
          <input
            id={hid}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) loadFile(f)
            }}
          />
          <span className="hint">…or drop a file anywhere in this box.</span>
        </div>
      </div>
      <div aria-live="polite">
        {loading && <Status level="info">Reading the file…</Status>}
        {loadError && <Status level="error">{loadError}</Status>}
      </div>
      {source && a && (
        <div className="stats" aria-live="polite">
          <dl className="kv">
            <dt>File</dt>
            <dd>{source.name}</dd>
            <dt>Pixel size</dt>
            <dd>{fmtInt(a.width)} × {fmtInt(a.height)} px</dd>
            <dt>Aspect ratio</dt>
            <dd>{a.aspectLabel}</dd>
            <dt>Alpha channel</dt>
            <dd>{a.hasAlpha ? 'Yes (has transparent pixels)' : 'No (fully opaque)'}</dd>
            <dt>Semi-transparent pixels</dt>
            <dd>{fmtInt(a.semiTransparentCount)}</dd>
            <dt>Distinct colors</dt>
            <dd>{fmtInt(a.distinctColors)} <span className="muted">(32 levels per channel)</span></dd>
            {source.pngDpi !== null && (
              <>
                <dt>PNG DPI</dt>
                <dd>{source.pngDpi} <span className="muted">(display only)</span></dd>
              </>
            )}
          </dl>
          {source.note && <Status level="info">{source.note}</Status>}
          {a.semiTransparentCount > 0 && (
            <Status level="warn">
              {fmtInt(a.semiTransparentCount)} semi-transparent pixels. The printer lays a white underbase under any pixel that is not fully
              transparent, so soft alpha prints as a white haze. Turn on Halftone in step 5 to convert soft edges and shadows to dots.
            </Status>
          )}
        </div>
      )}
    </Section>
  )
}
