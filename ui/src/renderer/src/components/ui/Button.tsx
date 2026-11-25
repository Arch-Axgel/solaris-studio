import { forwardRef, useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'
import { t } from '../../lib/i18n'
import { cx } from './position'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'accent' | 'gold' | 'ghost' | 'subtle' | 'danger'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
}

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'ui-btn-sm',
  md: 'ui-btn-md',
  lg: 'ui-btn-lg'
}

/** The shared button. Maps to the .btn-* classes, adds icons, a spinner and
 *  a click ripple. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconRight, loading, className, children, disabled, type, onPointerDown, ...rest },
  ref
) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx(`btn-${variant}`, 'ui-btn', SIZE[size], iconRight && 'nudge', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={(e) => {
        ripple(e)
        onPointerDown?.(e)
      }}
      {...rest}
    >
      {loading ? <span className="ui-spinner" aria-hidden /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children !== undefined && children !== null && <span className="ui-btn-label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </button>
  )
})

function ripple(e: React.PointerEvent<HTMLElement>): void {
  const el = e.currentTarget
  if (document.documentElement.dataset.motion === 'reduced') return
  const r = el.getBoundingClientRect()
  const dot = document.createElement('span')
  dot.className = 'ui-ripple'
  const size = Math.max(r.width, r.height)
  Object.assign(dot.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${e.clientX - r.left - size / 2}px`,
    top: `${e.clientY - r.top - size / 2}px`
  })
  el.appendChild(dot)
  setTimeout(() => dot.remove(), 600)
}

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon: IconName
  size?: 'sm' | 'md'
  active?: boolean
  badge?: number | 'dot' | null
  tone?: 'default' | 'error'
}

/** A square icon button with an accessible name, a tooltip and an optional
 *  badge (a count or a dot). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', active, badge, tone = 'default', className, type, ...rest },
  ref
) {
  const prevBadge = useRef(badge)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (typeof badge === 'number' && typeof prevBadge.current === 'number' && badge > prevBadge.current)
      setBump((b) => b + 1)
    prevBadge.current = badge
  }, [badge])
  const showBadge = badge === 'dot' || (typeof badge === 'number' && badge > 0)
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        type={type ?? 'button'}
        aria-label={label}
        data-active={active ? 'true' : undefined}
        className={cx('btn-icon', size === 'sm' && 'ui-icon-sm', tone === 'error' && 'ui-icon-error', className)}
        {...rest}
      >
        <Icon name={icon} size={size === 'sm' ? 15 : 18} />
        {showBadge && (
          <span
            key={bump}
            className={cx('ui-badge-count', badge === 'dot' && 'ui-badge-dot', bump > 0 && 'anim-pop')}
            aria-hidden
          >
            {badge === 'dot' ? '' : badge && badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    </Tooltip>
  )
})

/** Hold to confirm (destructive clears). Fills while held; releasing early
 *  cancels. Keyboard fallback: press twice within 3s. */
export function HoldButton({
  label,
  onConfirm,
  holdMs = 800,
  variant = 'danger',
  size = 'md',
  disabled
}: {
  label: string
  onConfirm: () => void
  holdMs?: number
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  disabled?: boolean
}): JSX.Element {
  const [holding, setHolding] = useState(false)
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (armTimer.current) clearTimeout(armTimer.current)
    },
    []
  )

  const start = (e: React.PointerEvent): void => {
    if (disabled || e.button !== 0) return
    fired.current = false
    setHolding(true)
    timer.current = setTimeout(() => {
      fired.current = true
      setHolding(false)
      onConfirm()
    }, holdMs)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (disabled) return
    if (armed) {
      setArmed(false)
      if (armTimer.current) clearTimeout(armTimer.current)
      onConfirm()
    } else {
      setArmed(true)
      armTimer.current = setTimeout(() => setArmed(false), 3000)
    }
  }

  return (
    <button
      type="button"
      className={cx(`btn-${variant}`, 'ui-btn', size === 'sm' ? 'ui-btn-sm' : 'ui-btn-md', 'ui-hold')}
      data-holding={holding ? 'true' : undefined}
      data-armed={armed ? 'true' : undefined}
      style={{ '--hold-ms': `${holdMs}ms` } as React.CSSProperties}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKey}
      onClick={(e) => e.preventDefault()}
      aria-label={`${label} (${t('hold to confirm')})`}
    >
      <span className="ui-hold-fill" aria-hidden />
      <span className="ui-btn-label relative">{armed ? t('Press again to confirm') : holding ? t('Keep holding…') : label}</span>
    </button>
  )
}
