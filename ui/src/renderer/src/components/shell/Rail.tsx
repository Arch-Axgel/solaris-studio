import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import logo from '../../assets/solaris-studio-logo.png'
import { api } from '../../lib/api'
import { useHotkey } from '../../lib/hotkeys'
import { t } from '../../lib/i18n'
import { PAGES, navigate, openLayer, topLayer, useRoute, type Page, type PageMeta } from '../../lib/nav'
import { useModelPulls } from '../../lib/stores/activity'
import { useStudioEvents } from '../../lib/stores/eventBus'
import { useLibrary } from '../../lib/stores/library'
import { useQueueSnapshot } from '../../lib/stores/queueStore'
import { useUiPrefs } from '../../lib/uiPrefs'
import type { Preflight } from '../../lib/types'
import FeedbackHub from '../FeedbackHub'
import ModelSwitcher from '../ModelSwitcher'
import { Icon } from '../icons'
import { Kbd, Tooltip } from '../ui'

/** The icon rail (spec 3.5): logo, the New clips orb, the page groups with
 *  live badges, and a footer with feedback, the model chip and health. */

const GROUPS: PageMeta['group'][] = ['Make', 'Discover', 'System']

function useMedia(query: string): boolean {
  const get = (): boolean => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  }
  const [m, setM] = useState(get)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(query)
    } catch {
      return
    }
    const on = (): void => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}

/** Channels being watched (live dot): 30s poll plus automation events. */
function useWatching(): number {
  const [watching, setWatching] = useState(0)
  const load = useCallback((): void => {
    api
      .automation()
      .then((s) => setWatching(s.enabled ? s.watching : 0))
      .catch(() => setWatching(0))
  }, [])
  useEffect(() => {
    load()
    const id = setInterval(() => {
      if (!document.hidden) load()
    }, 30000)
    return () => clearInterval(id)
  }, [load])
  useStudioEvents((e) => {
    if (e.type === 'automation' && !('activity' in e) && !('doing' in e)) load()
  })
  return watching
}

/** Preflight once at start and every 10 minutes. */
function useHealth(): Preflight | null {
  const [pf, setPf] = useState<Preflight | null>(null)
  useEffect(() => {
    const load = (): void => {
      api
        .preflight()
        .then(setPf)
        .catch(() => setPf(null))
    }
    const first = setTimeout(load, 2500)
    const id = setInterval(load, 10 * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])
  return pf
}

function HealthDot({ expanded }: { expanded: boolean }): JSX.Element {
  const pf = useHealth()
  const bad = pf ? pf.checks.filter((c) => !c.ok) : []
  const state = !pf ? 'unknown' : bad.length === 0 ? 'ok' : 'warn'
  const label =
    state === 'unknown'
      ? t('Checking readiness…')
      : state === 'ok'
        ? t('All systems ready')
        : `${bad.length} ${bad.length === 1 ? t('thing needs attention') : t('things need attention')}`
  const btn = (
    <button
      type="button"
      className="rail-health"
      data-state={state}
      onClick={() => navigate({ page: 'storage' })}
      aria-label={`${t('Storage & health')}: ${label}`}
    >
      <span className="rail-health-dot" aria-hidden />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  )
  return expanded ? btn : <Tooltip content={label} side="right">{btn}</Tooltip>
}

function CreateOrb({ expanded }: { expanded: boolean }): JSX.Element {
  const open = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.classList.remove('orb-rippling')
    void e.currentTarget.offsetWidth
    e.currentTarget.classList.add('orb-rippling')
    openLayer('create', { originRect: rect })
  }
  const orb = (
    <button
      type="button"
      className="rail-orb border-orbit anim-breathe"
      data-tour="create"
      data-expanded={expanded ? 'true' : 'false'}
      onClick={open}
      aria-label={t('New clips')}
      aria-keyshortcuts="Control+N"
    >
      <Icon name="plus" size={22} className="rail-orb-plus" />
      {expanded && (
        <>
          <span className="rail-orb-label">{t('New clips')}</span>
          <Kbd keys={['Ctrl', 'N']} className="rail-orb-kbd" />
        </>
      )}
    </button>
  )
  return (
    <div className="rail-orb-wrap">
      {expanded ? orb : <Tooltip content={`${t('New clips')} · Ctrl+N`} side="right">{orb}</Tooltip>}
    </div>
  )
}

