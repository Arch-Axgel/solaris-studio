import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { QueueJob } from '../lib/types'
import { formatQueueEta, jobLabel } from '../lib/queue'
import QueueItem from '../components/queue/QueueItem'
import QueueRows from '../components/queue/QueueRow'
import { t } from '../lib/i18n'
import { useQueueSnapshot, useQueueRun } from '../lib/stores/queueStore'
import { getLiveProgress, useActiveJob, useQueueEta } from '../lib/stores/activeJob'
import { useVisible } from '../lib/stores/useVisible'
import { openCreate, useBreadcrumbs } from '../lib/nav'
import { celebrate } from '../lib/motion'
import { useMedia } from '../components/watch/useMedia'
import { Icon, type IconName } from '../components/icons'
import {
  Button,
  Callout,
  CountUp,
  EmptyState,
  HoldButton,
  PageHeader,
  ProgressRing,
  SearchInput,
  Segmented,
  Skeleton,
  StatusChip,
  Tabs,
  toast
} from '../components/ui'

/** The processing queue.
 *
 *  The point of this screen is to make a long batch survivable: queue ten
 *  videos, each with its own settings, press start, and leave. It is the only
 *  place that mutates queue state — the row components take a job and call
 *  back, so queue rules never end up spread across the UI.
 *
 *  The server is the authority. Events say "something changed, re-read it"
 *  rather than carrying deltas (the shared queue store does the re-reading),
 *  and nothing here is applied optimistically: a reorder that only LOOKS
 *  applied because it raced the worker claiming the head of the queue is
 *  exactly the bug this screen exists to avoid. */

const PAGE = 30

type Lane = 'processing' | 'next' | 'history'

