import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../icons'
import { t } from '../../lib/i18n'
import { cx } from './position'

/** Toasts: a module-level store, so toast() works from anywhere (stores,
 *  event handlers, outside React). <Toaster/> renders the stack. */

export interface ToastOpts {
  title: string
  body?: React.ReactNode
  tone?: 'info' | 'success' | 'warn' | 'error'
  icon?: IconName
  thumbs?: string[]
  action?: { label: string; run: () => void }
  secondary?: { label: string; run: () => void }
  duration?: number
  id?: string
}

interface ToastItem extends ToastOpts {
  id: string
  createdAt: number
  leaving?: boolean
  value?: number | null
  progress?: boolean
  /** bumps when an existing toast is updated, so its timer restarts */
  rev: number
}

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const MAX = 5

function upsert(o: ToastOpts & { value?: number | null; progress?: boolean }): string {
  const id = o.id ?? `t${++seq}`
  const existing = items.find((x) => x.id === id)
  if (existing) {
    items = items.map((x) => (x.id === id ? { ...x, ...o, id, leaving: false, rev: x.rev + 1 } : x))
  } else {
    items = [...items, { ...o, id, createdAt: Date.now(), rev: 0 }]
    if (items.length > MAX) {
      const drop = items.find((x) => !x.progress && !x.leaving)
      if (drop) dismiss(drop.id)
    }
  }
  emit()
  return id
}

function dismiss(id: string): void {
  if (!items.some((x) => x.id === id && !x.leaving)) return
  items = items.map((x) => (x.id === id ? { ...x, leaving: true } : x))
  emit()
  setTimeout(() => {
    items = items.filter((x) => x.id !== id)
    emit()
  }, 320)
}

export const toast = Object.assign((o: ToastOpts): string => upsert({ ...o, progress: false, value: undefined }), {
  dismiss,
  progress: (id: string, o: ToastOpts & { value: number | null }): void => {
    upsert({ ...o, id, progress: true, duration: 0 })
  }
})

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>
}

const TONE_ICON: Record<NonNullable<ToastOpts['tone']>, IconName> = {
  info: 'info',
  success: 'check',
  warn: 'alert',
  error: 'alert'
}

