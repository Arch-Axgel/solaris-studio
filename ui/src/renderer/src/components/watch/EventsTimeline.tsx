import { useEffect, useState } from 'react'
import type { AutomationActivity } from '../../lib/types'
import { relative } from './WatchCard'
import { t } from '../../lib/i18n'
import { Icon, type IconName } from '../icons'
import { EmptyState } from '../ui'

const KIND: Record<string, { icon: IconName; tone: string }> = {
  found: { icon: 'eye', tone: 'gold' },
  queued: { icon: 'layers', tone: 'ink' },
  posted: { icon: 'send', tone: 'success' },
  done: { icon: 'check', tone: 'success' },
  waiting: { icon: 'clock', tone: 'warn' },
  retry: { icon: 'retry', tone: 'warn' },
  error: { icon: 'alert', tone: 'error' },
  info: { icon: 'info', tone: 'muted' },
  learned: { icon: 'sparkle', tone: 'gold' }
}

/** The watcher's recent steps as a vertical timeline: when, what, and the
 *  video or post it was about (opens in the browser). */
export default function EventsTimeline({
  activity,
  limit = 30
}: {
  activity: AutomationActivity | null
  limit?: number
}): JSX.Element {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 15000)
    return () => clearInterval(id)
  }, [])

  const events = activity?.events.slice(0, limit) ?? []
  if (activity && events.length === 0) {
    return (
      <EmptyState
        compact
        illustration="radar"
        title={t('Nothing yet')}
        body={t('Every check, find, clip and post shows up here as it happens.')}
      />
    )
  }
  return (
    <ol className="ops-timeline" aria-label={t('Recent activity')}>
      {events.map((e, i) => {
        const k = KIND[e.kind] ?? KIND.info
        return (
          <li
            key={`${e.at}-${i}`}
            className="ops-tl-item"
            data-tone={k.tone}
            style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
          >
            <span className="ops-tl-node" aria-hidden>
              <Icon name={k.icon} size={12} />
            </span>
            <div className="min-w-0">
              <p className="ops-tl-time tabular">{relative(e.at, now)}</p>
              <p className="ops-tl-text">{e.text}</p>
              {e.url && (
                <button
                  type="button"
                  className="ops-tl-link"
                  title={t('Open in your browser')}
                  onClick={() => void window.studio?.openExternal?.(e.url as string)}
                >
                  <span className="truncate">{e.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  <Icon name="external-link" size={11} />
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