export default function Queue({
  onOpenInStudio,
  active = true
}: {
  onOpenInStudio?: (videoId: string) => void
  active?: boolean
}): JSX.Element {
  const { snapshot, remaining, refresh, unreachable } = useQueueSnapshot()
  const { done } = useQueueRun()
  // Re-renders on every progress event and once a second while running, so
  // the live row and the ETA move.
  const activeJob = useActiveJob()
  const queueEta = useQueueEta()
  const visible = useVisible(active)
  const wide = useMedia('(min-width: 1280px)')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lane, setLane] = useState<Lane>('next')
  const [collapsed, setCollapsed] = useState<Record<Lane, boolean>>({ processing: false, next: false, history: false })
  const [historyTab, setHistoryTab] = useState<'completed' | 'failed'>('completed')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const ringRef = useRef<HTMLDivElement>(null)
  const wasBusy = useRef(false)

  useBreadcrumbs([])

  // Coming back to the page (or the window) re-reads at once; the shared
  // store keeps its own 20s poll and event refresh going meanwhile.
  useEffect(() => {
    if (visible) refresh()
  }, [visible, refresh])

  // A finished batch gets a little burst from the ring.
  useEffect(() => {
    if (!snapshot) return
    if (wasBusy.current && remaining === 0 && done > 0 && visible) celebrate(ringRef.current)
    wasBusy.current = remaining > 0
  }, [remaining, done, snapshot, visible])

  useEffect(() => setShown(PAGE), [historyTab, query])

  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
      if (ok) toast({ title: ok, tone: 'success', icon: 'check', duration: 2500 })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** The server only steps a job one place or jumps it to an end, so a drag
   *  is sent as those steps, one at a time, then the queue is read again. */
  const moveTo = async (job: QueueJob, from: number, to: number): Promise<void> => {
    const last = (snapshot?.queued.length ?? 1) - 1
    try {
      if (to === 0) await api.moveJob(job.id, { to: 'top' })
      else if (to === last) await api.moveJob(job.id, { to: 'bottom' })
      else {
        const delta = to > from ? 1 : -1
        for (let i = 0; i < Math.abs(to - from); i++) {
          const r = await api.moveJob(job.id, { delta })
          if (!r.moved) break
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      refresh()
    }
  }

  const paused = snapshot?.paused ?? false
  const processingJobs = snapshot?.processing ?? []
  const queuedJobs = snapshot?.queued ?? []
  const confident = snapshot?.estimate.confident ?? false
  const state: 'running' | 'paused' | 'stopping' | 'idle' = paused
    ? processingJobs.length > 0
      ? 'stopping'
      : 'paused'
    : remaining > 0
      ? 'running'
      : 'idle'
  // Overall fraction of this run: finished videos plus the running one's share.
  const total = done + remaining
  const overall = total > 0 ? Math.min(1, (done + (activeJob.running ? activeJob.fraction : 0)) / total) : 0
  const live = getLiveProgress()
  const now = Date.now()

  const history = historyTab === 'completed' ? (snapshot?.completed ?? []) : (snapshot?.failed ?? [])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((j) => `${jobLabel(j)} ${j.url} ${j.channel ?? ''}`.toLowerCase().includes(q))
  }, [history, query])

  const item = (job: QueueJob, index: number, list: QueueJob[], large = false): JSX.Element => (
    <QueueItem
      key={job.id}
      job={job}
      index={index}
      total={list.length}
      live={job.status === 'running' ? live : undefined}
      now={now}
      onChanged={refresh}
      onOpenInStudio={onOpenInStudio}
      large={large}
    />
  )

  const laneHead = (id: Lane, icon: IconName, title: string, count: number, action?: React.ReactNode): JSX.Element => (
    <div className="ops-lane-head">
      <button
        type="button"
        className="ops-lane-toggle"
        aria-expanded={!collapsed[id]}
        onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
      >
        <Icon name="chevron-right" size={14} className="ops-lane-chev" />
        <Icon name={icon} size={16} className="text-gold" />
        <span className="t-micro">{t(title)}</span>
        <span className="ops-lane-count tabular">{count}</span>
      </button>
      <div className="ml-auto flex items-center gap-2">{action}</div>
    </div>
  )

  const processingLane = (
    <section className="ops-lane" data-lane="processing" aria-label={t('Processing')}>
      {laneHead('processing', 'zap', 'Processing', processingJobs.length)}
      <div className="collapse" data-open={collapsed.processing ? 'false' : 'true'}>
        <div>
          <div className="ops-lane-body">
            {processingJobs.length === 0 ? (
              <div className="ops-lane-empty">
                <Icon name={paused ? 'pause' : 'sun'} size={20} />
                <p>{paused ? t('The queue is stopped.') : remaining > 0 ? t('Starting the next video…') : t('Nothing is processing.')}</p>
              </div>
            ) : (
              processingJobs.map((j, i) => (
                <div key={j.id} className="card-glow ops-processing-card anim-scale">
                  {item(j, i, processingJobs, true)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )

  const nextLane = (
    <section className="ops-lane" data-lane="next" aria-label={t('Up next')}>
      {laneHead(
        'next',
        'list',
        'Up next',
        queuedJobs.length,
        queuedJobs.length > 0 ? (
          <HoldButton
            size="sm"
            variant="subtle"
            label={t('Clear waiting')}
            disabled={busy}
            onConfirm={() => void act(() => api.clearQueue('queued'), t('Waiting videos cleared'))}
          />
        ) : undefined
      )}
      <div className="collapse" data-open={collapsed.next ? 'false' : 'true'}>
        <div>
          <div className="ops-lane-body">
            {queuedJobs.length === 0 ? (
              <div className="ops-lane-empty">
                <Icon name="plus" size={20} />
                <p>{t('Nothing waiting.')}</p>
                <Button size="sm" variant="subtle" onClick={() => openCreate({ mode: 'queue' })}>
                  {t('+ Add videos')}
                </Button>
              </div>
            ) : (
              <>
                <p className="ops-lane-hint">
                  <Icon name="grip" size={12} /> {t('Drag to reorder, or Alt+↑ / Alt+↓ on a row.')}
                </p>
                <QueueRows
                  jobs={queuedJobs}
                  onMove={moveTo}
                  renderItem={(j, i) => item(j, i + 1, queuedJobs)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )

  const failedCount = snapshot?.failed.length ?? 0
  const completedCount = snapshot?.completed.length ?? 0
  const historyLane = (
    <section className="ops-lane" data-lane="history" aria-label={t('Done & failed')}>
      {laneHead(
        'history',
        'check',
        'Done & failed',
        completedCount + failedCount,
        history.length > 0 ? (
          <HoldButton
            size="sm"
            variant="subtle"
            label={historyTab === 'completed' ? t('Clear completed') : t('Clear failed')}
            disabled={busy}
            onConfirm={() =>
              void act(
                () => api.clearQueue(historyTab),
                historyTab === 'completed' ? t('Completed videos cleared') : t('Failed videos cleared')
              )
            }
          />
        ) : undefined
      )}
      <div className="collapse" data-open={collapsed.history ? 'false' : 'true'}>
        <div>
          <div className="ops-lane-body">
            <div className="flex items-center gap-2 flex-wrap">
              <Segmented
                size="sm"
                ariaLabel={t('Show')}
                value={historyTab}
                onChange={(id) => setHistoryTab(id as 'completed' | 'failed')}
                items={[
                  { id: 'completed', label: t('Completed'), icon: 'check', badge: completedCount || undefined },
                  { id: 'failed', label: t('Failed'), icon: 'alert', badge: failedCount || undefined }
                ]}
              />
              <div className="flex-1 min-w-40">
                <SearchInput value={query} onChange={setQuery} placeholder={t('Filter by title')} ariaLabel={t('Filter by title')} />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="ops-lane-empty">
                <Icon name={query ? 'search' : historyTab === 'failed' ? 'heart' : 'clock'} size={20} />
                <p>
                  {query
                    ? t('No video matches that.')
                    : historyTab === 'failed'
                      ? t('Nothing has failed.')
                      : t('Finished videos show up here.')}
                </p>
              </div>
            ) : (
              <div className="space-y-2 stagger">
                {filtered.slice(0, shown).map((j, i) => (
                  <div key={j.id} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
                    {item(j, 0, filtered)}
                  </div>
                ))}
              </div>
            )}
            {filtered.length > shown && (
              <Button size="sm" variant="subtle" icon="chevron-down" className="w-full justify-center" onClick={() => setShown((n) => n + PAGE)}>
                {t('Show more')} ({filtered.length - shown})
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )

  const toggle =
    state === 'idle' ? null : paused ? (
      <Button
        variant="gold"
        size="lg"
        icon="play"
        disabled={busy}
        onClick={() => void act(api.resumeQueue)}
        title={t('Start working through the queue, one video at a time.')}
      >
        {t('Start queue')}
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="lg"
        icon="pause"
        disabled={busy}
        onClick={() => void act(api.pauseQueue)}
        title={t('Finish the current video, then stop. The queue is kept.')}
      >
        {t('Pause queue')}
      </Button>
    )

  return (
    <div className="ops-page max-w-[1600px] mx-auto p-6 space-y-6 w-full">
      <PageHeader
        eyebrow={t('Make')}
        icon="layers"
        title={t('Processing queue')}
        vtName="page-title"
        subtitle={t('Queue up a batch, then leave Solaris Studio running - it works through them on its own.')}
        actions={
          <Button variant="accent" onClick={(e) => openCreate({ mode: 'queue', originRect: e.currentTarget.getBoundingClientRect() })}>
            {t('+ Add videos')}
          </Button>
        }
      />

      {error && (
        <Callout tone="error" title={t('Something went wrong')} onDismiss={() => setError(null)}>
          {error}
        </Callout>
      )}

      {!snapshot && unreachable && (
        <div className="card ops-empty anim-rise">
          <EmptyState
            illustration="sun"
            title={t('The engine isn’t answering')}
            body={t('If it was just starting, give it a moment. The queue appears here as soon as it replies.')}
            action={
              <Button variant="ghost" icon="refresh" onClick={() => refresh()}>
                {t('Try again')}
              </Button>
            }
          />
        </div>
      )}

      {!snapshot && !unreachable && (
        <div className="grid gap-4 xl:grid-cols-3" aria-busy="true">
          <Skeleton h={180} radius={16} className="xl:col-span-3" />
          <Skeleton h={260} radius={16} />
          <Skeleton h={260} radius={16} />
          <Skeleton h={260} radius={16} />
        </div>
      )}

      {snapshot && remaining > 0 && (
        <section className="card-hero ops-band anim-rise" aria-label={t('Queue status')} data-state={state}>
          <div ref={ringRef} className="ops-band-ring">
            <ProgressRing
              value={overall}
              size={132}
              stroke={7}
              label={t('Overall progress')}
              tone={state === 'running' ? 'gold' : 'accent'}
            >
              <span className="flex flex-col items-center leading-tight">
                <span className="t-micro text-muted">{t('ETA')}</span>
                <span className="ops-band-eta tabular">{queueEta !== null ? formatQueueEta(queueEta) : '—'}</span>
              </span>
            </ProgressRing>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusChip status={state === 'idle' ? 'idle' : state} />
              <span className="text-xs text-muted tabular">
                {done > 0 && `${done} ${t('done this run')} · `}
                {Math.round(overall * 100)}%
              </span>
            </div>
            <p className="ops-band-count">
              <CountUp value={remaining} className="text-foil" />{' '}
              <span className="text-ink">{remaining === 1 ? t('video remaining') : t('videos remaining')}</span>
            </p>
            {queueEta !== null && (
              <p className="text-sm text-muted">
                {confident ? t('About') : t('Roughly')} {formatQueueEta(queueEta)} {t('to go')}
                {!confident && ` · ${t('the estimate sharpens after a few videos')}`}
              </p>
            )}
            {paused && (
              <p className="text-sm text-warn inline-flex items-center gap-1.5">
                <Icon name="pause" size={14} />
                {processingJobs.length > 0
                  ? t('Stopping - the current video finishes, then the queue stops.')
                  : t('Stopped - nothing runs until you press Start queue.')}
              </p>
            )}
            {activeJob.running && activeJob.title && (
              <p className="text-sm text-muted truncate">
                <span className="text-gold-strong">{activeJob.stageLabel}</span> · {activeJob.title}
              </p>
            )}
          </div>
          <div className="ops-band-actions">{toggle}</div>
        </section>
      )}

      {snapshot && remaining === 0 && (
        <div className="card ops-empty anim-rise">
          <EmptyState
            illustration="queue"
            title={t('Your queue is empty')}
            body={t('Queue lets you line up many videos and leave Solaris Studio working.')}
            action={
              <Button
                variant="gold"
                icon="plus"
                onClick={(e) => openCreate({ mode: 'queue', originRect: e.currentTarget.getBoundingClientRect() })}
              >
                {t('New clips')}
              </Button>
            }
          />
        </div>
      )}

      {snapshot &&
        (remaining === 0 ? (
          completedCount + failedCount > 0 && historyLane
        ) : wide ? (
          <div className="ops-lanes">
            {processingLane}
            {nextLane}
            {historyLane}
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs
              ariaLabel={t('Queue lanes')}
              variant="pill"
              value={lane}
              onChange={(id) => setLane(id as Lane)}
              items={[
                { id: 'processing', label: t('Processing'), icon: 'zap', badge: processingJobs.length || undefined },
                { id: 'next', label: t('Up next'), icon: 'list', badge: queuedJobs.length || undefined },
                { id: 'history', label: t('Done & failed'), icon: 'check', badge: completedCount + failedCount || undefined }
              ]}
            />
            <div key={lane} className="anim-fade">
              {lane === 'processing' ? processingLane : lane === 'next' ? nextLane : historyLane}
            </div>
          </div>
        ))}
    </div>
  )
}
