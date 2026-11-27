import { useEffect, useId, useRef, useState } from 'react'
import { api, type FramePeople, type LayoutSource } from '../lib/api'
import {
  clearZone,
  elementOf,
  faceClear,
  OUT_H,
  OUT_W,
  plan,
  PRESETS,
  SAFE_ZONES,
  safeZone,
  type Element,
  type GamingPlan,
  type Head,
  type LayoutSettings,
  type Placeable,
  type PxBox
} from '../lib/gamingLayout'
import { t } from '../lib/i18n'
import { FloatingLayer, Overlay } from './ui/Overlay'
import { dragLayer, keepOut, reshape, type Box, type Handle, type Targets } from '../lib/layerDrag'
import { Icon, Maximize, Minimize, Restore } from './icons'
import PlatformOverlay, { PLATFORM_UI } from './PlatformOverlay'
import type { FrameBox, GamingSettings } from '../lib/types'

/** The Gaming / Reaction layout editor: pick a layout, mark the webcam and the
 *  game on real frames of the video, and see the 9:16 result before anything
 *  is processed (or, in the clip editor, before one clip is re-rendered).
 *
 *  Every number in the preview comes from lib/gamingLayout.ts, a checked copy
 *  of the renderer's own geometry, so what it shows is what the clip will be:
 *  which layout, which part of the frame each element shows, where the game
 *  sits in its region, and where the streamer's face lands against the
 *  platform's own UI.
 *
 *  Nothing is saved here: the result goes back to the caller, which sends it
 *  with the job (Generate bar) or as a pending edit (clip editor). */

type BoxRole = 'cam' | 'cam2' | 'game' | 'ui'
type CamMode = 'auto' | 'draw' | 'none'
type Drag = { role: BoxRole; mode: Handle; ox: number; oy: number; box: FrameBox; fw: number; fh: number }
/** A layer being moved or resized on the preview, in canvas px. */
type LayerDrag = { role: Placeable; handle: Handle; ox: number; oy: number; dest: PxBox }

/** Where each resize handle sits on a layer, as fractions of its box; a round
 *  facecam's sit on the circle. */
const HANDLES: [Handle, number, number, string][] = [
  ['nw', 0, 0, 'nwse-resize'],
  ['n', 0.5, 0, 'ns-resize'],
  ['ne', 1, 0, 'nesw-resize'],
  ['e', 1, 0.5, 'ew-resize'],
  ['se', 1, 1, 'nwse-resize'],
  ['s', 0.5, 1, 'ns-resize'],
  ['sw', 0, 1, 'nesw-resize'],
  ['w', 0, 0.5, 'ew-resize']
]
const ON_CIRCLE = (f: number): number => (f === 0.5 ? 0.5 : 0.5 + (f - 0.5) * Math.SQRT1_2)

const CARD_ORDER = [
  'split',
  'basecam',
  'half',
  'fullscreen',
  'blurred',
  'small_cam',
  'circle_cam',
  'game_ui',
  'mosaic',
  'dual_cam',
  'duo_split'
] as const
const FRAMES = [0.1, 0.3, 0.5, 0.7, 0.9]
/** Box colours on the frame, from the theme: gold for the webcam, a light
 *  rose for the game, ink for a second webcam, amber for the Game UI. Bright
 *  enough to read on any video frame. */
const COLOUR: Record<BoxRole, string> = { cam: '#ECC87C', cam2: '#F6EDE7', game: '#EE7FA0', ui: '#F2A65A' }
/** Text on a coloured box label (theme base). */
const ON_COLOUR = '#130A0D'
/** Snap guides and the frame's middle lines. */
const GUIDE = '#ECC87C'
/** Blocks drawn for a layout before (or without) a frame: each part in its
 *  colour, so the cards and the preview still show the layout. */
const BLOCK: Record<string, string> = {
  cam: 'rgb(236 200 124 / 0.42)',
  cam2: 'rgb(246 237 231 / 0.3)',
  game: 'rgb(143 36 69 / 0.75)',
  ui: 'rgb(242 166 90 / 0.5)',
  bg: 'rgb(46 26 33 / 1)'
}
const LABEL: Record<BoxRole, string> = { cam: 'Webcam', cam2: 'Webcam 2', game: 'Game', ui: 'Game UI' }
const NEW_BOX: Record<BoxRole, FrameBox> = {
  cam: [0.02, 0.6, 0.25, 0.36],
  cam2: [0.73, 0.6, 0.25, 0.36],
  game: [0.1, 0.02, 0.8, 0.8],
  ui: [0.35, 0.0, 0.3, 0.08]
}
/** Where the preview draws a webcam that will only be found when processing. */
const PLACEHOLDER_CAM: FrameBox = [0.02, 0.6, 0.25, 0.36]
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

const rolesOf = (preset: string): Set<string> => {
  const spec = PRESETS[preset]
  return new Set<string>([...(spec.rows ?? []).flat(), ...(spec.cams ?? []), ...(spec.overlay ?? []), 'game'])
}

/** How much of box `a` lies inside box `b` (normalized x, y, w, h). */
function inside(a: FrameBox, b: FrameBox): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))
  return a[2] * a[3] > 0 ? (ix * iy) / (a[2] * a[3]) : 0
}

/** The style that shows source box `box` (px) of the frame in a pane of pw x ph:
 *  'cover' fills it (scaled up, overflow trimmed), 'contain' shows it whole at
 *  the anchor. `down` moves the picture down (a camera's face shift). */
function paint(
  box: PxBox,
  srcW: number,
  srcH: number,
  pw: number,
  ph: number,
  mode: 'cover' | 'contain',
  anchor: Element['anchor'] = 'center',
  down = 0
): React.CSSProperties {
  const [bx, by, bw, bh] = box
  const scale = (mode === 'cover' ? Math.max : Math.min)(pw / bw, ph / bh)
  const ox = (pw - bw * scale) / 2
  const oy = mode === 'cover' ? (ph - bh * scale) / 2 : anchor === 'top' ? 0 : anchor === 'bottom' ? ph - bh * scale : (ph - bh * scale) / 2
  return {
    position: 'absolute',
    width: srcW * scale,
    height: srcH * scale,
    left: ox - bx * scale,
    top: oy - by * scale + down,
    maxWidth: 'none',
    clipPath: `inset(${by * scale}px ${(srcW - bx - bw) * scale}px ${(srcH - by - bh) * scale}px ${bx * scale}px)`
  }
}

/** One layout drawn at `width` px wide from the frame image: the preview and
 *  the layout cards. */
