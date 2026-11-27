import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, openSettings, useBreadcrumbs, useRoute } from '../lib/nav'
import { useLibrary } from '../lib/stores/library'
import { useStudioEvents } from '../lib/stores/eventBus'
import { useVisible } from '../lib/stores/useVisible'
import { platformLabel } from '../lib/uploadpost'
import {
  addDays,
  dayKey,
  loadCalendar,
  monthGrid,
  sameDay,
  startOfDay,
  startOfWeek,
  type CalData,
  type CalEvent,
  type CalState
} from '../lib/calendarData'
import { Icon, type IconName } from '../components/icons'
import { Button, Card, EmptyState, IconButton, PageHeader, Segmented, Skeleton, StatusChip, toast } from '../components/ui'
import ScheduleView from '../components/ScheduleView'

/** Schedule (spec 4.8): what goes out when, across every publishing route,
 *  with the next free posting slots drawn as gold ghosts. Read-only: there
 *  is no endpoint to move a post, so nothing here drags. */

type View = 'week' | 'month'

// The whole day: free slots and posts land at any hour (a 23:45 slot is
// followed by 00:45, 01:45…), and clamping them to a 06:00 start stacked
// every early-morning post on top of each other at the grid's top edge.
const HOUR_START = 0
const HOUR_END = 24
const HOUR_PX = 52

const STATE_CHIP: Record<CalState, { status: 'scheduled' | 'running' | 'failed' | 'posted'; label: string }> = {
  scheduled: { status: 'scheduled', label: 'Scheduled' },
  uploading: { status: 'running', label: 'Uploading' },
  failed: { status: 'failed', label: 'Failed' },
  posted: { status: 'posted', label: 'Posted' }
}

const STATE_ICON: Record<CalState, IconName> = { scheduled: 'calendar', uploading: 'upload', failed: 'alert', posted: 'check' }

function platformIcon(p: string): IconName {
  if (p === 'youtube') return 'youtube'
  if (p === 'twitch') return 'twitch'
  if (p === 'kick') return 'kick'
  if (p === 'clip') return 'scissors'
  return 'send'
}

function platformName(p: string): string {
  return p === 'clip' ? t('Clip Editor') : platformLabel(p)
}

// One clock for the whole page, the user's locale's (Intl, no locale given):
// the hour axis and the event pills read 9 AM / 9:30 AM, or 09:00 / 09:30.
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const TWELVE_HOUR = ((): boolean => {
  const o = TIME_FMT.resolvedOptions()
  return o.hour12 ?? (o.hourCycle === 'h11' || o.hourCycle === 'h12')
})()
// On the axis a 12-hour clock drops the ":00" ("9 AM"); a 24-hour one keeps
// it, since a bare "09" doesn't read as a time.
const AXIS_FMT = TWELVE_HOUR ? new Intl.DateTimeFormat(undefined, { hour: 'numeric' }) : TIME_FMT
const timeFmt = (d: Date): string => TIME_FMT.format(d)
const axisHour = (h: number): string => AXIS_FMT.format(new Date(2000, 0, 1, h))
const dayFmt = (d: Date): string => d.toLocaleDateString([], { weekday: 'short' })
const longDay = (d: Date): string => d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

function relative(d: Date, now: number): string {
  const diff = d.getTime() - now
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const fmt = (n: number, unit: string): string => (diff >= 0 ? `${t('in')} ${n}${unit}` : `${n}${unit} ${t('ago')}`)
  if (mins < 60) return fmt(Math.max(1, mins), 'm')
  const hours = Math.round(mins / 60)
  if (hours < 48) return fmt(hours, 'h')
  return fmt(Math.round(hours / 24), 'd')
}

function Poster({ src, size = 24 }: { src?: string; size?: number }): JSX.Element {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <span className="sys-cal-poster sys-cal-poster-empty" style={{ width: size * 0.5625, height: size }} aria-hidden>
        <Icon name="film" size={Math.round(size * 0.45)} />
      </span>
    )
  return (
    <img
      className="sys-cal-poster"
      src={src}
      alt=""
      loading="lazy"
      style={{ width: size * 0.5625, height: size }}
      onError={() => setBroken(true)}
    />
  )
}

