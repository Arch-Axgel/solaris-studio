import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { API_BASE, api } from '../../lib/api'
import { motionReduced } from '../../lib/motion'
import { youtubeEnabledSync } from '../../lib/youtube'

/** One shared hover preview for every clip poster in the app (spec 4.6).
 *
 *  Chromium allows about six connections per host, so a grid of <video>
 *  elements pointed at the local server starves its own pool. Instead there
 *  is ONE module-level <video muted playsInline preload="none">, moved into
 *  whichever poster the pointer rests on:
 *
 *  - while the pointer moves, the poster scrubs: its frame follows pointer X
 *    (api.clipFrameUrl, throttled to 120 ms, snapped to 10 steps so the
 *    server's frame cache gets hits);
 *  - after 400 ms of hover the shared video is attached and plays muted, and
 *    moving the pointer then seeks it;
 *  - leaving pauses it and detaches it (the src is dropped so the connection
 *    is freed).
 *
 *  Disabled under reduced motion (poster only). Pauses when the window is
 *  hidden. Frames come from /clips/{id}/frame, which only answers while
 *  YouTube publishing is on, so `posterUrl` is '' when frames are known to be
 *  unavailable: render <ClipPoster/>, which falls back to a lazy first-frame
 *  <video>, rather than a bare <img>. */

const HOVER_DELAY_MS = 400
const SCRUB_THROTTLE_MS = 120
const SCRUB_STEPS = 10

/* ---------- frame availability (module-wide) ---------- */

type FrameState = 'unknown' | 'ok' | 'bad'
let frameState: FrameState = youtubeEnabledSync() ? 'unknown' : 'bad'
const frameListeners = new Set<() => void>()

function setFrameState(next: FrameState): void {
  if (frameState === next) return
  frameState = next
  frameListeners.forEach((l) => l())
}

/** A poster image loaded (true) or failed (false). The first answer decides
 *  for the session; after one success, a failure is only that clip's. */
export function reportFrame(ok: boolean): void {
  if (ok) setFrameState('ok')
  else if (frameState === 'unknown') setFrameState('bad')
}

export function framesAvailable(): boolean {
  return frameState !== 'bad'
}

function useFramesAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      frameListeners.add(cb)
      return () => {
        frameListeners.delete(cb)
      }
    },
    () => frameState !== 'bad',
    () => true
  )
}

/** Where a clip's poster frame sits by default: a third in, at most 1 s. */
export function defaultPosterT(durationS?: number): number {
  const d = durationS && durationS > 0 ? durationS : 3
  return Math.min(1, Math.max(0, d / 3))
}

/* ---------- the one shared video ---------- */

let shared: HTMLVideoElement | null = null
let owner: HTMLElement | null = null
let ownerStop: (() => void) | null = null
let visibilityHooked = false

function sharedVideo(): HTMLVideoElement {
  if (shared) return shared
  const v = document.createElement('video')
  v.muted = true
  v.defaultMuted = true
  v.playsInline = true
  v.loop = true
  v.preload = 'none'
  v.setAttribute('muted', '')
  v.setAttribute('playsinline', '')
  v.setAttribute('aria-hidden', 'true')
  v.tabIndex = -1
  v.className = 'lib-hover-video'
  shared = v
  if (!visibilityHooked) {
    visibilityHooked = true
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) shared?.pause()
    })
  }
  return v
}

function detachShared(): void {
  const v = shared
  if (!v) return
  v.pause()
  v.removeAttribute('data-on')
  if (v.parentElement) v.remove()
  v.removeAttribute('src')
  try {
    v.load() // frees the connection
  } catch {
    /* nothing to free */
  }
  owner = null
  ownerStop = null
}

export interface HoverPreviewOpts {
  src?: 'media' | 'preview'
  scrub?: boolean
  durationS?: number
  /** How the shared video fills the poster (longform clips: 'contain'). */
  fit?: 'cover' | 'contain'
}

/** Exact API (spec 4.6). Attach `ref` to a position:relative poster box and
 *  draw `posterUrl` (when not '') as its image. */
