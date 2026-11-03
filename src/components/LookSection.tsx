import type { ReactElement } from 'react'
import { PRESETS, UNSUPPORTED_NOTE, mentionsUnsupported, suggestPreset } from '../lib/presets'
import { Section, Select, Status } from './ui'
import { useStudio } from './studio'

export function LookSection(): ReactElement {
  const { look, setLook, preset, applyPreset } = useStudio()
  const suggestion = suggestPreset(look)
  const unsupported = mentionsUnsupported(look)
  return (
    <Section id="look" num={2} title="Look" lead="Optional. The text goes on the job sheet and picks a starting preset by keyword. Every toggle stays editable.">
      <div className="field">
        <label htmlFor="look-text">What look are you going for?</label>
        <textarea id="look-text" rows={3} value={look} onChange={(e) => setLook(e.target.value)} placeholder="e.g. cracked black-metal skull, faded like an old tour tee" />
      </div>
      <div aria-live="polite">
        {suggestion && suggestion.preset.id !== preset?.id && (
          <p className="suggest">
            Suggested preset: <strong>{suggestion.preset.name}</strong> (matched: {suggestion.matched.join(', ')}){' '}
            <button type="button" className="btn btn--small" onClick={() => applyPreset(suggestion.preset.id)}>
              Apply
            </button>
          </p>
        )}
      </div>
      <Select label="Aesthetic preset" value={preset?.id ?? ''} onChange={applyPreset}>
        <option value="">None</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
      <Status level={unsupported ? 'warn' : 'info'} className={unsupported ? 'status--strong' : ''}>
        {UNSUPPORTED_NOTE}
      </Status>
      {preset && (
        <div className="preset-card">
          <p>{preset.description}</p>
          <p className="muted">Inspired by: {preset.inspiredBy}</p>
          {preset.recommendColors && preset.recommendColors.length > 0 && <p className="muted">Recommended colors: {preset.recommendColors.join(', ')}</p>}
          {preset.recommendGarments && preset.recommendGarments.length > 0 && <p className="muted">Recommended garments: {preset.recommendGarments.join(', ')}</p>}
        </div>
      )}
    </Section>
  )
}
