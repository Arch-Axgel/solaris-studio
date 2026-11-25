import { ProgressRing, Skeleton } from './ui'
import { t } from '../lib/i18n'
import { useSystemStats } from '../lib/stores/statsStore'
import type { SystemStats as Stats } from '../lib/types'

/** CPU, GPU, VRAM and storage from the shared /system/stats poll (statsStore:
 *  every 8s, only while something on screen wants it).
 *
 *  - variant "rings" (default): four gauges, used by Home's Engine tile.
 *  - `compact`: one line of numbers, for tight spaces.
 *  - variant "cards": the older large number cards. */

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

function tone(frac: number): 'gold' | 'accent' | 'error' {
  return frac >= 0.9 ? 'error' : frac >= 0.7 ? 'accent' : 'gold'
}

interface Gauge {
  id: string
  label: string
  frac: number | null
  value: string
  sub: string
}

function gauges(s: Stats): Gauge[] {
  const disk = s.data_dir_bytes + s.disk_free_bytes
  return [
    { id: 'cpu', label: 'CPU', frac: s.cpu_percent / 100, value: `${Math.round(s.cpu_percent)}%`, sub: `${t('RAM')} ${Math.round(s.ram_percent)}%` },
    s.gpu
      ? { id: 'gpu', label: 'GPU', frac: s.gpu.gpu_percent / 100, value: `${Math.round(s.gpu.gpu_percent)}%`, sub: s.gpu.name }
      : { id: 'gpu', label: 'GPU', frac: null, value: '—', sub: t('CPU-only mode') },
    s.gpu && s.gpu.vram_total > 0
      ? {
          id: 'vram',
          label: 'VRAM',
          frac: s.gpu.vram_used / s.gpu.vram_total,
          value: `${Math.round((s.gpu.vram_used / s.gpu.vram_total) * 100)}%`,
          sub: `${gb(s.gpu.vram_used)} / ${gb(s.gpu.vram_total)}`
        }
      : { id: 'vram', label: 'VRAM', frac: null, value: '—', sub: t('No graphics memory') },
    {
      id: 'disk',
      label: t('Storage'),
      frac: disk > 0 ? s.data_dir_bytes / disk : null,
      value: gb(s.data_dir_bytes),
      sub: `${gb(s.disk_free_bytes)} ${t('free')}`
    }
  ]
}

function Inline({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{label}</span> <span className="font-semibold text-ink tabular-nums">{value}</span>
    </span>
  )
}

export default function SystemStats({
  compact = false,
  variant = 'rings',
  active = true
}: {
  compact?: boolean
  variant?: 'rings' | 'cards'
  /** Stop polling while the host page is hidden. */
  active?: boolean
}): JSX.Element {
  const stats = useSystemStats(active)

  if (!stats) {
    if (compact) return <span className="text-muted text-sm">{t('Connecting…')}</span>
    return (
      <div className="home-engine-grid" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="home-engine-gauge">
            <Skeleton w={58} h={58} radius="50%" />
            <Skeleton w={40} h={10} />
          </div>
        ))}
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex gap-4 items-center text-sm flex-wrap">
        <Inline label="CPU" value={`${Math.round(stats.cpu_percent)}%`} />
        <Inline label="RAM" value={`${Math.round(stats.ram_percent)}%`} />
        <Inline
          label="GPU"
          value={stats.gpu ? `${stats.gpu.gpu_percent}% · ${gb(stats.gpu.vram_used)}/${gb(stats.gpu.vram_total)}` : 'CPU-only'}
        />
        <Inline label={t('Storage')} value={`${gb(stats.data_dir_bytes)} (${gb(stats.disk_free_bytes)} free)`} />
      </div>
    )
  }

  const list = gauges(stats)
  if (variant === 'cards') {
    return (
      <div className="flex gap-3 flex-wrap">
        {list.map((g) => (
          <div key={g.id} className="card flex-1 min-w-36">
            <p className="label">{g.label}</p>
            <p className="t-kpi mt-1 text-gold-strong">{g.value}</p>
            <p className="text-xs text-muted mt-0.5 truncate">{g.sub}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="home-engine-grid">
      {list.map((g) => (
        <div key={g.id} className="home-engine-gauge" title={`${g.label}: ${g.value} · ${g.sub}`}>
          <ProgressRing value={g.frac === null ? 0 : g.frac} size={62} stroke={5} tone={g.frac === null ? 'gold' : tone(g.frac)} label={`${g.label} ${g.value}`}>
            <span className="home-engine-val tabular">{g.value}</span>
          </ProgressRing>
          <span className="home-engine-label">{g.label}</span>
          <span className="home-engine-sub">{g.sub}</span>
        </div>
      ))}
    </div>
  )
}
