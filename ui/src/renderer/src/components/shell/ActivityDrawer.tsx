import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { navigate, useLayer } from '../../lib/nav'
import { useActivity, useModelPulls, type ActivityItem, type ActivityKind } from '../../lib/stores/activity'
import { Icon, type IconName } from '../icons'
import { EmptyState, ProgressBar, Sheet, toast } from '../ui'

/** The activity center (spec 4.14): everything that happened, newest first,
 *  with the follow-up for each (open the clips, retry, read the log, open
 *  the post), plus the raw technical log. The store lives in
 *  lib/stores/activity.ts (B1). */

type Filter = 'all' | 'job' | 'publish' | 'watch' | 'model' | 'log'

const FILTERS: { id: Filter; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All', icon: 'bell' },
  { id: 'job', label: 'Jobs', icon: 'layers' },
  { id: 'publish', label: 'Publishing', icon: 'send' },
  { id: 'watch', label: 'Watch', icon: 'radar' },
  { id: 'model', label: 'Models', icon: 'cpu' },
  { id: 'log', label: 'Technical log', icon: 'log' }
]

const TONE_ICON: Record<ActivityItem['tone'], IconName> = {
  success: 'check',
  warn: 'alert',
  error: 'alert',
  info: 'info'
}

const KIND_ICON: Record<ActivityKind, IconName> = {
  job: 'film',
  publish: 'send',
  watch: 'radar',
  model: 'cpu',
  system: 'info'
}

function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return t('just now')
  const m = Math.round(s / 60)
  if (m < 60) return `${m} ${t('min ago')}`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ${t('h ago')}`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} ${t('d ago')}`
  return new Date(at).toLocaleDateString()
}

function dayLabel(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return t('Today')
  if (d.toDateString() === y.toDateString()) return t('Yesterday')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function openUrl(url: string): void {
  const open = window.studio?.openExternal
  if (open) void open(url)
  else window.open(url, '_blank', 'noopener')
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast({ tone: 'success', icon: 'copy', title: t('Copied'), duration: 1800 })
  } catch {
    toast({ tone: 'error', title: t('Couldn’t copy') })
  }
}

function LogViewer({ jobId }: { jobId: number }): JSX.Element {
  const [log, setLog] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api
      .jobLog(jobId, 200)
      .then((r) => live && setLog(r.missing ? '' : r.log))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [jobId])
  return (
    <div className="lyr-act-log">
      {log === null && !error && (
        <p className="lyr-act-log-wait">
          <span className="lyr-spinner" aria-hidden /> {t('Reading the log…')}
        </p>
      )}
      {error && <p className="text-error text-xs">{error.slice(0, 200)}</p>}
      {log === '' && <p className="text-muted text-xs">{t('No log was kept for this job.')}</p>}
      {log && (
        <>
          <pre className="t-mono">{log}</pre>
          <button type="button" className="btn-subtle lyr-act-mini" onClick={() => void copy(log)}>
            <Icon name="copy" size={13} /> {t('Copy')}
          </button>
        </>
      )}
    </div>
  )
}

function EventCard({ item, unread, now, onDone, style }: { item: ActivityItem; unread: boolean; now: number; onDone: () => void; style?: React.CSSProperties }): JSX.Element {
  const [showLog, setShowLog] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retried, setRetried] = useState(false)
  const jobId = typeof item.jobId === 'number' ? item.jobId : typeof item.jobId === 'string' && /^\d+$/.test(item.jobId) ? Number(item.jobId) : null
  const failedJob = item.kind === 'job' && item.tone === 'error' && jobId !== null
  const doneJob = item.kind === 'job' && item.tone === 'success' && item.videoId

  const retry = async (): Promise<void> => {
    if (jobId === null) return
    setRetrying(true)
    try {
      await api.retryJob(jobId)
      setRetried(true)
      toast({ tone: 'info', icon: 'retry', title: t('Queued again'), action: { label: t('View queue'), run: () => window.dispatchEvent(new Event('open-queue')) } })
    } catch (e) {
      toast({ tone: 'error', title: t('Could not retry it'), body: e instanceof Error ? e.message.slice(0, 160) : undefined })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <article className="lyr-act-card" data-tone={item.tone} data-unread={unread ? 'true' : 'false'} style={style}>
      <span className="lyr-act-badge" aria-hidden>
        <Icon name={item.kind === 'job' || item.kind === 'publish' ? TONE_ICON[item.tone] : KIND_ICON[item.kind]} size={15} />
      </span>
      <div className="lyr-act-main">
        <div className="lyr-act-top">
          <p className="lyr-act-title">{item.title}</p>
          <time className="lyr-act-time tabular" dateTime={new Date(item.at).toISOString()} title={new Date(item.at).toLocaleString()}>
            {relTime(item.at, now)}
          </time>
        </div>
        {item.body && <p className="lyr-act-body">{item.body}</p>}
        {typeof item.progress === 'number' && (
          <ProgressBar value={item.progress} label={item.title} size="xs" tone="gold" />
        )}
        {(doneJob || failedJob || item.url) && (
          <div className="lyr-act-actions">
            {doneJob && (
              <button
                type="button"
                className="btn-subtle lyr-act-mini nudge"
                onClick={() => {
                  onDone()
                  navigate({ page: 'studio', params: { videoId: item.videoId as string } })
                }}
              >
                <Icon name="scissors" size={13} /> {t('Open clips')}
              </button>
            )}
            {failedJob && (
              <>
                <button type="button" className="btn-subtle lyr-act-mini" disabled={retrying || retried} onClick={() => void retry()}>
                  <Icon name={retried ? 'check' : 'retry'} size={13} className={retrying ? 'anim-spin' : undefined} />
                  {retried ? t('Queued') : t('Retry')}
                </button>
                <button
                  type="button"
                  className="btn-subtle lyr-act-mini"
                  aria-expanded={showLog}
                  onClick={() => setShowLog((s) => !s)}
                >
                  <Icon name="log" size={13} /> {showLog ? t('Hide log') : t('View log')}
                </button>
              </>
            )}
            {item.url && (
              <button type="button" className="btn-subtle lyr-act-mini" onClick={() => openUrl(item.url as string)}>
                <Icon name="external-link" size={13} /> {item.kind === 'publish' ? t('Open post') : t('Open link')}
              </button>
            )}
          </div>
        )}
        {failedJob && (
          <div className="collapse" data-open={showLog ? 'true' : 'false'}>
            <div>{showLog && jobId !== null && <LogViewer jobId={jobId} />}</div>
          </div>
        )}
      </div>
    </article>
  )
}