function Chip({
  ev,
  compact,
  onOpen,
  style
}: {
  ev: CalEvent
  compact?: boolean
  onOpen: (ev: CalEvent) => void
  style?: React.CSSProperties
}): JSX.Element {
  const chip = STATE_CHIP[ev.state]
  return (
    <button
      type="button"
      className={`sys-cal-chip press ${compact ? 'sys-cal-chip-compact' : ''}`}
      data-state={ev.state}
      style={style}
      title={`${ev.title} · ${platformName(ev.platform)} · ${timeFmt(ev.when)} · ${t(chip.label)}${ev.error ? ` · ${ev.error}` : ''}`}
      onClick={() => onOpen(ev)}
    >
      {compact ? (
        <>
          <span className="sys-cal-chip-icon" aria-hidden>
            <Icon name={platformIcon(ev.platform)} size={12} />
          </span>
          <span className="sys-cal-chip-title min-w-0 flex-1 text-left">{ev.title}</span>
          <Icon name={STATE_ICON[ev.state]} size={11} className="sys-cal-chip-state" />
          <span className="sr-only">{t(chip.label)}</span>
        </>
      ) : (
        <>
          <Poster src={ev.poster} />
          <span className="min-w-0 flex-1 text-left">
            <span className="sys-cal-chip-top">
              <span className="sys-cal-chip-icon" aria-hidden>
                <Icon name={platformIcon(ev.platform)} size={11} />
              </span>
              <span className="sys-cal-chip-time tabular">{timeFmt(ev.when)}</span>
              <StatusChip status={chip.status} label={t(chip.label)} className="sys-cal-chip-badge" />
            </span>
            <span className="sys-cal-chip-title">{ev.title}</span>
          </span>
        </>
      )}
    </button>
  )
}

