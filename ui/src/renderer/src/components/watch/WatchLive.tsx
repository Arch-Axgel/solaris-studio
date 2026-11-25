import { useEffect, useState } from 'react'
import { relative } from './WatchCard'
import { useWatchActivity } from './useWatchActivity'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { ProgressBar } from '../ui'

/** "On air now": what the watcher is doing this second, big enough to read
 *  on a screen recording, and fed by the engine's own steps rather than
 *  guessed. The last few steps live in the events timeline beside it. */
export default function WatchLive({ visible = true }: { visible?: boolean }): JSX.Element | null {
  const live = useWatchActivity(visible)
  const [now, setNow] = useState(Date.now() / 1000)

  useEffect(() => {
    if (!visible) return
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(tick)
  }, [visible])

  if (!live) return null
  const state = live.now.state
  const on = state !== 'off'
  const busy = state === 'busy'
  const percent = live.now.progress?.percent
  const latest = live.events[0]

  return (
    <section className="ops-onair" data-state={state} aria-label={t('Live')} aria-live="polite">
      <div className="ops-onair-tag">
        <span className="ops-onair-dot" aria-hidden />
        <span>{busy ? t('On air now') : on ? t('Live') : t('Off')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="ops-onair-text truncate">{live.now.text}</p>
        {busy && percent != null ? (
          <div className="mt-1.5 flex items-center gap-3">
            <ProgressBar value={percent / 100} label={t('Clipping progress')} tone="gold" striped size="xs" className="flex-1" />
            <span className="text-xs text-muted tabular shrink-0">
              {percent}% · {live.now.progress?.label}
              {live.now.progress?.eta_seconds
                ? ` · ${t('about')} ${Math.max(1, Math.round(live.now.progress.eta_seconds / 60))} ${t('min left')}`
                : ''}
            </span>
          </div>
        ) : (
          latest && (
            <p className="text-xs text-muted truncate mt-0.5">
              <Icon name="clock" size={11} className="inline -mt-0.5 mr-1" />
              {relative(latest.at, now)} · {latest.text}
            </p>
          )
        )}
      </div>
    </section>
  )
}
