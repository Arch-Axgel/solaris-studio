import { api } from '../../lib/api'
import { formatEta } from '../../lib/jobProgress'
import { t } from '../../lib/i18n'
import { navigate, useRoute } from '../../lib/nav'
import { useActiveJob } from '../../lib/stores/activeJob'
import ProcessingBar from '../ProcessingBar'
import { Button, Popover, ProgressRing, toast, useConfirm } from '../ui'

/** The running job, always in view (spec 3.6): a ring, the stage, percent
 *  and ETA. Hidden when idle. Opens a spotlight popover. */
export default function JobsPill(): JSX.Element | null {
  const job = useActiveJob()
  const route = useRoute()
  const confirm = useConfirm()
  if (!job.running) return null
  const pct = Math.round(job.fraction * 100)
  // Home has its own "Now processing" ring carrying the shared name.
  const vtName = route.page === 'home' ? undefined : 'np-ring'

  const cancel = async (close: () => void): Promise<void> => {
    if (!job.videoId) return
    const ok = await confirm({
      title: t('Stop processing this video?'),
      body: job.title ? `“${job.title}”` : undefined,
      confirmLabel: t('Stop it'),
      cancelLabel: t('Keep going'),
      tone: 'danger'
    })
    if (!ok) return
    close()
    try {
      await api.cancelProcessing(job.videoId)
      toast({ tone: 'info', title: t('Stopping…'), body: job.title })
    } catch {
      toast({ tone: 'error', title: t('Could not stop it') })
    }
  }

  return (
    <Popover
      align="end"
      width={460}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          className="jobs-pill anim-scale"
          data-jobs-pill
          data-tour="activity"
          aria-expanded={p['aria-expanded']}
          onClick={p.onClick}
          aria-label={`${t('Processing')}: ${job.title ?? ''} ${pct}%`}
        >
          <ProgressRing value={job.fraction > 0 ? job.fraction : null} size={22} stroke={3} label={t('Progress')} vtName={vtName} />
          <span className="jobs-pill-text">
            <span className="jobs-pill-stage">{t(job.stageLabel ?? 'Working…')}</span>
            <span className="jobs-pill-meta tabular">
              {pct}%{job.etaSeconds !== null ? ` · ${formatEta(job.etaSeconds)}` : ''}
            </span>
          </span>
          {job.queuedAfter > 0 && <span className="jobs-pill-more tabular">+{job.queuedAfter}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-3 p-1">
          <div className="flex items-center gap-3">
            <ProgressRing value={job.fraction > 0 ? job.fraction : null} size={52} stroke={4} label={t('Progress')}>
              <span className="text-xs font-semibold text-ink tabular">{pct}%</span>
            </ProgressRing>
            <div className="min-w-0">
              <p className="t-micro">{t('Now processing')}</p>
              <p className="t-md text-ink truncate">{job.title || t('A video')}</p>
              <p className="text-xs text-muted truncate">
                {t(job.stageLabel ?? '')}
                {job.clip ? ` · ${t('clip')} ${job.clip.current}/${job.clip.total}` : ''}
                {job.remote ? ` · ${job.remote}` : ''}
              </p>
            </div>
          </div>
          <ProcessingBar />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted">
              {job.queuedAfter > 0 ? `${job.queuedAfter} ${t('more waiting')}` : t('Nothing else waiting')}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon="layers"
                onClick={() => {
                  close()
                  navigate({ page: 'queue' })
                }}
              >
                {t('Open queue')}
              </Button>
              {job.videoId && (
                <Button size="sm" variant="danger" icon="stop" onClick={() => void cancel(close)}>
                  {t('Cancel')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Popover>
  )
}
