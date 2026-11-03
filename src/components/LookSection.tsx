import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { PRESETS, UNSUPPORTED_NOTE, mentionsUnsupported } from '../lib/presets'
import { Section, Select, Status } from './ui'
import { useStudio } from './studio'

const EXAMPLES = [
  'Horror art where the black becomes the shirt',
  'Faded vintage tour tee, lightly cracked',
  'Clean 2-color logo for the left chest',
  'Photo as halftone dots fading out at the bottom',
  'Bold sticker look with a white outline',
]

export function LookSection(): ReactElement {
  const { source, look, setLook, preset, applyPreset, applyLook, undoLook, lookResult } = useStudio()
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const unsupported = mentionsUnsupported(look)
  const ready = !!source

  const apply = () => {
    if (!ready) return
    setError(applyLook())
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      apply()
    }
  }
  const plan = lookResult?.plan

  return (
    <Section
      id="look"
      num={2}
      title="Describe the look"
      next={ready && !lookResult}
      lead="Write the aesthetic you want in your own words. The app reads your text and your image, sets up the knockout, texture, size and upscaler for you, and explains what it did. Every control below stays editable."
    >
      <div className="field">
        <label htmlFor="look-text">Describe the look you want</label>
        <textarea
          id="look-text"
          ref={textRef}
          rows={3}
          value={look}
          disabled={!ready}
          aria-describedby="look-hint"
          onChange={(e) => setLook(e.target.value)}
          onKeyDown={onKey}
          placeholder="e.g. faded vintage tour tee on a black shirt, lightly cracked"
        />
        <span className="hint" id="look-hint">
          {ready ? 'Press Ctrl+Enter (Cmd+Enter on Mac) to apply.' : 'Upload your artwork first, then describe the look.'}
        </span>
      </div>
      <div className="chips" role="group" aria-label="Example prompts">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" disabled={!ready} onClick={() => setLook(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <p>
        <button type="button" className="btn btn--primary" disabled={!ready} onClick={apply}>
          Apply look
        </button>
      </p>

      <div aria-live="polite">
        {error && <Status level="error">{error}</Status>}
        {plan && lookResult && (
          <div className="result-card">
            <h3>What I applied</h3>
            <ul className="bullets">
              {plan.explanation.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <h3>Tips to tweak</h3>
            <ul className="bullets">
              {plan.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            {plan.warnings.map((w, i) => (
              <Status key={i} level="warn">{w}</Status>
            ))}
            {plan.matched.length > 0 && <p className="muted small">Recognised: {plan.matched.join(', ')}</p>}
            {lookResult.adjusted && <p className="muted small">You've adjusted settings since applying this look.</p>}
            <div className="row">
              <button type="button" className="btn btn--small" onClick={() => { setError(null); undoLook() }}>
                Undo look
              </button>
              <button type="button" className="btn btn--small" onClick={() => textRef.current?.focus()}>
                Edit prompt
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="lead lead--preset">Or start from a preset:</p>
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
