import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import type { Video } from '../lib/types'
import { EV } from '../lib/nav'
import NoClipsExplanation from './NoClipsExplanation'
import { Bug, Bulb, Icon, Image as ImageIcon, TrendUp } from './icons'
import { Button, Callout, Dialog, Tooltip } from './ui'

/** Feedback Hub: report a bug / request a feature / suggest an improvement
 *  in plain language. Diagnostics (versions, hardware, AI model, log tail)
 *  are auto-attached — previewable before sending — and the report goes to
 *  the developers with ONE click: no accounts, no sign-ups. (Under the
 *  hood it becomes a GitHub issue via the feedback relay, but users never
 *  need to know or care what GitHub is.)
 *
 *  Lives at the bottom of the sidebar so it's reachable from EVERY page —
 *  bugs don't only happen on the Dashboard. */

type Kind = 'bug' | 'feature' | 'improvement'

const AREAS = [
  ['ui', 'The app’s look & controls'],
  ['video-editor', 'The clip editor'],
  ['ai', 'AI results (clips picked, captions, titles)'],
  ['performance', 'Speed / freezes'],
  ['youtube', 'YouTube videos'],
  ['twitch', 'Twitch streams'],
  ['kick', 'Kick streams'],
  ['accessibility', 'Accessibility']
] as const

const KINDS: { id: Kind; icon: JSX.Element; title: string; blurb: string }[] = [
  { id: 'bug', icon: <Bug size={20} />, title: 'Report a bug', blurb: 'Something broke or looks wrong' },
  { id: 'feature', icon: <Bulb size={20} />, title: 'Request a feature', blurb: 'Something new you wish the app did' },
  { id: 'improvement', icon: <TrendUp size={20} />, title: 'Suggest an improvement', blurb: 'Make an existing part better' }
]