export function useHoverPreview(
  clipId: number,
  opts?: HoverPreviewOpts
): { ref: React.RefCallback<HTMLElement>; posterUrl: string; playing: boolean } {
  const frames = useFramesAvailable()
  const [playing, setPlaying] = useState(false)
  const [scrubT, setScrubT] = useState<number | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const cleanup = useRef<(() => void) | null>(null)

  const ref = useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.()
      cleanup.current = null
      if (!el) return
      let timer: ReturnType<typeof setTimeout> | null = null
      let lastScrub = 0
      let pendingT: number | null = null
      let scrubTimer: ReturnType<typeof setTimeout> | null = null

      const duration = (): number => {
        const d = optsRef.current?.durationS
        return d && d > 0 ? d : 0
      }
      const stop = (): void => {
        if (timer) clearTimeout(timer)
        timer = null
        if (scrubTimer) clearTimeout(scrubTimer)
        scrubTimer = null
        if (owner === el) detachShared()
        setPlaying(false)
        setScrubT(null)
      }
      const start = (): void => {
        timer = null
        if (motionReduced() || document.hidden) return
        if (owner && owner !== el) ownerStop?.()
        const v = sharedVideo()
        const o = optsRef.current
        v.src = o?.src === 'preview' ? `${API_BASE}/media/preview/${clipId}` : api.mediaUrl(clipId)
        v.style.objectFit = o?.fit ?? 'cover'
        owner = el
        ownerStop = stop
        el.appendChild(v)
        const seekTo = pendingT
        const onMeta = (): void => {
          if (seekTo !== null && owner === el) {
            try {
              v.currentTime = seekTo
            } catch {
              /* not seekable yet */
            }
          }
        }
        v.addEventListener('loadedmetadata', onMeta, { once: true })
        const onPlaying = (): void => {
          if (owner !== el) return
          v.setAttribute('data-on', '')
          setPlaying(true)
        }
        v.addEventListener('playing', onPlaying, { once: true })
        void v.play().catch(() => {
          /* autoplay refused or the source is missing: the poster stays */
        })
      }
      const enter = (): void => {
        if (motionReduced()) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(start, HOVER_DELAY_MS)
      }
      const applyScrub = (t: number): void => {
        lastScrub = Date.now()
        if (owner === el && shared && shared.readyState >= 1) {
          try {
            shared.currentTime = t
          } catch {
            /* ignore */
          }
        } else if (optsRef.current?.scrub !== false) {
          setScrubT(t)
        }
      }
      const move = (e: PointerEvent): void => {
        const d = duration()
        if (!d || motionReduced()) return
        const r = el.getBoundingClientRect()
        const frac = Math.max(0, Math.min(0.999, (e.clientX - r.left) / Math.max(1, r.width)))
        const step = Math.floor(frac * SCRUB_STEPS)
        const t = Number(((step + 0.5) * (d / SCRUB_STEPS)).toFixed(2))
        pendingT = t
        const wait = SCRUB_THROTTLE_MS - (Date.now() - lastScrub)
        if (wait <= 0) applyScrub(t)
        else if (!scrubTimer)
          scrubTimer = setTimeout(() => {
            scrubTimer = null
            if (pendingT !== null) applyScrub(pendingT)
          }, wait)
      }
      el.addEventListener('pointerenter', enter)
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerleave', stop)
      el.addEventListener('pointercancel', stop)
      cleanup.current = () => {
        el.removeEventListener('pointerenter', enter)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerleave', stop)
        el.removeEventListener('pointercancel', stop)
        if (timer) clearTimeout(timer)
        if (scrubTimer) clearTimeout(scrubTimer)
        if (owner === el) detachShared()
      }
    },
    [clipId]
  )

  useEffect(
    () => () => {
      cleanup.current?.()
      cleanup.current = null
    },
    []
  )

  const t = scrubT ?? defaultPosterT(opts?.durationS)
  return { ref, posterUrl: frames ? api.clipFrameUrl(clipId, t) : '', playing }
}

/* ---------- a ready-made poster ---------- */

function useNear<T extends Element>(): [React.RefCallback<T>, boolean] {
  const [near, setNear] = useState(false)
  const io = useRef<IntersectionObserver | null>(null)
  const ref = useCallback(
    (el: T | null) => {
      io.current?.disconnect()
      io.current = null
      if (!el || near) return
      if (typeof IntersectionObserver === 'undefined') {
        setNear(true)
        return
      }
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setNear(true)
            obs.disconnect()
          }
        },
        { rootMargin: '300px' }
      )
      obs.observe(el)
      io.current = obs
    },
    [near]
  )
  useEffect(() => () => io.current?.disconnect(), [])
  return [ref, near]
}

/** A 9:16 (or 16:9) clip poster with the shared hover preview built in:
 *  frame image when frames are available, otherwise a lazy first-frame
 *  <video>; both load only once the poster nears the viewport. Overlays go
 *  in `children`. `boxRef` receives the poster box (for the card→editor
 *  morph). */
export function ClipPoster({
  clipId,
  durationS,
  fit = 'cover',
  scrub = true,
  src,
  className,
  boxRef,
  children,
  hover = true
}: {
  clipId: number
  durationS?: number
  fit?: 'cover' | 'contain'
  scrub?: boolean
  src?: 'media' | 'preview'
  className?: string
  boxRef?: React.Ref<HTMLDivElement>
  children?: React.ReactNode
  hover?: boolean
}): JSX.Element {
  const { ref: hoverRef, posterUrl, playing } = useHoverPreview(clipId, { durationS, scrub, src, fit })
  const [nearRef, near] = useNear<HTMLDivElement>()
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [clipId])

  // The caller's ref is read through a ref, so an inline callback from the
  // parent never re-attaches the hover listeners (which would stop a playing
  // preview on every parent render).
  const boxRefLatest = useRef(boxRef)
  boxRefLatest.current = boxRef
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      nearRef(el)
      if (hover) hoverRef(el)
      else hoverRef(null)
      const r = boxRefLatest.current
      if (typeof r === 'function') r(el)
      else if (r && typeof r === 'object') (r as React.MutableRefObject<HTMLDivElement | null>).current = el
    },
    [nearRef, hoverRef, hover]
  )

  const useImg = Boolean(posterUrl) && !failed
  return (
    <div
      ref={setBox}
      className={`lib-poster ${className ?? ''}`}
      data-playing={playing ? '' : undefined}
      data-loaded={loaded || (!useImg && near) ? '' : undefined}
    >
      {!near ? (
        <div className="lib-poster-placeholder" aria-hidden />
      ) : useImg ? (
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          decoding="async"
          className="lib-poster-img"
          style={{ objectFit: fit }}
          onLoad={() => {
            setLoaded(true)
            reportFrame(true)
          }}
          onError={() => {
            setFailed(true)
            reportFrame(false)
          }}
        />
      ) : (
        <video
          src={`${api.mediaUrl(clipId)}#t=${defaultPosterT(durationS).toFixed(2)}`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden
          className="lib-poster-img"
          style={{ objectFit: fit }}
        />
      )}
      {children}
    </div>
  )
}
