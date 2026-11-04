import type { ReactElement } from 'react'
import { MASK_LABELS } from '../lib/image/masks'
import { knockoutSummary, fmtIn } from '../lib/pipeline'
import { OUTPUT_DPI, SOLID_WARN } from '../lib/settings'
import { speckSizePx } from '../lib/image/alpha'
import type { Edge, MaskKind } from '../lib/types'
import { Eyedropper } from './Eyedropper'
import { Check, Range, Section, Select, Status, Swatch, fmtInt } from './ui'
import { useStudio } from './studio'

const DOTS_HINT =
  'Art that already has a transparent background: use Soft edges and shadows. Tones / photo is for photos on a solid background.'
const POSTERIZE_HINT =
  'For flat logos and type. On photo-style or textured art it causes banding and can turn small accent colors gray.'

const INKS: [string, string][] = [
  ['auto', 'Auto contrast'],
  ['original', 'Original colors'],
  ['#000000', 'Black'],
  ['#ffffff', 'White'],
]

export function KnockoutSection(): ReactElement {
  const { settings: s, update, r, preview, source } = useStudio()
  const rep = preview.report
  const known = ['#000000', '#ffffff', 'garment']
  const outlineSel = known.includes(s.outline.color) ? s.outline.color : 'custom'
  const hasAlpha = source?.analysis.hasAlpha ?? false
  const manyColors = (source?.analysis.distinctColors ?? 0) > 256
  const speckPx = speckSizePx(s.speckMinIn, OUTPUT_DPI)

  return (
    <Section
      id="knockout"
      num={5}
      title="Knock out (fine-tune)"
      lead="This is the step that stops the print looking like a block sticker: remove the garment color, the background and the tones that should be fabric, then turn soft edges into dots."
    >
      <div className="group">
        <h3>Remove</h3>
        <Check
          label="Knock out garment color"
          checked={s.knockoutGarment}
          onChange={(b) => update((x) => void (x.knockoutGarment = b))}
          hint={
            <>
              <Swatch hex={r.colorHex} /> {r.colorName}: black art on a black tee becomes the fabric.
            </>
          }
        />
        <Check
          label="Remove background (flood fill from edges)"
          checked={s.removeBackground}
          onChange={(b) => update((x) => void (x.removeBackground = b))}
          hint="For white or solid backgrounds."
        />
        <Range
          label="Tolerance (Delta E)"
          value={s.tolerance}
          min={2}
          max={25}
          step={1}
          onChange={(v) => update((x) => void (x.tolerance = v))}
          hint="How close a color must be (in Lab) to be removed. Lower is stricter."
        />
        <Eyedropper />
      </div>

      <div className="group">
        <h3>Distress</h3>
        <Check label="Distress" checked={s.distress.enabled} onChange={(b) => update((x) => void (x.distress.enabled = b))} hint="Coarse marks only; fine noise turns to mud in DTF." />
        {s.distress.enabled && (
          <div className="indent">
            <Select label="Distress mask" value={s.distress.mask} onChange={(v) => update((x) => void (x.distress.mask = v as MaskKind))}>
              {(Object.keys(MASK_LABELS) as MaskKind[]).map((k) => (
                <option key={k} value={k}>{MASK_LABELS[k]}</option>
              ))}
            </Select>
            <Range label="Distress intensity" value={Math.round(s.distress.intensity * 100)} min={0} max={100} step={1} display={`${Math.round(s.distress.intensity * 100)}%`} onChange={(v) => update((x) => void (x.distress.intensity = v / 100))} />
          </div>
        )}
      </div>

      <div className="group">
        <h3>Soft edges become dots</h3>
        <Check label="Halftone" checked={s.halftone.enabled} onChange={(b) => update((x) => void (x.halftone.enabled = b))} hint="Replaces every soft-alpha fade and shadow with printable dots." />
        {s.halftone.enabled && (
          <div className="indent">
            <Select
              label="Dots from"
              value={s.halftone.mode}
              onChange={(v) => update((x) => void (x.halftone.mode = v as 'alpha' | 'luminance'))}
            >
              <option value="alpha">Soft edges and shadows (alpha)</option>
              <option value="luminance">Tones / photo (luminance)</option>
            </Select>
            {s.halftone.mode === 'luminance' && hasAlpha ? (
              <Status level="warn">{DOTS_HINT}</Status>
            ) : (
              <p className="hint">{DOTS_HINT}</p>
            )}
            <Range label="LPI (lines per inch)" value={s.halftone.lpi} min={45} max={65} step={1} onChange={(v) => update((x) => void (x.halftone.lpi = v))} />
            {s.halftone.mode === 'luminance' && (
              <>
                <Select
                  label="Ink"
                  value={s.halftone.ink}
                  onChange={(v) => update((x) => void (x.halftone.ink = v))}
                >
                  {INKS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
                <Range label="Tone range: from (darkest)" value={Math.round(s.halftone.lumLo * 100)} min={0} max={100} step={1} display={`${Math.round(s.halftone.lumLo * 100)}%`} onChange={(v) => update((x) => void (x.halftone.lumLo = Math.min(v / 100, x.halftone.lumHi)))} />
                <Range label="Tone range: to (lightest)" value={Math.round(s.halftone.lumHi * 100)} min={0} max={100} step={1} display={`${Math.round(s.halftone.lumHi * 100)}%`} onChange={(v) => update((x) => void (x.halftone.lumHi = Math.max(v / 100, x.halftone.lumLo)))} />
              </>
            )}
          </div>
        )}
        <Check label="Fade an edge into the garment" checked={s.fadeEdge.enabled} onChange={(b) => update((x) => void (x.fadeEdge.enabled = b))} hint="A dotted gradient, never soft alpha." />
        {s.fadeEdge.enabled && (
          <div className="indent">
            <Select label="Edge" value={s.fadeEdge.edge} onChange={(v) => update((x) => void (x.fadeEdge.edge = v as Edge))}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </Select>
            <Range label="Fade length" value={Math.round(s.fadeEdge.fraction * 100)} min={5} max={90} step={1} display={`${Math.round(s.fadeEdge.fraction * 100)}%`} onChange={(v) => update((x) => void (x.fadeEdge.fraction = v / 100))} />
          </div>
        )}
      </div>

      <details className="details">
        <summary>Color work</summary>
        <div className="indent">
          <Check label="Posterize" checked={s.posterize.enabled} onChange={(b) => update((x) => void (x.posterize.enabled = b))} hint={s.posterize.enabled && manyColors ? <span className="warn-line">⚠ {POSTERIZE_HINT}</span> : POSTERIZE_HINT} />
          {s.posterize.enabled && <Range label="Colors" value={s.posterize.colors} min={2} max={16} step={1} onChange={(v) => update((x) => void (x.posterize.colors = v))} />}
          <Range label="Desaturate" value={Math.round(s.desaturate * 100)} min={0} max={100} step={1} display={`${Math.round(s.desaturate * 100)}%`} onChange={(v) => update((x) => void (x.desaturate = v / 100))} />
          <Range label="Contrast" value={Math.round(s.contrast * 100)} min={-100} max={100} step={1} onChange={(v) => update((x) => void (x.contrast = v / 100))} />
          <Check label="Snap near-black/white to pure" checked={s.snapBlackWhite} onChange={(b) => update((x) => void (x.snapBlackWhite = b))} hint="Turns near-white (245+) into pure white and near-black (10 and under) into pure black." />
          <Check label="Line art (1-bit)" checked={s.lineArt.enabled} onChange={(b) => update((x) => void (x.lineArt.enabled = b))} hint="Dark tones become ink, light tones become fabric." />
          {s.lineArt.enabled && (
            <>
              <Range label="Line art threshold" value={Math.round(s.lineArt.threshold * 100)} min={5} max={95} step={1} display={`${Math.round(s.lineArt.threshold * 100)}%`} onChange={(v) => update((x) => void (x.lineArt.threshold = v / 100))} />
              <Select label="Line art ink" value={s.lineArt.ink} onChange={(v) => update((x) => void (x.lineArt.ink = v))}>
                {INKS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </>
          )}
          <Check label="Keyline outline" checked={s.outline.enabled} onChange={(b) => update((x) => void (x.outline.enabled = b))} />
          {s.outline.enabled && (
            <>
              <Range label="Keyline width (px at 300 DPI)" value={s.outline.px} min={1} max={12} step={1} onChange={(v) => update((x) => void (x.outline.px = v))} />
              <Select
                label="Keyline color"
                value={outlineSel}
                onChange={(v) => update((x) => void (x.outline.color = v === 'custom' ? '#cc2200' : v))}
              >
                <option value="#000000">Black</option>
                <option value="#ffffff">White</option>
                <option value="garment">Garment color</option>
                <option value="custom">Custom…</option>
              </Select>
              {outlineSel === 'custom' && (
                <div className="field">
                  <label htmlFor="outline-hex">Custom keyline color</label>
                  <input id="outline-hex" type="color" value={s.outline.color} onChange={(e) => update((x) => void (x.outline.color = e.target.value))} />
                </div>
              )}
            </>
          )}
        </div>
      </details>

      <div className="group">
        <h3>Finishing</h3>
        <p className="muted small">These steps end every knockout: hard 0 or 255 alpha, optional choke, speck removal.</p>
        <Range label="Alpha threshold" value={Math.round(s.alphaThreshold * 100)} min={1} max={99} step={1} display={`${Math.round(s.alphaThreshold * 100)}%`} onChange={(v) => update((x) => void (x.alphaThreshold = v / 100))} />
        <Check label="Choke 1 px" checked={s.choke} onChange={(b) => update((x) => void (x.choke = b))} hint="Pulls edges in by one pixel." />
        <Check label="Thicken strokes 1 px" checked={s.thicken} onChange={(b) => update((x) => void (x.thicken = b))} hint="Fixes strokes that are too thin to print." />
        <div className="field">
          <label htmlFor="speck">Remove specks smaller than (in)</label>
          <input
            id="speck"
            type="number"
            min={0}
            max={0.5}
            step={0.01}
            value={s.speckMinIn}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(n) && n >= 0) update((x) => void (x.speckMinIn = n))
            }}
          />
          <span className="hint">= {speckPx} px at {OUTPUT_DPI} DPI</span>
        </div>
        <Check label="Mirror (printer usually mirrors; leave off)" checked={s.mirror} onChange={(b) => update((x) => void (x.mirror = b))} />
      </div>

      <div className="report" aria-live="polite">
        <h3>Report</h3>
        {preview.status === 'error' && <Status level="error">{preview.error}</Status>}
        {rep ? (
          <>
            <ul className="plain">
              <li>Removed: {knockoutSummary(rep, s, r.colorName)}.</li>
              <li>Specks removed: {fmtInt(rep.specks.islands)} (islands under {fmtIn(s.speckMinIn)} in, counted on the preview).</li>
              <li>Halftone dots: {fmtInt(rep.halftoneDots)}.</li>
              <li>Semi-transparent pixels after processing: {fmtInt(rep.semiTransparentAfter)}.</li>
            </ul>
            {rep.solid.warn ? (
              <Status level="warn">
                {Math.round(rep.solid.coverage * 100)}% solid (over {Math.round(SOLID_WARN * 100)}%): big solid fills feel like a plastic patch and trap sweat. Remedies, in order:
              </Status>
            ) : (
              <Status level="ok">Solid coverage {Math.round(rep.solid.coverage * 100)}% (under {Math.round(SOLID_WARN * 100)}%).</Status>
            )}
            {rep.solid.warn && (
              <ol className="small remedies">
                <li>Delete non-essential background shapes and borders.</li>
                <li>Knock out garment-color areas.</li>
                <li>Halftone the fades and shading.</li>
                <li>Punch texture or pattern into unavoidable solids (distress).</li>
                <li>Keep designs open and thin. Heavier fabrics (hoodies, tees 6 oz and up) hide stiffness better than 4 oz tees.</li>
              </ol>
            )}
            {rep.colors.messages.map((m) => (
              <Status key={m} level="warn">{m}</Status>
            ))}
            {rep.messages
              .filter((m) => !rep.colors.messages.includes(m) && !m.startsWith('The design is'))
              .map((m) => (
                <Status key={m} level="warn">{m}</Status>
              ))}
          </>
        ) : (
          preview.status !== 'error' && <p className="muted small">The report appears after the first preview.</p>
        )}
      </div>
    </Section>
  )
}
