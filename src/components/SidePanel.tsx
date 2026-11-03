import type { ReactElement } from 'react'
import GarmentMockup from './GarmentMockup'
import type { GarmentMockupProps, MockupView } from './GarmentMockup'
import { Status } from './ui'
import { useStudio } from './studio'

export function SidePanel(): ReactElement {
  const { r, sz, preview, finish, showGarment, setShowGarment, source, upscaler } = useStudio()
  const p = r.placement
  const view: MockupView = p.side === 'back' ? 'back' : p.side === 'sleeve' ? 'left-sleeve' : 'front'
  const common: Omit<GarmentMockupProps, 'variant'> = {
    garmentType: r.garment.type,
    bodyWidthIn: sz.bodyWidthIn,
    bodyLengthIn: sz.bodyLengthIn,
    colorHex: r.colorHex,
    finish,
    designUrl: preview.url,
    designWIn: sz.effW,
    designHIn: sz.heightIn,
    downIn: sz.downIn,
    offsetIn: p.offsetIn,
    view,
  }
  const flagLevel = sz.flag.level === 'green' ? 'ok' : sz.flag.level === 'amber' ? 'warn' : 'error'
  const rep = preview.report

  return (
    <aside className="side" aria-label="Preview and status">
      <div className="card side__card flags">
        <h3>Status</h3>
        <div data-testid="preview-status" aria-live="polite" role="status">
          {!source && <Status level="info">Upload artwork to see a preview.</Status>}
          {source && preview.status === 'running' && (
            <>
              <Status level="info">Updating preview… {preview.stage}</Status>
              <label htmlFor="pv-progress" className="sr-only">Preview progress</label>
              <progress id="pv-progress" max={100} value={Math.round(preview.fraction * 100)} />
            </>
          )}
          {source && preview.status === 'ready' && <Status level="ok">Preview ready</Status>}
          {source && preview.status === 'error' && <Status level="error">{preview.error}</Status>}
        </div>
        {source ? (
          <Status level={flagLevel} live>
            <strong>Source {sz.flag.label.toLowerCase()}.</strong> {sz.flag.detail}
            {sz.flag.level !== 'green' && (
              <>
                {' '}Export will {upscaler === 'ai' ? 'upscale it with Real-ESRGAN' : upscaler === 'vectorize' ? 'trace it to vectors' : 'resize it with Lanczos'} to 300 DPI (step 6).
              </>
            )}
          </Status>
        ) : (
          <Status level="info">DPI is shown once artwork is loaded.</Status>
        )}
        {rep && preview.status !== 'error' && (
          <>
            <Status level={rep.semiTransparentAfter === 0 ? 'ok' : 'error'}>
              {rep.semiTransparentAfter === 0 ? 'Every pixel is fully opaque or fully transparent.' : 'Semi-transparent pixels remain.'}
            </Status>
            <Status level={rep.solid.warn ? 'warn' : 'ok'}>
              {rep.solid.warn ? `${Math.round(rep.solid.coverage * 100)}% solid: see the remedies in step 5.` : `Solid coverage ${Math.round(rep.solid.coverage * 100)}%.`}
            </Status>
          </>
        )}
      </div>
      <div className="card side__card">
        <div className="toggle" role="group" aria-label="Preview style">
          <button type="button" className="btn btn--small" aria-pressed={showGarment} onClick={() => setShowGarment(true)}>Show garment</button>
          <button type="button" className="btn btn--small" aria-pressed={!showGarment} onClick={() => setShowGarment(false)}>Show artwork only (checkerboard)</button>
        </div>
        {showGarment ? (
          <GarmentMockup {...common} variant="full" />
        ) : (
          <div className="art-only checker">
            {preview.url ? <img src={preview.url} alt="Artwork only, on a checkerboard that shows transparency" /> : <p className="muted small">No preview yet.</p>}
          </div>
        )}
        <h3>Seen from 6 feet</h3>
        {showGarment ? (
          <GarmentMockup {...common} variant="distance" />
        ) : (
          <div className="art-only art-only--small checker">{preview.url && <img src={preview.url} alt="Artwork only, small, to judge readability from a distance" />}</div>
        )}
      </div>

    </aside>
  )
}
