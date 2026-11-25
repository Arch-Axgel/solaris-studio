import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { platformLabel } from '../lib/uploadpost'
import { Icon } from './icons'
import { Dialog } from './ui'
import { useClosingDialog } from './library/useClosingDialog'

/** What is due, and what actually happened.
 *
 *  This exists because of a real run: 37 clips went out at once, five posted
 *  and thirty-two failed, and the app could say nothing about any of it. The
 *  rows sat at "processing" forever because nothing ever asked again, so a
 *  queue moving slowly looked exactly like a batch that had died. The answer
 *  was counting Shorts on YouTube by hand.
 *
 *  Refresh asks the provider what became of everything still in the air. It
 *  is a button rather than a poll because these runs stretch over days: a
 *  timer would spend its life asking about posts due on Thursday.
 */
const STATE_STYLE: Record<string, string> = {
  published: 'text-success',
  failed: 'text-error',
  skipped: 'text-muted',
  processing: 'text-warn',
  queued: 'text-warn'
}

export default function ScheduleView({ onClose }: { onClose: () => void }): JSX.Element {
  const [open, close] = useClosingDialog(onClose)
  const [posts, setPosts] = useState<
    {
      clip_id: number
      platform: string
      state: string
      scheduled_for: string
      post_url: string
      error: string
      title: string
    }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = async (): Promise<void> => {
    try {
      const got = await api.woopSocialSchedule()
      setPosts(got.posts)
    } catch {
      /* provider off or no key: an empty schedule is the honest answer */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const refresh = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote('')
    try {
      const got = await api.woopSocialRefresh()
      setNote(
        got.checked === 0
          ? t('Nothing is waiting.')
          : `${t('Checked')} ${got.checked}, ${t('updated')} ${got.updated}, ${got.still_waiting} ${t('still waiting')}.`
      )
      await load()
    } catch (e) {
      setNote(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const done = posts.filter((p) => p.state === 'published').length
  const failed = posts.filter((p) => p.state === 'failed').length
  const waiting = posts.filter(
    (p) => p.state === 'queued' || p.state === 'processing' || p.state === 'sending'
  ).length

  const total = posts.length || 1
  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      className="lib-dialog"
      title={t('Posting schedule')}
      description={
        posts.length
          ? `${done} ${t('posted')}, ${waiting} ${t('waiting')}, ${failed} ${t('failed')}.`
          : t('Nothing scheduled yet.')
      }
      footer={
        <div className="flex gap-2 w-full">
          <button
            className="btn-ghost !py-2 inline-flex items-center gap-1.5"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <Icon name="refresh" size={14} className={busy ? 'anim-spin' : ''} />
            {busy ? t('Checking…') : t('Refresh')}
          </button>
          <button className="btn-accent flex-1 !py-2" onClick={close}>
            {t('Done')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {posts.length > 0 && (
          <div className="lib-sched-meter" role="img" aria-label={`${done} ${t('posted')}, ${waiting} ${t('waiting')}, ${failed} ${t('failed')}.`}>
            <span className="lib-sched-ok" style={{ width: `${(done / total) * 100}%` }} />
            <span className="lib-sched-wait" style={{ width: `${(waiting / total) * 100}%` }} />
            <span className="lib-sched-fail" style={{ width: `${(failed / total) * 100}%` }} />
          </div>
        )}

        {note && <p className="text-xs text-muted">{note}</p>}

        <div className="lib-dialog-list lib-sched-list">
          {loading && (
            <div className="p-3 space-y-2" aria-busy>
              <p className="text-sm text-muted">{t('Loading…')}</p>
              <span className="skeleton block h-6 w-full" />
              <span className="skeleton block h-6 w-5/6" />
            </div>
          )}
          {!loading && posts.length === 0 && (
            <p className="p-4 text-sm text-muted text-center">
              {t('Publish some clips with a daily budget and they will appear here.')}
            </p>
          )}
          {posts.map((p, i) => (
            <div
              key={`${p.clip_id}-${p.platform}`}
              className="lib-sched-row"
              style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            >
              <span className="t-mono text-muted w-36 shrink-0">
                {p.scheduled_for ? new Date(p.scheduled_for).toLocaleString() : '-'}
              </span>
              <span className="flex-1 min-w-0 truncate text-ink" title={p.title}>
                {p.title}
              </span>
              <span className="lib-chip shrink-0">{platformLabel(p.platform)}</span>
              <span className={`text-xs shrink-0 w-20 inline-flex items-center gap-1.5 ${STATE_STYLE[p.state] || 'text-muted'}`}>
                <span className="lib-status-dot" aria-hidden />
                {p.state}
              </span>
              {p.post_url ? (
                <button
                  className="text-xs text-gold hover:text-gold-strong hover:underline shrink-0"
                  onClick={() => void window.studio?.openExternal?.(p.post_url)}
                >
                  {t('Open')}
                </button>
              ) : (
                <span className="w-10 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {failed > 0 && (
          <p className="text-xs text-warn">
            {t(
              'Failed posts are usually the daily limit: WoopSocial allows five YouTube posts a day. Publish the rest with a daily budget rather than all at once.'
            )}
          </p>
        )}
      </div>
    </Dialog>
  )
}
