import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusFromKeyboard, hideTop, layerHost, placeFloating, showTop, type Side } from './position'

/** Hover/focus tooltip in the top layer (popover="manual"), so it shows above
 *  modal dialogs too. 300ms delay, Esc hides, wired with aria-describedby. */
export function Tooltip({
  content,
  side = 'top',
  children
}: {
  content: React.ReactNode
  side?: Side
  children: React.ReactElement
}): JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const show = (el: HTMLElement, delay = 300): void => {
    anchor.current = el
    clear()
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = (): void => {
    clear()
    setOpen(false)
  }

  useEffect(() => {
    const el = panel.current
    if (!el) return
    if (anchor.current?.isConnected) {
      showTop(el, 'manual')
      placeFloating(anchor.current.getBoundingClientRect(), el, side, 'center', 8)
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') hide()
      }
      const onScroll = (): void => hide()
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('scroll', onScroll, true)
      return () => {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('scroll', onScroll, true)
      }
    }
    hideTop(el)
    setOpen(false)
  }, [open, side])

  useEffect(() => clear, [])

  const p = children.props as Record<string, unknown> & {
    onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave?: (e: React.MouseEvent<HTMLElement>) => void
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void
    onBlur?: (e: React.FocusEvent<HTMLElement>) => void
    onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  }
  if (content === null || content === undefined || content === '') return children

  const child = cloneElement(children, {
    'aria-describedby': open ? id : (p['aria-describedby'] as string | undefined),
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      p.onMouseEnter?.(e)
      show(e.currentTarget)
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      p.onMouseLeave?.(e)
      hide()
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      p.onFocus?.(e)
      // Keyboard focus only: a programmatic focus right after a hotkey or
      // click (e.g. a drawer focusing its close button) shows no tooltip.
      if (e.currentTarget.matches(':focus-visible') && focusFromKeyboard()) show(e.currentTarget, 150)
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      p.onBlur?.(e)
      hide()
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      p.onPointerDown?.(e)
      hide()
    }
  } as Record<string, unknown>)

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div ref={panel} id={id} role="tooltip" className="ui-tooltip ui-pop">
            {content}
          </div>,
          layerHost(anchor.current)
        )}
    </>
  )
}
