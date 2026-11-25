import { useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from '../icons'
import { Card, CountUp, Skeleton, Sparkline } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { useLibrary, useRecentClips } from '../../lib/stores/library'
import { useQueueSnapshot } from '../../lib/stores/queueStore'
import type { CreatorSummary } from '../../lib/types'
import { dailyBuckets, parseTime, tf } from './homeUtil'

interface Kpi {
  id: string
  label: string
  icon: IconName
  value: number | null
  format?: (n: number) => string
  spark: number[]
  sparkLabel: string
  delta?: { value: number; label: string } | null
  hint?: string
}

function Tile({ k, index }: { k: Kpi; index: number }): JSX.Element {
  const up = (k.delta?.value ?? 0) > 0
  const down = (k.delta?.value ?? 0) < 0
  return (
    <Card className="home-kpi card-interactive" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <p className="t-micro">{k.label}</p>
        <span className="home-kpi-icon" aria-hidden>
          <Icon name={k.icon} size={15} />
        </span>
      </div>
      <div className="home-kpi-value">
        {k.value === null ? <Skeleton w={84} h={30} /> : <CountUp value={k.value} format={k.format} className="t-kpi text-ink" />}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1 min-h-7">
        <span className="text-xs text-muted min-w-0">
          {k.delta ? (
            <span className={`home-kpi-delta ${up ? 'is-up' : down ? 'is-down' : ''}`}>
              <Icon name={up ? 'arrow-up' : down ? 'arrow-down' : 'arrow-right'} size={11} />
              {k.delta.label}
            </span>
          ) : (
            k.hint ?? ''
          )}
        </span>
        <Sparkline values={k.spark} width={92} height={28} label={k.sparkLabel} className="home-kpi-spark" />
      </div>
    </Card>
  )
}

/** Four headline numbers with 14-day sparklines and a count-up. */
export default function KpiTiles(): JSX.Element {
  const { videos } = useLibrary()
  const { clips } = useRecentClips(24)
  const { snapshot } = useQueueSnapshot()
  const [creators, setCreators] = useState<CreatorSummary[] | null>(null)

  const libVersion = videos?.length ?? -1
  useEffect(() => {
    let alive = true
    api
      .creators()
      .then((r) => alive && setCreators(r.creators))
      .catch(() => alive && setCreators([]))
    return () => {
      alive = false
    }
  }, [libVersion])

  const kpis = useMemo((): Kpi[] => {
    const vids = videos ?? []
    const at = (v: { created_at: string }): number => parseTime(v.created_at)
    const now = Date.now()
    const week = 7 * 86_400_000
    const thisWeek = vids.filter((v) => at(v) >= now - week).reduce((n, v) => n + (v.clip_count || 0), 0)
    const lastWeek = vids
      .filter((v) => at(v) >= now - 2 * week && at(v) < now - week)
      .reduce((n, v) => n + (v.clip_count || 0), 0)
    const diff = thisWeek - lastWeek
    const clipSpark = dailyBuckets(vids, at, (v) => v.clip_count || 0)

    const total = vids.reduce((n, v) => n + (v.clip_count || 0), 0)
    let running = 0
    const cumulative = dailyBuckets(vids, at, (v) => v.clip_count || 0).map((n) => (running += n))

    // Hours of video processed, when the queue knows the source lengths.
    const completed = snapshot?.completed ?? []
    const sourceSecs = completed.reduce((n, j) => n + (j.source_seconds || 0), 0)
    const hasSource = sourceSecs > 0
    const procSecs = vids.reduce((n, v) => n + (v.process_seconds || 0), 0)
    const hoursSpark = hasSource
      ? dailyBuckets(completed, (j) => parseTime(j.finished_at || j.updated_at), (j) => (j.source_seconds || 0) / 3600)
      : dailyBuckets(vids, at, (v) => (v.process_seconds || 0) / 3600)

    let avg: number | null = null
    if (creators) {
      let w = 0
      let sum = 0
      for (const c of creators) {
        if (c.avg_score == null || !c.clips) continue
        sum += c.avg_score * c.clips
        w += c.clips
      }
      avg = w > 0 ? Math.round(sum / w) : 0
    }
    const scoreDays = dailyBuckets(clips ?? [], (c) => parseTime(c.created_at), (c) => c.score)
    const countDays = dailyBuckets(clips ?? [], (c) => parseTime(c.created_at), () => 1)
    const scoreSpark = scoreDays.map((s, i) => (countDays[i] ? s / countDays[i] : 0))

    const fmtHours = (n: number): string => (n >= 10 ? `${Math.round(n)}h` : `${n.toFixed(1)}h`)
    return [
      {
        id: 'week',
        label: t('Clips this week'),
        icon: 'flame',
        value: videos ? thisWeek : null,
        spark: clipSpark,
        sparkLabel: t('Clips per day, last 14 days'),
        delta: videos
          ? {
              value: diff,
              label: diff === 0 ? t('same as last week') : tf(diff > 0 ? '{n} more than last week' : '{n} fewer than last week', { n: Math.abs(diff) })
            }
          : null
      },
      {
        id: 'total',
        label: t('Total clips'),
        icon: 'film',
        value: videos ? total : null,
        spark: cumulative,
        sparkLabel: t('Clips made, last 14 days'),
        hint: videos ? tf(vids.length === 1 ? 'from {n} video' : 'from {n} videos', { n: vids.length }) : undefined
      },
      {
        id: 'hours',
        label: hasSource ? t('Hours processed') : t('Processing time'),
        icon: 'clock',
        value: videos ? (hasSource ? sourceSecs : procSecs) / 3600 : null,
        format: fmtHours,
        spark: hoursSpark,
        sparkLabel: hasSource ? t('Hours of video processed per day') : t('Processing time per day'),
        hint: hasSource ? t('of video, from the queue') : t('time the engine spent')
      },
      {
        id: 'score',
        label: t('Average score'),
        icon: 'star',
        value: avg,
        spark: scoreSpark,
        sparkLabel: t('Average clip score per day'),
        hint: avg === null ? undefined : avg >= 80 ? t('excellent') : avg >= 65 ? t('strong') : avg > 0 ? t('room to grow') : t('no scores yet')
      }
    ]
  }, [videos, clips, snapshot, creators])

  return (
    <div className="home-kpis stagger">
      {kpis.map((k, i) => (
        <Tile key={k.id} k={k} index={i} />
      ))}
    </div>
  )
}
