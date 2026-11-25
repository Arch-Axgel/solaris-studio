import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'
import { cx } from './position'

export interface TabItem {
  id: string
  label: string
  icon?: IconName
  badge?: number | string
}

/** Measures the selected child so a single indicator can slide to it. */
function useIndicator(value: string, items: TabItem[]): [React.RefObject<HTMLDivElement>, React.CSSProperties] {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 })
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = (): void => {
      const el = root.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(value)}"]`)
      if (!el) {
        setStyle({ opacity: 0 })
        return
      }
      setStyle({ width: el.offsetWidth, transform: `translateX(${el.offsetLeft}px)`, opacity: 1 })
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(root)
    return () => ro?.disconnect()
  }, [value, items])
  return [ref, style]
}

function onArrows(e: React.KeyboardEvent<HTMLDivElement>, items: TabItem[], value: string, onChange: (id: string) => void): void {
  const i = items.findIndex((x) => x.id === value)
  let next = -1
  if (e.key === 'ArrowRight') next = (i + 1) % items.length
  else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  if (next < 0) return
  e.preventDefault()
  onChange(items[next].id)
  const btn = e.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(items[next].id)}"]`)
  btn?.focus()
}

/** Tabs (role="tablist") with a sliding underline or pill. */
export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  variant = 'underline',
  className
}: {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
  variant?: 'underline' | 'pill'
  className?: string
}): JSX.Element {
  const [ref, style] = useIndicator(value, items)
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={cx('ui-tabs', `ui-tabs-${variant}`, className)}
      onKeyDown={(e) => onArrows(e, items, value, onChange)}
    >
      <span className="ui-tabs-indicator" style={style} aria-hidden />
      {items.map((it) => {
        const sel = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            data-tab-id={it.id}
            aria-selected={sel}
            tabIndex={sel ? 0 : -1}
            className="ui-tab"
            onClick={() => onChange(it.id)}
          >
            {it.icon && <Icon name={it.icon} size={15} />}
            <span>{it.label}</span>
            {it.badge !== undefined && it.badge !== 0 && it.badge !== '' && <span className="ui-tab-badge tabular">{it.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** A segmented control (radiogroup) with a sliding thumb. */
export function Segmented({
  items,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className
}: {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}): JSX.Element {
  const [ref, style] = useIndicator(value, items)
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('ui-seg', `ui-seg-${size}`, className)}
      onKeyDown={(e) => onArrows(e, items, value, onChange)}
    >
      <span className="ui-seg-thumb" style={style} aria-hidden />
      {items.map((it) => {
        const sel = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            data-tab-id={it.id}
            aria-checked={sel}
            tabIndex={sel ? 0 : -1}
            className="ui-seg-item"
            onClick={() => onChange(it.id)}
          >
            {it.icon && <Icon name={it.icon} size={14} />}
            <span>{it.label}</span>
            {it.badge !== undefined && it.badge !== 0 && it.badge !== '' && <span className="ui-tab-badge tabular">{it.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
