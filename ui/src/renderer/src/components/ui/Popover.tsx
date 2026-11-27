import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../icons'
import { cx, hideTop, layerHost, placeFloating, showTop } from './position'

/** A click-to-open panel in the top layer (popover="auto": light dismiss and
 *  Esc for free), positioned against its trigger. */
export function Popover({
  trigger,
  align = 'start',
  side = 'bottom',
  width,
  children,
  className
}: {
  trigger: (props: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean }) => React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  width?: number
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closedAt = useRef(0)
  const id = useId()

  const close = useCallback((): void => {
    setOpen(false)
  }, [])

  const onClick = useCallback((): void => {
    // A light-dismiss from pressing the trigger itself must not reopen it.
    if (Date.now() - closedAt.current < 250) return
    setOpen((o) => !o)
  }, [])

  useLayoutEffect(() => {
    const el = panel.current
    if (!el || !open) return
    showTop(el, 'auto')
    const place = (): void => {
      if (triggerRef.current) placeFloating(triggerRef.current.getBoundingClientRect(), el, side, align, 8)
    }
    place()
    const onToggle = (e: Event): void => {
      if ((e as Event & { newState?: string }).newState === 'closed') {
        closedAt.current = Date.now()
        setOpen(false)
      }
    }
    el.addEventListener('toggle', onToggle)
    window.addEventListener('resize', place)
    // Pages scroll inside .keep-page, not the window: follow the trigger
    // (capture catches every scroll container), and close once it is gone.
    let raf = 0
    const onScroll = (e: Event): void => {
      if (el.contains(e.target as Node)) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = triggerRef.current?.getBoundingClientRect()
        if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false)
        else place()
      })
    }
    window.addEventListener('scroll', onScroll, true)
    // focus the first focusable thing inside
    const first = el.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled]), button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    )
    first?.focus({ preventScroll: true })
    return () => {
      el.removeEventListener('toggle', onToggle)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(raf)
    }
  }, [open, side, align])

  useEffect(() => {
    if (open || !panel.current) return
    hideTop(panel.current)
  }, [open])

  // return focus to the trigger when the panel closes
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open && panel.current?.contains(document.activeElement ?? null)) triggerRef.current?.focus()
    if (wasOpen.current && !open && document.activeElement === document.body) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const setRef = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el
    if (el) {
      el.setAttribute('aria-haspopup', 'dialog')
      el.setAttribute('aria-controls', id)
    }
  }, [id])

  return (
    <>
      {trigger({ ref: setRef, onClick, 'aria-expanded': open })}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            className={cx('ui-popover ui-pop', className)}
            style={width ? { width } : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          layerHost(triggerRef.current)
        )}
    </>
  )
}

/** A ⋯ style menu: a Popover with role="menu" and arrow-key navigation. */
export function MenuButton({
  label,
  icon = 'more-h',
  items,
  className
}: {
  label: string
  icon?: IconName
  items: { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean }[]
  className?: string
}): JSX.Element {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % list.length
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    if (next >= 0) {
      e.preventDefault()
      list[next]?.focus()
    }
  }
  return (
    <Popover
      align="end"
      width={220}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          className={cx('btn-icon', className)}
          aria-label={label}
          title={label}
          aria-expanded={p['aria-expanded']}
          onClick={(e) => {
            e.stopPropagation()
            p.onClick()
          }}
        >
          <Icon name={icon} size={18} />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label={label} className="ui-menu" onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={cx('ui-menu-item', it.danger && 'ui-menu-danger')}
              onClick={(e) => {
                e.stopPropagation()
                close()
                it.onSelect()
              }}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