function SlotGhost({
  when,
  style,
  short,
  onClick
}: {
  when: Date
  style?: React.CSSProperties
  /** Too little height for two lines: show the time only. */
  short?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="sys-cal-ghost"
      data-short={short || undefined}
      style={style}
      onClick={onClick}
      title={`${t('Free slot')} · ${timeFmt(when)}. ${t('A free posting slot. Schedule a clip from the Clip Editor.')}`}
      aria-label={`${t('Free slot')} · ${timeFmt(when)}`}
    >
      <span className="sys-cal-ghost-time tabular">
        <Icon name="plus" size={11} />
        {timeFmt(when)}
      </span>
      {!short && <span className="sys-cal-ghost-label">{t('Free slot')}</span>}
    </button>
  )
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function WeekView({
  anchor,
  data,
  now,
  onOpen,
  onSlot
}: {
  anchor: Date
  data: CalData
  now: number
  onOpen: (ev: CalEvent) => void
  onSlot: () => void
}): JSX.Element {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)
  const scroller = useRef<HTMLDivElement>(null)
  const today = new Date(now)

  // Open on the current hour (or the first event of the week).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const h = Math.max(HOUR_START, Math.min(HOUR_END - 3, today.getHours() - 1))
    // A little above the hour line, so its label is not cut by the top edge.
    el.scrollTo({ top: Math.max(0, (h - HOUR_START) * HOUR_PX - 10), behavior: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey(start)])

  const top = (d: Date): number => {
    const h = d.getHours() + d.getMinutes() / 60
    return Math.max(0, (h - HOUR_START) * HOUR_PX)
  }
  const gridH = hours.length * HOUR_PX
  // A ghost is an hour tall, less a gap, but never hangs past midnight: a
  // 23:45 slot gets the room left in the day and moves up if that is too short.
  const ghostBox = (d: Date): { top: number; height: number } => {
    const y = top(d)
    const height = Math.max(22, Math.min(HOUR_PX - 8, gridH - y - 3))
    return { top: Math.min(y, gridH - height - 3), height }
  }

  return (
    <div className="sys-cal-week anim-fade" key={dayKey(start)}>
      <div className="sys-cal-week-head">
        <span />
        {days.map((d) => {
          const isToday = sameDay(d, today)
          const count = data.events.filter((e) => sameDay(e.when, d)).length
          return (
            <div key={dayKey(d)} className="sys-cal-dayhead" data-today={isToday || undefined}>
              <span className="t-micro">{dayFmt(d)}</span>
              <span className="sys-cal-daynum tabular">{d.getDate()}</span>
              {count > 0 && <span className="sys-cal-daycount tabular">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="sys-cal-week-body" ref={scroller}>
        <div className="sys-cal-week-grid" style={{ height: gridH }}>
          <div className="sys-cal-hours" aria-hidden>
            {hours.map((h) => (
              <span key={h} style={{ top: (h - HOUR_START) * HOUR_PX }}>
                {axisHour(h)}
              </span>
            ))}
          </div>
          {days.map((d, col) => {
            const evs = data.events.filter((e) => sameDay(e.when, d))
            const slots = data.slots.filter((s) => sameDay(s, d))
            const isToday = sameDay(d, today)
            // side-by-side for chips that start within the same half hour
            const lanes: number[] = []
            const laneOf = evs.map((e, i) => {
              const prev = evs.slice(0, i).filter((p) => Math.abs(p.when.getTime() - e.when.getTime()) < 30 * 60000)
              const lane = prev.length
              lanes[i] = lane
              return lane
            })
            return (
              <div key={dayKey(d)} className="sys-cal-col" data-today={isToday || undefined} style={{ gridColumn: col + 2 }}>
                {hours.map((h) => (
                  <span key={h} className="sys-cal-line" style={{ top: (h - HOUR_START) * HOUR_PX }} aria-hidden />
                ))}
                {slots.map((s) => {
                  const box = ghostBox(s)
                  return <SlotGhost key={s.toISOString()} when={s} onClick={onSlot} short={box.height < 34} style={box} />
                })}
                {evs.map((e, i) => (
                  <Chip
                    key={e.id}
                    ev={e}
                    onOpen={onOpen}
                    style={{
                      position: 'absolute',
                      top: top(e.when) + 2,
                      left: `calc(4px + ${laneOf[i] * 14}px)`,
                      right: 4,
                      zIndex: 2 + lanes[i],
                      animationDelay: `${Math.min(i, 8) * 40}ms`
                    }}
                  />
                ))}
                {isToday && (
                  <span className="sys-cal-now" style={{ top: top(today) }} aria-label={t('Now')}>
                    <span className="sys-cal-now-dot" />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthView({
  anchor,
  data,
  now,
  onOpen,
  onDay
}: {
  anchor: Date
  data: CalData
  now: number
  onOpen: (ev: CalEvent) => void
  onDay: (d: Date) => void
}): JSX.Element {
  const days = monthGrid(anchor)
  const today = new Date(now)
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of data.events) {
      const k = dayKey(e.when)
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [data.events])
  const slotDays = useMemo(() => new Set(data.slots.map(dayKey)), [data.slots])
  const heads = days.slice(0, 7)
  return (
    <div className="sys-cal-month anim-fade" key={`${anchor.getFullYear()}-${anchor.getMonth()}`}>
      {heads.map((d) => (
        <div key={`h${d.getDay()}`} className="sys-cal-month-head t-micro">
          {dayFmt(d)}
        </div>
      ))}
      {days.map((d, i) => {
        const evs = byDay.get(dayKey(d)) ?? []
        const out = d.getMonth() !== anchor.getMonth()
        const isToday = sameDay(d, today)
        return (
          <div
            key={dayKey(d)}
            className="sys-cal-cell"
            data-out={out || undefined}
            data-today={isToday || undefined}
            style={{ animationDelay: `${Math.min(i, 41) * 8}ms` }}
          >
            <button type="button" className="sys-cal-cell-num tabular" onClick={() => onDay(d)} aria-label={longDay(d)}>
              {d.getDate()}
            </button>
            {slotDays.has(dayKey(d)) && (
              <span className="sys-cal-slotdot" title={t('Free slot')} aria-label={t('Free slot')} role="img" />
            )}
            <div className="sys-cal-cell-list">
              {evs.slice(0, 3).map((e) => (
                <Chip key={e.id} ev={e} compact onOpen={onOpen} />
              ))}
              {evs.length > 3 && (
                <button type="button" className="sys-cal-more" onClick={() => onDay(d)}>
                  +{evs.length - 3} {t('more')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Calendar({
  active = true,
  onOpenInStudio
}: {
  active?: boolean
  onOpenInStudio?: (videoId: string, clipId?: number) => void
} = {}): JSX.Element {
  const route = useRoute()
  const view: View = route.page === 'calendar' && route.params?.view === 'month' ? 'month' : 'week'
  const setView = (v: string): void => navigate({ page: 'calendar', params: { view: v } }, { replace: true, instant: true })
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [data, setData] = useState<CalData | null>(null)
  const [loading, setLoading] = useState(false)
  const [full, setFull] = useState(false)
  const [checking, setChecking] = useState(false)
  const visible = useVisible(active)
  const now = useNow(visible)
  const { videos, loadClipsFor } = useLibrary()

  const load = useCallback(() => {
    setLoading(true)
    loadCalendar(videos, loadClipsFor)
      .then(setData)
      .catch(() => setData({ events: [], slots: [], inFlight: [], providers: { woop: false, youtube: false, uploadPost: false } }))
      .finally(() => setLoading(false))
  }, [videos, loadClipsFor])

  // Load when the page is shown, and again when the library changes while it is.
  useEffect(() => {
    if (visible) load()
  }, [visible, videos, load])

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useStudioEvents((e) => {
    if (e.type !== 'publish' || !visible) return
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(load, 1500)
  })
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
  }, [])

  const rangeLabel = useMemo(() => {
    if (view === 'month') return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    const s = startOfWeek(anchor)
    const e = addDays(s, 6)
    const sameMonth = s.getMonth() === e.getMonth()
    return `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`
  }, [anchor, view])
  useBreadcrumbs([{ label: rangeLabel }])

  const step = (dir: -1 | 1): void => {
    if (view === 'month') setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
    else setAnchor((a) => addDays(a, 7 * dir))
  }

  const openEvent = (ev: CalEvent): void => {
    if (ev.videoId && onOpenInStudio) onOpenInStudio(ev.videoId, ev.clipId)
    else if (ev.url) void window.studio?.openExternal?.(ev.url)
    else navigate({ page: 'studio' })
  }

  const checkStuck = async (): Promise<void> => {
    setChecking(true)
    try {
      const r = await api.woopSocialRefresh()
      toast({
        title: r.checked === 0 ? t('Nothing is waiting.') : t('Checked the stuck posts'),
        body:
          r.checked === 0
            ? undefined
            : `${t('Checked')} ${r.checked}, ${t('updated')} ${r.updated}, ${r.still_waiting} ${t('still waiting')}.`,
        tone: r.failed > 0 ? 'warn' : 'success',
        icon: 'refresh'
      })
      load()
    } catch (e) {
      toast({ title: t('Couldn’t check the posts'), body: String(e).replace(/^Error:\s*/, ''), tone: 'error' })
    } finally {
      setChecking(false)
    }
  }

  const events = data?.events ?? []
  const upcoming = events.filter((e) => e.when.getTime() >= now && e.state !== 'posted').slice(0, 6)
  const failed = events.filter((e) => e.state === 'failed')
  const uploading = events.filter((e) => e.state === 'uploading')
  const weekStart = startOfWeek(new Date(now))
  const thisWeek = events.filter((e) => e.when >= weekStart && e.when < addDays(weekStart, 7))
  const stats = [
    { label: t('This week'), value: thisWeek.length, icon: 'calendar' as IconName },
    { label: t('Scheduled'), value: events.filter((e) => e.state === 'scheduled').length, icon: 'clock' as IconName },
    { label: t('Posted'), value: events.filter((e) => e.state === 'posted').length, icon: 'send' as IconName },
    { label: t('Failed'), value: failed.length, icon: 'alert' as IconName, tone: failed.length ? 'error' : undefined }
  ]
  const noProvider = data && !data.providers.woop && !data.providers.youtube && !data.providers.uploadPost
  // Publishing happens per clip in the Clip Editor (there is no engine call
  // that publishes "everything" from here), so the page says where it goes
  // instead of promising an action it can't perform.
  const goPublish = (): void => navigate({ page: 'studio' })
  const showEmpty = Boolean(noProvider && events.length === 0)

  return (
    <div className="sys-page sys-cal max-w-[1200px] mx-auto p-6 space-y-5">
      <PageHeader
        eyebrow={t('MAKE')}
        title={t('Schedule')}
        icon="calendar"
        vtName="page-title"
        subtitle={t('Everything going out, across every account, with the next free posting slots.')}
        actions={
          <>
            <Button variant="ghost" icon="list" onClick={() => setFull(true)}>
              {t('Open full schedule')}
            </Button>
            {!showEmpty && (
              <Button variant="subtle" icon="scissors" onClick={goPublish} title={t('Schedule and publish clips from the Clip Editor.')}>
                {t('Open Clip Editor')}
              </Button>
            )}
          </>
        }
      />

      <div className="sys-cal-stats stagger">
        {stats.map((s) => (
          <div key={s.label} className="sys-cal-stat" data-tone={s.tone}>
            <Icon name={s.icon} size={16} />
            <span className="t-kpi tabular">{s.value}</span>
            <span className="t-micro">{s.label}</span>
          </div>
        ))}
      </div>

      {showEmpty ? (
        <Card variant="glass">
          <EmptyState
            illustration="calendar"
            title={t('Nothing is scheduled yet')}
            body={t('Connect YouTube, WoopSocial or Upload-Post and the posts you schedule appear here, with the next free slots marked in gold.')}
            action={
              <>
                <Button variant="accent" icon="link" onClick={() => openSettings('publishing')}>
                  {t('Connect publishing')}
                </Button>
                <Button variant="ghost" icon="scissors" onClick={goPublish}>
                  {t('Open Clip Editor')}
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <div className="sys-cal-layout">
          <Card className="sys-cal-board" padded={false}>
            <div className="sys-cal-toolbar">
              <div className="flex items-center gap-1">
                <IconButton label={t('Previous')} icon="chevron-left" onClick={() => step(-1)} />
                <Button variant="ghost" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
                  {t('Today')}
                </Button>
                <IconButton label={t('Next')} icon="chevron-right" onClick={() => step(1)} />
              </div>
              <h2 className="t-md text-ink sys-cal-range" aria-live="polite">
                {rangeLabel}
              </h2>
              <div className="flex items-center gap-3">
                {loading && <Icon name="refresh" size={14} className="anim-spin text-muted" />}
                <span className="sys-cal-legend" aria-hidden>
                  <span className={view === 'month' ? 'sys-cal-legend-dot' : 'sys-cal-legend-ghost'} /> {t('Free slot')}
                </span>
                <Segmented
                  ariaLabel={t('Calendar view')}
                  size="sm"
                  value={view}
                  onChange={setView}
                  items={[
                    { id: 'week', label: t('Week') },
                    { id: 'month', label: t('Month') }
                  ]}
                />
              </div>
            </div>
            {!data ? (
              <div className="p-4 space-y-3">
                <Skeleton h={28} />
                <Skeleton h={360} radius={12} />
              </div>
            ) : view === 'week' ? (
              <WeekView anchor={anchor} data={data} now={now} onOpen={openEvent} onSlot={goPublish} />
            ) : (
              <MonthView
                anchor={anchor}
                data={data}
                now={now}
                onOpen={openEvent}
                onDay={(d) => {
                  setAnchor(startOfDay(d))
                  setView('week')
                }}
              />
            )}
          </Card>

          <aside className="sys-cal-side space-y-4">
            {failed.length > 0 && (
              <Card className="sys-cal-failed anim-rise">
                <div className="flex items-center gap-2">
                  <Icon name="alert" size={16} className="text-error" />
                  <h3 className="t-md text-ink flex-1">
                    {failed.length} {failed.length === 1 ? t('post failed') : t('posts failed')}
                  </h3>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {failed.slice(0, 4).map((e) => (
                    <li key={e.id}>
                      <Chip ev={e} compact onOpen={openEvent} />
                      {e.error && <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{e.error}</p>}
                    </li>
                  ))}
                </ul>
                {data?.providers.woop && (
                  <Button variant="ghost" size="sm" icon="refresh" loading={checking} className="mt-3 w-full" onClick={() => void checkStuck()}>
                    {t('Check stuck posts')}
                  </Button>
                )}
              </Card>
            )}

            <Card>
              <h3 className="t-micro mb-3">{t('Up next')}</h3>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted">{t('Nothing waiting to go out.')}</p>
              ) : (
                <ol className="sys-cal-upnext stagger">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="sys-cal-upnext-row" onClick={() => openEvent(e)}>
                        <Poster src={e.poster} size={40} />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm text-ink">{e.title}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted">
                            <Icon name={platformIcon(e.platform)} size={12} />
                            {platformName(e.platform)} · <span className="tabular">{relative(e.when, now)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            {(data?.slots.length ?? 0) > 0 && (
              <Card>
                <h3 className="t-micro mb-3">{t('Next free slots')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {data!.slots.slice(0, 6).map((s) => (
                    <button
                      key={s.toISOString()}
                      type="button"
                      className="sys-cal-slotpill"
                      onClick={goPublish}
                      title={t('A free posting slot. Schedule a clip from the Clip Editor.')}
                    >
                      <Icon name="clock" size={12} />
                      <span className="tabular">
                        {s.toLocaleDateString([], { weekday: 'short' })} {timeFmt(s)}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-2">{t('Based on five posts a day, an hour apart. Schedule clips from the Clip Editor.')}</p>
              </Card>
            )}

            {data?.providers.woop && (
              <Card>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`sys-dot ${data.inFlight.length || uploading.length ? 'sys-dot-live' : ''}`} aria-hidden />
                  <h3 className="t-micro flex-1">{t('In flight')}</h3>
                  <span className="tabular text-sm text-ink">{data.inFlight.length}</span>
                </div>
                {data.inFlight.length === 0 && uploading.length === 0 ? (
                  <p className="text-sm text-muted">{t('Nothing is on its way right now.')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {uploading.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <Chip ev={e} compact onOpen={openEvent} />
                      </li>
                    ))}
                    {uploading.length === 0 && (
                      <li className="text-sm text-muted">
                        {data.inFlight.length} {t('posts waiting for WoopSocial to confirm.')}
                      </li>
                    )}
                  </ul>
                )}
                <Button variant="subtle" size="sm" icon="refresh" loading={checking} className="mt-2" onClick={() => void checkStuck()}>
                  {t('Check stuck posts')}
                </Button>
              </Card>
            )}

            {noProvider && (
              <Card variant="sunken" className="text-sm">
                <p className="text-muted">{t('No publishing account is connected, so only clips scheduled in the library show here.')}</p>
                <Button variant="ghost" size="sm" icon="link" className="mt-2" onClick={() => openSettings('publishing')}>
                  {t('Connect publishing')}
                </Button>
              </Card>
            )}
          </aside>
        </div>
      )}

      {full && <ScheduleView onClose={() => setFull(false)} />}
    </div>
  )
}
