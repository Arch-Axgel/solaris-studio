import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { API_BASE, api } from '../lib/api'
import type { Clip, LiveOverlay, TranslationPreview, WatermarkConfig } from '../lib/types'
import { Icon, Scissors, YouTube } from './icons'
import PlatformOverlay, { PLATFORM_UI } from './PlatformOverlay'
import ScoreBadge from './ScoreBadge'
import { toast } from './ui'
import { t } from '../lib/i18n'
import { markEditorOpened } from './library/prefs'
import LiveTextOverlay from './LiveTextOverlay'
import TimelineEditor from './TimelineEditor'
import { DEFAULT_CAPTION_STYLE, burnedCaptionStyle, isHighlights } from './CaptionStyleControls'
import { youtubeEnabledSync } from '../lib/youtube'

/** Live, draggable watermark preview over the editor video. Shows the
 *  text/logo where it will burn in, updates as the controls change, and
 *  drag repositions it (switching to a 'custom' point) so a static
 *  watermark can be placed off anything important. */
function WatermarkOverlay({
  config,
  onChange
}: {
  config: WatermarkConfig
  onChange: (patch: Partial<WatermarkConfig>) => void
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const dragging = useRef(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pos = config.position ?? 'bottom_right'
  const pad = (config.padding ?? 0.04) * 100
  const opacity = config.opacity ?? 0.85
  const moving = pos === 'moving'

  const place = (p: string): React.CSSProperties => {
    const s: React.CSSProperties = { position: 'absolute' }
    if (p === 'custom') {
      s.left = `${(config.x ?? 0.5) * 100}%`
      s.top = `${(config.y ?? 0.5) * 100}%`
      s.transform = 'translate(-50%, -50%)'
      return s
    }
    if (p.includes('top')) s.top = `${pad}%`
    if (p.includes('bottom')) s.bottom = `${pad}%`
    if (p.includes('left')) s.left = `${pad}%`
    if (p.includes('right')) s.right = `${pad}%`
    if (p === 'center') {
      s.top = '50%'
      s.left = '50%'
      s.transform = 'translate(-50%, -50%)'
    }
    return s
  }

  const Mark = ({ ghost }: { ghost?: boolean }): JSX.Element => {
    const showImg = (config.type === 'image' || config.type === 'both') && config.image_asset
    const showTxt = (config.type === 'text' || config.type === 'both') && config.text
    return (
      <div
        className="flex flex-col items-center gap-0.5 leading-none pointer-events-none"
        style={{ opacity: ghost ? opacity * 0.4 : opacity }}
      >
        {showImg && (
          <img
            src={api.brandingAssetUrl(config.image_asset!)}
            alt=""
            style={{ width: `${(config.scale ?? 0.18) * box.w}px` }}
            className="max-w-none"
            draggable={false}
          />
        )}
        {showTxt && (
          <span
            style={{
              color: config.color ?? '#FFFFFF',
              fontFamily: config.font,
              fontSize: `${Math.max(8, (config.font_size ?? 42) * (box.h / 1920))}px`,
              textShadow: config.shadow ? '0 1px 3px rgba(0,0,0,0.9)' : 'none',
              transform: config.rotation ? `rotate(${config.rotation}deg)` : undefined,
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            {config.text}
          </span>
        )}
      </div>
    )
  }

  const startDrag = (e: React.PointerEvent): void => {
    if (moving) return
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width))
    const y = Math.max(0.02, Math.min(0.98, (e.clientY - r.top) / r.height))
    onChange({ position: 'custom', x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) })
  }

  return (
    <div ref={boxRef} className="absolute inset-0 z-10 pointer-events-none">
      {moving ? (
        // Two faint ghosts at the side edge-centres show the L/R travel.
        <>
          <div style={{ position: 'absolute', top: '50%', left: `${pad}%`, transform: 'translateY(-50%)' }}>
            <Mark ghost />
          </div>
          <div style={{ position: 'absolute', top: '50%', right: `${pad}%`, transform: 'translateY(-50%)' }}>
            <Mark ghost />
          </div>
          <span className="absolute bottom-14 left-1/2 -translate-x-1/2 text-[10px] text-ink/80 bg-base/60 backdrop-blur-sm px-1.5 py-0.5 rounded">
            moves left ↔ right
          </span>
        </>
      ) : (
        <div
          style={place(pos)}
          className="pointer-events-auto cursor-move touch-none ring-1 ring-gold/0 hover:ring-gold/60 rounded"
          onPointerDown={startDrag}
          onPointerMove={onMove}
          onPointerUp={() => (dragging.current = false)}
          title="Drag to reposition"
        >
          <Mark />
        </div>
      )}
    </div>
  )
}

/** 00:01:23 for the Edit Bay timecode. */
function timecode(s: number): string {
  const v = Math.max(0, Math.floor(s))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const sec = v % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

const SAFE_PLATFORMS: { id: string; label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reels', label: 'Reels' },
  { id: 'shorts', label: 'Shorts' }
]

function readSafe(): string {
  try {
    return localStorage.getItem('solaris.ui.lib.safeArea') ?? ''
  } catch {
    return ''
  }
}
function writeSafe(v: string): void {
  try {
    localStorage.setItem('solaris.ui.lib.safeArea', v)
  } catch {
    /* remembered for this session only */
  }
}

/** The clip's title, edited in place (api.patchClip). */
function InlineTitle({ clip, onChanged }: { clip: Clip; onChanged: () => void }): JSX.Element {
  const shown = clip.title || clip.hook || 'Untitled clip'
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(clip.title)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setEditing(false)
    setValue(clip.title)
  }, [clip.id, clip.title])
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
  const save = async (): Promise<void> => {
    const next = value.trim()
    if (!next || next === clip.title) {
      setEditing(false)
      setValue(clip.title)
      return
    }
    setSaving(true)
    try {
      await api.patchClip(clip.id, { title: next })
      toast({ tone: 'success', title: t('Title saved'), duration: 2500 })
      onChanged()
      setEditing(false)
    } catch (e) {
      toast({ tone: 'error', title: t('Could not save the title'), body: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }
  if (editing) {
    return (
      <form
        className="edit-bay-title-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          ref={input}
          className="input edit-bay-title-input"
          value={value}
          disabled={saving}
          aria-label={t('Clip title')}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setValue(clip.title)
              setEditing(false)
            }
          }}
        />
      </form>
    )
  }
  return (
    <button
      type="button"
      className="edit-bay-title"
      onClick={() => setEditing(true)}
      title={t('Rename this clip')}
    >
      <Scissors size={15} className="text-gold shrink-0" />
      <span className="truncate">
        <span className="text-muted font-normal">Editing — </span>
        {shown}
      </span>
      <Icon name="pencil" size={13} className="edit-bay-title-pen shrink-0" />
    </button>
  )
}