function Composition({
  p,
  frameUrl,
  src,
  width,
  placeholderCam
}: {
  p: GamingPlan
  /** null: no frame (yet): each part is drawn as a coloured block. */
  frameUrl: string | null
  src: { w: number; h: number }
  width: number
  placeholderCam: boolean
}): JSX.Element {
  const k = width / OUT_W
  return (
    <div className="relative overflow-hidden" style={{ width, height: OUT_H * k, background: frameUrl ? '#000' : BLOCK.bg }}>
      {p.elements.map((e, i) => {
        const [dx, dy, dw, dh] = e.dest.map((v) => v * k)
        const box: React.CSSProperties = {
          position: 'absolute',
          left: dx,
          top: dy,
          width: dw,
          height: dh,
          overflow: 'hidden',
          borderRadius: e.shape === 'circle' ? '50%' : undefined
        }
        if (placeholderCam && e.role === 'cam') {
          return (
            <div key={i} style={box} className="bg-raised/80 flex items-center justify-center text-center">
              {width > 120 && (
                <span className="text-[10px] text-muted px-2">{t('Webcam, found by who is talking when processing')}</span>
              )}
            </div>
          )
        }
        if (!frameUrl) {
          return (
            <div
              key={i}
              style={{
                ...box,
                background: BLOCK[e.role] ?? BLOCK.game,
                boxShadow: e.role === 'bg' ? undefined : 'inset 0 0 0 1px rgb(246 237 231 / 0.14)'
              }}
            />
          )
        }
        if (e.fit === 'blur') {
          return (
            <div key={i} style={box}>
              <img
                src={frameUrl}
                alt=""
                draggable={false}
                style={{ ...paint(e.src, src.w, src.h, dw, dh, 'cover'), filter: 'blur(6px) brightness(0.85)' }}
              />
            </div>
          )
        }
        const blurred = e.fit === 'contain' || e.shift > 0
        return (
          <div key={i} style={box}>
            {blurred && (
              <img
                src={frameUrl}
                alt=""
                draggable={false}
                style={{ ...paint(e.src, src.w, src.h, dw, dh, 'cover'), filter: 'blur(6px) brightness(0.85)' }}
              />
            )}
            <img
              src={frameUrl}
              alt=""
              draggable={false}
              style={paint(e.src, src.w, src.h, dw, dh, e.fit, e.anchor, e.shift * k)}
            />
          </div>
        )
      })}
    </div>
  )
}

/** One of the five frames to set the layout up on: a shimmer while it
 *  loads, a film glyph if it can't be read, never an empty box. */
function FrameThumb({ src, on, label, onPick }: { src: string; on: boolean; label: string; onPick: () => void }): JSX.Element {
  const [state, setState] = useState<'loading' | 'ok' | 'bad'>('loading')
  useEffect(() => setState('loading'), [src])
  return (
    <button type="button" className="gle-thumb" data-on={on} data-state={state} aria-label={label} aria-pressed={on} onClick={onPick}>
      {state === 'bad' ? (
        <Icon name="film" size={16} />
      ) : (
        <img src={src} alt="" loading="lazy" draggable={false} onLoad={() => setState('ok')} onError={() => setState('bad')} />
      )}
    </button>
  )
}

