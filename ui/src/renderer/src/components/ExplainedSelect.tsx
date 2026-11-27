import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { hideTop, layerHost, placeFloating, showTop } from './ui/position'

export type Explained = { id: string; label: string; hint: string }

/** A dropdown whose options show what they do in a tooltip when hovered,
 *  so each can be read before it's picked, the way tooltips work across the
 *  app. A native select can't: its options' tooltips don't show on Windows.
 *  Labels and hints arrive translated. */
export default function ExplainedSelect({
  value,
  options,
  onChange,
  label,
  className = ''
}: {
  value: string
  options: Explained[]
  onChange: (id: string) => void
  /** The control's accessible name ("Highlights 2"). */
  label: string
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const chosen = Math.max(0, options.findIndex((o) => o.id === value))

  // A click anywhere else closes it, as a native select does.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      const t = e.target as Node
      if (root.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // The list lives in the top layer (portaled next to the anchor's dialog or
  // <body>), so scrolling cards and sheets can't clip it. It follows the
  // button while the page scrolls and closes once the button scrolls away.
  useLayoutEffect(() => {
    const el = list.current
    const b = btn.current
    if (!open || !el || !b) return
    const place = (): void => {
      const r = b.getBoundingClientRect()
      el.style.width = `${Math.max(224, Math.round(r.width))}px`
      placeFloating(r, el, 'bottom', 'start', 4)
    }
    showTop(el, 'manual')
    place()
    let raf = 0
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && el.contains(e.target)) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = b.getBoundingClientRect()
        if (r.bottom < 0 || r.top > window.innerHeight) setOpen(false)
        else place()
      })
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
      hideTop(el)
    }
  }, [open])

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = (): void => {
    setActive(chosen)
    setOpen(true)
  }
  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
  }
  const keys = (e: KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') {
      // Close only the list, not the sheet or dialog around it.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if ((e.key === 'Enter' || e.key === ' ') && options[active]) {
      e.preventDefault()
      pick(options[active].id)
    }
  }

  return (
    <div ref={root} className={`relative shrink-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        className="input ops-xsel-btn !py-2 text-left flex items-center justify-between gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        <span className="truncate">{options[chosen]?.label ?? ''}</span>
        <span aria-hidden className="ops-xsel-chev" data-open={open ? 'true' : undefined}>
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {open &&
        createPortal(
        <ul
          ref={list}
          role="listbox"
          aria-label={label}
          className="ops-xsel-list max-h-80 overflow-y-auto p-1"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              title={o.hint || undefined}
              className="ops-xsel-opt"
              data-selected={o.id === value ? 'true' : undefined}
              data-active={i === active ? 'true' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault() // keeps the focus on the button
                pick(o.id)
              }}
            >
              <span className="truncate">{o.label}</span>
              {o.id === value && <Icon name="check" size={13} className="ml-auto shrink-0" />}
            </li>
          ))}
          {/* What the highlighted option does, readable without a tooltip. */}
          {options[active]?.hint && (
            <li role="presentation" className="ops-xsel-hint" aria-hidden>
              {options[active].hint}
            </li>
          )}
        </ul>,
          layerHost(btn.current)
        )}
    </div>
  )
}