export default function FeedbackHub({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [areas, setAreas] = useState<string[]>([])
  const [images, setImages] = useState<string[]>([])
  const [includeDiag, setIncludeDiag] = useState(true)
  const [diagPreview, setDiagPreview] = useState<string | null>(null)
  // Which video this report is about, chosen from a list rather than typed.
  // A free-text box asking "which video were you processing?" reliably comes
  // back as "a video" — and the answer is the single most useful field on a
  // bug report, so it should not depend on someone's patience.
  const [videos, setVideos] = useState<Video[]>([])
  const [videoId, setVideoId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Anywhere can open it: the palette, the help drawer, error toasts.
  useEffect(() => {
    const onOpen = (): void => {
      setKind(null)
      setVideoId('')
      setAnswers({})
      setAreas([])
      setImages([])
      setDone(null)
      setError(null)
      setDiagPreview(null)
      setOpen(true)
    }
    window.addEventListener(EV.feedback, onOpen)
    return () => window.removeEventListener(EV.feedback, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    api
      .videos()
      .then((v) => setVideos(v.slice(0, 25)))
      .catch(() => setVideos([]))
  }, [open])

  /** The run summary for the chosen video, when it produced nothing. This is
   *  what turns "clips didn't get created" from a bug report into an answer. */
  const zeroClipOutcome = (() => {
    const v = videos.find((x) => x.video_id === videoId)
    const o = v?.outcome
    return o && o.clips === 0 && o.cause ? o : null
  })()

  const set = (k: string, v: string): void => setAnswers((a) => ({ ...a, [k]: v }))
  /** The picker's value, unless they chose the escape hatch. */
  const realVideoId = (): string | undefined =>
    videoId && videoId !== '__other__' ? videoId : undefined

  const reset = (): void => {
    setKind(null)
    setVideoId('')
    setAnswers({})
    setAreas([])
    setImages([])
    setDone(null)
    setError(null)
    setDiagPreview(null)
  }

  const field = (
    key: string,
    label: string,
    placeholder: string,
    rows = 2,
    optional = false
  ): JSX.Element => (
    <div key={key} className="fb-field">
      <label htmlFor={`fb-${key}`} className="fb-q">
        {t(label)}
        {!optional && <span className="fb-req" aria-hidden> *</span>}
      </label>
      <textarea
        id={`fb-${key}`}
        required={!optional}
        className="input resize-y"
        rows={rows}
        placeholder={t(placeholder)}
        value={answers[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  const titleFor = (): string => {
    const src =
      kind === 'bug' ? (answers.happened ?? '') : (answers.what ?? '')
    return src.split('\n')[0].slice(0, 120)
  }

  // Every substantive question is required — half-filled reports aren't
  // actionable. Mirrors REQUIRED_FIELDS on the backend, which enforces it
  // again server-side.
  const REQUIRED: Record<Kind, [string, string][]> = {
    bug: [
      ['source', 'which video you were processing'],
      ['trying', 'what you were trying to do'],
      ['happened', 'what happened'],
      ['expected', 'what you expected'],
      ['repro', 'whether it happens again'],
      ['severity', 'how serious it is']
    ],
    feature: [
      ['what', 'the feature you want'],
      ['why', 'why it would be useful'],
      ['workflow', 'how it fits your workflow'],
      ['importance', 'how important it is']
    ],
    improvement: [
      ['what', 'what to improve'],
      ['why', 'why it helps']
    ]
  }

  const missing = kind
    ? REQUIRED[kind].filter(([key]) => !(answers[key] ?? '').trim()).map(([, label]) => label)
    : []
  const tooShort = titleFor().trim().length < 8
  const canSend = missing.length === 0 && !tooShort

  const submit = async (): Promise<void> => {
    if (!kind) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.feedbackSubmit({
        kind,
        title: titleFor(),
        answers,
        areas,
        severity: answers.severity ?? '',
        include_diagnostics: includeDiag,
        images: images.map((p) => ({ path: p }))
      })
      if (res.ok) {
        setDone(t('Sent - thank you! Your report went straight to the developers.'))
      } else {
        // Relay unreachable/not configured: save the report locally instead.
        const blob = new Blob([res.markdown], { type: 'text/markdown' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `solaris-studio-${kind}-report.md`
        a.click()
        URL.revokeObjectURL(a.href)
        setDone(
          'Sending isn’t available right now, so the report was saved to your Downloads as a file — ' +
            'you can share it on GitHub or in the community instead.'
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const trigger = (
    <button
      type="button"
      className={`rail-feedback${compact ? ' rail-feedback-compact' : ''}`}
      onClick={() => {
        reset()
        setOpen(true)
      }}
      aria-label={compact ? t('Feedback') : undefined}
      title={compact ? undefined : 'Report a bug, request a feature, or suggest an improvement — no account needed'}
    >
      <span aria-hidden className="rail-feedback-icon">
        <Bug size={18} />
      </span>
      {!compact && <span className="truncate">{t('Feedback')}</span>}
    </button>
  )

  return (
    <>
      {compact ? (
        <Tooltip content={t('Feedback')} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={kind === null ? t('Feedback Hub') : t(KINDS.find((k) => k.id === kind)?.title ?? '')}
        size="lg"
        className="feedback-hub"
        footer={
          done ? (
            <Button variant="accent" onClick={() => setOpen(false)}>
              {t('Close')}
            </Button>
          ) : kind !== null ? (
            <div className="fb-foot">
              {!canSend && (
                <p className="fb-missing" title={missing.length > 0 ? missing.map((m) => t(m)).join(", ") : undefined}>
                  <Icon name="info" size={14} />
                  <span>
                    {missing.length > 0
                      ? `${t('Still needed:')} ${missing.map((m) => t(m)).join(', ')}`
                      : t('Describe what happened in a bit more detail (a few words is enough)')}
                  </span>
                </p>
              )}
              <div className="fb-foot-btns">
                <Button variant="ghost" icon="arrow-left" onClick={reset} disabled={busy}>
                  {t('Back')}
                </Button>
                <Button
                  variant="accent"
                  icon="send"
                  onClick={submit}
                  disabled={!canSend}
                  loading={busy}
                  title={!canSend ? t('Answer every required (*) question first') : undefined}
                >
                  {busy ? t('Sending…') : t('Send feedback')}
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {done ? (
          <div className="fb-done anim-rise" role="status">
            <span className="fb-done-mark" aria-hidden>
              <Icon name="check" size={22} />
            </span>
            <p className="text-sm text-ink leading-relaxed">{done}</p>
          </div>
        ) : kind === null ? (
          <div className="fb-chooser">
            <p className="text-sm text-muted leading-relaxed">
              {t('Found a problem or have an idea? Tell us in plain words - technical details are collected automatically, and you don’t need an account for anything.')}
            </p>
            <div className="fb-kinds stagger">
              {KINDS.map((k, i) => (
                <button
                  key={k.id}
                  type="button"
                  className="fb-kind"
                  style={{ '--i': i } as React.CSSProperties}
                  onClick={() => setKind(k.id)}
                >
                  <span className="fb-kind-icon" aria-hidden>
                    {k.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="fb-kind-title">{t(k.title)}</span>
                    <span className="fb-kind-blurb">{t(k.blurb)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} className="fb-kind-chev" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="fb-form" key={kind}>
            {kind === 'bug' && (
              <>
                <div className="fb-field">
                  <label htmlFor="fb-video" className="fb-q">
                    {t('Which video were you processing?')}
                    <span className="fb-req" aria-hidden> *</span>
                  </label>
                  <select
                    id="fb-video"
                    className="input"
                    required
                    value={videoId}
                    onChange={(e) => {
                      setVideoId(e.target.value)
                      const v = videos.find((x) => x.video_id === e.target.value)
                      set('source', v ? `${v.title} (${v.video_id})` : '')
                    }}
                  >
                    <option value="">{t('Choose the video…')}</option>
                    {videos.map((v) => (
                      <option key={v.video_id} value={v.video_id}>
                        {v.title || v.video_id} — {v.clip_count} {t('clips')}
                      </option>
                    ))}
                    <option value="__other__">{t('Something else / not listed')}</option>
                  </select>
                </div>
                {videoId === '__other__' &&
                  field(
                    'source',
                    'Which video was it?',
                    'e.g. https://twitch.tv/videos/123456  —  or "local file, 40 min talking head"'
                  )}

                {zeroClipOutcome && (
                  <div className="space-y-2">
                    <NoClipsExplanation outcome={zeroClipOutcome} />
                    <p className="text-xs text-muted">
                      {t(
                        'If that explains it, you can close this - nothing is wrong. If it does not match what you saw, please do carry on and tell us.'
                      )}
                    </p>
                  </div>
                )}
                {field('trying', 'What were you trying to do?', 'e.g. Export a clip of my Twitch stream')}
                {field('happened', 'What happened?', 'e.g. The export button froze the whole app')}
                {field('expected', 'What did you expect to happen?', 'e.g. The clip saves to my Downloads')}
                <div className="fb-pair">
                  <div className="fb-field">
                    <label className="fb-q" htmlFor="fb-repro">
                      {t('Can you make it happen again?')}
                      <span className="fb-req" aria-hidden> *</span>
                    </label>
                    <select
                      id="fb-repro"
                      className="input"
                      required
                      value={answers.repro ?? ''}
                      onChange={(e) => set('repro', e.target.value)}
                    >
                      <option value="" disabled>
                        {t('Choose…')}
                      </option>
                      <option>{t('Always')}</option>
                      <option>{t('Sometimes')}</option>
                      <option>{t('Only once')}</option>
                      <option>{t('Not sure')}</option>
                    </select>
                  </div>
                  <div className="fb-field">
                    <label className="fb-q" htmlFor="fb-sev">
                      {t('How serious is it?')}
                      <span className="fb-req" aria-hidden> *</span>
                    </label>
                    <select
                      id="fb-sev"
                      className="input"
                      required
                      value={answers.severity ?? ''}
                      onChange={(e) => set('severity', e.target.value)}
                    >
                      <option value="" disabled>
                        {t('Choose…')}
                      </option>
                      <option value="low">{t('Low - cosmetic')}</option>
                      <option value="medium">{t('Medium')}</option>
                      <option value="high">{t('High - blocks my work')}</option>
                      <option value="critical">{t('Critical - app unusable')}</option>
                    </select>
                  </div>
                </div>
                {field('notes', 'Anything else? (optional)', 'Anything that seems related', 2, true)}
              </>
            )}
            {kind === 'feature' && (
              <>
                {field('what', 'What feature would you like?', 'e.g. Auto-post finished clips to TikTok')}
                {field('why', 'Why would it be useful?', 'What problem would it solve for you?')}
                {field('workflow', 'How would it fit your workflow?', 'e.g. After a stream I always…')}
                <div className="fb-pair">
                  <div className="fb-field">
                    <label className="fb-q" htmlFor="fb-imp">
                      {t('How important is this to you?')}
                      <span className="fb-req" aria-hidden> *</span>
                    </label>
                    <select
                      id="fb-imp"
                      className="input"
                      required
                      value={answers.importance ?? ''}
                      onChange={(e) => set('importance', e.target.value)}
                    >
                      <option value="" disabled>
                        {t('Choose…')}
                      </option>
                      <option>{t('Nice to have')}</option>
                      <option>{t('Would use it weekly')}</option>
                      <option>{t('Would use it every video')}</option>
                      <option>{t('Can’t use the app well without it')}</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            {kind === 'improvement' && (
              <>
                {field('what', 'What would you like improved?', 'e.g. The timeline is hard to use with a trackpad')}
                {field('why', 'Why would it improve Solaris Studio?', 'What gets easier or faster?')}
                {field('inspiration', 'Which app inspired this? (optional)', 'e.g. CapCut’s keyframe editor', 2, true)}
                {field('links', 'Links / screenshots of that feature (optional)', 'A YouTube video, docs page…', 2, true)}
              </>
            )}

            <fieldset className="fb-field">
              <legend className="fb-q">{t('Which part of the app is this about? (optional)')}</legend>
              <div className="fb-chips">
                {AREAS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="lyr-chip"
                    aria-pressed={areas.includes(id)}
                    onClick={() =>
                      setAreas((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id].slice(0, 4)))
                    }
                    title={label}
                  >
                    {areas.includes(id) && <Icon name="check" size={13} />}
                    {t(label)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="fb-shots">
              <Button
                size="sm"
                variant="ghost"
                icon="image"
                onClick={async () => {
                  const p = await window.studio.pickImageFile()
                  if (p) setImages((im) => [...im, p].slice(0, 3))
                }}
                disabled={images.length >= 3}
              >
                {t('Attach screenshot')} ({images.length}/3)
              </Button>
              {images.map((p, i) => (
                <span key={i} className="fb-shot">
                  <ImageIcon size={13} />
                  <span className="truncate">{p.split(/[\\/]/).pop()}</span>
                  <button
                    type="button"
                    className="fb-shot-x"
                    onClick={() => setImages((im) => im.filter((_, j) => j !== i))}
                    aria-label={t('Remove screenshot')}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>

            <div className="fb-diag">
              <label className="fb-diag-check">
                <input type="checkbox" checked={includeDiag} onChange={(e) => setIncludeDiag(e.target.checked)} />
                <span>
                  {t('Include technical details (PC specs, app version, AI model, recent log) - this is what lets someone actually fix it')}
                </span>
              </label>
              {includeDiag && (
                <Button
                  size="sm"
                  variant="subtle"
                  icon="eye"
                  className="fb-diag-peek"
                  aria-expanded={!!diagPreview}
                  onClick={async () => {
                    if (diagPreview) {
                      setDiagPreview(null)
                      return
                    }
                    const d = await api.feedbackDiagnostics(realVideoId())
                    setDiagPreview(JSON.stringify(d, null, 2))
                  }}
                >
                  {diagPreview ? t('Hide what will be shared') : t('See exactly what will be shared')}
                </Button>
              )}
              {diagPreview && <pre className="fb-diag-pre anim-fade">{diagPreview}</pre>}
            </div>

            {error && (
              <Callout tone="error" title={t('Couldn’t send that')}>
                {error}
              </Callout>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
