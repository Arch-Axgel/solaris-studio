import { useEffect, useRef, useState } from 'react'
import { Button, Disclosure } from '../ui'
import { t } from '../../lib/i18n'
import { useActivity } from '../../lib/stores/activity'
import { useStudioEvents } from '../../lib/stores/eventBus'
import type { StudioEvent } from '../../lib/types'

/** The engine's technical event feed, one line per change. Moved here from
 *  the old Dashboard. */
export function describeEvent(e: StudioEvent): string {
  if (e.type === 'progress') {
    if (e.stage === 'render') return `Rendering clip ${e.clip}/${e.total}${e.remote ? ` · ${e.remote}` : ''}`
    if (e.stage === 'done') return `Finished — ${e.clips} clip(s) created`
    if (e.stage === 'prefetch') return 'Downloading the next queued video in the background'
    return `Stage: ${e.stage}${e.title ? ` — ${e.title}` : ''}`
  }
  if (e.type === 'job') return `Job ${e.job_id}: ${e.status}${e.error ? ` (${e.error})` : ''}`
  if (e.type === 'model_pull') return `Model ${e.tag}: ${e.status}`
  return JSON.stringify(e)
}

/** "Activity log (advanced)": a closed Disclosure holding the monospace log,
 *  oldest first, following the bottom only while you are already there. */
export default function ActivityLog({ className }: { className?: string }): JSX.Element {
  const { raw } = useActivity()
  // Seeded from the shared store (it has been listening since start-up).
  const [log, setLog] = useState<string[]>(() => [...raw].reverse().slice(-200))
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useStudioEvents((e) => {
    const msg = describeEvent(e)
    const line = `${new Date().toLocaleTimeString()}  ${msg}`
    setLog((prev) => {
      // Skip consecutive duplicates so a stage that reports every second
      // doesn't flood the feed.
      const last = prev[prev.length - 1]
      if (last && last.slice(last.indexOf('  ') + 2) === msg) return prev
      return [...prev, line].slice(-200)
    })
  })

  useEffect(() => {
    const el = box.current
    if (el && pinned.current && open) el.scrollTop = el.scrollHeight
  }, [log, open])

  const copy = (): void => {
    void navigator.clipboard?.writeText(log.join('\n')).catch(() => undefined)
  }

  return (
    <Disclosure
      className={`home-log ${className ?? ''}`}
      open={open}
      onOpenChange={setOpen}
      summary={
        <span className="flex items-center gap-2">
          <span className="t-micro">{t('Activity log (advanced)')}</span>
          <span className="text-xs text-muted tabular">{log.length}</span>
        </span>
      }
    >
      <div className="flex justify-end gap-2 mb-2">
        <Button variant="subtle" size="sm" icon="copy" onClick={copy} disabled={log.length === 0}>
          {t('Copy')}
        </Button>
        <Button variant="subtle" size="sm" icon="trash" onClick={() => setLog([])} disabled={log.length === 0}>
          {t('Clear')}
        </Button>
      </div>
      <div
        ref={box}
        role="log"
        aria-label={t('Activity')}
        className="home-log-box"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {log.length === 0 ? <p>{t('Waiting for events…')}</p> : log.map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </Disclosure>
  )
}
