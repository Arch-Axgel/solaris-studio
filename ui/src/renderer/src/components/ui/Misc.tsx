import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../icons'
import { GLOSSARY } from '../../lib/help'
import { useHotkey } from '../../lib/hotkeys'
import { t } from '../../lib/i18n'
import { countUp as countUpText, useReducedMotion } from '../../lib/motion'
import { usePageActive } from '../../lib/stores/useVisible'
import { Popover } from './Popover'
import { cx } from './position'
import type { Tone } from './Badge'

/** Keyboard keys, e.g. <Kbd keys={['Ctrl', 'K']} />. */
export function Kbd({ keys, className }: { keys: string[]; className?: string }): JSX.Element {
  return (
    <span className={cx('ui-kbd-group', className)}>
      {keys.map((k, i) => (
        <kbd key={k + i} className="ui-kbd">
          {k}
        </kbd>
      ))}
    </span>
  )
}

function hash(seed: string | number): number {
  const s = String(seed)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** A monogram on a gradient picked from the seed (burgundy to gold). */
export function Avatar({
  seed,
  name,
  size = 32,
  src,
  className
}: {
  seed: string | number
  name: string
  size?: number
  src?: string | null
  className?: string
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  const h = hash(seed)
  const a = 330 + (h % 30) // burgundy hues
  const b = 30 + ((h >> 8) % 20) // gold hues
  const angle = (h >> 16) % 360
  const bg = `linear-gradient(${angle}deg, hsl(${a} 58% ${28 + (h % 10)}%), hsl(${b} 55% ${48 + ((h >> 4) % 12)}%))`
  return (
    <span
      className={cx('ui-avatar', className)}
      style={{ width: size, height: size, background: bg, fontSize: Math.max(10, size * 0.38) }}
      title={name}
      aria-label={name}
      role="img"
    >
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <span aria-hidden>{initials(name)}</span>}
    </span>
  )
}

/** Tiny bar chart in SVG. The last bar is highlighted. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = 'gold',
  label,
  className
}: {
  values: number[]
  width?: number
  height?: number
  tone?: 'gold' | 'accent'
  label: string
  className?: string
}): JSX.Element {
  const max = Math.max(1, ...values)
  const n = Math.max(1, values.length)
  const gap = 2
  const bw = Math.max(1, (width - gap * (n - 1)) / n)
  const color = tone === 'gold' ? 'var(--color-gold)' : 'var(--color-accent-strong)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cx('ui-spark', className)}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * (height - 2))
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={h}
            rx={Math.min(2, bw / 2)}
            fill={color}
            opacity={i === values.length - 1 ? 1 : 0.35 + (0.4 * i) / n}
            style={{ '--i': Math.min(i, 24) } as React.CSSProperties}
          />
        )
      })}
    </svg>
  )
}

const METER: Record<Tone, string> = {
  accent: 'var(--grad-ember)',
  gold: 'var(--grad-solar)',
  muted: 'var(--color-line)',
  success: 'var(--color-success)',
  warn: 'var(--color-warn)',
  error: 'var(--color-error)',
  live: 'var(--color-live)'
}

/** A small horizontal meter (role="meter"). */
export function Meter({ value, label, tone = 'gold', className }: { value: number; label: string; tone?: Tone; className?: string }): JSX.Element {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className={cx('ui-meter', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <span style={{ transform: `scaleX(${v})`, background: METER[tone] }} />
    </div>
  )
}

/** A number that counts up. Integers without a formatter use the CSS
 *  @property counter; anything else counts in JS. The aria-label always
 *  carries the final value. */
export function CountUp({ value, format, className }: { value: number; format?: (n: number) => string; className?: string }): JSX.Element {
  const reduced = useReducedMotion()
  const cssMode = !format && Number.isInteger(value)
  const [n, setN] = useState(reduced ? value : 0)
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(0)

  useEffect(() => {
    if (!cssMode) return
    const id = requestAnimationFrame(() => setN(value))
    return () => cancelAnimationFrame(id)
  }, [value, cssMode])

  useEffect(() => {
    if (cssMode || !ref.current) return
    countUpText(ref.current, prev.current, value, format)
    prev.current = value
  }, [value, cssMode, format])

  const final = format ? format(value) : value.toLocaleString()
  if (cssMode) {
    return (
      <span className={cx('tabular', className)} aria-label={final} role="text">
        <span className="count-up" style={{ '--n': n } as React.CSSProperties} aria-hidden />
      </span>
    )
  }
  return (
    <span className={cx('tabular', className)} aria-label={final} role="text">
      <span ref={ref} aria-hidden>
        {format ? format(0) : '0'}
      </span>
    </span>
  )
}

/** A labelled form field. Wires the label, hint and error to a single child
 *  control (aria-describedby / aria-invalid). */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className
}: {
  label: string
  hint?: React.ReactNode
  error?: string
  htmlFor?: string
  children: React.ReactNode
  className?: string
}): JSX.Element {
  const auto = useId()
  const controlId = htmlFor ?? `f-${auto}`
  const hintId = `${controlId}-hint`
  const errId = `${controlId}-err`
  const described = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? controlId,
        'aria-describedby': described,
        'aria-invalid': error ? true : undefined
      })
    : children
  return (
    <div className={cx('ui-field', className)}>
      <label htmlFor={controlId} className="label block mb-1.5">
        {label}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted mt-1.5 leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-error mt-1.5 flex items-center gap-1 anim-fade">
          <Icon name="alert" size={12} />
          {error}
        </p>
      )}
    </div>
  )
}

/** A search box. With `hotkey`, `/` focuses it while its page is active. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  hotkey,
  ariaLabel,
  className
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  hotkey?: boolean
  ariaLabel?: string
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const active = usePageActive()
  useHotkey(
    '/',
    () => {
      ref.current?.focus()
      ref.current?.select()
    },
    { when: Boolean(hotkey) && active }
  )
  return (
    <div className={cx('ui-search', className)}>
      <Icon name="search" size={16} className="ui-search-icon" />
      <input
        ref={ref}
        type="search"
        className="input ui-search-input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            e.stopPropagation()
            onChange('')
          }
        }}
      />
      {hotkey && !value && (
        <kbd className="ui-kbd ui-search-kbd" aria-hidden>
          /
        </kbd>
      )}
      {value && (
        <button type="button" className="btn-icon ui-icon-sm ui-search-clear" aria-label={t('Clear search')} onClick={() => onChange('')}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}

/** A glossary term: dotted underline, definition in a popover. */
export function Term({ term, children, className }: { term: string; children?: React.ReactNode; className?: string }): JSX.Element {
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === term.toLowerCase())
  const def = key ? GLOSSARY[key] : undefined
  if (!def) return <span className={className}>{children ?? term}</span>
  return (
    <Popover
      width={300}
      align="start"
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          className={cx('ui-term', className)}
          aria-expanded={p['aria-expanded']}
          onClick={(e) => {
            e.stopPropagation()
            p.onClick()
          }}
        >
          {children ?? term}
        </button>
      )}
    >
      <div className="p-1">
        <p className="t-micro mb-1">{t(key ?? term)}</p>
        <p className="text-sm text-ink leading-relaxed">{t(def)}</p>
      </div>
    </Popover>
  )
}
