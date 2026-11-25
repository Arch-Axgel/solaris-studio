import { useState } from 'react'
import { t } from '../../lib/i18n'
import { navigate } from '../../lib/nav'
import { jobLabel } from '../../lib/queue'
import { useActiveJob } from '../../lib/stores/activeJob'
import { useQueueRun, useQueueSnapshot } from '../../lib/stores/queueStore'
import { Icon } from '../icons'

/** The global playhead (spec 3.7): a 4px strip whose width is the whole
 *  queue run's progress, with a glowing gold head. Hover grows it into a
 *  filmstrip of what is running and what is next. */
export default function TransportDock(): JSX.Element | null {
  const { snapshot, remaining } = useQueueSnapshot()
  const { done } = useQueueRun()
  const job = useActiveJob()
  const [open, setOpen] = useState(false)
  if (!snapshot || (remaining === 0 && !job.running)) return null

  const total = done + Math.max(remaining, job.running ? 1 : 0)
  const frac = total > 0 ? Math.min(1, (done + (job.running ? job.fraction : 0)) / total) : 0
  const processing = snapshot.processing[0]
  const next = snapshot.queued.slice(0, 8)

  return (
    <div
      className="dock"
      data-open={open ? 'true' : 'false'}
      data-paused={snapshot.paused ? 'true' : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
      role={open ? 'region' : undefined}
      aria-label={open ? t('Queue progress') : undefined}
      aria-hidden={open ? undefined : true}
    >
      <div className="dock-track">
        <div className="dock-fill" style={{ width: `${(frac * 100).toFixed(2)}%` }}>
          <span className="dock-head" />
        </div>
      </div>
      <div className="dock-strip">
        <span className="dock-count tabular">
          {done}/{total}
        </span>
        {processing && (
          <span className="dock-chip dock-chip-live" title={jobLabel(processing)}>
            <span className="dock-chip-dot" aria-hidden />
            {jobLabel(processing)}
            <span className="tabular text-gold">{Math.round(job.fraction * 100)}%</span>
          </span>
        )}
        {next.map((j, i) => (
          <span key={j.id} className="dock-chip" title={jobLabel(j)} style={{ '--i': i } as React.CSSProperties}>
            <span className="dock-chip-n tabular">{i + 1}</span>
            {jobLabel(j)}
          </span>
        ))}
        {snapshot.queued.length > next.length && (
          <span className="dock-more tabular">+{snapshot.queued.length - next.length}</span>
        )}
        <button
          type="button"
          className="dock-open"
          tabIndex={open ? 0 : -1}
          onClick={() => navigate({ page: 'queue' })}
        >
          {t('Open queue')}
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
    </div>
  )
}
