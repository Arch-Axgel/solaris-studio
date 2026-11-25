import { useState } from 'react'
import { Icon } from '../icons'
import { Badge, Button, Card, ProgressBar, ProgressRing, toast, useConfirm } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { formatEta } from '../../lib/jobProgress'
import { navigate, openCreate } from '../../lib/nav'
import { formatQueueEta } from '../../lib/queue'
import { useActiveJob, useQueueEta } from '../../lib/stores/activeJob'
import { useQueueSnapshot } from '../../lib/stores/queueStore'
import { tf } from './homeUtil'

const STAGE_STEPS: { id: string; label: string; match: RegExp }[] = [
  { id: 'get', label: 'Fetch', match: /download|prefetch|fetch|import|probe/i },
  { id: 'listen', label: 'Listen', match: /transcri|whisper|audio|diariz|speaker/i },
  { id: 'find', label: 'Find', match: /analy|score|rank|moment|understand|llm|select|segment|title/i },
  { id: 'render', label: 'Render', match: /render|crop|caption|export|encode|track|face/i }
]

function stageIndex(stage?: string, label?: string): number {
  const s = `${stage ?? ''} ${label ?? ''}`
  for (let i = STAGE_STEPS.length - 1; i >= 0; i--) if (STAGE_STEPS[i].match.test(s)) return i
  return 0
}

/** The spotlight for the one running video: a big ring that shares the
 *  `np-ring` transition with the TopBar pill, the stage, ETA, and Cancel. */
