import { useState, useSyncExternalStore } from 'react'
import { t } from '../../lib/i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'

/** Promise-based confirm, replacing window.confirm. A module-level queue, so
 *  useConfirm() works anywhere; ConfirmProvider renders the dialog. */

export interface ConfirmOptions {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

interface Pending extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

let queue: Pending[] = []
let nextId = 1
let hostMounted = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

function ask(o: ConfirmOptions): Promise<boolean> {
  if (hostMounted === 0) {
    // No provider mounted (tests, early boot): fall back to the native prompt.
    return Promise.resolve(window.confirm(o.title))
  }
  return new Promise((resolve) => {
    queue = [...queue, { ...o, id: nextId++, resolve }]
    emit()
  })
}

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  return ask
}

/** Non-hook form, for code outside components. */
export const confirmDialog = ask

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  hostMounted++
  return () => {
    listeners.delete(cb)
    hostMounted--
  }
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const q = useSyncExternalStore(subscribe, () => queue, () => queue)
  const current = q[0]
  const [closing, setClosing] = useState<number | null>(null)

  const settle = (ok: boolean): void => {
    if (!current) return
    setClosing(current.id)
    current.resolve(ok)
    setTimeout(() => {
      queue = queue.filter((p) => p.id !== current.id)
      setClosing(null)
      emit()
    }, 180)
  }

  return (
    <>
      {children}
      {current && (
        <Dialog
          open={closing !== current.id}
          onClose={() => settle(false)}
          title={current.title}
          size="sm"
          initialFocus="[data-confirm-default]"
          footer={
            <>
              <Button variant="ghost" onClick={() => settle(false)}>
                {current.cancelLabel ?? t('Cancel')}
              </Button>
              <Button
                variant={current.tone === 'danger' ? 'danger' : 'accent'}
                icon={current.tone === 'danger' ? 'alert' : undefined}
                onClick={() => settle(true)}
                data-confirm-default={current.tone === 'danger' ? undefined : ''}
              >
                {current.confirmLabel ?? t('Confirm')}
              </Button>
            </>
          }
        >
          {current.body ? (
            <div className="text-sm text-muted leading-relaxed">{current.body}</div>
          ) : (
            <span className="sr-only">{current.title}</span>
          )}
        </Dialog>
      )}
    </>
  )
}