function NavBadge({ page }: { page: Page }): JSX.Element | null {
  return <BadgeFor page={page} />
}

function BadgeFor({ page }: { page: Page }): JSX.Element | null {
  if (page === 'queue') return <QueueBadge />
  if (page === 'studio') return <StudioBadge />
  if (page === 'models') return <ModelsBadge />
  return null
}

function QueueBadge(): JSX.Element | null {
  const { remaining, failed } = useQueueSnapshot()
  if (failed > 0)
    return (
      <span className="rail-badge rail-badge-error tabular" title={`${failed} ${t('failed')}`}>
        <span className="sr-only">{t('failed')}: </span>
        {failed}
      </span>
    )
  if (remaining === 0) return null
  return (
    <span className="rail-badge tabular anim-pop" key={remaining}>
      <span className="sr-only">{t('in queue')}: </span>
      {remaining}
    </span>
  )
}

function StudioBadge(): JSX.Element | null {
  const { unexported } = useLibrary()
  if (unexported === 0) return null
  return (
    <span className="rail-badge rail-badge-muted tabular" title={`${unexported} ${t('clips not exported yet')}`}>
      <span className="sr-only">{t('not exported')}: </span>
      {unexported > 99 ? '99+' : unexported}
    </span>
  )
}

function ModelsBadge(): JSX.Element | null {
  const pulls = useModelPulls()
  const vals = Object.values(pulls)
  if (vals.length === 0) return null
  const known = vals.filter((v): v is number => typeof v === 'number')
  const frac = known.length ? known.reduce((a, b) => a + b, 0) / vals.length : 0.15
  return (
    <span className="rail-mini-ring" title={t('Downloading a model')} aria-label={t('Downloading a model')} role="img">
      <span className="ring" style={{ '--p': frac, '--ring-w': '2.5px' } as React.CSSProperties} />
    </span>
  )
}