export default function ActivityDrawer(): JSX.Element | null {
  const { open, close } = useLayer('activity')
  const { items, unread, raw, markAllRead } = useActivity()
  const pulls = useModelPulls()
  const [filter, setFilter] = useState<Filter>('all')
  const [now, setNow] = useState(() => Date.now())

  // Relative times tick while the drawer is open.
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open])

  const unreadIds = useMemo(() => new Set(items.slice(0, unread).map((i) => i.id)), [items, unread])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, log: raw.length }
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1
    return c
  }, [items, raw])

  const shown = useMemo(() => (filter === 'all' || filter === 'log' ? items : items.filter((i) => i.kind === filter)), [items, filter])

  const groups = useMemo(() => {
    const out: { day: string; list: ActivityItem[] }[] = []
    for (const it of shown) {
      const day = dayLabel(it.at)
      const last = out[out.length - 1]
      if (last && last.day === day) last.list.push(it)
      else out.push({ day, list: [it] })
    }
    return out
  }, [shown])

  const pullTags = Object.keys(pulls)

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('Activity')}
      width="400px"
      className="lyr-activity"
      header={
        <div className="lyr-act-head">
          <span className="lyr-act-bell" data-ring={unread > 0 ? 'true' : 'false'} aria-hidden>
            <Icon name="bell" size={18} />
          </span>
          <div className="min-w-0">
            <p className="t-lg text-ink" aria-hidden>
              {t('Activity')}
            </p>
            <p className="text-xs text-muted">{unread > 0 ? `${unread} ${t('new')}` : t('You’re all caught up')}</p>
          </div>
          <button type="button" className="btn-subtle lyr-act-mini ml-auto" disabled={unread === 0} onClick={markAllRead}>
            <Icon name="check" size={13} /> {t('Mark all read')}
          </button>
        </div>
      }
    >
      <div className="lyr-act">
        <div className="lyr-act-filters" role="toolbar" aria-label={t('Filter activity')}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="lyr-chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              <Icon name={f.icon} size={13} />
              {t(f.label)}
              {(counts[f.id] ?? 0) > 0 && <span className="lyr-chip-n tabular">{Math.min(99, counts[f.id] ?? 0)}</span>}
            </button>
          ))}
        </div>

        {pullTags.length > 0 && (filter === 'all' || filter === 'model') && (
          <section className="lyr-act-pulls" aria-label={t('Downloads in progress')}>
            {pullTags.map((tag) => (
              <div key={tag} className="lyr-act-pull">
                <div className="lyr-act-top">
                  <p className="lyr-act-title">
                    <Icon name="download" size={13} /> {tag}
                  </p>
                  <span className="lyr-act-time tabular">{pulls[tag] === null ? '…' : `${Math.round((pulls[tag] ?? 0) * 100)}%`}</span>
                </div>
                <ProgressBar value={pulls[tag]} label={`${t('Downloading')} ${tag}`} size="xs" tone="gold" striped />
              </div>
            ))}
          </section>
        )}

        {filter === 'log' ? (
          raw.length === 0 ? (
            <EmptyState compact illustration="queue" title={t('Nothing logged yet')} body={t('Engine events appear here as they happen.')} />
          ) : (
            <div className="lyr-act-raw">
              <div className="lyr-act-raw-bar">
                <span className="text-xs text-muted">{`${raw.length} ${t('lines, newest first')}`}</span>
                <button type="button" className="btn-subtle lyr-act-mini" onClick={() => void copy(raw.join('\n'))}>
                  <Icon name="copy" size={13} /> {t('Copy all')}
                </button>
              </div>
              <ol className="t-mono">
                {raw.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </div>
          )
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            illustration="sun"
            title={filter === 'all' ? t('All quiet') : t('Nothing here yet')}
            body={t('Finished videos, posts, watched channels and downloads show up here.')}
          />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="lyr-act-day">
              <h3 className="lyr-act-dayhead t-micro">{g.day}</h3>
              <div className="lyr-act-list stagger">
                {g.list.slice(0, 80).map((it, i) => (
                  <EventCard
                    key={it.id}
                    item={it}
                    unread={unreadIds.has(it.id)}
                    now={now}
                    onDone={close}
                    style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </Sheet>
  )
}