function ToastCard({ item, paused }: { item: ToastItem; paused: boolean }): JSX.Element {
  const tone = item.tone ?? 'info'
  const duration = item.duration ?? (tone === 'error' ? 9000 : item.action ? 7000 : 5000)
  const remaining = useRef(duration)
  const startedAt = useRef(Date.now())
  const [, force] = useState(0)

  useEffect(() => {
    remaining.current = duration
    startedAt.current = Date.now()
    force((n) => n + 1)
  }, [item.rev, duration])

  useEffect(() => {
    if (duration === 0 || item.leaving) return
    if (paused) {
      remaining.current -= Date.now() - startedAt.current
      return
    }
    startedAt.current = Date.now()
    const id = setTimeout(() => dismiss(item.id), Math.max(400, remaining.current))
    return () => clearTimeout(id)
  }, [paused, duration, item.leaving, item.id, item.rev])

  const icon = item.icon ?? TONE_ICON[tone]
  const pct = typeof item.value === 'number' ? Math.round(Math.max(0, Math.min(1, item.value)) * 100) : null
  return (
    <div
      className={cx('toast ui-toast', `ui-toast-${tone}`)}
      data-leaving={item.leaving ? '' : undefined}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className={cx('ui-toast-icon', tone === 'success' && 'ui-toast-icon-success')} aria-hidden>
        {tone === 'success' && !item.icon ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path className="draw" pathLength={24} d="m4.5 12.5 5 5L20 7" />
          </svg>
        ) : (
          <Icon name={icon} size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink leading-snug">{item.title}</p>
        {item.body && <div className="text-xs text-muted mt-0.5 leading-relaxed">{item.body}</div>}
        {item.thumbs && item.thumbs.length > 0 && (
          <div className="ui-toast-thumbs">
            {item.thumbs.slice(0, 3).map((src, i) => (
              <img key={src + i} src={src} alt="" style={{ '--i': i } as React.CSSProperties} />
            ))}
          </div>
        )}
        {item.progress && (
          <div
            className={cx('progress-track mt-2', pct === null && 'progress-indeterminate')}
            role="progressbar"
            aria-label={item.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <div className="progress-fill" style={{ width: `${pct ?? 35}%` }} />
          </div>
        )}
        {(item.action || item.secondary) && (
          <div className="flex gap-2 mt-2.5">
            {item.action && (
              <button
                type="button"
                className="btn-accent ui-btn ui-btn-sm"
                onClick={() => {
                  item.action?.run()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </button>
            )}
            {item.secondary && (
              <button
                type="button"
                className="btn-subtle ui-btn ui-btn-sm"
                onClick={() => {
                  item.secondary?.run()
                  dismiss(item.id)
                }}
              >
                {item.secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
      <button type="button" className="btn-icon ui-icon-sm shrink-0 -mr-1 -mt-1" aria-label={t('Dismiss')} onClick={() => dismiss(item.id)}>
        <Icon name="x" size={14} />
      </button>
      {duration > 0 && !item.progress && (
        <span
          key={item.rev}
          className="ui-toast-timer"
          style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          aria-hidden
        />
      )}
    </div>
  )
}

/** The element the toaster must live in to stay visible AND clickable: the
 *  most recently opened modal <dialog> (everything outside a modal dialog is
 *  inert), else <body>. Tracked through the `open` attribute, which
 *  showModal()/close() toggle. */
function useToastHost(): [HTMLElement | null, () => void] {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const repick = useRef<() => void>(() => undefined)
  useEffect(() => {
    const stack: HTMLDialogElement[] = []
    const pick = (): void => {
      for (const d of Array.from(document.querySelectorAll('dialog[open]')) as HTMLDialogElement[])
        if (!stack.includes(d)) stack.push(d)
      for (let i = stack.length - 1; i >= 0; i--) {
        const d = stack[i]
        if (!d.isConnected || !d.open) stack.splice(i, 1)
      }
      const modal = [...stack].reverse().find((d) => {
        try {
          return d.matches(':modal')
        } catch {
          return false
        }
      })
      setHost(modal ?? document.body)
    }
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const d = r.target as HTMLDialogElement
        if (d.tagName === 'DIALOG' && d.open) {
          const i = stack.indexOf(d)
          if (i >= 0) stack.splice(i, 1)
          stack.push(d)
        }
      }
      pick()
    })
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
    pick()
    repick.current = pick
    return () => mo.disconnect()
  }, [])
  // A dialog unmounted while still open (its parent went away) never toggles
  // `open`, so the observer misses it: re-pick when the host has left the DOM.
  return [host, () => repick.current()]
}

// React 18's types don't know the popover attribute yet; React passes it on.
const POPOVER_MANUAL = { popover: 'manual' } as Record<string, string>

/** Bottom-right stack. Hovering pauses every timer. A manual popover in the
 *  top layer, so toasts show above sheets and modal dialogs (and stay
 *  clickable: it moves into the topmost modal dialog while one is open). */
export function Toaster(): JSX.Element | null {
  const list = useSyncExternalStore(subscribe, () => items, () => items)
  const [paused, setPaused] = useState(false)
  const [host, repickHost] = useToastHost()
  const ref = useRef<HTMLElement>(null)
  const empty = list.length === 0
  useLayoutEffect(() => {
    if (host && !host.isConnected) repickHost()
  })
  useLayoutEffect(() => {
    const el = ref.current as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null
    if (!el || typeof el.showPopover !== 'function') return
    try {
      if (empty) {
        if (el.matches(':popover-open')) el.hidePopover?.()
      } else if (!el.matches(':popover-open')) el.showPopover()
    } catch {
      /* detached */
    }
  }, [host, empty])
  // Publish the stack's height so an open command palette can stop short of
  // it instead of being covered (shell.css, "Toasts beside the palette").
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!el || empty) {
      root.style.removeProperty('--toast-stack-h')
      return
    }
    const set = (): void => root.style.setProperty('--toast-stack-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--toast-stack-h')
    }
  }, [host, empty])
  if (!host) return null
  return createPortal(
    <section
      ref={ref}
      {...POPOVER_MANUAL}
      className="ui-toaster"
      aria-label={t('Notifications')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {list.map((item) => (
        <ToastCard key={item.id} item={item} paused={paused} />
      ))}
    </section>,
    host
  )
}