export default function GamingLayoutEditor({
  source,
  context,
  settings,
  remember: rememberInitially,
  canRemember = true,
  onClose,
  onDone
}: {
  source: LayoutSource
  /** 'video': set up before processing. 'clip': fixing one clip in the editor. */
  context: 'video' | 'clip'
  settings: GamingSettings
  remember: boolean
  canRemember?: boolean
  onClose: () => void
  onDone: (settings: GamingSettings, remember: boolean) => void
}): JSX.Element {
  // Where to start: the clip's or job's own choices; a layout from before
  // layouts existed was Half, in the order it had.
  const legacy = !settings.preset && Boolean(settings.cam_position || settings.game_fit)
  const [preset, setPreset] = useState<string>(
    settings.preset && settings.preset in PRESETS ? settings.preset : legacy ? 'half' : 'split'
  )
  const [order, setOrder] = useState<'cam_top' | 'game_top'>(
    (settings.order as 'cam_top' | 'game_top') ??
      (settings.cam_position === 'bottom' ? 'game_top' : (PRESETS[preset]?.order as 'cam_top' | 'game_top') ?? 'cam_top')
  )
  const [divider, setDivider] = useState<number | undefined>(settings.divider)
  const [safe, setSafe] = useState<string>(settings.safe ?? 'tiktok')
  const [gameFit, setGameFit] = useState<'fit' | 'fill'>(
    (settings.game_fit as 'fit' | 'fill') ?? (legacy ? 'fit' : (PRESETS[preset]?.game_fit as 'fit' | 'fill') ?? 'fill')
  )
  const [gameAlign, setGameAlign] = useState<'left' | 'center' | 'right'>(settings.game_align ?? 'center')
  const decided = settings.by === 'user' || settings.by === 'creator'
  const found: FrameBox | null = settings.used_cam ?? (settings.by === 'video' ? settings.cam ?? null : null)
  // Draw it is the default: the webcam and game boxes are on the frame from
  // the start, to drag onto the webcam and round the gameplay. A clip that
  // was rendered with no webcam starts from None.
  const [camMode, setCamMode] = useState<CamMode>(
    decided && 'cam' in settings
      ? settings.cam
        ? 'draw'
        : 'none'
      : context === 'clip' && settings.used_preset && !settings.used_cam
        ? 'none'
        : 'draw'
  )
  const camTouched = useRef(Boolean(decided || found))
  const [boxes, setBoxes] = useState<Record<BoxRole, FrameBox | null>>({
    cam: (decided ? settings.cam : found) ?? NEW_BOX.cam,
    cam2: settings.cam2 ?? null,
    game: settings.game_box ?? null,
    ui: settings.ui_box ?? null
  })
  // The stream's solid panels (a black chat bar, a splits timer): the game
  // crop keeps them out. Found by the engine; drawing the game area overrides.
  const [panels, setPanels] = useState<FrameBox[] | undefined>(settings.panels)
  // Where the facecams and the Game UI were put on the Short, as in
  // StreamLadder: dragged and resized on the preview.
  const [places, setPlaces] = useState<Partial<Record<Placeable, FrameBox>>>(settings.places ?? {})
  const layerDrag = useRef<LayerDrag | null>(null)
  const [selected, setSelected] = useState<Placeable | null>(null)
  const [guides, setGuides] = useState<Targets>({ xs: [], ys: [] })
  const [showGrid, setShowGrid] = useState(false)
  // Fullscreen like the video player's (the whole monitor, Esc to leave),
  // remembered for next time; minimised to a bar to get at the app.
  const [full, setFull] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gaming-layout-fullscreen') === '1'
    } catch {
      return false
    }
  })
  const [mini, setMini] = useState(false)
  const miniRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [viewH, setViewH] = useState(window.innerHeight)
  const [remember, setRemember] = useState(rememberInitially)
  const [active, setActive] = useState<BoxRole>('cam')
  const [at, setAt] = useState(context === 'video' ? FRAMES[1] : 0.5)
  const [scrub, setScrub] = useState(at)
  const [src, setSrc] = useState({ w: 1920, h: 1080 })
  const [loaded, setLoaded] = useState(false)
  const [frameError, setFrameError] = useState<string | null>(null)
  // Bumped by Retry: a fresh request for the same frames.
  const [retry, setRetry] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const titleId = useId()
  const [people, setPeople] = useState<FramePeople | null>(null)
  const [checking, setChecking] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // The box being dragged on the frame: the grid shows meanwhile, and for the
  // game box the webcam's edges too.
  const [placing, setPlacing] = useState<BoxRole | null>(null)
  // Guide lines on the frame while a box snaps, in fractions of the frame.
  const [frameGuides, setFrameGuides] = useState<Targets>({ xs: [], ys: [] })
  const dividerDrag = useRef(false)

  const rememberFull = (on: boolean): void => {
    try {
      localStorage.setItem('gaming-layout-fullscreen', on ? '1' : '0')
    } catch {
      // not remembered; still works now
    }
  }
  const toggleFull = (): void => {
    const on = !full
    setFull(on)
    rememberFull(on)
    if (on) panelRef.current?.requestFullscreen?.().catch(() => undefined)
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
  }
  const minimise = (): void => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    setMini(true)
  }
  useEffect(() => {
    // Opened fullscreen last time: fill the window, and the monitor if allowed.
    if (full) panelRef.current?.requestFullscreen?.().catch(() => undefined)
    const onResize = (): void => setViewH(window.innerHeight)
    // Leaving the monitor's fullscreen (Esc, as on a video) leaves it
    // altogether, back to the normal-sized editor.
    const onFsChange = (): void => {
      setViewH(window.innerHeight)
      if (!document.fullscreenElement) {
        setFull(false)
        rememberFull(false)
      }
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onFsChange)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    // Minimised, the bar floats over the page it was opened from: give that
    // page's scroller room at the bottom so its last row can always be
    // scrolled clear of the bar.
    if (!mini) return
    const bar = miniRef.current?.parentElement
    if (!bar) return
    // The nearest scroller that reaches down to where the bar floats: the
    // page (or the Create sheet), not a short inner list on the way up. One
    // that already scrolls wins, so an overflow:auto box that just grows with
    // its content (the Create surface on narrow windows) is passed over;
    // failing that (a page that fits), the nearest one that reaches the bar.
    const reach = window.innerHeight - bar.offsetHeight - 40
    const reaches = (n: HTMLElement): boolean =>
      /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.getBoundingClientRect().bottom >= reach
    const find = (scrolls: boolean): HTMLElement | null => {
      let n: HTMLElement | null = bar.parentElement
      while (n && !(reaches(n) && (!scrolls || n.scrollHeight > n.clientHeight + 1))) n = n.parentElement
      return n
    }
    const el = find(true) ?? find(false)
    if (!el) return
    const scroller = el
    const before = scroller.style.paddingBottom
    const base = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
    const room = bar.offsetHeight + 32
    // Near the bottom already: the bar would land on the last row, so follow
    // it down into the new room.
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - room
    scroller.style.paddingBottom = `${base + room}px`
    if (atBottom) scroller.scrollTop = scroller.scrollHeight
    // A scroller that stops short of the window (the Create sheet, above its
    // footer): sit just above its bottom edge, not on the footer below it.
    const gap = window.innerHeight - scroller.getBoundingClientRect().bottom
    if (gap > 4) bar.style.bottom = `${gap + 12}px`
    return () => {
      scroller.style.paddingBottom = before
      bar.style.bottom = ''
    }
  }, [mini])
  useEffect(() => {
    // Esc belongs to this editor while it's open: out of fullscreen first,
    // then closed. Without this, inside the clip editor Esc closed the whole
    // clip editor underneath.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || mini) return
      e.stopImmediatePropagation()
      // Also cancel the browser's close request, or it lands on the Create
      // sheet / dialog under this editor once it has closed and shuts that too.
      e.preventDefault()
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined)
        return
      }
      if (full) {
        setFull(false)
        rememberFull(false)
      } else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full, mini, onClose])

  const withRetry = (url: string): string => (retry > 0 ? `${url}&retry=${retry}` : url)
  const frameUrl = withRetry(api.layoutFrameUrl(source, at))
  useEffect(() => {
    setLoaded(false)
    setFrameError(null)
    setChecking(true)
    api
      .layoutPeople(source, at)
      .then(setPeople)
      .catch(() => setPeople(null))
      .finally(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameUrl])

  // A starting webcam, before processing: the same person in the same framed
  // spot across the video. Only a suggestion: it is drawn for you to check.
  useEffect(() => {
    if ('clipId' in source) {
      if (settings.panels === undefined)
        api
          .layoutPanels(source.clipId)
          .then((r) => setPanels(r.panels))
          .catch(() => undefined)
      return
    }
    const wantCam = context === 'video' && !camTouched.current
    if (!wantCam && settings.panels !== undefined) return
    if (wantCam) setNote(t('Drag the Webcam box onto the streamer’s camera and the Game box round the gameplay.'))
    api
      .layoutSuggest(source)
      .then((r) => {
        if (settings.panels === undefined) setPanels(r.panels ?? [])
        if (!wantCam || !r.cam || camTouched.current) return
        setBoxes((b) => ({ ...b, cam: r.cam }))
        setNote(t('Webcam found: the same person in the same framed spot across the video. Check it on a few frames, and drag it if it’s off.'))
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roles = rolesOf(preset)
  const camBox: FrameBox | null = camMode === 'draw' ? boxes.cam : camMode === 'auto' ? found : null
  const camUnknown = camMode === 'auto' && !found
  // The webcams the layout shows, a little past their border (CAM_CLEAR, the
  // same line the automatic game area keeps to): the game box snaps to their
  // edges and stops there instead of going over them, so the webcam doesn't
  // show in the game too. Fractions of the frame.
  const camWalls: FrameBox[] = [camBox, roles.has('cam2') ? boxes.cam2 : null]
    .filter((b): b is FrameBox => !!b)
    .map(clearZone)

  const settingsFor = (p: string, gameBox: FrameBox | null = boxes.game): LayoutSettings => ({
    preset: p,
    order,
    divider,
    safe,
    game_fit: gameFit,
    game_align: gameAlign,
    cam: camUnknown ? PLACEHOLDER_CAM : camBox,
    cam2: boxes.cam2,
    game_box: gameBox,
    ui_box: boxes.ui,
    panels,
    places
  })

  // The streamer's head on this frame: the surest person inside the webcam.
  const headIn = (box: FrameBox | null): Head | undefined => {
    if (!box || !people) return undefined
    const inBox = people.people.filter((q) => q.head && inside(q.box, box) >= 0.6)
    if (inBox.length === 0) return undefined
    const q = inBox.reduce((a, b) => (b.confidence > a.confidence ? b : a))
    const [cx, top, chin] = q.head as [number, number, number]
    return [cx * src.w, top * src.h, chin * src.h]
  }
  const heads = { cam: camUnknown ? undefined : headIn(camBox), cam2: headIn(boxes.cam2) }
  const cleanHeads = Object.fromEntries(Object.entries(heads).filter(([, v]) => v)) as Record<string, Head>
  const base = plan(src.w, src.h, settingsFor(preset), cleanHeads)
  // Zoomed to fill, the game is cut to the shape of its space on the Short,
  // which changes with the webcam's share, the layout and which goes on top.
  // The game box takes that shape (its middle and size as drawn, clear of the
  // webcam), so what's inside it is what renders; the box as drawn is kept, so
  // going back and forth doesn't wear it down. Whole shows any box whole.
  const baseGame = elementOf(base, 'game')
  const gameShape = baseGame && baseGame.fit === 'cover' ? (baseGame.dest[2] / baseGame.dest[3]) * (src.h / src.w) : null
  const drawnGame = boxes.game
  const gameBox: FrameBox | null =
    drawnGame && gameShape
      ? (keepOut(drawnGame, 'move', reshape(drawnGame, gameShape, [1, 1]), camWalls, [1, 1]).box as FrameBox)
      : drawnGame
  const p = gameBox === drawnGame ? base : plan(src.w, src.h, settingsFor(preset, gameBox), cleanHeads)
  const gameOverCam =
    !!gameBox &&
    camWalls.some(
      (w) => gameBox[0] < w[0] + w[2] && w[0] < gameBox[0] + gameBox[2] && gameBox[1] < w[1] + w[3] && w[1] < gameBox[1] + gameBox[3]
    )
  const shownPreset = p.preset
  const zone = safeZone(safe)
  const camEl = elementOf(p, 'cam')
  const faceCheck =
    camEl && cleanHeads.cam ? faceClear(cleanHeads.cam, camEl.src, camEl.dest, camEl.shift, zone) : null

  const setBox = (role: BoxRole, box: FrameBox): void => setBoxes((b) => ({ ...b, [role]: box }))

  // ---- dragging boxes on the frame -----------------------------------------------------
  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const r = frameRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const startDrag = (e: React.PointerEvent, role: BoxRole, mode: Drag['mode']): void => {
    const box = role === 'game' ? gameBox ?? autoGame : boxes[role]
    if (!box) return
    if (role === 'game') setBox('game', box) // from the shape it's shown in
    if (role === 'cam') camTouched.current = true
    e.stopPropagation()
    e.preventDefault()
    setActive(role)
    setPlacing(role)
    const q = pos(e)
    const r = frameRef.current!.getBoundingClientRect()
    drag.current = { role, mode, ox: q.x, oy: q.y, box: [...box] as FrameBox, fw: r.width, fh: r.height }
    frameRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const q = pos(e)
    // Any side or corner, snapping like the layers on the preview: to the
    // frame's middle and edges, the grid, the other boxes and the stream's
    // panels (so a game box can sit exactly on the chat bar's edge). Worked
    // in the frame's own pixels, so "close" is the same across and down.
    const { fw, fh } = d
    const px = (b: FrameBox): Box => [b[0] * fw, b[1] * fh, b[2] * fw, b[3] * fh]
    // The grid shows while a box is dragged, so it snaps to it too.
    const xs = [0, fw / 2, fw, fw / 3, (2 * fw) / 3]
    const ys = [0, fh / 2, fh, fh / 3, (2 * fh) / 3]
    const walls = d.role === 'game' ? camWalls.map(px) : []
    for (const [x, y, w, h] of walls) {
      xs.push(x, x + w)
      ys.push(y, y + h)
    }
    const others: FrameBox[] = [...(panels ?? [])]
    for (const role of ['cam', 'cam2', 'game', 'ui'] as BoxRole[]) {
      if (role === d.role) continue
      if (walls.length > 0 && (role === 'cam' || role === 'cam2')) continue // the game snaps to the walls instead
      const b = role === 'game' ? gameBox ?? autoGame : role === 'cam' ? camBox : boxes[role]
      if (b && (role !== 'ui' || roles.has('ui')) && (role !== 'cam2' || roles.has('cam2'))) others.push(b)
    }
    for (const b of others) {
      const [x, y, w, h] = px(b)
      xs.push(x, x + w / 2, x + w)
      ys.push(y, y + h / 2, y + h)
    }
    // Zoomed to fill, the game box keeps its space's shape as it's resized.
    const shape = d.role === 'game' && gameShape ? gameShape * (fw / fh) : null
    const { box, guides: lines } = dragLayer(px(d.box), d.mode, (q.x - d.ox) * fw, (q.y - d.oy) * fh, {
      aspect: shape,
      canvas: [fw, fh],
      minW: 0.03 * fw,
      minH: 0.03 * fh,
      targets: e.altKey ? null : { xs, ys }, // hold Alt to place freely
      tol: 6
    })
    const kept =
      e.altKey || walls.length === 0 ? { box, guides: lines } : keepOut(px(d.box), d.mode, box, walls, [fw, fh], shape)
    const shown = kept.box === box ? lines : kept.guides
    setFrameGuides({ xs: shown.xs.map((v) => v / fw), ys: shown.ys.map((v) => v / fh) })
    setBox(d.role, [kept.box[0] / fw, kept.box[1] / fh, kept.box[2] / fw, kept.box[3] / fh])
  }

  // ---- the divider on the preview ------------------------------------------------------
  const spec = PRESETS[shownPreset]
  const canDivide = spec.type === 'stack' && spec.divider && spec.divider[0] < spec.divider[1]
  // The preview grows with the screen in fullscreen.
  const PW = full ? Math.round(clamp((viewH - 330) * (OUT_W / OUT_H), 270, 540)) : 270
  const k = PW / OUT_W
  const dividerY = camEl && canDivide ? (order === 'cam_top' ? camEl.dest[1] + camEl.dest[3] : camEl.dest[1]) : null
  // Layers on the preview: the facecams of the picture-in-picture layouts and
  // the Game UI. A facecam keeps its shape; two are always the same size.
  const layerRoles = new Set<string>([...(spec.type === 'pip' ? spec.cams ?? [] : []), ...(spec.overlay ?? [])])
  const layers = p.elements.filter((e) => layerRoles.has(e.role))
  const startLayer = (e: React.PointerEvent, role: Placeable, handle: Handle): void => {
    const el = elementOf(p, role)
    if (!el || !previewRef.current) return
    e.stopPropagation()
    e.preventDefault() // a drag, not a text selection
    setSelected(role)
    const r = previewRef.current.getBoundingClientRect()
    layerDrag.current = {
      role,
      handle,
      ox: ((e.clientX - r.left) / r.width) * OUT_W,
      oy: ((e.clientY - r.top) / r.height) * OUT_H,
      dest: [...el.dest] as PxBox
    }
    previewRef.current.setPointerCapture(e.pointerId)
  }
  // Lines a layer snaps to: the Short's middle and edges, the platform's safe
  // lines, the grid when it's on, and every other part's edges and middle.
  const snapTargets = (role: Placeable): Targets => {
    const xs = [0, OUT_W / 2, OUT_W, zone.left, OUT_W - zone.right]
    const ys = [0, OUT_H / 2, OUT_H, zone.top, OUT_H - zone.bottom]
    if (showGrid) {
      xs.push(OUT_W / 3, (2 * OUT_W) / 3)
      ys.push(OUT_H / 3, (2 * OUT_H) / 3)
    }
    for (const e of p.elements) {
      if (e.role === role || e.role === 'bg') continue
      const [x, y, w, h] = e.dest
      xs.push(x, x + w / 2, x + w)
      ys.push(y, y + h / 2, y + h)
    }
    return { xs, ys }
  }
  const moveLayer = (e: React.PointerEvent): void => {
    const d = layerDrag.current
    if (!d || !previewRef.current) return
    const r = previewRef.current.getBoundingClientRect()
    const dx = ((e.clientX - r.left) / r.width) * OUT_W - d.ox
    const dy = ((e.clientY - r.top) / r.height) * OUT_H - d.oy
    const { box: next, guides: lines } = dragLayer(d.dest, d.handle, dx, dy, {
      aspect: d.role === 'ui' ? null : spec.pip_aspect ?? 1,
      canvas: [OUT_W, OUT_H],
      minW: 0.12 * OUT_W,
      minH: 0.02 * OUT_H,
      targets: e.altKey ? null : snapTargets(d.role), // hold Alt to place freely
      tol: 6 / k
    })
    setGuides(lines)
    const norm = (b: PxBox): FrameBox => [b[0] / OUT_W, b[1] / OUT_H, b[2] / OUT_W, b[3] / OUT_H]
    setPlaces((was) => {
      const out = { ...was, [d.role]: norm(next) }
      if (d.handle !== 'move' && d.role !== 'ui') {
        // Two facecams are always the same size.
        const other: Placeable = d.role === 'cam' ? 'cam2' : 'cam'
        const oe = elementOf(p, other)
        if (oe)
          out[other] = norm([
            Math.min(oe.dest[0], OUT_W - next[2]),
            Math.min(oe.dest[1], OUT_H - next[3]),
            next[2],
            next[3]
          ])
      }
      return out
    })
  }
  const endDrags = (): void => {
    dividerDrag.current = false
    layerDrag.current = null
    setGuides({ xs: [], ys: [] })
  }
  const onPreviewMove = (e: React.PointerEvent): void => {
    if (layerDrag.current) {
      moveLayer(e)
      return
    }
    if (!dividerDrag.current || !previewRef.current || !spec.divider) return
    const r = previewRef.current.getBoundingClientRect()
    const y = ((e.clientY - r.top) / r.height) * OUT_H
    const top = camEl ? camEl.dest[1] : 0
    const bottom = camEl ? camEl.dest[1] + camEl.dest[3] : OUT_H
    const share = order === 'cam_top' ? (y - top) / OUT_H : (bottom - y) / OUT_H
    setDivider(clamp(share, spec.divider[0], spec.divider[1]))
  }

  const pick = (id: string): void => {
    setPreset(id)
    // Each layout starts from its own order (Basecam: the game on top); the
    // On top switch then changes it.
    setOrder(((PRESETS[id].order as string) ?? 'cam_top') as 'cam_top' | 'game_top')
    setDivider(undefined)
    const r = rolesOf(id)
    if (r.has('ui') && !boxes.ui) setBox('ui', NEW_BOX.ui)
    if (r.has('cam2') && !boxes.cam2) setBox('cam2', NEW_BOX.cam2)
    if ((r.has('cam') || r.has('cam2')) && camMode === 'none') setCamMode('auto')
  }

  const snap = async (): Promise<void> => {
    if (!boxes.cam) return
    setSnapping(true)
    try {
      camTouched.current = true
    const r = await api.layoutSnap(source, boxes.cam)
      setBox('cam', r.box)
      setNote(
        r.bordered.some(Boolean)
          ? t('Snapped to the webcam’s own border.')
          : t('No clear border round the webcam, so the box was left as drawn.')
      )
    } catch {
      setNote(t('Couldn’t snap the box on this build.'))
    } finally {
      setSnapping(false)
    }
  }

  const done = (): void => {
    const out: GamingSettings = { preset, order, safe, game_fit: gameFit, game_align: gameAlign }
    if (divider !== undefined) out.divider = Math.round(divider * 1000) / 1000
    if (gameBox) out.game_box = gameBox // as shown: what renders
    if (panels !== undefined) out.panels = panels
    if (Object.keys(places).length > 0) out.places = places
    if (roles.has('ui') && boxes.ui) out.ui_box = boxes.ui
    if (roles.has('cam2') && boxes.cam2) out.cam2 = boxes.cam2
    if (camMode === 'draw' && boxes.cam) Object.assign(out, { cam: boxes.cam, by: 'user' })
    else if (camMode === 'none') Object.assign(out, { cam: null, by: 'user' })
    else if (context === 'clip') {
      if (settings.by === 'video') Object.assign(out, { cam: settings.cam ?? null, by: 'video' })
      else out.by = 'clip'
    }
    onDone(out, remember)
    onClose()
  }

  // Boxes drawn on the frame for this layout. The game's is where the layout
  // takes the game from until you move it.
  const gameEl = elementOf(p, 'game')
  const autoGame: FrameBox | null = gameEl
    ? [gameEl.src[0] / src.w, gameEl.src[1] / src.h, gameEl.src[2] / src.w, gameEl.src[3] / src.h]
    : null
  const shownBoxes: BoxRole[] = []
  if (boxes.game || autoGame) shownBoxes.push('game')
  if (roles.has('ui') && boxes.ui) shownBoxes.push('ui')
  if (roles.has('cam2') && boxes.cam2) shownBoxes.push('cam2')
  if (camMode === 'draw' && boxes.cam) shownBoxes.push('cam')

  const segment = <V extends string>(options: [V, string][], value: V, onChange: (v: V) => void): JSX.Element => (
    <div className="gle-seg" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}>
          {t(label)}
        </button>
      ))}
    </div>
  )

  const zoneLabel = SAFE_ZONES[safe]?.label ?? 'TikTok'
  const face: { tone: 'ok' | 'warn' | 'muted'; text: string } | null = !camEl
    ? null
    : camUnknown
      ? { tone: 'muted', text: t('The face is placed when the webcam is found.') }
      : !faceCheck && checking
        ? { tone: 'muted', text: t('Checking the face…') }
        : !faceCheck
          ? { tone: 'muted', text: t('No face on this frame to check. Try another frame.') }
          : faceCheck.top && faceCheck.bottom
            ? { tone: 'ok', text: `${t('Face clear of')} ${zoneLabel}${t('’s UI')}` }
            : !faceCheck.top
              ? { tone: 'warn', text: `${t('Head under')} ${zoneLabel}${t('’s top bar')}` }
              : {
                  tone: 'warn',
                  text: `${t('Chin under')} ${zoneLabel}${t('’s captions')}${order === 'game_top' ? ` — ${t('try Camera top')}` : ''}`
                }

  /** Another of the five frames than the one shown: after a failed read. */
  const nextFrame = (): void => {
    const i = FRAMES.findIndex((f) => Math.abs(f - at) < 0.001)
    const f = FRAMES[(i + 1) % FRAMES.length]
    setAt(f)
    setScrub(f)
  }

  const title = context === 'video' ? t('Choose a layout before processing') : t('Gaming / Reaction layout')
  if (mini)
    return (
      // Top layer (non-modal): stays above the rail, sheets and the Edit Bay
      // panel. Docked bottom-left, just clear of the rail, so it never sits
      // under the toasts (bottom-right); the page gets room below its last
      // row while it's here (see the effect above).
      <FloatingLayer
        className="gle-mini bottom-5 left-[calc(var(--rail-col,var(--rail-w-collapsed))+16px)] max-w-[calc(100vw-var(--rail-col,var(--rail-w-collapsed))-32px)]"
        role="dialog"
        aria-label={t('Choose a layout')}
      >
        <span ref={miniRef} className="gle-mini-icon" aria-hidden>
          <Icon name="grid" size={15} />
        </span>
        <button type="button" className="gle-mini-title" onClick={() => setMini(false)} title={t('Restore')}>
          {title}
        </button>
        <button type="button" className="btn-ghost ui-btn ui-btn-sm" onClick={() => setMini(false)}>
          <Restore size={14} />
          <span className="ui-btn-label">{t('Restore')}</span>
        </button>
        <button type="button" className="btn-icon ui-icon-sm" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
          <Icon name="x" size={15} />
        </button>
      </FloatingLayer>
    )

  const help = t(
    'Pick a moment where the webcam and the game both show. Drag a box to move it, any handle to resize it; it snaps to the middle, the edges and the other boxes (hold Alt to place it freely). The dashed line inside is what the layout will actually show.'
  )

  return (
    // A native modal in the top layer: above the rail, top bar, Create sheet
    // and Edit Bay panel whatever their transforms; the app behind is inert.
    // Esc stays with the keydown handler above (fullscreen first, then close).
    <Overlay
      onClose={onClose}
      escCloses={false}
      labelledBy={titleId}
      initialFocus='.gle-card[aria-checked="true"]'
      className={`select-none ${full ? '' : 'p-3 sm:p-4'}`}
    >
      <div ref={panelRef} className="gle" data-full={full ? 'true' : undefined} onClick={(e) => e.stopPropagation()}>
        {/* ---- header: always in view ---- */}
        <header className="gle-head">
          <span className="gle-head-icon" aria-hidden>
            <Icon name="grid" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="t-micro">{context === 'video' ? t('Gaming / Reaction') : t('Clip editor')}</p>
            <h2 id={titleId} className="t-lg text-ink truncate">
              {title}
            </h2>
          </div>
          <div className="gle-tools">
            <button
              type="button"
              className="gle-grid-toggle"
              aria-pressed={showGrid}
              onClick={() => setShowGrid((g) => !g)}
              title={t('Grid lines: thirds and the middle. Boxes snap to them.')}
            >
              <Icon name="grid" size={15} />
              <span>{t('Grid')}</span>
            </button>
            <span className="gle-tools-rule" aria-hidden />
            <button
              type="button"
              className="btn-icon"
              onClick={minimise}
              aria-label={t('Minimise')}
              title={t('Minimise: a bar in the corner, to get at the app')}
            >
              <Minimize size={16} />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={toggleFull}
              aria-label={full ? t('Exit fullscreen') : t('Fullscreen')}
              title={full ? t('Exit fullscreen (Esc)') : t('Fullscreen')}
            >
              {full ? <Restore size={16} /> : <Maximize size={16} />}
            </button>
            <button type="button" className="btn-icon" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>

        {/* ---- body: the one part that scrolls ---- */}
        <div className="gle-body">
          <div className="gle-grid">
            {/* ---- layouts ---- */}
            <section className="gle-layouts" aria-labelledby={`${titleId}-layouts`}>
              <p id={`${titleId}-layouts`} className="label mb-2">
                {t('Layouts')}
              </p>
              <div className="gle-cards" role="radiogroup" aria-label={t('Layouts')}>
                {CARD_ORDER.map((id) => {
                  const cardPlan = plan(
                    src.w,
                    src.h,
                    {
                      ...settingsFor(id),
                      order: preset === id ? order : ((PRESETS[id].order as string) ?? 'cam_top'),
                      divider: preset === id ? divider : undefined,
                      ui_box: boxes.ui ?? NEW_BOX.ui,
                      cam2: boxes.cam2 ?? NEW_BOX.cam2
                    },
                    cleanHeads
                  )
                  const selected = preset === id
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => pick(id)}
                      className="gle-card"
                      title={t(PRESETS[id].label)}
                    >
                      <span className="gle-card-art">
                        <Composition
                          p={cardPlan}
                          frameUrl={loaded ? frameUrl : null}
                          src={src}
                          width={56}
                          placeholderCam={camUnknown}
                        />
                      </span>
                      <span className="gle-card-name">{t(PRESETS[id].label)}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* ---- the frame ---- */}
            <section className="gle-frame min-w-0">
              <div className="gle-help">
                <p className={helpOpen ? '' : 'line-clamp-2'}>{help}</p>
                <button type="button" className="gle-help-more" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)}>
                  {helpOpen ? t('Less') : t('More')}
                </button>
              </div>
              <div
                ref={frameRef}
                className="gle-stage relative select-none touch-none overflow-hidden"
                style={{ aspectRatio: `${src.w} / ${src.h}` }}
                onPointerMove={onMove}
                onPointerUp={() => {
                  drag.current = null
                  setPlacing(null)
                  setFrameGuides({ xs: [], ys: [] })
                }}
                onPointerCancel={() => {
                  drag.current = null
                  setPlacing(null)
                  setFrameGuides({ xs: [], ys: [] })
                }}
              >
                {frameError ? (
                  <div className="gle-stage-state" role="alert">
                    <span className="gle-stage-icon" aria-hidden>
                      <Icon name="alert" size={20} />
                    </span>
                    <p className="text-sm text-ink font-medium">{frameError}</p>
                    <p className="text-xs text-muted max-w-sm">
                      {t('The video may still be downloading. Try again, or pick another moment.')}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-1">
                      <button type="button" className="btn-ghost ui-btn ui-btn-sm" onClick={() => setRetry((r) => r + 1)}>
                        <Icon name="retry" size={14} />
                        <span className="ui-btn-label">{t('Retry')}</span>
                      </button>
                      <button type="button" className="btn-subtle ui-btn ui-btn-sm" onClick={nextFrame}>
                        <span className="ui-btn-label">{t('Try another moment')}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {!loaded && (
                      <div className="gle-stage-state" aria-live="polite">
                        <span className="skeleton absolute inset-0" aria-hidden style={{ borderRadius: 0 }} />
                        <span className="home-spinner relative" aria-hidden />
                        <p className="relative text-sm text-muted">{t('Loading the frame…')}</p>
                      </div>
                    )}
                    <img
                      src={frameUrl}
                      alt={t('A frame of the video')}
                      className={`w-full h-full block ${loaded ? '' : 'invisible'}`}
                      draggable={false}
                      onLoad={(e) => {
                        setLoaded(true)
                        setSrc({
                          w: (e.target as HTMLImageElement).naturalWidth || 1920,
                          h: (e.target as HTMLImageElement).naturalHeight || 1080
                        })
                      }}
                      onError={() => {
                        fetch(frameUrl)
                          .then(async (r) => setFrameError((await r.json().catch(() => ({}))).detail || t('Couldn’t read a frame.')))
                          .catch(() => setFrameError(t('Couldn’t reach Solaris Studio’s engine for a frame.')))
                      }}
                    />
                  </>
                )}
                {loaded && camMode === 'auto' && found && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: `${found[0] * 100}%`,
                      top: `${found[1] * 100}%`,
                      width: `${found[2] * 100}%`,
                      height: `${found[3] * 100}%`,
                      border: `2px dashed ${COLOUR.cam}`
                    }}
                  >
                    <span className="absolute top-0 left-0 text-[10px] px-1 rounded-br" style={{ background: COLOUR.cam, color: ON_COLOUR }}>
                      {t('Found automatically')}
                    </span>
                  </div>
                )}
                {/* What each element will actually show: the crops from the plan. */}
                {loaded &&
                  p.elements.map((e, i) =>
                    (e.role === 'cam' && camUnknown) || e.role === 'bg' || (e.role === 'game' && !boxes.game) ? null : (
                      <div
                        key={`crop${i}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${(e.src[0] / src.w) * 100}%`,
                          top: `${(e.src[1] / src.h) * 100}%`,
                          width: `${(e.src[2] / src.w) * 100}%`,
                          height: `${(e.src[3] / src.h) * 100}%`,
                          border: `1px dashed ${COLOUR[e.role as BoxRole] ?? '#fff'}`,
                          opacity: 0.9
                        }}
                      />
                    )
                  )}
                {loaded &&
                  !boxes.game &&
                  (panels ?? []).map(([x, y, w, h], i) => (
                    <div
                      key={`panel${i}`}
                      className="absolute pointer-events-none flex items-start justify-end"
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${w * 100}%`,
                        height: `${h * 100}%`,
                        background: 'repeating-linear-gradient(45deg, rgb(242 122 132 / 0.28) 0 6px, transparent 6px 12px)',
                        outline: '1px solid rgb(242 122 132 / 0.8)'
                      }}
                    >
                      <span className="text-[10px] px-1 rounded-bl bg-error text-base">{t('Left out')}</span>
                    </div>
                  ))}
                {loaded &&
                  shownBoxes.map((role) => {
                    const [x, y, w, h] = (role === 'game' ? gameBox ?? autoGame : boxes[role]) as FrameBox
                    return (
                      <div
                        key={role}
                        className="absolute cursor-move"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          width: `${w * 100}%`,
                          height: `${h * 100}%`,
                          // An outline, not a border: the handles then sit exactly on the edge.
                          outline: `3px solid ${COLOUR[role]}`,
                          outlineOffset: -3,
                          boxShadow: active === role ? `0 0 0 2px ${COLOUR[role]}55` : 'none'
                        }}
                        onPointerDown={(e) => startDrag(e, role, 'move')}
                      >
                        <span
                          className={`absolute left-2.5 text-[11px] font-semibold px-1.5 leading-4 ${
                            role === 'game' ? 'bottom-0 rounded-t' : 'top-0 rounded-b'
                          }`}
                          style={{ background: COLOUR[role], color: ON_COLOUR }}
                        >
                          {t(LABEL[role])}
                        </span>
                        {HANDLES.map(([handle, fx, fy, cursor]) => (
                          <span
                            key={handle}
                            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 shadow"
                            style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, background: COLOUR[role], borderColor: ON_COLOUR, cursor }}
                            onPointerDown={(e) => startDrag(e, role, handle)}
                          />
                        ))}
                      </div>
                    )
                  })}
                {loaded && placing === 'game' && (
                  <div className="absolute inset-0 pointer-events-none">
                    {camWalls.flatMap(([x, y, w, h], i) => [
                      ...[x, x + w].map((v) => (
                        <div key={`wx${i}${v}`} className="absolute top-0 bottom-0 border-l-2 border-dashed" style={{ left: `${v * 100}%`, borderColor: COLOUR.cam }} />
                      )),
                      ...[y, y + h].map((v) => (
                        <div key={`wy${i}${v}`} className="absolute left-0 right-0 border-t-2 border-dashed" style={{ top: `${v * 100}%`, borderColor: COLOUR.cam }} />
                      ))
                    ])}
                  </div>
                )}
                {loaded && (showGrid || placing) && (
                  <div className="absolute inset-0 pointer-events-none">
                    {[1 / 3, 2 / 3].map((f) => (
                      <div key={`gx${f}`} className="absolute top-0 bottom-0 border-l border-dashed border-white/40" style={{ left: `${f * 100}%` }} />
                    ))}
                    {[1 / 3, 2 / 3].map((f) => (
                      <div key={`gy${f}`} className="absolute left-0 right-0 border-t border-dashed border-white/40" style={{ top: `${f * 100}%` }} />
                    ))}
                    <div className="absolute top-0 bottom-0 border-l border-white/60" style={{ left: '50%' }} />
                    <div className="absolute left-0 right-0 border-t border-white/60" style={{ top: '50%' }} />
                  </div>
                )}
                {frameGuides.xs.map((x) => (
                  <div key={`fx${x}`} className="absolute top-0 bottom-0 border-l-2 pointer-events-none" style={{ left: `${x * 100}%`, borderColor: GUIDE }} />
                ))}
                {frameGuides.ys.map((y) => (
                  <div key={`fy${y}`} className="absolute left-0 right-0 border-t-2 pointer-events-none" style={{ top: `${y * 100}%`, borderColor: GUIDE }} />
                ))}
              </div>

              {/* ---- scrubbing through the video ---- */}
              <div className="gle-moment">
                <span className="shrink-0">{t('Moment')}</span>
                <input
                  type="range"
                  min={0.02}
                  max={0.98}
                  step={0.01}
                  value={scrub}
                  className="flex-1"
                  aria-label={t('Moment in the video')}
                  onChange={(e) => setScrub(Number(e.target.value))}
                  onPointerUp={() => setAt(scrub)}
                  onKeyUp={() => setAt(scrub)}
                />
              </div>
              <div className="gle-thumbs" role="group" aria-label={t('Frames')}>
                {FRAMES.map((f, i) => (
                  <FrameThumb
                    key={f}
                    src={withRetry(api.layoutFrameUrl(source, f))}
                    on={Math.abs(at - f) < 0.001}
                    label={`${t('Frame')} ${i + 1}`}
                    onPick={() => {
                      setAt(f)
                      setScrub(f)
                    }}
                  />
                ))}
              </div>
              {note && (
                <p className="gle-note">
                  <Icon name="bulb" size={14} />
                  <span>{note}</span>
                </p>
              )}
              {gameOverCam && (
                <p className="gle-note is-warn">
                  <Icon name="alert" size={14} />
                  <span>
                    {t('The game box runs into the webcam, so part of the webcam shows in the game too. Drag the game box off it: it stops at the webcam’s dashed line (hold Alt to place it freely).')}
                  </span>
                </p>
              )}
            </section>

            {/* ---- the result ---- */}
            <section className="gle-side" style={{ width: PW + 2 }}>
              <div className="flex items-center justify-between gap-2">
                <p className="label">{t('Preview')}</p>
                <select
                  className="input gle-select"
                  value={safe}
                  onChange={(e) => setSafe(e.target.value)}
                  aria-label={t('Platform whose UI to show')}
                >
                  {Object.entries(SAFE_ZONES).map(([id, z]) => (
                    <option key={id} value={id}>
                      {id === 'none' ? t('No overlay') : `${z.label} ${t('preview')}`}
                    </option>
                  ))}
                </select>
              </div>
              <div
                ref={previewRef}
                className="gle-preview relative overflow-hidden touch-none"
                style={{ width: PW, height: OUT_H * k }}
                onPointerMove={onPreviewMove}
                onPointerUp={endDrags}
                onPointerCancel={endDrags}
                onPointerDown={() => setSelected(null)}
              >
                <Composition p={p} frameUrl={loaded ? frameUrl : null} src={src} width={PW} placeholderCam={camUnknown} />
                {/* What the app draws over the Short: the real layout for one
                    platform; the three platforms' shared no-go areas for "All". */}
                {PLATFORM_UI[safe] && <PlatformOverlay platform={safe} />}
                {showGrid && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${OUT_W} ${OUT_H}`} preserveAspectRatio="none">
                    {[OUT_W / 3, (2 * OUT_W) / 3].map((x) => (
                      <line key={`gx${x}`} x1={x} x2={x} y1={0} y2={OUT_H} stroke="white" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="14 10" />
                    ))}
                    {[OUT_H / 3, (2 * OUT_H) / 3].map((y) => (
                      <line key={`gy${y}`} x1={0} x2={OUT_W} y1={y} y2={y} stroke="white" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="14 10" />
                    ))}
                    <line x1={OUT_W / 2} x2={OUT_W / 2} y1={0} y2={OUT_H} stroke="white" strokeOpacity={0.6} strokeWidth={3} />
                    <line x1={0} x2={OUT_W} y1={OUT_H / 2} y2={OUT_H / 2} stroke="white" strokeOpacity={0.6} strokeWidth={3} />
                    {safe !== 'none' && (
                      <rect
                        x={zone.left}
                        y={zone.top}
                        width={OUT_W - zone.left - zone.right}
                        height={OUT_H - zone.top - zone.bottom}
                        fill="none"
                        stroke="#D8B263"
                        strokeOpacity={0.8}
                        strokeWidth={3}
                        strokeDasharray="20 12"
                      />
                    )}
                  </svg>
                )}
                {safe === 'all' && (
                  <>
                    <div
                      className="absolute left-0 right-0 top-0 bg-white/15 border-b border-white/40 pointer-events-none flex items-start justify-center"
                      style={{ height: zone.top * k }}
                    >
                      <span className="text-[10px] text-white/85 mt-0.5">{t('Top bar')}</span>
                    </div>
                    <div
                      className="absolute left-0 right-0 bottom-0 bg-white/15 border-t border-white/40 pointer-events-none flex items-end justify-center"
                      style={{ height: zone.bottom * k }}
                    >
                      <span className="text-[10px] text-white/85 mb-0.5">{t('Captions and buttons')}</span>
                    </div>
                    <div
                      className="absolute right-0 bg-white/10 border-l border-white/30 pointer-events-none"
                      style={{ width: zone.right * k, top: zone.top * k, bottom: zone.bottom * k }}
                    />
                  </>
                )}
                {loaded &&
                  layers.map((e) => {
                    const role = e.role as Placeable
                    const [x, y, w, h] = e.dest.map((v) => v * k)
                    const round = e.shape === 'circle'
                    const on = selected === role
                    return (
                      <div
                        key={`layer-${role}`}
                        className={`absolute cursor-move group ${on ? 'ring-2 ring-white' : 'ring-1 ring-white/60 hover:ring-white'}`}
                        style={{ left: x, top: y, width: w, height: h, borderRadius: round ? '50%' : 2 }}
                        onPointerDown={(ev) => startLayer(ev, role, 'move')}
                        title={t('Drag to move; drag a handle to resize. Hold Alt to stop it snapping.')}
                      >
                        {HANDLES.map(([handle, fx, fy, cursor]) => (
                          <span
                            key={handle}
                            className={`absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white border border-base shadow ${
                              on ? '' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            style={{ left: `${(round ? ON_CIRCLE(fx) : fx) * 100}%`, top: `${(round ? ON_CIRCLE(fy) : fy) * 100}%`, cursor }}
                            onPointerDown={(ev) => startLayer(ev, role, handle)}
                          />
                        ))}
                      </div>
                    )
                  })}
                {(guides.xs.length > 0 || guides.ys.length > 0) && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${OUT_W} ${OUT_H}`} preserveAspectRatio="none">
                    {guides.xs.map((gx) => (
                      <line key={`sx${gx}`} x1={gx} x2={gx} y1={0} y2={OUT_H} stroke={GUIDE} strokeWidth={4} />
                    ))}
                    {guides.ys.map((gy) => (
                      <line key={`sy${gy}`} x1={0} x2={OUT_W} y1={gy} y2={gy} stroke={GUIDE} strokeWidth={4} />
                    ))}
                  </svg>
                )}
                {dividerY !== null && (
                  <div
                    className="absolute left-0 right-0 h-3 -mt-1.5 cursor-ns-resize flex items-center justify-center"
                    style={{ top: dividerY * k }}
                    onPointerDown={(e) => {
                      dividerDrag.current = true
                      previewRef.current?.setPointerCapture(e.pointerId)
                    }}
                    title={t('Drag to change how much of the Short the webcam takes')}
                  >
                    <div className="h-1 w-12 rounded-full bg-white/90 shadow" />
                  </div>
                )}
              </div>
              {face && (
                <p className="gle-face" data-tone={face.tone}>
                  {face.tone !== 'muted' && <Icon name={face.tone === 'ok' ? 'check' : 'alert'} size={14} />}
                  <span>{face.text}</span>
                </p>
              )}
              {layers.length > 0 && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted flex-1">
                    {t('Drag')} {layers.some((e) => e.role === 'ui') ? t('the Game UI') : t('the facecam')}{' '}
                    {t('on the preview to move it, its corner to resize it.')}
                  </p>
                  {layers.some((e) => places[e.role as Placeable]) && (
                    <button type="button" className="btn-ghost ui-btn ui-btn-sm shrink-0" onClick={() => setPlaces({})}>
                      <span className="ui-btn-label">{t('Reset')}</span>
                    </button>
                  )}
                </div>
              )}
              {shownPreset !== preset && (
                <p className="gle-face" data-tone="warn">
                  <Icon name="alert" size={14} />
                  <span>
                    {t('Showing')} {t(PRESETS[shownPreset].label)}: {t('this layout needs a box that isn’t set yet.')}
                  </span>
                </p>
              )}

              <div className="gle-controls">
                {spec.type === 'stack' && (
                  <div className="gle-row">
                    <span className="gle-row-label">{t('On top')}</span>
                    {segment(
                      [
                        ['cam_top', 'Camera'],
                        ['game_top', 'Game']
                      ],
                      order,
                      setOrder
                    )}
                  </div>
                )}
                {(roles.has('cam') || roles.has('cam2')) && (
                  <>
                    <div className="gle-row">
                      <span className="gle-row-label">
                        <span className="gle-swatch" style={{ background: COLOUR.cam }} aria-hidden />
                        {t('Webcam')}
                      </span>
                      {segment(
                        [
                          ['draw', 'Draw it'],
                          ['auto', 'Find it'],
                          ['none', 'None']
                        ],
                        camMode,
                        (m) => {
                          setCamMode(m)
                          camTouched.current = true
                          if (m === 'draw') {
                            if (!boxes.cam) setBox('cam', found ?? NEW_BOX.cam)
                            setActive('cam')
                          }
                        }
                      )}
                    </div>
                    {camMode === 'draw' && (
                      <button type="button" className="btn-ghost ui-btn ui-btn-sm w-full" onClick={snap} disabled={snapping}>
                        {snapping ? <span className="ui-spinner" aria-hidden /> : <Icon name="wand" size={14} />}
                        <span className="ui-btn-label">{snapping ? t('Snapping…') : t('Snap to the webcam’s border')}</span>
                      </button>
                    )}
                  </>
                )}
                <div className={`gle-row ${spec.type === 'full' ? 'hidden' : ''}`}>
                  <span className="gle-row-label">
                    <span className="gle-swatch" style={{ background: COLOUR.game }} aria-hidden />
                    {t('Game')}
                  </span>
                  {segment(
                    [
                      ['fit', 'Whole'],
                      ['fill', 'Zoom to fill']
                    ],
                    gameFit,
                    setGameFit
                  )}
                </div>
                {(spec.type === 'full' ? spec.game_fit === 'fill' : gameFit === 'fill') && !boxes.game && (
                  <div className="gle-row">
                    <span className="gle-row-label">{t('Crop')}</span>
                    {segment(
                      [
                        ['left', 'Left'],
                        ['center', 'Centre'],
                        ['right', 'Right']
                      ],
                      gameAlign,
                      setGameAlign
                    )}
                  </div>
                )}
                {boxes.game && (
                  <button type="button" className="btn-ghost ui-btn ui-btn-sm w-full" onClick={() => setBoxes((b) => ({ ...b, game: null }))}>
                    <Icon name="sparkle" size={14} />
                    <span className="ui-btn-label">{t('Let Solaris Studio pick the game area')}</span>
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* ---- footer: the decision, always in view ---- */}
        <footer className="gle-foot">
          {canRemember && (
            <label className="gle-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>{t('Remember for this creator’s next videos')}</span>
            </label>
          )}
          <div className="gle-foot-actions">
            <button type="button" className="btn-ghost ui-btn ui-btn-md" onClick={onClose}>
              <span className="ui-btn-label">{t('Cancel')}</span>
            </button>
            <button type="button" className="btn-accent ui-btn ui-btn-md" onClick={done}>
              <Icon name="check" size={16} />
              <span className="ui-btn-label">{context === 'video' ? t('Use this layout') : t('Done')}</span>
            </button>
          </div>
        </footer>
      </div>
    </Overlay>
  )
}
