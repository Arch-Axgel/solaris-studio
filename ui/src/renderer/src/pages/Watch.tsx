import { motionReduced } from '../lib/motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../lib/api'
import type { AutomationStatus, StudioEvent, Watch as WatchRow } from '../lib/types'
import { useStudioEvents } from '../lib/stores/eventBus'
import { useVisible } from '../lib/stores/useVisible'
import WatchLive from '../components/watch/WatchLive'
import RadarHero from '../components/watch/RadarHero'
import AddChannelSheet from '../components/watch/AddChannelSheet'
import ChannelTile, { type TileStats } from '../components/watch/ChannelTile'
import EventsTimeline from '../components/watch/EventsTimeline'
import { refreshWatchActivity, useWatchActivity } from '../components/watch/useWatchActivity'
import { useMedia } from '../components/watch/useMedia'
import { t } from '../lib/i18n'
import { useAIStatus } from '../lib/useAIStatus'
import OpenRouterPrompt from '../components/OpenRouterPrompt'
import { Icon } from '../components/icons'
import { Button, Callout, Disclosure, EmptyState, IconButton, PageHeader, Skeleton, toast } from '../components/ui'

/** Watched channels: a creator posts, Solaris Studio clips it, nobody pastes a link.
 *
 *  Everything here is off until switched on, and each channel is its own
 *  go-ahead. The page only shows and edits; the watching itself happens in
 *  the backend (server/automation.py), which keeps going with this page
 *  closed, and, when the tray option is on, with the window closed too. */
