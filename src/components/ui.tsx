import { useId } from 'react'
import type { ReactElement, ReactNode } from 'react'

export type Level = 'ok' | 'warn' | 'error' | 'info'
const ICON: Record<Level, string> = { ok: '✓', warn: '⚠', error: '✕', info: 'ℹ' }
const WORD: Record<Level, string> = { ok: 'OK: ', warn: 'Warning: ', error: 'Error: ', info: 'Note: ' }

/** Status line: icon + text, never color alone. */
export function Status(props: { level: Level; children: ReactNode; testId?: string; live?: boolean; className?: string }): ReactElement {
  return (
    <p
      className={`status status--${props.level} ${props.className ?? ''}`}
      data-testid={props.testId}
      aria-live={props.live ? 'polite' : undefined}
    >
      <span className="status__icon" aria-hidden="true">{ICON[props.level]}</span>
      <span className="sr-only">{WORD[props.level]}</span>
      <span className="status__text">{props.children}</span>
    </p>
  )
}

export function Section(props: { id: string; num: number; title: string; lead?: ReactNode; children: ReactNode }): ReactElement {
  const hid = `${props.id}-h`
  return (
    <section className="card" id={props.id} aria-labelledby={hid}>
      <h2 id={hid}>
        <span className="num" aria-hidden="true">{props.num}</span>
        {props.title}
      </h2>
      {props.lead && <p className="lead">{props.lead}</p>}
      {props.children}
    </section>
  )
}

export function Check(props: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  hint?: ReactNode
  disabled?: boolean
  name?: string
}): ReactElement {
  const hid = useId()
  return (
    <div className="check">
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          aria-describedby={props.hint ? hid : undefined}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span>{props.label}</span>
      </label>
      {props.hint && <span className="hint" id={hid}>{props.hint}</span>}
    </div>
  )
}

export function Range(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display?: string
  disabled?: boolean
  hint?: ReactNode
}): ReactElement {
  const id = useId()
  return (
    <div className="field">
      <div className="field__row">
        <label htmlFor={id}>{props.label}</label>
        <output className="out" htmlFor={id}>{props.display ?? String(props.value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function Select(props: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
  hint?: ReactNode
  disabled?: boolean
}): ReactElement {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        {props.children}
      </select>
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function Swatch(props: { hex: string; label?: string }): ReactElement {
  return (
    <span
      className="swatch"
      style={{ background: props.hex }}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    />
  )
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')
