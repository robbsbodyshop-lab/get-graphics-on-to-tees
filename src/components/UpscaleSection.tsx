import type { ReactElement } from 'react'
import type { UpscaleMode } from '../workers/pipeline.worker'
import { Section, Status, fmtInt } from './ui'
import { useStudio } from './studio'

export function UpscaleSection(): ReactElement {
  const { sz, upscaler, setUpscaler, vectorOk, source, model } = useStudio()
  const opts: { v: UpscaleMode; label: string; hint: string; disabled?: boolean }[] = [
    { v: 'ai', label: 'AI (Real-ESRGAN)', hint: 'Best for photos and textured art. Runs on your device.' },
    { v: 'lanczos', label: 'Lanczos (fast)', hint: 'Plain resampling: fast, no invented detail, softer.' },
    {
      v: 'vectorize',
      label: 'Vectorize instead (logos with ≤ 8 colors)',
      hint: vectorOk
        ? 'Trace to vector shapes, then rasterize at 300 DPI. Crisp edges for flat logos and text.'
        : source
          ? 'Not available: this artwork has more than 8 dominant colors.'
          : 'Upload artwork to check whether it has 8 or fewer colors.',
      disabled: !vectorOk,
    },
  ]
  return (
    <Section id="upscale" num={6} title="Upscale" lead="Order of operations: upscale first, then color work, knockout, halftone and threshold at final resolution.">
      <div aria-live="polite">
        <dl className="kv">
          <dt>Source art</dt>
          <dd>{source ? `${fmtInt(sz.cropPx)} px wide (after trimming to the art)` : 'n/a'}</dd>
          <dt>Target</dt>
          <dd>{fmtInt(sz.targetPx)} px wide ({sz.effW.toFixed(2)} in × 300)</dd>
          <dt>Upscale factor</dt>
          <dd>{source ? `${sz.factor.toFixed(2)}×` : 'n/a'}</dd>
        </dl>
        {source && sz.factor > 2 && (
          <Status level="warn">Upscaling more than 2× invents detail; check text and logos at 100% after export.</Status>
        )}
        {source && sz.factor <= 1 && <Status level="ok">No upscale needed: the art is larger than the print.</Status>}
      </div>
      <fieldset>
        <legend>Upscaler</legend>
        {opts.map((o) => (
          <div className="radio" key={o.v}>
            <label>
              <input type="radio" name="upscaler" value={o.v} checked={upscaler === o.v} disabled={o.disabled} onChange={() => setUpscaler(o.v)} aria-describedby={`up-${o.v}`} />
              <span>{o.label}</span>
            </label>
            <span className="hint" id={`up-${o.v}`}>{o.hint}</span>
          </div>
        ))}
      </fieldset>
      {upscaler === 'ai' && (
        <div aria-live="polite">
          {model.state === 'loading' || model.state === 'idle' ? (
            <Status level="info">AI model: loading…</Status>
          ) : model.state === 'ready' ? (
            <Status level="ok">AI model: ready ({model.backend})</Status>
          ) : (
            <Status level="warn">AI model: unavailable — Lanczos will be used.</Status>
          )}
        </div>
      )}
    </Section>
  )
}