export default function Watch({
  onOpenInStudio,
  onOpenCreator,
  active = true
}: {
  onOpenInStudio?: (videoId: string) => void
  onOpenCreator?: (creatorId: number) => void
  active?: boolean
}): JSX.Element {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const aiStatus = useAIStatus()
  const [watches, setWatches] = useState<WatchRow[] | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tray, setTray] = useState<boolean | null>(null)
  const [sheet, setSheet] = useState(false)
  // The channel just added opens its whole setup.
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const [working, setWorking] = useState<Record<number, boolean>>({})
  const [railOpen, setRailOpen] = useState(true)
  const inFlight = useRef(false)
  const visible = useVisible(active)
  const activity = useWatchActivity(visible)
  const wide = useMedia('(min-width: 1440px)')

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const [s, w] = await Promise.all([api.automation(), api.watches()])
      setStatus(s)
      setWatches(w)
      setVersion((v) => v + 1)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      inFlight.current = false
    }
  }, [])

  // First load, and a re-read whenever the page comes back into view.
  useEffect(() => {
    if (visible) void refresh()
  }, [visible, refresh])

  // Events while hidden are not lost: the visibility re-read above catches up.
  useStudioEvents((e: StudioEvent) => {
    if (!visible) return
    if (e.type === 'automation' || e.type === 'queue' || e.type === 'job') void refresh()
  })

  // Belt and braces against a dropped WebSocket, like the Queue page: a
  // watch's "checked 3 min ago" must not freeze because a socket died.
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => void refresh(), 20000)
    return () => clearInterval(id)
  }, [refresh, visible])

  // The tray option lives in the main process, which decides what closing
  // the window does. An older preload has no tray at all, so ask carefully.
  useEffect(() => {
    const bridge = window.studio?.tray
    if (!bridge) return
    bridge
      .get()
      .then((got) => setTray(got.keepInTray))
      .catch(() => setTray(null))
  }, [])

  useEffect(() => {
    if (flash === null) return
    const id = setTimeout(() => setFlash(null), 3000)
    return () => clearTimeout(id)
  }, [flash])

  const setKeepInTray = async (on: boolean): Promise<void> => {
    const bridge = window.studio?.tray
    if (!bridge) return
    const got = await bridge.set(on)
    setTray(got.keepInTray)
  }

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
      refreshWatchActivity(0)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** One at a time, so the engine is never asked to look at every channel
   *  in the same second. */
  const checkAll = async (): Promise<void> => {
    const list = (watches ?? []).filter((w) => w.enabled)
    if (list.length === 0) return
    setChecking(true)
    let ok = 0
    for (const w of list) {
      try {
        await api.checkWatch(w.id)
        ok += 1
      } catch {
        /* counted below */
      }
    }
    setChecking(false)
    void refresh()
    refreshWatchActivity(0)
    toast(
      ok === list.length
        ? { title: t('Checking every channel'), body: `${ok} ${ok === 1 ? t('channel') : t('channels')}`, tone: 'success', icon: 'radar' }
        : { title: t('Some channels could not be checked'), body: `${ok} / ${list.length}`, tone: 'warn', icon: 'radar' }
    )
  }

  const onStats = useCallback((id: number, s: TileStats) => {
    setWorking((w) => (Boolean(w[id]) === s.working ? w : { ...w, [id]: s.working }))
  }, [])

  const focusWatch = (id: number): void => {
    document.querySelector(`[data-watch="${id}"]`)?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
    setFlash(id)
  }

  // The use case cloud AI exists for: a small always-on machine. Only the AI
  // moves; watching, downloading, clipping and publishing stay on this PC.
  const aiChip = (() => {
    if (!aiStatus) return null
    if (aiStatus.active.local) {
      return (
        <Disclosure
          className="ops-ai"
          summary={
            <span className="ops-ai-chip">
              <Icon name="cpu" size={13} />
              {t('AI runs on this PC')}
              <span className="text-muted">· {t('Running Solaris Studio on a small, always-on PC?')}</span>
            </span>
          }
        >
          <OpenRouterPrompt
            prominent
            title={t('Running Solaris Studio on a small, always-on PC?')}
            body={t(
              'Use OpenRouter with your own key: the AI runs in the cloud, while this PC watches, downloads, clips and publishes. Billed by OpenRouter to your account.'
            )}
          />
        </Disclosure>
      )
    }
    // A plan signed in to (ChatGPT) only runs unattended jobs once the user
    // has allowed it in Settings → AI; say so here, where a watch would
    // otherwise just fail.
    const plan = aiStatus.signin?.find((s) => s.id === aiStatus.active.provider)
    const label =
      plan?.label ??
      aiStatus.providers.find((p) => p.id === aiStatus.active.provider)?.label ??
      aiStatus.active.provider
    const blocked = Boolean(plan && !plan.automation_allowed)
    return (
      <Disclosure
        className="ops-ai"
        defaultOpen={blocked}
        summary={
          <span className="ops-ai-chip" data-tone={blocked ? 'warn' : undefined}>
            <Icon name={blocked ? 'alert' : 'sparkle'} size={13} />
            {t('AI')}: {label}
          </span>
        }
      >
        <div className="space-y-1">
          <p className="text-xs text-muted">
            {t('AI')}:{' '}
            <span className="text-ink">
              {label} · {aiStatus.active.model}
            </span>{' '}
            ({plan ? t('your plan') : t('your own key')})
          </p>
          {blocked && (
            <p className="text-xs text-warn">
              ⚠{' '}
              {t(
                "Watched channels won't use your ChatGPT plan until you allow it in Settings → AI. Videos you clip yourself still use it."
              )}
            </p>
          )}
        </div>
      </Disclosure>
    )
  })()

  const grid = (
    <div className="ops-channels">
      <button type="button" className="ops-add-tile lift" data-tour="watch-add" onClick={() => setSheet(true)}>
        <span className="ops-add-orb" aria-hidden>
          <Icon name="plus" size={22} />
        </span>
        <span className="t-md text-ink">{t('+ Watch a channel')}</span>
        <span className="text-xs text-muted max-w-56 text-center">
          {t('YouTube, Twitch or Kick. New videos are clipped as they appear.')}
        </span>
      </button>
      {watches &&
        status &&
        watches.map((w, i) => (
          <div key={w.id} className="ops-channel-cell anim-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <ChannelTile
              watch={w}
              automation={status}
              version={version}
              onChanged={() => void refresh()}
              onOpenInStudio={onOpenInStudio}
              onOpenCreator={onOpenCreator}
              openSetup={w.id === justAdded}
              flash={w.id === flash}
              onStats={onStats}
            />
          </div>
        ))}
      {!watches && !error && (
        <>
          <Skeleton h={260} radius={16} />
          <Skeleton h={260} radius={16} />
        </>
      )}
    </div>
  )

  return (
    <div className="ops-page max-w-[1600px] mx-auto p-6 space-y-5 w-full">
      <PageHeader
        eyebrow={t('Make')}
        icon="radar"
        title={t('Watched channels')}
        vtName="page-title"
        subtitle={t('When a channel posts, Solaris Studio clips the new video and publishes the clips the way you set it up.')}
        actions={
          <Button variant="gold" icon="plus" onClick={() => setSheet(true)}>
            {t('Watch a channel')}
          </Button>
        }
      />

      {error && (
        <Callout tone="error" title={t('Something went wrong')} onDismiss={() => setError(null)}>
          {error}
        </Callout>
      )}

      <RadarHero
        status={status}
        watches={watches}
        activity={activity}
        working={working}
        busy={busy}
        checking={checking}
        tray={tray}
        onEnabled={(on) => void act(() => api.setAutomation({ enabled: on }))}
        onDeleteSources={(on) => void act(() => api.setAutomation({ delete_sources: on }))}
        onTray={(on) => void setKeepInTray(on)}
        onCheckAll={() => void checkAll()}
        onPick={focusWatch}
      />

      <div className="flex items-start gap-3 flex-wrap">{aiChip}</div>

      <WatchLive visible={visible} />

      {watches && status && watches.length === 0 && (
        <div className="card ops-empty">
          <EmptyState
            illustration="radar"
            title={t('No channels yet.')}
            body={t('Add a channel and Solaris Studio clips every new video it posts, even while you are away.')}
            action={
              <Button variant="gold" icon="plus" onClick={() => setSheet(true)}>
                {t('Watch a channel')}
              </Button>
            }
          />
        </div>
      )}

      {wide ? (
        <div className="ops-watch-layout" data-rail={railOpen ? 'open' : 'closed'}>
          <div className="min-w-0">{grid}</div>
          <aside className="ops-events-rail" aria-label={t('Recent activity')}>
            <div className="ops-events-head">
              {railOpen && (
                <span className="t-micro text-gold inline-flex items-center gap-1.5">
                  <Icon name="clock" size={13} />
                  {t('Recent activity')}
                </span>
              )}
              <IconButton
                size="sm"
                icon={railOpen ? 'chevron-right' : 'chevron-left'}
                label={railOpen ? t('Hide activity') : t('Show activity')}
                className="ml-auto"
                onClick={() => setRailOpen((o) => !o)}
              />
            </div>
            {railOpen && (
              <div className="ops-events-body anim-fade">
                <EventsTimeline activity={activity} />
              </div>
            )}
          </aside>
        </div>
      ) : (
        <>
          {grid}
          <div className="card">
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-2 t-micro text-gold">
                  <Icon name="clock" size={13} />
                  {t('Recent activity')}
                  {activity && activity.events.length > 0 && (
                    <span className="ops-lane-count tabular">{Math.min(activity.events.length, 30)}</span>
                  )}
                </span>
              }
            >
              <EventsTimeline activity={activity} />
            </Disclosure>
          </div>
        </>
      )}

      <AddChannelSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onAdded={(id) => {
          setSheet(false)
          setJustAdded(id)
          setFlash(id)
          toast({ title: t('Channel added'), body: t('Set it up now. Nothing is clipped until the channel posts something new.'), tone: 'success', icon: 'radar' })
          void refresh()
        }}
      />
    </div>
  )
}