export default function NowProcessing({ active, className }: { active: boolean; className?: string }): JSX.Element {
  const job = useActiveJob()
  const { queued, refresh } = useQueueSnapshot()
  const queueEta = useQueueEta()
  const ask = useConfirm()
  const [cancelling, setCancelling] = useState(false)
  const [toggling, setToggling] = useState(false)

  const cancel = async (): Promise<void> => {
    if (!job.videoId) return
    const ok = await ask({
      title: t('Stop this video?'),
      body: job.title ? tf('“{title}” stops now. Clips already rendered are kept.', { title: job.title }) : t('Clips already rendered are kept.'),
      confirmLabel: t('Stop processing'),
      tone: 'danger'
    })
    if (!ok) return
    setCancelling(true)
    try {
      await api.cancelProcessing(job.videoId)
      toast({ title: t('Stopping…'), tone: 'info', icon: 'stop' })
    } catch (e) {
      toast({ title: t('Couldn’t stop it'), body: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setCancelling(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    setToggling(true)
    try {
      if (job.paused) await api.resumeQueue()
      else await api.pauseQueue()
      refresh()
    } catch (e) {
      toast({ title: t('The queue didn’t respond'), body: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setToggling(false)
    }
  }

  if (!job.running) {
    return (
      <Card variant="glass" className={`home-np home-np-idle ${className ?? ''}`} aria-label={t('Now processing')}>
        <div className="home-np-idle-art" aria-hidden>
          <span className="home-np-orbit" />
          <span className="home-np-orbit home-np-orbit-2" />
          <span className="home-np-core">
            <Icon name={queued > 0 ? 'layers' : 'sun'} size={26} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-micro">{t('Now processing')}</p>
          {queued > 0 ? (
            <>
              <p className="t-lg text-ink mt-1">
                {tf(queued === 1 ? 'Up next: {n} video' : 'Up next: {n} videos', { n: queued })}
                {queueEta ? <span className="text-muted"> · {formatQueueEta(queueEta)}</span> : null}
              </p>
              <p className="text-sm text-muted mt-1">
                {job.paused ? t('The queue is paused. Resume when you’re ready.') : t('Starting the next one…')}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button variant={job.paused ? 'accent' : 'ghost'} icon={job.paused ? 'play' : 'pause'} loading={toggling} onClick={() => void togglePause()}>
                  {job.paused ? t('Resume') : t('Pause')}
                </Button>
                <Button variant="subtle" iconRight="arrow-right" className="nudge" onClick={() => navigate({ page: 'queue' })}>
                  {t('Open queue')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="t-lg text-ink mt-1">{t('Nothing running')}</p>
              <p className="text-sm text-muted mt-1">{t('The engine is idle. Paste a link above, or open every option.')}</p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button variant="accent" icon="plus" onClick={(e) => openCreate({ originRect: e.currentTarget.getBoundingClientRect() })}>
                  {t('Start something')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    )
  }

  const pct = Math.round(job.fraction * 100)
  const step = stageIndex(job.stage, job.stageLabel)
  return (
    <Card variant="glow" className={`home-np home-np-running ${className ?? ''}`} aria-label={t('Now processing')} aria-live="polite">
      <div className="home-np-ring-wrap">
        <ProgressRing
          value={job.fraction > 0 ? job.fraction : null}
          size={128}
          stroke={7}
          label={t('Processing progress')}
          vtName={active ? 'np-ring' : undefined}
        >
          <span className="home-np-pct tabular">{job.fraction > 0 ? `${pct}%` : '…'}</span>
          <span className="home-np-pct-sub">{t('done')}</span>
        </ProgressRing>
        <span className="home-np-halo" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="gold" icon="play" size="xs">
            {job.paused ? t('Pausing after this') : t('Running')}
          </Badge>
          <p className="t-micro">{job.stageLabel ?? t('Working…')}</p>
        </div>
        <p className="t-lg text-ink mt-1.5 truncate" title={job.title}>
          {job.title || t('A video')}
        </p>
        <ol className="home-np-steps" aria-label={t('Stages')}>
          {STAGE_STEPS.map((s, i) => (
            <li key={s.id} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
              <span className="home-np-step-dot" aria-hidden />
              {t(s.label)}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {job.clip && (
            <Badge tone="accent" icon="film" size="xs">
              {tf('clip {a} of {b}', { a: job.clip.current, b: job.clip.total })}
            </Badge>
          )}
          {job.remote && (
            <Badge tone="muted" icon="cpu" size="xs">
              {job.remote}
            </Badge>
          )}
          {job.plugin && (
            <Badge tone="muted" icon="store" size="xs">
              {job.plugin}
            </Badge>
          )}
          <span className="text-xs text-muted tabular flex items-center gap-1">
            <Icon name="clock" size={12} />
            {job.etaSeconds !== null ? tf('about {eta} left', { eta: formatEta(job.etaSeconds) }) : t('estimating time…')}
          </span>
          {queued > 0 && <span className="text-xs text-muted">· {tf('{n} waiting', { n: queued })}</span>}
        </div>
        <ProgressBar value={job.fraction > 0 ? job.fraction : null} label={t('Processing progress')} striped size="sm" className="mt-3" />
        <div className="flex flex-wrap gap-2 mt-4">
          <Button variant="danger" size="sm" icon="stop" loading={cancelling} onClick={() => void cancel()}>
            {t('Cancel')}
          </Button>
          <Button variant="ghost" size="sm" icon={job.paused ? 'play' : 'pause'} loading={toggling} onClick={() => void togglePause()}>
            {job.paused ? t('Resume queue') : t('Pause queue')}
          </Button>
          <Button variant="subtle" size="sm" iconRight="arrow-right" className="nudge" onClick={() => navigate({ page: 'queue' })}>
            {t('Open queue')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Three small rings: processing, waiting and failed, plus "Open queue". */
export function QueueMini({ className }: { className?: string }): JSX.Element {
  const { processing, queued, failed } = useQueueSnapshot()
  const total = Math.max(1, processing + queued + failed)
  const rings: { label: string; n: number; tone: 'gold' | 'accent' | 'error'; icon: 'play' | 'clock' | 'alert' }[] = [
    { label: t('Processing'), n: processing, tone: 'gold', icon: 'play' },
    { label: t('Waiting'), n: queued, tone: 'accent', icon: 'clock' },
    { label: t('Failed'), n: failed, tone: 'error', icon: 'alert' }
  ]
  return (
    <Card className={`home-qmini ${className ?? ''}`} aria-label={t('Queue')}>
      <div className="flex items-center justify-between">
        <p className="t-micro">{t('Queue')}</p>
        <Icon name="layers" size={16} className="text-muted" />
      </div>
      <div className="home-qmini-rings">
        {rings.map((r) => (
          <div key={r.label} className="home-qmini-item" data-zero={r.n === 0 ? 'true' : 'false'}>
            <ProgressRing value={r.n / total} size={64} stroke={5} tone={r.tone} label={`${r.label}: ${r.n}`}>
              <span className="home-qmini-n tabular">{r.n}</span>
            </ProgressRing>
            <span className="text-xs text-muted flex items-center gap-1">
              <Icon name={r.icon} size={11} />
              {r.label}
            </span>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" iconRight="arrow-right" className="nudge w-full mt-auto" onClick={() => navigate({ page: 'queue' })}>
        {failed > 0 ? tf('Open queue · {n} failed', { n: failed }) : t('Open queue')}
      </Button>
    </Card>
  )
}
