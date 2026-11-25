import { useEffect, useState } from 'react'
import { cx } from './position'

const FILL: Record<string, string> = {
  accent: 'var(--grad-ember)',
  gold: 'var(--grad-solar)',
  success: 'linear-gradient(90deg, #3e9b67, var(--color-success))',
  error: 'linear-gradient(90deg, #b2404c, var(--color-error))'
}

/** A progress bar (role="progressbar"). value null/undefined = indeterminate. */
export function ProgressBar({
  value,
  label,
  tone = 'accent',
  striped,
  size = 'sm',
  showValue,
  className
}: {
  value?: number | null
  label: string
  tone?: 'accent' | 'gold' | 'success' | 'error'
  striped?: boolean
  size?: 'xs' | 'sm' | 'md'
  showValue?: boolean
  className?: string
}): JSX.Element {
  const indeterminate = value === null || value === undefined
  const pct = indeterminate ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100)
  const h = size === 'xs' ? 3 : size === 'md' ? 10 : 6
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <div
        className={cx('progress-track flex-1', striped && 'progress-striped', indeterminate && 'progress-indeterminate')}
        style={{ height: h }}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
      >
        <div
          className="progress-fill"
          style={{
            width: `${indeterminate ? 35 : pct}%`,
            ...(striped
              ? {
                  backgroundImage: `repeating-linear-gradient(45deg, rgb(255 255 255 / .12) 0 10px, transparent 10px 20px), ${FILL[tone]}`
                }
              : { background: FILL[tone] })
          }}
        />
      </div>
      {showValue && !indeterminate && <span className="text-xs text-muted tabular w-9 text-right">{pct}%</span>}
    </div>
  )
}

const RING: Record<string, string> = {
  gold: 'var(--color-gold)',
  accent: 'var(--color-accent-strong)',
  success: 'var(--color-success)',
  error: 'var(--color-error)'
}

/** A conic progress ring (`.ring` with --p). Fills from 0 on mount. */
export function ProgressRing({
  value,
  size = 40,
  stroke = 4,
  label,
  tone = 'gold',
  vtName,
  children,
  className
}: {
  value?: number | null
  size?: number
  stroke?: number
  label: string
  tone?: 'gold' | 'accent' | 'success' | 'error'
  vtName?: string
  children?: React.ReactNode
  className?: string
}): JSX.Element {
  const indeterminate = value === null || value === undefined
  const target = indeterminate ? 0.28 : Math.max(0, Math.min(1, value))
  const [p, setP] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setP(target))
    return () => cancelAnimationFrame(id)
  }, [target])
  return (
    <div
      className={cx('ui-ring', className)}
      style={{ width: size, height: size, viewTransitionName: vtName || undefined }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(target * 100)}
    >
      <div
        className={cx('ring absolute inset-0', indeterminate && 'anim-spin')}
        style={{ '--p': p, '--ring-w': `${stroke}px`, '--ring-color': RING[tone] } as React.CSSProperties}
      />
      {children !== undefined && <div className="ui-ring-inner">{children}</div>}
    </div>
  )
}

/** Numbered steps joined by a gold line that fills as you advance. */
export function StepProgress({ steps, current, className }: { steps: string[]; current: number; className?: string }): JSX.Element {
  const frac = steps.length > 1 ? Math.min(1, Math.max(0, current / (steps.length - 1))) : 0
  return (
    <ol className={cx('ui-steps', className)} style={{ '--steps-frac': frac, '--step-n': Math.max(1, steps.length) } as React.CSSProperties}>
      <span className="ui-steps-line" aria-hidden>
        <span />
      </span>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={s + i} className="ui-step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ui-step-dot">
              {state === 'done' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path className="draw" pathLength={24} d="m4.5 12.5 5 5L20 7" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="ui-step-label">{s}</span>
          </li>
        )
      })}
    </ol>
  )
}
