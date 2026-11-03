import { useState } from 'react'
import type { ReactElement } from 'react'
import { AHTV_PRICE_DATE } from '../lib/sizing'
import { fmtIn } from '../lib/pipeline'
import { designClearsPocket } from './GarmentMockup'
import { Check, Section, Select, Status } from './ui'
import { useStudio } from './studio'

export function PlacementSection(): ReactElement {
  const { r, sz, pick, setWidth, resetWidth } = useStudio()
  const p = r.placement
  const type = r.garment.type
  const hoodie = type === 'hoodie' || type === 'zip-hoodie' || type === 'crop-hoodie'
  const [copied, setCopied] = useState(false)
  const width = r.sel.widthIn

  const clears = sz.downIn !== null && designClearsPocket(sz.downIn, sz.heightIn, sz.bodyLengthIn)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const v = sz.variant

  return (
    <Section id="placement" num={4} title="Placement & size" lead="The width you pick is the width of the exported file: the art plus a 0.1 in transparent margin on each side.">
      <Select label="Placement" value={r.sel.placementId} onChange={(id) => pick({ placementId: id })}>
        {r.placements.map((x) => (
          <option key={x.id} value={x.id}>{x.label}</option>
        ))}
      </Select>
      <Check label="Show all placements" checked={r.sel.showAll} onChange={(b) => pick({ showAll: b }, false)} />
      {p.oversize && (
        <Check
          label="Oversize"
          checked={r.sel.oversize}
          onChange={(b) => pick({ oversize: b })}
          hint={`Oversize: ${p.oversize.minW} to ${p.oversize.maxW} in wide, ${p.oversize.downIn} in below the collar.`}
        />
      )}
      <div className="field">
        <div className="field__row">
          <label htmlFor="w-slider">Width slider</label>
          <output className="out" htmlFor="w-slider">{fmtIn(width)} in</output>
        </div>
        <input id="w-slider" type="range" min={0.5} max={20} step={0.05} value={Math.min(20, Math.max(0.5, width))} onChange={(e) => setWidth(Number(e.target.value))} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="w-num">Print width (inches)</label>
          <input
            id="w-num"
            type="number"
            min={0.5}
            max={20}
            step={0.01}
            value={Number.isFinite(width) ? String(Math.round(width * 100) / 100) : ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(n) && n > 0) setWidth(n)
            }}
          />
        </div>
        <button type="button" className="btn" onClick={resetWidth}>Reset to suggested</button>
      </div>
      <p className="muted small">
        Suggested range for this placement: {p.minW} to {p.maxW} in wide.
      </p>

      <div aria-live="polite" className="facts">
        <dl className="kv">
          <dt>Print size</dt>
          <dd>{fmtIn(sz.effW)} × {fmtIn(sz.heightIn)} in</dd>
          <dt>Top of design</dt>
          <dd>{sz.downIn !== null ? `${fmtIn(sz.downIn)} in below the collar seam` : (p.downNote ?? 'centered in the print area')}</dd>
          <dt>Offset from centre</dt>
          <dd>{p.offsetIn === 0 ? '0 in (centred)' : `${fmtIn(p.offsetIn)} in toward the wearer's left`}</dd>
        </dl>
        {sz.capped && <Status level="info">Capped to {p.maxH} in tall: the width was reduced to keep the print within the {p.maxH} in height limit.</Status>}
        {p.notes && <p className="muted small">{p.notes}</p>}
        <p className="muted small">American HTV Supply size guide: youth full front 7 to 9 in, adult full front 9 to 12 in, left chest 3 to 4.5 in, hat front 3 to 5 in wide (3 in tall max), tote 8 to 10 in.</p>
      </div>

      {hoodie && p.id === 'hoodie-full-front' && sz.downIn !== null && (
        clears ? (
          <Status level="ok">Clears the kangaroo pocket seam.</Status>
        ) : (
          <Status level="warn">This design runs into the kangaroo pocket. Make it shorter, start it higher or choose a smaller width so it stays above the pocket seam.</Status>
        )
      )}
      {hoodie && (p.id === 'full-back' || p.id === 'upper-back') && (
        <Status level="warn">The hood covers the top of a back print; start lower.</Status>
      )}
      {p.id === 'zip-hoodie-side' && <Status level="info">Zip hoodies get split or left-chest art. Order 2 transfers for a split: one per side.</Status>}

      <div className="order" aria-live="polite">
        <h3>American HTV Supply order</h3>
        {v ? (
          <>
            <p>
              Order the <strong>{v.variant.label}</strong> variant (${v.variant.price.toFixed(2)}, prices as of {AHTV_PRICE_DATE})
              {v.rotated ? ', turned 90 degrees' : ''}.
              {sz.quantity === 2 ? ' Quantity 2 (one per side).' : ''}
            </p>
            {v.note ? (
              <>
                <p className="small">Not a listed size. Paste this in “Leave a Note for our Designers”:</p>
                <blockquote className="note">{v.note}</blockquote>
                <button type="button" className="btn btn--small" onClick={() => void copy(v.note ?? '')}>
                  {copied ? '✓ Copied' : 'Copy note'}
                </button>
              </>
            ) : (
              <p className="small">Exactly a listed size: no designer note needed.</p>
            )}
          </>
        ) : (
          <p>Too large for a single transfer: use a gang sheet.</p>
        )}
      </div>
    </Section>
  )
}