export default function Rail(): JSX.Element {
  const route = useRoute()
  const [prefs, setPrefs] = useUiPrefs()
  const narrow = useMedia('(max-width: 1279px)')
  const [overlay, setOverlay] = useState(false)
  const [hovering, setHovering] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watching = useWatching()

  const docked = !narrow && prefs.railPinned
  const expanded = docked || overlay || hovering
  const floating = expanded && !docked

  const toggle = useCallback((): void => {
    if (narrow) setOverlay((o) => !o)
    else {
      setHovering(false)
      setPrefs({ railPinned: !prefs.railPinned })
    }
  }, [narrow, prefs.railPinned, setPrefs])
  useHotkey('ctrl+b', toggle)

  // Close the overlay after navigating, and when the window widens.
  useEffect(() => {
    setOverlay(false)
    setHovering(false)
  }, [route.page, narrow])

  const onEnter = (): void => {
    if (!prefs.railHover || docked) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHovering(true), 350)
  }
  const onLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHovering(false)
  }

  // The sliding indicator behind the active item.
  const listRef = useRef<HTMLDivElement>(null)

  // On a short window the footer (feedback, AI model, health) pushes the last
  // pages below the fold, and with the scrollbar hidden they look missing
  // rather than scrolled away. Mark which edges have more so CSS can fade them.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<'none' | 'below' | 'above' | 'both'>('none')
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => {
      const above = el.scrollTop > 2
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2
      setMore(above && below ? 'both' : below ? 'below' : above ? 'above' : 'none')
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [])
  const [indicator, setIndicator] = useState<{ y: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const root = listRef.current
    if (!root) return
    const measure = (): void => {
      const el = root.querySelector<HTMLElement>(`[data-nav="${route.page}"]`)
      setIndicator(el ? { y: el.offsetTop, h: el.offsetHeight } : null)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(root)
    return () => ro?.disconnect()
  }, [route.page, expanded])

  // Esc closes a floating rail.
  useEffect(() => {
    if (!floating) return
    const onKey = (e: KeyboardEvent): void => {
      // Only when nothing sits on top: the shell handler marks the event when
      // it closed a layer, and modal dialogs / popovers take Esc themselves.
      if (e.key === 'Escape' && !e.defaultPrevented && !topLayer() && !document.querySelector('dialog[open]:modal, .ui-pop:popover-open')) {
        setOverlay(false)
        setHovering(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [floating])

  return (
    <>
      {floating && overlay && <div className="rail-scrim anim-fade" onClick={() => setOverlay(false)} aria-hidden />}
      <nav
        className="rail"
        aria-label={t('Main')}
        data-expanded={expanded ? 'true' : 'false'}
        data-floating={floating ? 'true' : 'false'}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div className="rail-top">
          <button type="button" className="rail-logo" onClick={() => navigate({ page: 'home' })} aria-label={t('Home')}>
            <img src={logo} alt="" width={36} height={36} />
          </button>
          {expanded && (
            <div className="rail-brand min-w-0">
              <p className="rail-brand-name text-foil">Solaris Studio</p>
              <p className="rail-brand-by">by Arch</p>
            </div>
          )}
        </div>

        <CreateOrb expanded={expanded} />

        <div ref={scrollRef} className="rail-scroll" data-more={more}>
          <div ref={listRef} className="rail-list">
            {indicator && (
              <span
                className="rail-indicator"
                aria-hidden
                style={{ transform: `translateY(${indicator.y}px)`, height: indicator.h }}
              />
            )}
            {GROUPS.map((group) => (
              <div key={group} className="rail-group" role="group" aria-label={t(group)}>
                {expanded ? <p className="t-micro rail-group-label">{t(group)}</p> : <span className="rail-group-rule" aria-hidden />}
                {PAGES.filter((p) => p.group === group).map((p) => {
                  const active = route.page === p.id
                  const item = (
                    <button
                      type="button"
                      data-nav={p.id}
                      className="rail-item"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => navigate({ page: p.id })}
                      aria-keyshortcuts={p.chord.replace(' ', ' ')}
                    >
                      <span className="rail-icon" data-fly-target={p.id === 'queue' ? 'queue' : undefined}>
                        <Icon name={p.icon} size={20} className={active ? 'icon-gold' : undefined} />
                        {p.id === 'watch' && watching > 0 && (
                          <span className="rail-live" title={`${t('Watching')} ${watching}`}>
                            <span className="sr-only">{t('Watching')}</span>
                          </span>
                        )}
                        {!expanded && <NavBadge page={p.id} />}
                      </span>
                      {expanded ? (
                        <span className="rail-text">
                          <span className="rail-label">{t(p.label)}</span>
                          <span className="rail-caption">{t(p.caption)}</span>
                        </span>
                      ) : (
                        <span className="sr-only">{t(p.label)}</span>
                      )}
                      {expanded && (
                        <span className="rail-end">
                          <NavBadge page={p.id} />
                        </span>
                      )}
                    </button>
                  )
                  return expanded ? (
                    <div key={p.id}>{item}</div>
                  ) : (
                    <Tooltip
                      key={p.id}
                      side="right"
                      content={
                        <span className="block">
                          <span className="block font-semibold text-ink">{t(p.label)}</span>
                          <span className="block text-muted text-[11px]">{t(p.caption)}</span>
                        </span>
                      }
                    >
                      {item}
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="rail-foot">
          <FeedbackHub compact={!expanded} />
          <ModelSwitcher compact={!expanded} />
          <div className="rail-foot-row">
            <HealthDot expanded={expanded} />
            <Tooltip content={expanded ? `${t('Collapse sidebar')} · Ctrl+B` : `${t('Expand sidebar')} · Ctrl+B`} side="right">
              <button
                type="button"
                className="btn-icon rail-collapse"
                onClick={toggle}
                aria-label={expanded ? t('Collapse sidebar') : t('Expand sidebar')}
                aria-expanded={expanded}
              >
                <Icon name={expanded ? 'chevron-left' : 'chevron-right'} size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </nav>
    </>
  )
}
