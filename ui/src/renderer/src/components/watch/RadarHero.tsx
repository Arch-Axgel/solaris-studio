import { useEffect, useState } from 'react'
import type { AutomationActivity, AutomationStatus, Watch } from '../../lib/types'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { Avatar, Button, CountUp, IconButton, Popover, Skeleton, Toggle, Tooltip } from '../ui'

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const SWEEP_S = 3

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** The radar: every watched channel is a blip at its own angle, the sweep
 *  goes round while auto-clipping is on, and the master switch, the next
 *  check and the radar settings live next to it. */
export default function RadarHero({
  status,
  watches,
  activity,
  working,
  busy,
  checking,
  tray,
  onEnabled,
  onDeleteSources,
  onTray,
  onCheckAll,
  onPick,
  aside
}: {
  status: AutomationStatus | null
  watches: Watch[] | null
  activity: AutomationActivity | null
  /** Channels with a video being clipped or waiting in the queue right now. */
  working: Record<number, boolean>
  busy: boolean
  checking: boolean
  /** null: no tray option on this build. */
  tray: boolean | null
  onEnabled: (on: boolean) => void
  onDeleteSources: (on: boolean) => void
  onTray: (on: boolean) => void
  onCheckAll: () => void
  onPick?: (watchId: number) => void
  /** A small extra beside "Check all now" (the AI chip). */
  aside?: React.ReactNode
}): JSX.Element {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])

  const on = Boolean(status?.enabled)
  const list = watches ?? []
  const watching = list.filter((w) => w.enabled).length
  const loading = status === null
  const state = loading ? 'loading' : (activity?.now.state ?? (on ? 'watching' : 'off'))
  const next = activity && activity.next_check_at > 0 ? activity.next_check_at - now : null

  return (
    <section
      className={`card-hero ops-radar-hero ${on || loading ? '' : 'radar-off'}`}
      aria-label={t('Watching')}
      aria-busy={loading || undefined}
      data-state={state}
    >
      <div className="ops-radar" aria-hidden={list.length === 0}>
        <div className="ops-radar-rings" aria-hidden>
          <span />
          <span />
          <span />
          <i className="ops-radar-cross" />
        </div>
        <div className="radar-sweep ops-radar-sweep" aria-hidden />
        {list.map((w) => {
          const h = hash(`${w.id}:${w.channel_key}`)
          const angle = h % 360
          const r = 22 + ((h >>> 9) % 20)
          const rad = (angle * Math.PI) / 180
          const tone = w.last_error ? 'error' : !w.enabled || !on ? 'off' : working[w.id] ? 'live' : 'gold'
          return (
            <Tooltip key={w.id} content={`${w.name || w.channel_key}${working[w.id] ? ` · ${t('clipping now')}` : ''}`}>
              <button
                type="button"
                className="ops-blip"
                data-tone={tone}
                aria-label={w.name || w.channel_key}
                style={
                  {
                    left: `${50 + r * Math.sin(rad)}%`,
                    top: `${50 - r * Math.cos(rad)}%`,
                    '--blip-delay': `${((angle / 360) * SWEEP_S).toFixed(2)}s`
                  } as React.CSSProperties
                }
                onClick={() => onPick?.(w.id)}
              >
                <Avatar seed={w.creator?.id ?? w.id} name={w.name || w.channel_key} size={22} />
              </button>
            </Tooltip>
          )
        })}
        <span className="ops-radar-core" aria-hidden>
          <Icon name="radar" size={18} />
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            {/* Until the engine says, nothing is claimed: no "Off", no zeros. */}
            {loading ? (
              <div className="ops-radar-skel" aria-hidden>
                <Skeleton w={52} h={28} radius={999} />
                <div className="flex-1 space-y-2">
                  <Skeleton w={140} h={16} />
                  <Skeleton h={12} className="max-w-md" />
                </div>
              </div>
            ) : (
            <Toggle
              size="lg"
              checked={on}
              disabled={busy || status === null}
              onChange={onEnabled}
              label={t('Auto-clipping')}
              description={
                status?.enabled
                  ? `${t('Each channel is checked every')} ${status.interval_minutes} ${t('minutes while Solaris Studio is open. Hands-off channels are queued, clipped and published with nobody at the PC, so leave Solaris Studio running.')}`
                  : t('Off. Nothing is checked, queued or published until you switch it on.')
              }
            />
            )}
          </div>
          <Popover
            align="end"
            width={360}
            trigger={(p) => (
              <IconButton
                ref={p.ref}
                icon="gear"
                label={t('Radar settings')}
                aria-expanded={p['aria-expanded']}
                onClick={p.onClick}
              />
            )}
          >
            <div className="ops-radar-settings space-y-4">
              <p className="t-micro text-gold">{t('Radar settings')}</p>
              <div className="flex items-center gap-2 text-sm">
                <Icon name="clock" size={14} className="text-muted" />
                <span className="text-muted">{t('Check interval')}</span>
                <span className="ml-auto text-ink tabular">
                  {status ? `${status.interval_minutes} ${t('min')}` : '—'}
                </span>
              </div>
              <Toggle
                size="sm"
                checked={Boolean(status?.delete_sources)}
                disabled={busy || status === null}
                onChange={onDeleteSources}
                label={t('Delete each watched video’s download once its clips are published')}
                description={t(
                  'Keeps an always-on PC from filling its disk. The clips stay. Re-rendering one of those clips later needs the video downloaded again.'
                )}
              />
              {tray !== null && (
                <Toggle
                  size="sm"
                  checked={tray}
                  onChange={onTray}
                  label={t('Keep watching when the window is closed')}
                  description={t(
                    'Closing the window leaves Solaris Studio running in the system tray. Quit it from the tray icon. Windows going to sleep still stops it.'
                  )}
                />
              )}
            </div>
          </Popover>
        </div>

        <div className="ops-radar-stats">
          <div>
            <p className="t-micro text-muted">{t('Channels')}</p>
            <div className="t-kpi">{loading || watches === null ? <Skeleton w={28} h={26} className="ops-kpi-skel" /> : <CountUp value={list.length} />}</div>
          </div>
          <div>
            <p className="t-micro text-muted">{t('Watching')}</p>
            <div className="t-kpi text-foil">
              {loading || watches === null ? <Skeleton w={28} h={26} className="ops-kpi-skel" /> : <CountUp value={on ? watching : 0} />}
            </div>
          </div>
          {/* What is being clipped right now, and how far along, is the
              on-air strip's job just below; the radar keeps to the schedule. */}
          <div className="min-w-0">
            <p className="t-micro text-muted">{t('Next check')}</p>
            {loading ? (
              <div className="t-kpi"><Skeleton w={64} h={26} className="ops-kpi-skel" /></div>
            ) : (
              <p className="t-kpi tabular">
                {on && next !== null ? (
                  next <= 1 ? (
                    <span className="text-gold-strong text-lg">{t('checking…')}</span>
                  ) : (
                    mmss(next)
                  )
                ) : (
                  <span className="text-muted">—</span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="subtle"
            icon="refresh"
            loading={checking}
            disabled={!on || watching === 0 || busy}
            onClick={onCheckAll}
            title={t('Look at every switched-on channel now instead of waiting for the next check.')}
          >
            {checking ? t('Checking…') : t('Check all now')}
          </Button>
          {aside && <span className="ops-radar-aside">{aside}</span>}
        </div>

      </div>
    </section>
  )
}
