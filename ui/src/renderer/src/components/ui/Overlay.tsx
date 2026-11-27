import { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { PageContext } from '../../lib/stores/useVisible'
import { cx } from './position'

/** Stacking model (read before adding anything that covers the window).
 *
 *  Pages live inside `section.keep-page`, sheets inside `dialog.ui-sheet`,
 *  the Edit Bay inside an animated panel. Any of those can carry a transform,
 *  filter, backdrop-filter, contain or animation, and then a `fixed inset-0
 *  z-50` div inside them is positioned and stacked relative to THAT box, not
 *  the window: the rail and top bar paint over it, or it gets squashed into a
 *  card. Never hand-roll a full-window layer with `fixed inset-0 z-…`.
 *
 *  - Full-window modal layer (editor, plan, cheat sheet): <Overlay>. It is a
 *    native modal <dialog> (showModal), so it lives in the browser's top
 *    layer above every page, sheet and the shell, dims everything with
 *    ::backdrop, makes the rest of the app inert (focus is trapped, the page
 *    behind can't scroll or be clicked), takes Esc before any sheet or modal
 *    under it, and returns focus to the opener when it unmounts.
 *  - Titled dialog with the standard header/footer chrome: <Dialog>.
 *  - Non-modal floating bar/panel (a minimised editor, a corner widget):
 *    <FloatingLayer> (popover="manual", also top layer, but the app behind
 *    stays usable).
 *  - Anchored menus/tooltips: <Popover>, <Tooltip>.
 *
 *  Mount the layer where it logically belongs (inline, no portal): the top
 *  layer escapes every ancestor's containing block and stacking context, and
 *  staying inside an open sheet's subtree keeps it interactive (a modal
 *  dialog makes everything OUTSIDE its own subtree inert). */

/** Open overlays, oldest first; html[data-overlay] is set while any is. */
const stack: HTMLDialogElement[] = []
function markOpen(d: HTMLDialogElement): void {
  stack.push(d)
  document.documentElement.dataset.overlay = ''
}
function markClosed(d: HTMLDialogElement): void {
  const i = stack.lastIndexOf(d)
  if (i >= 0) stack.splice(i, 1)
  if (stack.length === 0) delete document.documentElement.dataset.overlay
}

export function Overlay({
  onClose,
  label,
  labelledBy,
  escCloses = true,
  backdropCloses = true,
  initialFocus,
  className,
  children
}: {
  /** Esc (when escCloses) and a click on the backdrop (when backdropCloses). */
  onClose: () => void
  /** Accessible name; or pass labelledBy with the id of the visible title. */
  label?: string
  labelledBy?: string
  /** false when the content handles Esc itself (e.g. exit fullscreen first). */
  escCloses?: boolean
  backdropCloses?: boolean
  /** CSS selector inside the overlay to focus first; default: the browser's
   *  dialog focusing steps (first focusable / [autofocus]). */
  initialFocus?: string
  /** Classes for the full-window <dialog> itself: padding, alignment. It is
   *  a flex box centred on both axes by default. */
  className?: string
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef({ onClose, escCloses })
  latest.current = { onClose, escCloses }
  const downOnBackdrop = useRef(false)
  const closingByUs = useRef(false)

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    const opener = document.activeElement as HTMLElement | null
    closingByUs.current = false
    try {
      if (!d.open) d.showModal()
    } catch {
      d.setAttribute('open', '')
    }
    markOpen(d)
    if (initialFocus) d.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true })

    const onCancel = (e: Event): void => {
      e.preventDefault()
      if (latest.current.escCloses) latest.current.onClose()
    }
    // Chromium may force-close a dialog whose cancel was already prevented
    // without a user activation in between (close-watcher anti-abuse). Keep
    // React and the DOM in step: close for real, or reopen.
    const onNativeClose = (): void => {
      if (closingByUs.current || !d.isConnected || d.open) return
      if (latest.current.escCloses) latest.current.onClose()
      else
        try {
          d.showModal()
        } catch {
          /* detached */
        }
    }
    // Esc is consumed at keydown (preventDefault cancels the browser's close
    // request). Waiting for 'cancel' is not enough: content that closes the
    // overlay from its own Esc handler unmounts it mid-dispatch, and the close
    // request would then land on the sheet or dialog underneath and close
    // that too. Skipped when focus is in a layer above this one (a confirm,
    // an open popover/menu), which takes the Esc itself.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      if (stack[stack.length - 1] !== d) return
      const a = document.activeElement
      if (a && a !== document.body && !d.contains(a)) return
      if (a && a.closest('[popover]:popover-open')) return
      e.preventDefault()
      if (latest.current.escCloses) latest.current.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    d.addEventListener('cancel', onCancel)
    d.addEventListener('close', onNativeClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      d.removeEventListener('cancel', onCancel)
      d.removeEventListener('close', onNativeClose)
      closingByUs.current = true
      if (d.open) d.close()
      markClosed(d)
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The keep-alive page holding this overlay was switched away (a toast
  // action, Back, a link): the page is `hidden`, so the dialog can't paint,
  // but a modal dialog would still make the whole app inert, with nothing on
  // screen to close. Step out of the top layer while the page is hidden and
  // come back when it shows again.
  const { active } = useContext(PageContext)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!active && d.open) {
      closingByUs.current = true
      d.close()
      markClosed(d)
    } else if (active && !d.open && closingByUs.current) {
      closingByUs.current = false
      try {
        d.showModal()
      } catch {
        d.setAttribute('open', '')
      }
      markOpen(d)
    }
  }, [active])

  return (
    <dialog
      ref={ref}
      className={cx('ui-overlay', className)}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Only a press that started AND ended on the backdrop closes: a drag
        // that began inside the panel and was released outside must not.
        if (e.target === e.currentTarget && downOnBackdrop.current && backdropCloses) latest.current.onClose()
        downOnBackdrop.current = false
      }}
    >
      {children}
    </dialog>
  )
}

/** A non-modal layer in the top layer (popover="manual"): a minimised editor
 *  bar, a corner widget. Escapes transformed ancestors like <Overlay>, but
 *  the app behind stays usable. Position it with utilities (e.g.
 *  `bottom-4 right-4`): its UA inset/margin/background are reset. */
// React 18's types don't know the popover attribute yet; React passes it on.
const POPOVER_MANUAL = { popover: 'manual' } as Record<string, string>

export function FloatingLayer({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null
    if (!el || typeof el.showPopover !== 'function') return
    try {
      el.showPopover()
    } catch {
      /* already open */
    }
    return () => {
      try {
        el.hidePopover?.()
      } catch {
        /* closed */
      }
    }
  }, [])
  return (
    <div ref={ref} {...POPOVER_MANUAL} className={cx('ui-float', className)} {...rest}>
      {children}
    </div>
  )
}
