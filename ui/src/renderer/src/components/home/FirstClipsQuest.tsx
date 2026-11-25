import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Button, Card, IconButton, ProgressRing } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { celebrate } from '../../lib/motion'
import { navigate, openCreate } from '../../lib/nav'
import { useActivity } from '../../lib/stores/activity'
import { useLibrary } from '../../lib/stores/library'
import { QUEST_DISMISSED_KEY, QUEST_OPENED_EDITOR_KEY, readKey, writeKey } from './homeUtil'

interface Step {
  id: string
  label: string
  hint: string
  done: boolean
  optional?: boolean
  action?: { label: string; run: () => void }
}

function CheckMark({ done }: { done: boolean }): JSX.Element {
  return (
    <span className="home-quest-check" data-done={done ? 'true' : 'false'} aria-hidden>
      {done && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path className="draw" pathLength={24} d="m4.5 12.5 5 5L20 7" />
        </svg>
      )}
    </span>
  )
}

/** Whether the quest should be on screen at all: not dismissed. (Hidden for
 *  good once it has been completed and closed.) */
export function questDismissed(): boolean {
  return readKey(QUEST_DISMISSED_KEY) !== null
}

/** "Your first clips": five steps worked out from real data, a progress ring,
 *  and a celebration when the four required ones are done. */
export default function FirstClipsQuest({ active, onHide, className }: { active: boolean; onHide?: () => void; className?: string }): JSX.Element | null {
  const { videos, loadClipsFor } = useLibrary()
  const { hasPublished } = useActivity()
  const [openedEditor, setOpenedEditor] = useState(() => readKey(QUEST_OPENED_EDITOR_KEY) === '1')
  const [exported, setExported] = useState(false)
  const [exportChecked, setExportChecked] = useState(false)
  const [watching, setWatching] = useState(false)
  const [hidden, setHidden] = useState(questDismissed)
  const card = useRef<HTMLElement>(null)
  const wasIncomplete = useRef<boolean | null>(null)
  const celebrated = useRef(false)

  // The Clip Editor marks itself opened in localStorage (B4). Re-read it when
  // Home comes back into view, and when another window writes it.
  useEffect(() => {
    if (!active) return
    setOpenedEditor(readKey(QUEST_OPENED_EDITOR_KEY) === '1')
    const onStorage = (e: StorageEvent): void => {
      if (e.key === QUEST_OPENED_EDITOR_KEY) setOpenedEditor(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [active])

  // Any exported clip among the newest videos.
  const ids = (videos ?? [])
    .filter((v) => v.clip_count > 0)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 30)
    .map((v) => v.video_id)
  const idKey = ids.join(',')
  useEffect(() => {
    if (hidden || !active || exported || ids.length === 0) return
    let alive = true
    void loadClipsFor(ids).then((by) => {
      if (!alive) return
      if (Object.values(by).some((list) => list.some((c) => c.exported_at))) setExported(true)
      setExportChecked(true)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, hidden, active, exported])

  useEffect(() => {
    if (hidden || !active) return
    let alive = true
    api
      .watches()
      .then((w) => alive && setWatching(w.length > 0))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [hidden, active])

  const anyVideo = (videos?.length ?? 0) > 0
  const anyClips = (videos ?? []).some((v) => v.clip_count > 0)
  const steps: Step[] = [
    {
      id: 'add',
      label: t('Add a video'),
      hint: t('Paste a link above or drop a file.'),
      done: anyVideo,
      action: { label: t('Add one'), run: () => openCreate() }
    },
    {
      id: 'clips',
      label: t('Get your clips'),
      hint: t('Solaris finds the moments and renders them.'),
      done: anyClips,
      action: { label: t('Open queue'), run: () => navigate({ page: 'queue' }) }
    },
    {
      id: 'editor',
      label: t('Open one in the Clip Editor'),
      hint: t('Trim, restyle captions, swap the layout.'),
      done: openedEditor,
      action: anyClips ? { label: t('Open Clip Editor'), run: () => navigate({ page: 'studio' }) } : undefined
    },
    {
      id: 'export',
      label: t('Export or publish'),
      hint: t('Save the file or send it to your channels.'),
      done: exported || hasPublished,
      action: anyClips ? { label: t('Pick a clip'), run: () => navigate({ page: 'studio' }) } : undefined
    },
    {
      id: 'watch',
      label: t('Watch a channel'),
      hint: t('New uploads get clipped automatically.'),
      done: watching,
      optional: true,
      action: { label: t('Set one up'), run: () => navigate({ page: 'watch' }) }
    }
  ]
  const required = steps.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.done).length
  const complete = doneCount === required.length
  const nextStep = steps.find((s) => !s.done && !s.optional)

  // Celebrate only when it is completed while you watch, not when a returning
  // user already had everything done. "Settled" waits for the export check,
  // so a late answer can't look like a fresh completion.
  const settled = videos !== null && (exportChecked || exported || hasPublished || !anyClips)
  if (settled && wasIncomplete.current === null) wasIncomplete.current = !complete
  useEffect(() => {
    if (!settled) return
    if (complete && wasIncomplete.current && !celebrated.current && active) {
      celebrated.current = true
      celebrate(card.current)
    }
  }, [complete, settled, active])

  if (hidden || !settled) return null
  // Already done before this visit: nothing to show.
  if (complete && wasIncomplete.current === false) return null

  const dismiss = (): void => {
    writeKey(QUEST_DISMISSED_KEY, complete ? 'done' : '1')
    setHidden(true)
    onHide?.()
  }

  return (
    <Card ref={card} as="section" variant={complete ? 'hero' : 'glass'} className={`home-quest ${complete ? 'is-complete' : ''} ${className ?? ''}`} aria-labelledby="home-quest-title">
      <div className="home-quest-head">
        <ProgressRing value={doneCount / required.length} size={56} stroke={5} label={t('Quest progress')} tone={complete ? 'success' : 'gold'}>
          <span className="text-sm font-semibold text-ink tabular">
            {doneCount}/{required.length}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="t-micro">{complete ? t('Quest complete') : t('First clips quest')}</p>
          <h2 id="home-quest-title" className="t-lg text-ink">
            {complete ? t('You’ve got the whole loop down') : t('Your first clips, start to finish')}
          </h2>
          <p className="text-sm text-muted">
            {complete
              ? t('Paste, clip, publish. From here on it only gets faster.')
              : nextStep
                ? `${t('Next')}: ${nextStep.label}`
                : ''}
          </p>
        </div>
        {complete ? (
          <Button variant="gold" size="sm" icon="check" onClick={dismiss}>
            {t('Close')}
          </Button>
        ) : (
          <IconButton label={t('Hide the quest')} icon="x" size="sm" onClick={dismiss} />
        )}
      </div>
      <ol className="home-quest-steps stagger">
        {steps.map((s, i) => {
          const isNext = s === nextStep
          return (
            <li
              key={s.id}
              className="home-quest-step"
              data-done={s.done ? 'true' : 'false'}
              data-next={isNext ? 'true' : 'false'}
              style={{ '--i': i } as React.CSSProperties}
            >
              <CheckMark done={s.done} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink font-medium flex items-center gap-1.5">
                  {s.label}
                  {s.optional && <span className="home-quest-opt">{t('optional')}</span>}
                </p>
                <p className="text-xs text-muted">{s.hint}</p>
              </div>
              {!s.done && s.action && (
                <button type="button" className={`home-quest-go ${isNext ? 'is-next' : ''}`} onClick={s.action.run}>
                  {s.action.label}
                  <Icon name="arrow-right" size={12} />
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
