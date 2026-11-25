import { useState } from 'react'
import { api } from '../../lib/api'
import type { QueueJob } from '../../lib/types'
import type { JobProgress } from '../../lib/jobProgress'
import { etaSeconds, formatEta } from '../../lib/jobProgress'
import { describeOptions, jobLabel, ranFor, sourceOf } from '../../lib/queue'
import QueueItemSettings from './QueueItemSettings'
import { t } from '../../lib/i18n'
import { useLocalAI } from '../../lib/useAIStatus'
import OpenRouterPrompt from '../OpenRouterPrompt'
import { Icon, type IconName } from '../icons'
import { Button, Disclosure, IconButton, ProgressBar, StatusChip, toast } from '../ui'

/** A job that failed in a request to the local Ollama runtime: the address it
 *  listens on or its API paths are in the message. Only then is a cloud
 *  alternative worth suggesting; a download or render failure is not this. */
const LOCAL_AI_FAILURE = /\/api\/(generate|chat)|:1143[45]\b|ollama/i

/** Vertical Live refused the source as not 9:16 (core/modes.py MISMATCH). */
const NOT_VERTICAL = /is not a vertical 9:16 source/

const ICON: Record<string, IconName> = {
  running: 'play',
  queued: 'clock',
  done: 'check',
  failed: 'alert',
  cancelled: 'ban'
}

const SOURCE_ICON: Record<string, IconName> = {
  YouTube: 'youtube',
  Twitch: 'twitch',
  Kick: 'kick',
  'Local file': 'folder',
  Link: 'link'
}

const CHIP: Record<string, 'running' | 'queued' | 'done' | 'failed' | 'idle'> = {
  running: 'running',
  queued: 'queued',
  done: 'done',
  failed: 'failed',
  cancelled: 'idle'
}

/** One row of the processing queue.
 *
 *  Presentational: it renders a job and calls back. It never holds queue
 *  state, so the page stays the single place that knows what the queue is. */
