import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AutomationStatus, Watch, WatchItem } from '../../lib/types'
import WatchCard, { WATCH_PLATFORM_LABEL } from './WatchCard'
import { useInView } from '../../lib/motion'
import { t } from '../../lib/i18n'
import { Icon, type IconName } from '../icons'
import { Avatar } from '../ui'

export interface TileStats {
  found: number
  queued: number
  clipped: number
  skipped: number
  working: boolean
}

const PLATFORM_ICON: Record<string, IconName> = { youtube: 'youtube', twitch: 'twitch', kick: 'kick' }

function statsOf(items: WatchItem[]): TileStats {
  const s: TileStats = { found: 0, queued: 0, clipped: 0, skipped: 0, working: false }
  for (const i of items) {
    if (i.status === 'earlier') continue
    s.found += 1
    if (i.status === 'queued' || i.status === 'processing' || i.status === 'waiting_for_queue' || i.status === 'waiting_for_video')
      s.queued += 1
    if (i.status === 'processing') s.working = true
    if (i.status === 'complete') s.clipped += 1
    if (i.status === 'skipped' || i.status === 'cancelled') s.skipped += 1
  }
  return s
}

/** One watched channel on the grid: a platform-coloured edge, an avatar and
 *  found / queued / clipped / skipped counts around the existing WatchCard.
 *  The counts load only once the tile scrolls into view, and at most every
 *  15 seconds after that. */
export default function ChannelTile({
  watch,
  automation,
  version,
  onChanged,
  onOpenInStudio,
  onOpenCreator,
  openSetup,
  flash,
  onStats
}: {
  watch: Watch
  automation: AutomationStatus
  version: number
  onChanged: () => void
  onOpenInStudio?: (videoId: string) => void
  onOpenCreator?: (creatorId: number) => void
  openSetup: boolean
  flash?: boolean
  onStats?: (watchId: number, stats: TileStats) => void
}): JSX.Element {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: '200px' })
  const [stats, setStats] = useState<TileStats | null>(null)
  const last = useRef(0)
  const statsCb = useRef(onStats)
  statsCb.current = onStats

  useEffect(() => {
    if (!inView) return
    const wait = Math.max(0, 15000 - (Date.now() - last.current))
    const id = setTimeout(() => {
      last.current = Date.now()
      api
        .watchItems(watch.id, 200)
        .then((items) => {
          const s = statsOf(items)
          setStats(s)
          statsCb.current?.(watch.id, s)
        })
        .catch(() => {})
    }, last.current === 0 ? 0 : wait)
    return () => clearTimeout(id)
  }, [inView, version, watch.id])

  const on = automation.enabled && watch.enabled
  const counts: [string, number | undefined, IconName, string][] = [
    ['found', stats?.found, 'eye', t('Found')],
    ['queued', stats?.queued, 'layers', t('Queued')],
    ['clipped', stats?.clipped, 'scissors', t('Clipped')],
    ['skipped', stats?.skipped, 'ban', t('Skipped')]
  ]

  return (
    <div
      ref={ref}
      className={`ops-tile ${flash ? 'anim-flash' : ''}`}
      data-platform={watch.platform}
      data-on={on ? 'true' : 'false'}
      data-watch={watch.id}
    >
      <div className="ops-tile-head">
        <div className="ops-tile-avatar">
          <Avatar seed={watch.id} name={watch.name || watch.channel_key} size={44} />
          <span className="ops-tile-platform" title={WATCH_PLATFORM_LABEL[watch.platform] ?? watch.platform}>
            <Icon name={PLATFORM_ICON[watch.platform] ?? 'link'} size={12} />
          </span>
          {stats?.working && <span className="ops-tile-live" aria-label={t('Clipping now')} />}
        </div>
        <dl className="ops-tile-counts">
          {counts.map(([key, n, icon, label]) => (
            <div key={key} data-k={key}>
              <dt>
                <Icon name={icon} size={11} />
                {label}
              </dt>
              <dd className="tabular">{n === undefined ? <span className="skeleton ops-count-skel" /> : n}</dd>
            </div>
          ))}
        </dl>
      </div>
      <WatchCard
        watch={watch}
        automation={automation}
        version={version}
        onChanged={onChanged}
        onOpenInStudio={onOpenInStudio}
        onOpenCreator={onOpenCreator}
        openSetup={openSetup}
      />
    </div>
  )
}
