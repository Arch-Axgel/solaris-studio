import { useId, useLayoutEffect, useRef } from 'react'
import { Icon } from '../icons'
import { t } from '../../lib/i18n'
import { useNativeDialog } from './Dialog'
import { cx } from './position'

/** A side (or bottom) sheet on the native <dialog>. `modal={false}` shows it
 *  docked and non-modal (the page stays usable). With `originRect` it grows
 *  out of the element that opened it (the New clips orb). */
export function Sheet({
  open,
  onClose,
  title,
  side = 'right',
  width,
  originRect,
  header,
  footer,
  modal = true,
  children,
  className
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: 'right' | 'bottom'
  width?: string
  originRect?: DOMRect | null
  header?: React.ReactNode
  footer?: React.ReactNode
  modal?: boolean
  children: React.ReactNode
  className?: string
}): JSX.Element | null {
  const titleId = useId()
  const { ref, render } = useNativeDialog(open, { modal, onCancel: onClose })
  const downOnBackdrop = useRef(false)

  // Grow from the opener: origin relative to the sheet's own box.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d || !open) return
    if (originRect) {
      const box = d.getBoundingClientRect()
      const left = box.width ? box.left : window.innerWidth - box.width
      d.style.setProperty('--origin-x', `${Math.round(originRect.left + originRect.width / 2 - left)}px`)
      d.style.setProperty('--origin-y', `${Math.round(originRect.top + originRect.height / 2 - box.top)}px`)
      d.dataset.origin = ''
    } else {
      d.style.removeProperty('--origin-x')
      d.style.removeProperty('--origin-y')
      delete d.dataset.origin
    }
  }, [open, originRect, render, ref])

  if (!render && !open) return null
  return (
    <dialog
      ref={ref}
      className={cx('ui-sheet', !modal && 'ui-sheet-docked', className)}
      data-side={side}
      aria-labelledby={titleId}
      style={side === 'right' ? ({ '--sheet-w': width ?? '440px' } as React.CSSProperties) : undefined}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (modal && e.target === e.currentTarget && downOnBackdrop.current) onClose()
      }}
    >
      <div className="ui-sheet-body">
        <div className="ui-sheet-head">
          {header ?? (
            <h2 id={titleId} className="t-lg text-ink truncate">
              {title}
            </h2>
          )}
          {header && (
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
          )}
          <button type="button" className="btn-icon shrink-0 ml-auto" aria-label={t('Close')} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="ui-sheet-content">{children}</div>
        {footer && <div className="ui-sheet-foot">{footer}</div>}
      </div>
    </dialog>
  )
}
