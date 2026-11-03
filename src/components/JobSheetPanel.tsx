import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { buildJobSheet } from '../lib/jobSheet'
import { knockoutSummary } from '../lib/pipeline'
import { AHTV_PRICE_DATE } from '../lib/sizing'
import { useStudio } from './studio'

export function JobSheetPanel(): ReactElement | null {
  const { source, look, preset, r, sz, preview, exp, settings } = useStudio()
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const first = exp.results[0]

  const text = useMemo(() => {
    if (!source) return ''
    const rep = first?.report ?? preview.report
    const warnings: string[] = []
    if (sz.flag.level !== 'green') warnings.push(`${sz.flag.label}: ${sz.flag.detail}`)
    if (sz.factor > 2) warnings.push(`Upscaled ${sz.factor.toFixed(1)}x: upscalers invent detail; check text and logos at 100%.`)
    if (rep) warnings.push(...rep.messages.filter((m) => !m.startsWith('Upscaled')))
    if (!sz.variant) warnings.push('Too large for a single transfer: use a gang sheet.')
    const p = r.placement
    const hoodie = r.garment.type.includes('hoodie')
    if (hoodie && (p.id === 'full-back' || p.id === 'upper-back')) warnings.push('The hood covers the top of a back print; start lower.')
    const secondary = exp.results[1]
    return buildJobSheet({
      sourceName: source.name,
      sourcePx: { w: source.image.width, h: source.image.height },
      lookText: look,
      presetName: preset?.name ?? '',
      store: r.store?.name ?? 'Custom garment',
      garment: r.garmentLabel,
      color: r.colorName,
      size: r.sel.size,
      placementLabel: p.label,
      downIn: sz.downIn,
      downNote: p.downNote,
      offsetIn: p.offsetIn,
      widthIn: first?.widthIn ?? sz.effW,
      heightIn: first?.heightIn ?? sz.heightIn,
      variant: sz.variant,
      priceDate: AHTV_PRICE_DATE,
      effectiveDpi: sz.dpi,
      dpiLabel: sz.flag.label,
      knockedOut: rep ? knockoutSummary(rep, first?.settings ?? settings, r.colorName) : 'not previewed yet',
      upscaledWith: first?.upscaledWith ?? 'not exported yet',
      warnings,
      quantity: sz.quantity,
      secondary: sz.secondary
        ? { ...sz.secondary, widthIn: secondary?.widthIn ?? sz.secondary.widthIn, heightIn: secondary?.heightIn ?? sz.secondary.heightIn }
        : undefined,
      recommendations:
        preset?.id === 'washed-pairing'
          ? ['Comfort Colors 1717 and 1745, SmartBlanks MT600 and MH700, DigiPrint acid wash, LBL 2102.']
          : preset?.recommendGarments,
    })
  }, [source, look, preset, r, sz, preview.report, first, exp.results, settings])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    setTimeout(() => setCopied('idle'), 2500)
  }

  return (
    <div className="jobsheet">
      <h3>Job sheet</h3>
      {!source ? (
        <p className="muted small">The job sheet appears once artwork is loaded.</p>
      ) : (
        <>
          <div className="actions no-print">
            <button type="button" className="btn" onClick={() => void copy()}>Copy job sheet</button>
            <button type="button" className="btn" onClick={() => window.print()}>Print job sheet</button>
            <span aria-live="polite" className="small">
              {copied === 'ok' && '✓ Copied to the clipboard'}
              {copied === 'fail' && '⚠ Copy was blocked: select the text and copy it by hand'}
            </span>
          </div>
          <pre id="job-sheet-print" className="sheet" tabIndex={0} aria-label="Job sheet text">{text}</pre>
        </>
      )}
    </div>
  )
}
