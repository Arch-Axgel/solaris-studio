import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon } from './icons'

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
  const chosen = Math.max(0, options.findIndex((o) => o.id === value))

  // A click anywhere else closes it, as a native select does.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

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
    if (e.key === 'Escape' || e.key === 'Tab') {
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
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="ops-xsel-list absolute z-50 mt-1 left-0 w-full min-w-56 max-h-80 overflow-y-auto p-1"
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
        </ul>
      )}
    </div>
  )
}
