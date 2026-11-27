import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { t } from '../../lib/i18n'
import { cx } from './position'

const SIZES = { sm: 'ui-dialog-sm', md: 'ui-dialog-md', lg: 'ui-dialog-lg', xl: 'ui-dialog-xl', full: 'ui-dialog-full' }
const EXIT_MS = 340

/** Keeps children rendered through the exit transition, and drives the
 *  native dialog's showModal()/show()/close(). */
export function useNativeDialog(
  open: boolean,
  opts: { modal?: boolean; initialFocus?: string; onCancel: () => void; dismissible?: boolean }
): { ref: React.RefObject<HTMLDialogElement>; render: boolean } {
  const ref = useRef<HTMLDialogElement>(null)
  const [render, setRender] = useState(open)
  const opener = useRef<Element | null>(null)
  const latest = useRef(opts)
  latest.current = opts
  const openRef = useRef(open)
  openRef.current = open

  useLayoutEffect(() => {
    if (open) setRender(true)
  }, [open])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement
      try {
        if (latest.current.modal === false) d.show()
        else d.showModal()
      } catch {
        d.setAttribute('open', '')
      }
      const sel = latest.current.initialFocus
      const target = sel ? d.querySelector<HTMLElement>(sel) : null
      if (target) target.focus()
      return
    }
    if (!open && d.open) {
      d.close()
      const back = opener.current as HTMLElement | null
      if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true })
      const id = setTimeout(() => setRender(false), EXIT_MS)
      return () => clearTimeout(id)
    }
    if (!open && !d.open && render) {
      const id = setTimeout(() => setRender(false), EXIT_MS)
      return () => clearTimeout(id)
    }
  }, [open, render])

  // Esc arrives as 'cancel'; keep the element under React's control.
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onCancel = (e: Event): void => {
      e.preventDefault()
      if (latest.current.dismissible !== false) latest.current.onCancel()
    }
    // Chromium can force-close a dialog whose cancel was prevented without a
    // user activation in between (close-watcher anti-abuse). If it closed
    // while React still says open, report it as a cancel (or reopen when it
    // can't be dismissed), so the state and the DOM never disagree.
    const onClose = (): void => {
      if (!openRef.current || d.open || !d.isConnected) return
      if (latest.current.dismissible !== false) latest.current.onCancel()
      else
        try {
          if (latest.current.modal === false) d.show()
          else d.showModal()
        } catch {
          /* detached */
        }
    }
    d.addEventListener('cancel', onCancel)
    d.addEventListener('close', onClose)
    return () => {
      d.removeEventListener('cancel', onCancel)
      d.removeEventListener('close', onClose)
    }
  }, [render])

  return { ref, render }
}

/** A modal dialog on the native <dialog>: focus trap, Esc, backdrop click,
 *  focus return to the opener, labelled by its title. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  dismissible = true,
  hideTitle,
  children,
  initialFocus,
  className
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  footer?: React.ReactNode
  dismissible?: boolean
  hideTitle?: boolean
  children: React.ReactNode
  initialFocus?: string
  className?: string
}): JSX.Element | null {
  const titleId = useId()
  const descId = useId()
  const { ref, render } = useNativeDialog(open, { initialFocus, onCancel: onClose, dismissible })
  const downOnBackdrop = useRef(false)
  if (!render && !open) return null
  return (
    <dialog
      ref={ref}
      className={cx('ui-dialog', SIZES[size], className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current && dismissible) onClose()
      }}
    >
      <div className="ui-dialog-body">
        <div className={cx('ui-dialog-head', hideTitle && 'sr-only')}>
          <div className="min-w-0">
            <h2 id={titleId} className="t-lg text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-sm text-muted mt-1">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button type="button" className="btn-icon shrink-0 -mr-1 -mt-1" aria-label={t('Close')} onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        {hideTitle && dismissible && (
          <button type="button" className="btn-icon ui-dialog-x" aria-label={t('Close')} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        )}
        <div className="ui-dialog-content">{children}</div>
        {footer && <div className="ui-dialog-foot">{footer}</div>}
      </div>
    </dialog>
  )
}
