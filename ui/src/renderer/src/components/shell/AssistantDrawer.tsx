import { useCallback, useEffect, useRef, useState } from 'react'
import { helpFor } from '../../lib/help'
import { t } from '../../lib/i18n'
import { pageMeta, useLayer, useRoute } from '../../lib/nav'
import Assistant from '../Assistant'
import { Icon } from '../icons'
import { IconButton, toast } from '../ui'

/** The assistant drawer (spec 4.15): <Assistant/> unchanged, in a 440px
 *  panel on the right, with page-aware "Try:" prompts above it.
 *
 *  It is a non-modal panel rather than a modal sheet, so you can keep
 *  chatting while you look at the page, and it stays mounted once opened so
 *  the conversation survives closing it. Pinned at 1440px and wider it
 *  docks: html[data-dock="assistant"] makes the shell grid give it a column
 *  (shell.css), pushing the page over instead of covering it. */

const PIN_KEY = 'solaris.ui.assistant.pinned'

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1'
  } catch {
    return false
  }
}

function writePinned(v: boolean): void {
  try {
    localStorage.setItem(PIN_KEY, v ? '1' : '0')
  } catch {
    /* lasts this session */
  }
}

/** Put text into the Assistant's own input the way typing would, so React
 *  sees the change. Returns false when the input isn't ready (still checking
 *  the model, busy, or not set up). */
function fillInput(root: HTMLElement | null, text: string): boolean {
  const input = root?.querySelector<HTMLInputElement>('input.input')
  if (!input || input.disabled) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) return false
  setter.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus({ preventScroll: true })
  try {
    input.setSelectionRange(text.length, text.length)
  } catch {
    /* some input types refuse selection */
  }
  return true
}

export default function AssistantDrawer(): JSX.Element | null {
  const { open, payload, close } = useLayer<{ prompt?: string }>('assistant')
  const route = useRoute()
  const [mounted, setMounted] = useState(false)
  const [pinned, setPinned] = useState(readPinned)
  const [banner, setBanner] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  // Dock beside the page while open and pinned (only takes effect ≥1440px).
  useEffect(() => {
    const h = document.documentElement
    if (open && pinned) h.dataset.dock = 'assistant'
    else if (h.dataset.dock === 'assistant') delete h.dataset.dock
    return () => {
      if (h.dataset.dock === 'assistant') delete h.dataset.dock
    }
  }, [open, pinned])

  // Hidden panels stay out of the tab order and the accessibility tree.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.inert = !open
    if (open) {
      opener.current = document.activeElement as HTMLElement | null
      const id = setTimeout(() => {
        if (!el.contains(document.activeElement)) {
          const input = el.querySelector<HTMLInputElement>('input.input:not([disabled])')
          ;(input ?? el.querySelector<HTMLElement>('.lyr-asst-close'))?.focus({ preventScroll: true })
        }
      }, 60)
      return () => clearTimeout(id)
    }
    const back = opener.current
    if (back && back.isConnected && el.contains(document.activeElement)) back.focus({ preventScroll: true })
    return undefined
  }, [open, mounted])

  const fill = useCallback((text: string): boolean => {
    if (fillInput(hostRef.current, text)) {
      setBanner(null)
      return true
    }
    setBanner(text)
    return false
  }, [])

  // A prompt handed in (palette "Ask Solaris Studio", Help "Try asking").
  // The Assistant may still be checking its model, so try for a few seconds.
  useEffect(() => {
    const prompt = payload?.prompt
    if (!open || !prompt) return
    let tries = 0
    const tick = (): void => {
      if (fillInput(hostRef.current, prompt)) {
        setBanner(null)
        return
      }
      if (++tries < 15) id = setTimeout(tick, 200)
      else setBanner(prompt)
    }
    let id = setTimeout(tick, 80)
    return () => clearTimeout(id)
  }, [open, payload, mounted])

  if (!mounted) return null

  const help = helpFor(route.page)
  const page = pageMeta(route.page)

  const copyBanner = async (): Promise<void> => {
    if (!banner) return
    try {
      await navigator.clipboard.writeText(banner)
      toast({ tone: 'success', icon: 'copy', title: t('Copied. Paste it into the box below.'), duration: 2200 })
    } catch {
      toast({ tone: 'error', title: t('Couldn’t copy') })
    }
  }

  return (
    <aside
      ref={ref}
      className="lyr-assistant assistant-drawer"
      data-open={open ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : 'false'}
      aria-label={t('Ask Solaris Studio')}
      aria-hidden={!open}
    >
      <div className="lyr-asst-glow" aria-hidden />
      <header className="lyr-asst-head">
        <span className="lyr-asst-orb" aria-hidden>
          <Icon name="sparkle" size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="t-md text-ink">{t('Ask Solaris Studio')}</h2>
          <p className="text-xs text-muted truncate">{t('It plans first, and only posts when you ask it to.')}</p>
        </div>
        <div className="lyr-asst-tools">
          <IconButton
            size="sm"
            icon="pin"
            label={pinned ? t('Unpin from the side') : t('Pin beside the page')}
            active={pinned}
            onClick={() => {
              setPinned((p) => {
                writePinned(!p)
                return !p
              })
            }}
          />
          <IconButton size="sm" icon="x" label={`${t('Close')} (Esc)`} onClick={close} className="lyr-asst-close" />
        </div>
      </header>

      <div className="lyr-asst-try">
        <span className="t-micro text-muted">
          {t('Try on')} {t(page.label)}
        </span>
        <div className="lyr-asst-chips stagger" key={route.page}>
          {help.tryPrompts.map((p, i) => (
            <button
              key={p}
              type="button"
              className="lyr-chip lyr-asst-chip"
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => fill(t(p))}
            >
              <Icon name="sparkle" size={12} />
              {t(p).trim()}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div className="lyr-asst-banner anim-rise" role="status">
          <Icon name="note" size={14} />
          <span className="min-w-0 flex-1 truncate" title={banner}>
            {banner}
          </span>
          <button type="button" className="btn-subtle lyr-act-mini" onClick={() => void copyBanner()}>
            <Icon name="copy" size={13} /> {t('Copy')}
          </button>
          <button type="button" className="btn-icon" aria-label={t('Dismiss')} onClick={() => setBanner(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div ref={hostRef} className="lyr-asst-host">
        <Assistant />
      </div>
    </aside>
  )
}
