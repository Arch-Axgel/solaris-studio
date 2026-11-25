import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { useLayer } from '../../lib/nav'
import { markSeen } from '../../lib/uiPrefs'
import { Icon, type IconName } from '../icons'
import { Button, Kbd } from '../ui'
import { hideTop, placeFloating, showTop, type Side } from '../ui/position'

/** The three-stop tour (spec 4.17): the New clips orb, the search, and the
 *  jobs pill / bell. Each stop rings its target in pulsing gold and puts a
 *  card next to it, positioned from getBoundingClientRect. Offered from the
 *  last What's new card and the palette; finishing or skipping is
 *  remembered. */

interface Stop {
  selector: string
  side: Side
  icon: IconName
  title: string
  body: string
  keys?: string[]
}

const STOPS: Stop[] = [
  {
    selector: '[data-tour="create"]',
    side: 'right',
    icon: 'plus',
    title: 'Start here',
    body: 'The gold orb opens New clips from any page. Paste a link or drop a file, and press Generate.',
    keys: ['Ctrl', 'N']
  },
  {
    selector: '[data-tour="palette"]',
    side: 'bottom',
    icon: 'search',
    title: 'Find anything',
    body: 'Search every page, setting, clip and creator, paste a link to start it, or run an action. End with a question mark to ask the assistant.',
    keys: ['Ctrl', 'K']
  },
  {
    selector: '[data-tour="activity"]',
    side: 'bottom',
    icon: 'bell',
    title: 'Keep an eye on things',
    body: 'Progress shows here while a video is processing. The bell keeps everything that happened: finished videos, posts and downloads.',
    keys: ['Ctrl', 'Shift', 'A']
  }
]

const PAD = 6

function visibleTarget(sel: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(sel))
  return all.find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && !el.closest('[hidden], [inert]')
  }) ?? null
}

export default function Tour(): JSX.Element | null {
  const { open, close } = useLayer('tour')
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Stops whose targets exist right now.
  const [stops, setStops] = useState<Stop[]>(STOPS)

  useEffect(() => {
    if (!open) return
    setStops(STOPS.filter((s) => visibleTarget(s.selector)))
    setStep(0)
  }, [open])

  const stop = stops[Math.min(step, stops.length - 1)]

  const measure = useCallback((): void => {
    if (!stop) return
    const el = visibleTarget(stop.selector)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [stop])

  useLayoutEffect(() => {
    if (!open) return
    const el = layerRef.current
    if (el) showTop(el, 'manual')
    measure()
    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)
    // the rail collapsing or the top bar reflowing moves targets: follow them
    const id = setInterval(measure, 400)
    return () => {
      window.removeEventListener('resize', onResize)
      clearInterval(id)
      if (el) hideTop(el)
    }
  }, [open, measure])

  // Place the card next to the ring.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!open || !card || !rect || !stop) return
    const ring = new DOMRect(rect.left - PAD, rect.top - PAD, rect.width + PAD * 2, rect.height + PAD * 2)
    placeFloating(ring, card, stop.side, stop.side === 'right' ? 'start' : 'center', 14)
  }, [open, rect, stop, step])

  useEffect(() => {
    if (open) cardRef.current?.querySelector<HTMLElement>('.lyr-tour-next')?.focus({ preventScroll: true })
  }, [open, step])

  // Nothing to point at (e.g. a tiny window): end quietly.
  useEffect(() => {
    if (open && stops.length === 0) close()
  }, [open, stops, close])

  if (!open || !stop) return null

  const finish = (): void => {
    markSeen('tour')
    close()
  }

  const last = step >= stops.length - 1

  return (
    <div ref={layerRef} className="lyr-tour" role="presentation">
      {rect && (
        <div
          className="lyr-tour-ring"
          aria-hidden
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2
          }}
        />
      )}
      <div
        ref={cardRef}
        className="lyr-tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="lyr-tour-title"
        aria-describedby="lyr-tour-body"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' && !last) setStep((s) => s + 1)
          else if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1)
        }}
      >
        <div className="lyr-tour-top">
          <span className="lyr-tour-glyph" aria-hidden key={step}>
            <Icon name={stop.icon} size={18} />
          </span>
          <span className="t-micro text-muted tabular">
            {step + 1} / {stops.length}
          </span>
          <button type="button" className="btn-icon lyr-tour-x" aria-label={t('End the tour')} onClick={finish}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="lyr-tour-copy" key={step}>
          <h2 id="lyr-tour-title" className="t-md text-ink">
            {t(stop.title)}
          </h2>
          <p id="lyr-tour-body" className="text-sm text-muted leading-relaxed">
            {t(stop.body)}
          </p>
          {stop.keys && <Kbd keys={stop.keys} />}
        </div>
        <div className="lyr-tour-foot">
          <div className="lyr-tour-dots" aria-hidden>
            {stops.map((s, n) => (
              <span key={s.selector} data-on={n === step ? 'true' : 'false'} />
            ))}
          </div>
          {step > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
              {t('Back')}
            </Button>
          )}
          {last ? (
            <Button variant="gold" size="sm" icon="check" className="lyr-tour-next" onClick={finish}>
              {t('Got it')}
            </Button>
          ) : (
            <Button variant="accent" size="sm" iconRight="arrow-right" className="lyr-tour-next" onClick={() => setStep((s) => s + 1)}>
              {t('Next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
