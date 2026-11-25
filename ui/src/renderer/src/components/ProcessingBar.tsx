import { useEffect, useState } from 'react'
import { formatEta } from '../lib/jobProgress'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { useActiveJob } from '../lib/stores/activeJob'
import { Icon } from './icons'

/** Live progress for the running job: stage label, a striped ember bar with
 *  a gold glow head, an estimated time remaining that ticks down, and a
 *  Cancel button. Hidden when idle.
 *
 *  It reads the shared active-job store (lib/stores/activeJob), which owns
 *  the one event subscription and the "events went quiet, ask the server"
 *  watchdog that this bar used to carry inline (useJobWatch), so the bar can
 *  never claim to be processing forever after a dropped terminal event. */
export default function ProcessingBar({ variant = 'card' }: { variant?: 'card' | 'slim' }): JSX.Element | null {
  const job = useActiveJob()
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!job.running) setCancelling(false)
  }, [job.running])

  if (!job.running) return null
  const eta = job.etaSeconds
  const pct = Math.round(job.fraction * 100)

  // Remote rendering set to one worker that isn't there: the clips wait for
  // it, and this brings them back to this PC instead.
  const waiting = Boolean(job.remote?.startsWith('waiting for'))
  const renderHere = async (): Promise<void> => {
    if (!job.videoId) return
    try {
      await api.renderLocally(job.videoId)
    } catch {
      // the next progress event says where the clips are
    }
  }

  const cancel = async (): Promise<void> => {
    if (!job.videoId) return
    setCancelling(true)
    try {
      await api.cancelProcessing(job.videoId)
    } catch {
      setCancelling(false)
    }
  }

  return (
    <div className={`lib-pbar ${variant === 'slim' ? 'lib-pbar-slim' : ''}`} aria-live="polite">
      <div className="lib-pbar-row">
        <span className="lib-pbar-pulse" aria-hidden>
          <Icon name="film" size={14} />
        </span>
        <p className="lib-pbar-title">
          {job.title ? <span className="text-ink">{job.title} — </span> : ''}
          <span className="text-gold-strong">{job.stageLabel || 'Working…'}</span>
          {job.clip && (
            <span className="text-muted tabular">
              {' '}
              · {t('clip')} {job.clip.current}/{job.clip.total}
            </span>
          )}
        </p>
        <div className="lib-pbar-actions">
          <p className="text-xs text-muted tabular-nums whitespace-nowrap">
            <span className="text-ink font-semibold">{pct}%</span> ·{' '}
            {eta !== null
              ? `Estimated time: ~${formatEta(eta)} left`
              : 'Estimated time: calculating…'}
          </p>
          {/* Reachable from wherever the bar is shown: while a long batch
              runs, the queue is the screen that answers "what's left?" */}
          <button
            className="btn-ghost lib-pbar-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('open-queue'))}
          >
            Queue
          </button>
          {waiting && (
            <button className="btn-ghost lib-pbar-btn" onClick={renderHere}>
              Render here instead
            </button>
          )}
          <button
            className="btn-ghost lib-pbar-btn"
            onClick={cancel}
            disabled={cancelling || !job.videoId}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </div>
      <div
        className="lib-pbar-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Video processing progress"
      >
        <div className="lib-pbar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  )
}
