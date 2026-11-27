import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Button, Kbd, toast } from '../ui'
import { seedOptions } from '../queue/AddVideos'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { flyTo } from '../../lib/motion'
import { navigate, openCreate } from '../../lib/nav'
import { getQueueSnapshot, refreshQueue } from '../../lib/stores/queueStore'
import PresetChips, { applyPreset, applyPresetToGenerateBar, setPreset, usePreset } from './PresetChips'
import { PLATFORM_META, detectPlatform, normaliseLink, tf, type Platform } from './homeUtil'

interface Staged {
  path: string
  name: string
  vertical?: boolean
}

/** The hero bar on Home: paste a link (or drop video files) and Generate.
 *  It never submits on its own; the clipboard is only ever offered as a chip. */
export default function QuickPaste({ compact = false }: { compact?: boolean }): JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [files, setFiles] = useState<Staged[]>([])
  const [preset] = usePreset()
  const heroRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const platform: Platform | null = detectPlatform(value)
  const anyVertical = files.some((f) => f.vertical)

  useEffect(() => {
    const el = heroRef.current
    if (!shake || !el) return
    el.classList.remove('anim-shake')
    void el.offsetWidth
    el.classList.add('anim-shake')
    const done = (): void => el.classList.remove('anim-shake')
    el.addEventListener('animationend', done, { once: true })
    return () => el.removeEventListener('animationend', done)
  }, [shake])

  /** Offer whatever link is on the clipboard (never used without a click). */
  const peekClipboard = async (): Promise<void> => {
    if (value.trim()) return
    let text = ''
    try {
      text = (await window.studio?.readClipboardKey?.()) ?? ''
    } catch {
      text = ''
    }
    if (!detectPlatform(text)) {
      try {
        text = (await navigator.clipboard?.readText?.()) ?? ''
      } catch {
        text = ''
      }
    }
    const link = text.trim()
    if (link && link.length < 2000 && detectPlatform(link) && normaliseLink(link)) setCopied(link)
    else setCopied(null)
  }

  const fail = (msg: string): void => {
    setError(msg)
    setShake((n) => n + 1)
  }

  const started = (count: number): void => {
    if (heroRef.current) flyTo(heroRef.current, document.querySelector('[data-fly-target="queue"]'))
    refreshQueue(0)
    toast({
      title: t('Started'),
      body: count > 1 ? tf('{n} videos are on their way to clips.', { n: count }) : t('Your video is on its way to clips.'),
      tone: 'success',
      icon: 'sparkle',
      action: { label: t('View queue'), run: () => window.dispatchEvent(new CustomEvent('open-queue')) }
    })
  }

  const generate = async (force = false): Promise<void> => {
    if (busy) return
    const raw = value.trim()
    const link = raw ? normaliseLink(raw) : null
    if (raw && !link) {
      fail(t('That doesn’t look like a link. Paste the full address from YouTube, Twitch or Kick.'))
      inputRef.current?.focus()
      return
    }
    if (!link && files.length === 0) {
      fail(t('Paste a link first, or drop a video file here.'))
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const options = applyPreset(seedOptions(), preset)
    let ok = 0
    const problems: string[] = []
    let already: { videoId?: string } | null = null
    try {
      if (link) {
        const res = await api.createJobsBatch([{ url: link, ...options, ...(force ? { force: true } : {}) }])
        ok += res.created.length
        for (const s of res.skipped) {
          if (s.reason === 'already_processed') already = { videoId: s.video_id }
          else problems.push(s.detail ? `${s.reason.replace(/_/g, ' ')}: ${s.detail}` : s.reason.replace(/_/g, ' '))
        }
      }
      const failedFiles: Staged[] = []
      for (const f of files) {
        try {
          const res = await api.addLocalVideo({ path: f.path, title: f.name, ...options, ...(force ? { force: true } : {}) })
          if (res.already_processed) {
            already = { videoId: res.video_id }
            continue
          }
          ok += 1
        } catch (e) {
          failedFiles.push(f)
          problems.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (ok > 0) {
        // Same as the Generate bar: adding is what starts the queue.
        const q = getQueueSnapshot()
        const running = Boolean(q && !q.paused && q.processing.length + q.queued.length > 0)
        if (!running) await api.resumeQueue().catch(() => undefined)
        started(ok)
        setValue('')
        setCopied(null)
      }
      setFiles(failedFiles)
      if (already) {
        const vid = already.videoId
        toast({
          title: t('Already clipped'),
          body: t('Solaris Studio has made clips from this video before.'),
          tone: 'warn',
          icon: 'film',
          action: vid ? { label: t('Open in Clip Editor'), run: () => navigate({ page: 'studio', params: { videoId: vid } }) } : undefined,
          secondary: { label: t('Make clips again'), run: () => void generate(true) }
        })
      }
      if (problems.length > 0) fail(problems.join(' · '))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fail(/failed to fetch|networkerror|load failed/i.test(msg) ? t('Couldn’t reach the Solaris Studio engine. It may still be starting; try again in a moment.') : msg)
    } finally {
      setBusy(false)
    }
  }

  /* ---------- drag & drop of video files ---------- */

  const onDragEnter = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepth.current++
    setDrag(true)
  }
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDrag(false)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDrag(false)
    const dropped = Array.from(e.dataTransfer.files)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (dropped.length === 0 && text) {
      setValue(text.trim())
      return
    }
    const videos = dropped.filter((f) => f.type.startsWith('video/') || /\.(mp4|mkv|mov|webm|avi|m4v|flv|ts)$/i.test(f.name))
    if (videos.length === 0) {
      fail(t('Only video files can be dropped here.'))
      return
    }
    // Electron exposes the file's path on the File object.
    const withPath = videos
      .map((f) => ({ f, path: (f as File & { path?: string }).path ?? '' }))
      .filter((x) => x.path)
    if (withPath.length === 0) {
      fail(t('This window can’t read dropped files. Use Options to add files instead.'))
      return
    }
    setFiles((prev) => {
      const known = new Set(prev.map((p) => p.path))
      return [
        ...prev,
        ...withPath
          .filter((x) => !known.has(x.path))
          .map((x) => ({ path: x.path, name: x.f.name.replace(/\.[^.]+$/, '') }))
      ]
    })
    for (const { path } of withPath) {
      void api
        .localVideoShape(path)
        .then((shape) =>
          setFiles((prev) => prev.map((p) => (p.path === path ? { ...p, vertical: shape.orientation === 'vertical' } : p)))
        )
        .catch(() => undefined)
    }
  }

  const options = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const link = normaliseLink(value)
    // The sheet starts from the Generate bar's switches: make them say what
    // the chips here say, so "Options" opens on the same preset.
    applyPresetToGenerateBar(preset)
    openCreate({ link: link ?? undefined, originRect: e.currentTarget.getBoundingClientRect() })
  }

  return (
    <div className={`home-quick ${compact ? 'home-quick-compact' : ''}`}>
      <div
        ref={heroRef}
        className={`home-quick-bar card-hero border-orbit ${drag ? 'is-drag' : ''} ${error ? 'is-error' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-tour="quick-paste"
      >
        <span className="home-quick-platform" aria-hidden>
          {platform ? (
            <span key={platform} className={`home-quick-badge home-plat-${platform} anim-pop`}>
              <Icon name={PLATFORM_META[platform].icon} size={20} />
            </span>
          ) : (
            <span key="link" className="home-quick-badge anim-pop">
              <Icon name={files.length > 0 ? 'film' : 'link'} size={20} />
            </span>
          )}
        </span>
        <label htmlFor="home-quick-input" className="sr-only">
          {t('Video link')}
        </label>
        <input
          id="home-quick-input"
          ref={inputRef}
          className="home-quick-input"
          placeholder={files.length > 0 ? t('Add a link too, or press Generate') : t('Paste a YouTube, Twitch or Kick link, or drop a video')}
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'home-quick-error' : 'home-quick-hint'}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onFocus={() => void peekClipboard()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void generate()
            } else if (e.key === 'Escape' && value) {
              e.preventDefault()
              e.stopPropagation()
              setValue('')
            }
          }}
        />
        {platform && (
          <span className="home-quick-plat-name anim-fade" aria-live="polite">
            {PLATFORM_META[platform].label}
          </span>
        )}
        <button type="button" className="home-quick-options" onClick={options} aria-label={t('More options')} title={t('All options')}>
          <span>{t('Options')}</span>
          <Icon name="chevron-down" size={16} />
        </button>
        <Button variant="gold" size="lg" icon="sparkle" loading={busy} disabled={busy} onClick={() => void generate()} className="home-quick-go">
          {t('Generate')}
        </Button>
        {drag && (
          <div className="home-quick-drop" aria-hidden>
            <Icon name="upload" size={22} />
            <span>{t('Drop to add these videos')}</span>
          </div>
        )}
      </div>

      <div className="home-quick-under">
        {error ? (
          <p id="home-quick-error" className="home-quick-error anim-fade" role="alert">
            <Icon name="alert" size={14} />
            {error}
          </p>
        ) : copied && !value ? (
          <button type="button" className="home-quick-chip anim-pop" onClick={() => {
            setValue(copied)
            setCopied(null)
            inputRef.current?.focus()
          }}>
            <Icon name="copy" size={14} />
            <span>{t('Use copied link')}</span>
            <span className="home-quick-chip-url">{copied.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}</span>
          </button>
        ) : (
          <p id="home-quick-hint" className="home-quick-hint">
            <Kbd keys={['Enter']} /> {t('to generate')} · <Kbd keys={['Ctrl', 'N']} /> {t('for every option')}
          </p>
        )}
      </div>

      {files.length > 0 && (
        <div className="home-quick-files stagger" aria-label={t('Files to add')}>
          {files.map((f, i) => (
            <span key={f.path} className="home-quick-file" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
              <Icon name="film" size={14} />
              <span className="truncate">{f.name}</span>
              {f.vertical && <span className="home-quick-vert">9:16</span>}
              <button
                type="button"
                aria-label={tf('Remove {name}', { name: f.name })}
                onClick={() => setFiles((prev) => prev.filter((p) => p.path !== f.path))}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {anyVertical && preset !== 'vertical_live' && (
            <span className="home-quick-suggest anim-rise">
              <Icon name="bulb" size={14} />
              {t('Looks vertical: Vertical Live suggested')}
              <button type="button" className="btn-subtle ui-btn ui-btn-sm" onClick={() => {
                  setPreset('vertical_live')
                  applyPresetToGenerateBar('vertical_live')
                }}>
                {t('Use it')}
              </button>
            </span>
          )}
        </div>
      )}

      {/* One preset everywhere: a pick here is also the Create page's and
          the Create sheet's starting point. */}
      <PresetChips className="home-quick-presets" applyToGenerateBar />
    </div>
  )
}
