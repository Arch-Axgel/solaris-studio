import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import { Button, Card, Skeleton } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { navigate } from '../../lib/nav'
import { useStudioEvents } from '../../lib/stores/eventBus'
import { useVisible } from '../../lib/stores/useVisible'
import type { AutomationActivity } from '../../lib/types'
import { relativeTime, tf, useTicker } from './homeUtil'

function countdown(seconds: number): string {
  if (seconds <= 0) return t('checking now')
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Watch radar mini: the sweep, the countdown to the next channel check and
 *  the latest thing the watcher did. */
export default function WatchMini({ active, className }: { active: boolean; className?: string }): JSX.Element {
  const visible = useVisible(active)
  const [act, setAct] = useState<AutomationActivity | null>(null)
  const [failed, setFailed] = useState(false)
  const now = useTicker(visible && Boolean(act?.next_check_at), 1000)

  const load = useCallback(async (): Promise<void> => {
    try {
      setAct(await api.automationActivity())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [visible, load])

  useStudioEvents((e) => {
    if (e.type === 'automation' && visible) void load()
  })

  const watching = act?.watching ?? 0
  const on = watching > 0
  const left = act?.next_check_at ? act.next_check_at - now / 1000 : 0
  const latest = act?.events[0]
  return (
    <Card className={`home-watch ${on ? '' : 'radar-off'} ${className ?? ''}`} aria-labelledby="home-watch-title">
      <div className="flex items-center justify-between">
        <p className="t-micro" id="home-watch-title">
          {t('Watched channels')}
        </p>
        {on && (
          <span className="home-live-dot" title={t('Watching')}>
            <span />
          </span>
        )}
      </div>
      <div className="home-watch-body">
        <div className="home-radar" aria-hidden>
          <span className="radar-sweep" />
          <span className="home-radar-ring" />
          <span className="home-radar-ring home-radar-ring-2" />
          <span className="home-radar-blip" />
        </div>
        <div className="min-w-0">
          {act === null && !failed ? (
            <Skeleton w={90} h={18} />
          ) : (
            <>
              <p className="t-md text-ink tabular">{on ? countdown(left) : t('Off')}</p>
              <p className="text-xs text-muted">
                {on
                  ? tf(watching === 1 ? 'next check · {n} channel' : 'next check · {n} channels', { n: watching })
                  : t('No channels watched')}
              </p>
            </>
          )}
        </div>
      </div>
      <p className="home-watch-event text-xs text-muted" title={latest?.text}>
        {latest ? (
          <>
            <Icon name="radar" size={12} />
            <span className="truncate">{latest.text}</span>
            <span className="shrink-0 opacity-70">· {relativeTime(latest.at * 1000, now)}</span>
          </>
        ) : (
          act?.now.text ?? t('New uploads get clipped automatically.')
        )}
      </p>
      <Button variant="ghost" size="sm" iconRight="arrow-right" className="nudge w-full mt-auto" onClick={() => navigate({ page: 'watch' })}>
        {on ? t('Open radar') : t('Watch a channel')}
      </Button>
    </Card>
  )
}
