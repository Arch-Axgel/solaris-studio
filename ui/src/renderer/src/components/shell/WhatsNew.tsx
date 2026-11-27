import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n'
import { celebrate } from '../../lib/motion'
import { openLayer, topLayer, useLayer } from '../../lib/nav'
import { setupDone } from '../SetupWizard'
import { Icon, type IconName } from '../icons'
import { Button, Dialog, IconButton, Kbd } from '../ui'

/** What's new (spec 4.17): five cards, shown once on the first launch after
 *  the redesign, never before the SetupWizard has finished. Re-openable from
 *  the palette. */

const SEEN_KEY = 'solaris.ui.whatsnew.v2'

interface CardDef {
  icon: IconName
  eyebrow: string
  title: string
  body: string
  keys?: string[]
}

const CARDS: CardDef[] = [
  {
    icon: 'home',
    eyebrow: 'A new home',
    title: 'Setup now lands on Home',
    body: 'Home shows what is processing, your freshest clips and a paste box to start the next video, all on one screen.'
  },
  {
    icon: 'plus',
    eyebrow: 'Make clips from anywhere',
    title: 'New clips is a sheet, and a page',
    body: 'Press New clips at the top of the sidebar, or the keys below, on any page to paste links without leaving what you were doing. The full Create page is still in the sidebar.',
    keys: ['Ctrl', 'N']
  },
  {
    icon: 'scissors',
    eyebrow: 'One place for your library',
    title: 'Processed videos moved to the Clip Editor',
    body: 'The list of videos you have processed now sits down the side of the Clip Editor, right next to their clips.'
  },
  {
    icon: 'layers',
    eyebrow: 'Simpler queue',
    title: 'One Pause / Start toggle',
    body: 'The Queue has a single switch to pause or start it. Drag videos to change their order.'
  },
  {
    icon: 'search',
    eyebrow: 'Everything, one search away',
    title: 'Ctrl+K reaches everything',
    body: 'Jump to any page or setting, find a clip or creator by name, paste a link to start it, or run an action such as Pause queue.',
    keys: ['Ctrl', 'K']
  }
]

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function markSeenNow(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* shown again next launch at worst */
  }
}

function wizardDone(): boolean {
  try {
    return setupDone()
  } catch {
    return false
  }
}

export default function WhatsNew(): JSX.Element | null {
  const { open, close } = useLayer('whatsnew')
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<'next' | 'back'>('next')

  // Offer it once, after setup, when nothing else is open.
  useEffect(() => {
    if (seen()) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = (): void => {
      if (seen()) return
      if (wizardDone() && !topLayer() && !document.querySelector('dialog[open]:modal')) {
        openLayer('whatsnew')
        return
      }
      timer = setTimeout(check, 2500)
    }
    timer = setTimeout(check, 1800)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setI(0)
      setDir('next')
      markSeenNow()
    }
  }, [open])

  const go = (n: number): void => {
    setDir(n > i ? 'next' : 'back')
    setI(Math.max(0, Math.min(CARDS.length - 1, n)))
  }

  const card = CARDS[i]
  const last = i === CARDS.length - 1

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('What’s new in Solaris Studio')}
      hideTitle
      size="md"
      className="lyr-new"
      initialFocus=".lyr-new-next"
    >
      <div
        className="lyr-new-wrap"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(i + 1)
          else if (e.key === 'ArrowLeft') go(i - 1)
        }}
      >
        <div className="lyr-new-stage" aria-hidden>
          <div className="lyr-new-rays" />
          <span className="lyr-new-glyph" key={i} data-dir={dir}>
            <Icon name={card.icon} size={40} />
          </span>
          <span className="lyr-new-badge t-micro">{t('New')}</span>
        </div>

        {/* Every card's copy is laid out invisibly in the same cell, so the
            box is as tall as the longest card: no empty band on short cards
            and no jump in height while paging. */}
        <div className="lyr-new-copies">
          {CARDS.map((c, n) =>
            n === i ? (
              <div className="lyr-new-copy" key={`c${i}`} data-dir={dir} aria-live="polite">
                <p className="t-micro text-foil">{t(c.eyebrow)}</p>
                <h2 className="t-xl text-ink">{t(c.title)}</h2>
                <p className="text-sm text-muted leading-relaxed">{t(c.body)}</p>
                {c.keys && <Kbd keys={c.keys} className="lyr-new-kbd" />}
              </div>
            ) : (
              <div className="lyr-new-copy lyr-new-sizer" key={`s${n}`} aria-hidden>
                <p className="t-micro">{t(c.eyebrow)}</p>
                <h2 className="t-xl">{t(c.title)}</h2>
                <p className="text-sm leading-relaxed">{t(c.body)}</p>
                {c.keys && <Kbd keys={c.keys} className="lyr-new-kbd" />}
              </div>
            )
          )}
        </div>

        <div className="lyr-new-nav">
          <div className="lyr-new-dots" role="tablist" aria-label={t('Cards')}>
            {CARDS.map((c, n) => (
              <button
                key={c.title}
                type="button"
                role="tab"
                aria-selected={n === i}
                aria-label={`${n + 1} / ${CARDS.length}: ${t(c.title)}`}
                className="lyr-new-dot"
                onClick={() => go(n)}
              />
            ))}
          </div>
          <div className="lyr-new-btns">
            {!last && (
              <Button variant="subtle" size="sm" onClick={close}>
                {t('Skip')}
              </Button>
            )}
            {i > 0 && <IconButton size="sm" icon="arrow-left" label={t('Back')} onClick={() => go(i - 1)} />}
            {last ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="lyr-new-done"
                  onClick={(e) => {
                    celebrate(e.currentTarget, { count: 40 })
                    close()
                  }}
                >
                  {t('Done')}
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  icon="orbit"
                  className="lyr-new-next"
                  onClick={() => {
                    close()
                    setTimeout(() => openLayer('tour'), 380)
                  }}
                >
                  {t('Take the tour')}
                </Button>
              </>
            ) : (
              <Button variant="accent" size="sm" iconRight="arrow-right" className="lyr-new-next nudge" onClick={() => go(i + 1)}>
                {t('Next')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