/** Full-page editing workspace: the Edit Bay (spec 4.7). */
export default function EditorView({
  clip,
  onClose,
  onChanged,
  vtName
}: {
  clip: Clip
  onClose: () => void
  onChanged: () => void
  /** `clip-<id>` while the card→editor morph runs; removed shortly after. */
  vtName?: string
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [watermark, setWatermark] = useState<WatermarkConfig | null>(clip.render_opts?.watermark ?? null)
  const [liveOverlay, setLiveOverlay] = useState<LiveOverlay | null>(null)
  const isLandscape = !!clip.render_opts?.profile

  const [translated, setTranslated] = useState<TranslationPreview | null>(null)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [safe, setSafeState] = useState<string>(() => readSafe())
  const setSafe = (v: string): void => {
    setSafeState(v)
    writeSafe(v)
  }
  const [morph, setMorph] = useState<string | undefined>(vtName)

  useEffect(() => {
    setPreviewSrc(null)
    setWatermark(clip.render_opts?.watermark ?? null)
    setLiveOverlay(null)
    setTranslated(null)
    setNow(0)
  }, [clip.id])

  // The shared clip-<id> name only for the morph itself: a name left behind
  // would collide with the poster on the next transition.
  useEffect(() => {
    setMorph(vtName)
    if (!vtName) return
    const id = setTimeout(() => setMorph(undefined), 1100)
    return () => clearTimeout(id)
  }, [vtName])

  // The Edit Bay owns the window: the rail collapses, the top bar folds into
  // a reveal strip (shell.css), and global single-key shortcuts stand down.
  useLayoutEffect(() => {
    const html = document.documentElement
    html.dataset.editBay = ''
    markEditorOpened()
    return () => {
      delete html.dataset.editBay
      delete html.dataset.playing
    }
  }, [])
  useEffect(() => {
    const html = document.documentElement
    if (playing) html.dataset.playing = ''
    else delete html.dataset.playing
  }, [playing])

  // The captions as burned into the clip file: a Highlights clip's are in
  // that style's own look and place, whatever its saved style says, and
  // that is where the mask below has to go.
  const captionStyle = burnedCaptionStyle(
    { ...DEFAULT_CAPTION_STYLE, ...clip.render_opts?.caption_style },
    isLandscape
  )
  /** What LiveTextOverlay draws. A translated language being previewed wins
   *  over the pending-edit overlay: it is what the creator asked to look at,
   *  and it reuses the same masking so the English already burned into the
   *  clip file is blurred out underneath instead of ghosting through. */
  const overlay: LiveOverlay | null = translated
    ? {
        hook: null,
        captions: {
          lines: translated.lines,
          // The subtitle's own style, except that a non-Latin script forces
          // a font that has the glyphs, and a Highlights clip puts them in
          // the middle, clear of its title card — exactly what the burn does
          // (multilingual/publish.py).
          style: {
            ...translated.style,
            font: translated.font ?? translated.style.font,
            ...(isHighlights(captionStyle, isLandscape) ? { position: 'middle' as const } : {})
          }
        },
        bakedKeep: liveOverlay?.bakedKeep,
        keep: liveOverlay?.keep ?? [],
        burned:
          clip.render_opts?.captions !== false && translated.source.length > 0
            ? { lines: translated.source, style: captionStyle }
            : null,
        burnedHook: null
      }
    : liveOverlay

  // The header's YouTube button just asks the timeline editor to open its
  // YouTube tab. activeTab lives down there, and lifting it up here for one
  // button would be a lot of plumbing for a shortcut.
  const [tabRequest, setTabRequest] = useState<{ tab: 'youtube'; n: number } | null>(null)
  const [ytEnabled, setYtEnabled] = useState(youtubeEnabledSync())
  useEffect(() => {
    let alive = true
    api
      .youtubeStatus()
      .then((s) => alive && setYtEnabled(Boolean(s.enabled)))
      .catch(() => {
        /* leave the mirror's answer alone */
      })
    return () => {
      alive = false
    }
  }, [])

  // Esc closes the editor, as it always has. Not when something on top
  // should take it first: a shell layer (the global handler marks the event),
  // a modal dialog or popover, or a text field (TimelineEditor's word editor
  // uses Esc to cancel an edit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open]:modal, .ui-pop:popover-open')) return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable ||
          (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((el as HTMLInputElement).type)))
      ) {
        el.blur()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const duration = Math.max(0, clip.end_s - clip.start_s)
  const showKeys = (): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
  }

  return (
    <div className={`edit-bay ${isLandscape ? 'edit-bay-landscape' : 'edit-bay-portrait'}`}>
      <header className="edit-bay-top">
        <button onClick={onClose} className="btn-ghost edit-bay-back">
          ← Back to clips
        </button>
        <div className="min-w-0 flex-1">
          <InlineTitle clip={clip} onChanged={onChanged} />
        </div>
        <div className="edit-bay-timecode t-mono" aria-label={t('Playhead')} title={t('Playhead / clip length')}>
          <span className={playing ? 'edit-bay-rec' : 'edit-bay-rec edit-bay-rec-off'} aria-hidden />
          <span className="text-ink">{timecode(now)}</span>
          <span className="text-muted">/ {timecode(duration)}</span>
        </div>
        {!isLandscape && (
          <div className="edit-bay-safe" role="group" aria-label={t('Safe areas')}>
            <button
              type="button"
              className="edit-bay-chip"
              aria-pressed={Boolean(safe)}
              onClick={() => setSafe(safe ? '' : 'tiktok')}
              title={t('Show what TikTok, Reels or Shorts draw over the clip')}
            >
              <Icon name="eye" size={14} /> {t('Safe areas')}
            </button>
            {safe && (
              <span className="edit-bay-safe-pick anim-fade">
                {SAFE_PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="edit-bay-chip edit-bay-chip-sm"
                    aria-pressed={safe === p.id}
                    onClick={() => setSafe(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        <button type="button" className="edit-bay-chip" onClick={showKeys} title={t('Editor keyboard shortcuts')}>
          <Icon name="keyboard" size={14} /> <kbd className="ui-kbd">?</kbd>
        </button>
        {/* Nothing at all when publishing is switched off in Settings. */}
        {ytEnabled && (
          <button
            onClick={() => setTabRequest({ tab: 'youtube', n: (tabRequest?.n ?? 0) + 1 })}
            className="btn-ghost edit-bay-yt shrink-0"
            title="Publish this clip to YouTube"
          >
            <YouTube size={15} /> YouTube
          </button>
        )}
      </header>

      <div className="edit-bay-body">
        <section className="edit-bay-stage" aria-label={t('Preview')}>
          <div className="edit-bay-stage-inner">
            <div
              className={`edit-bay-frame relative mx-auto max-w-full ${
                isLandscape ? 'w-full aspect-video' : 'aspect-[9/16]'
              }`}
              style={morph ? { viewTransitionName: morph } : undefined}
            >
              <video
                key={previewSrc ?? `clip-${clip.id}`}
                ref={videoRef}
                src={previewSrc ? `${API_BASE}${previewSrc}` : api.mediaUrl(clip.id)}
                controls
                autoPlay
                className="absolute inset-0 w-full h-full object-contain edit-bay-video"
                aria-label="Editing preview"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onSeeked={(e) => setNow(e.currentTarget.currentTime)}
              />
              {/* What the apps draw over a Short, to keep text clear of it. */}
              {safe && !isLandscape && PLATFORM_UI[safe] && (
                <div className="absolute inset-0 z-[5] pointer-events-none edit-bay-safe-layer">
                  <PlatformOverlay platform={safe} />
                </div>
              )}
              {/* Live watermark overlay — hidden while a baked draft is shown. */}
              {watermark && !previewSrc && (
                <WatermarkOverlay
                  config={watermark}
                  onChange={(patch) => setWatermark({ ...watermark, ...patch })}
                />
              )}
              {/* Pending hook / caption text — or a translated language being
                  auditioned — drawn live over the video. */}
              {!previewSrc && <LiveTextOverlay videoRef={videoRef} overlay={overlay} />}
              {translated && !previewSrc && (
                <span className="absolute bottom-2 left-2 z-20 edit-bay-tag">
                  {translated.language.toUpperCase()} preview — this is how the burn will look
                </span>
              )}
              {previewSrc && (
                <span className="absolute top-2 left-2 z-20 edit-bay-tag edit-bay-tag-hot">
                  PREVIEW — all edits applied (not saved until Apply)
                </span>
              )}
            </div>
            <div className="edit-bay-caption">
              <ScoreBadge score={clip.score} size="sm" />
              <span className="t-mono text-muted">
                {timecode(clip.start_s)} → {timecode(clip.end_s)}
              </span>
              {isLandscape ? (
                <span className="text-xs text-muted">Longform clip — 1920×1080 horizontal</span>
              ) : (
                <span className="text-xs text-muted">{t('Short — 1080×1920 vertical')}</span>
              )}
            </div>
          </div>
        </section>
        <section className="edit-bay-panel min-w-0" aria-label={t('Edit')}>
          <TimelineEditor
            clip={clip}
            videoRef={videoRef}
            onChanged={onChanged}
            onPreview={setPreviewSrc}
            onLiveOverlay={setLiveOverlay}
            onTranslationPreview={setTranslated}
            watermark={watermark}
            setWatermark={setWatermark}
            tabRequest={tabRequest ?? undefined}
          />
        </section>
      </div>
    </div>
  )
}