export default function QueueItem({
  job,
  index,
  total,
  live,
  now,
  onChanged,
  onOpenInStudio,
  large = false
}: {
  job: QueueJob
  /** 1-based position among waiting videos; 0 when not applicable. */
  index: number
  total: number
  /** Live progress, only for the running row. */
  live?: JobProgress
  now: number
  onChanged: () => void
  onOpenInStudio?: (videoId: string) => void
  /** The Processing lane's big card. */
  large?: boolean
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const localAI = useLocalAI()
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const chips = describeOptions(job.settings)
  const source = sourceOf(job.url)
  const running = job.status === 'running'
  const waiting = job.status === 'queued'
  const failed = job.status === 'failed' || job.status === 'cancelled'
  const eta = running && live ? etaSeconds(live, now) : null
  const took = ranFor(job)
  const pct = running && live ? Math.round(live.fraction * 100) : 0

  const loadWhy = async (): Promise<void> => {
    if (why !== null) return
    try {
      const res = await api.jobLog(job.id, 80)
      setWhy(res.log)
    } catch (e) {
      setWhy('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const copy = (text: string): void => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: t('Copied'), tone: 'success', icon: 'copy', duration: 2000 }))
      .catch(() => toast({ title: t('Could not copy'), tone: 'error' }))
  }

  return (
    <article
      className={`ops-qi ${large ? 'ops-qi-large' : ''}`}
      data-status={job.status}
      aria-label={jobLabel(job)}
    >
      <div className="flex items-start gap-3">
        <span className="ops-qi-icon" aria-hidden>
          <Icon name={ICON[job.status] ?? 'clock'} size={large ? 20 : 16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`ops-qi-title truncate min-w-0 ${large ? 't-md' : ''}`} title={job.url || jobLabel(job)}>
              {jobLabel(job)}
            </p>
          </div>
          <div className="ops-qi-meta">
            {source && (
              <span className="ops-qi-source">
                <Icon name={SOURCE_ICON[source] ?? 'link'} size={12} />
                {t(source)}
              </span>
            )}
            {job.channel && <span className="truncate">{job.channel}</span>}
            {!running && !waiting && <StatusChip status={CHIP[job.status] ?? 'idle'} label={job.status === 'cancelled' ? t('Cancelled') : undefined} />}
          </div>

          {running && live && (
            <div className="mt-2.5 space-y-1.5">
              <div className="flex items-baseline gap-2 text-sm flex-wrap">
                <span className="text-gold-strong font-medium">{live.label || t('Starting…')}</span>
                <span className="ml-auto t-mono text-ink">{pct}%</span>
                {eta !== null && (
                  <span className="text-muted tabular">
                    · {formatEta(eta)} {t('left')}
                  </span>
                )}
              </div>
              <ProgressBar value={live.fraction} label={t('Progress')} tone="gold" striped size={large ? 'md' : 'sm'} />
            </div>
          )}

          {waiting && (
            <p className="text-sm text-muted mt-1">
              {job.interrupted
                ? t('Restarted after an interruption - resumes from its last finished stage')
                : t('Waiting')}
            </p>
          )}

          {took && !running && (
            <p className="text-sm text-muted mt-1">
              {job.status === 'done' ? t('Finished in') : t('Ran for')} <span className="tabular">{took}</span>
              {job.attempts > 1 && ` · ${job.attempts} ${t('attempts')}`}
            </p>
          )}

          {job.error && <p className="ops-qi-error">{job.error}</p>}
          {job.error && NOT_VERTICAL.test(job.error) && (
            <Button
              size="sm"
              variant="subtle"
              icon="retry"
              className="mt-2"
              disabled={busy}
              onClick={() => void run(() => api.retryJob(job.id, true))}
              title={t('Clip it again with the normal framing, which follows faces and reframes for 9:16')}
            >
              {t('Use standard processing')}
            </Button>
          )}
          {job.error && localAI && LOCAL_AI_FAILURE.test(job.error) && (
            <OpenRouterPrompt
              className="mt-2"
              title={t('Having trouble running AI locally?')}
              body={t('OpenRouter is the recommended cloud alternative, on your own key.')}
            />
          )}

          {chips.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {chips.map((c) => (
                <span key={c} className="ops-chip">
                  {c}
                </span>
              ))}
            </div>
          )}

          {failed && job.log_path && (
            <div className="ops-why mt-2">
              <Disclosure
                summary={
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <Icon name="help" size={14} />
                    {t('Why did this fail?')}
                  </span>
                }
                onOpenChange={(o) => {
                  if (o) void loadWhy()
                }}
              >
                <div className="ops-log-wrap">
                  {why === null ? (
                    <div className="skeleton" style={{ height: 64 }} aria-hidden />
                  ) : (
                    <>
                      <pre className="ops-log">{why || t('No log was recorded for this run.')}</pre>
                      {why && (
                        <Button size="sm" variant="subtle" icon="copy" className="ops-log-copy" onClick={() => copy(why)}>
                          {t('Copy')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Disclosure>
            </div>
          )}

          {log !== null && (
            <div className="ops-log-wrap mt-2 anim-fade">
              <pre className="ops-log">{log || t('No log was recorded for this run.')}</pre>
              {log && (
                <Button size="sm" variant="subtle" icon="copy" className="ops-log-copy" onClick={() => copy(log)}>
                  {t('Copy')}
                </Button>
              )}
            </div>
          )}

          {waiting && job.type === 'process' && (
            <div className="collapse" data-open={open ? 'true' : 'false'}>
              <div>{open && <QueueItemSettings job={job} onSaved={onChanged} />}</div>
            </div>
          )}
          {/* The running video's settings are visible but not editable.
              Showing nothing at all read as a missing feature; the truth is
              that changing them mid-run would render some of this video's
              clips one way and the rest another. */}
          {running && (
            <p className="text-xs text-muted mt-2 inline-flex items-center gap-1.5">
              <Icon name="pin" size={12} />
              {t('Settings are locked while this video processes.')}
            </p>
          )}
          {error && <p className="text-sm text-error mt-1.5 anim-shake">{error}</p>}
        </div>

        <div className="ops-qi-actions">
          {waiting && (
            <>
              <IconButton
                size="sm"
                icon="arrow-up"
                label={t('Run this one next')}
                aria-label={t('Move to the front of the queue')}
                disabled={busy || index <= 1}
                onClick={() => void run(() => api.moveJob(job.id, { to: 'top' }))}
              />
              <IconButton
                size="sm"
                icon="chevron-up"
                label={t('Move up')}
                disabled={busy || index <= 1}
                onClick={() => void run(() => api.moveJob(job.id, { delta: -1 }))}
              />
              <IconButton
                size="sm"
                icon="chevron-down"
                label={t('Move down')}
                disabled={busy || index >= total}
                onClick={() => void run(() => api.moveJob(job.id, { delta: 1 }))}
              />
              {job.type === 'process' && (
                <Button
                  size="sm"
                  variant={open ? 'accent' : 'subtle'}
                  icon="gear"
                  iconRight={open ? 'chevron-up' : 'chevron-down'}
                  aria-expanded={open}
                  title={t('Change this video’s settings')}
                  onClick={() => setOpen(!open)}
                >
                  {t('Settings')}
                </Button>
              )}
            </>
          )}

          {running && (
            <Button
              size="sm"
              variant="ghost"
              icon="stop"
              loading={busy}
              disabled={!job.video_id}
              title={t('Stop this video (finishes the clip it is on)')}
              onClick={() => void run(() => api.cancelProcessing(job.video_id))}
            >
              {busy ? t('Cancelling…') : t('Cancel')}
            </Button>
          )}

          {failed && (
            <Button
              size="sm"
              variant="accent"
              icon="retry"
              disabled={busy}
              title={t('Put this video back in the queue with the same settings')}
              onClick={() => void run(() => api.retryJob(job.id))}
            >
              {t('Retry')}
            </Button>
          )}

          {job.status === 'done' && job.video_id && onOpenInStudio && (
            <Button
              size="sm"
              variant="gold"
              icon="film"
              title={t('Open the clips from this video')}
              onClick={() => onOpenInStudio(job.video_id)}
            >
              {t('Clips')}
            </Button>
          )}

          {!running && job.log_path && (
            <IconButton
              size="sm"
              icon="log"
              label={t('Show what happened during this run')}
              active={log !== null}
              onClick={async () => {
                if (log !== null) {
                  setLog(null)
                  return
                }
                try {
                  const res = await api.jobLog(job.id)
                  setLog(res.log)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            />
          )}

          {!running && (
            <IconButton
              size="sm"
              icon="x"
              tone="error"
              label={t('Remove from the queue')}
              disabled={busy}
              onClick={() => void run(() => api.deleteJob(job.id))}
            />
          )}
        </div>
      </div>
    </article>
  )
}
