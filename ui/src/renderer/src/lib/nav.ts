import { useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { IconName } from '../components/icons'
import { motionReduced } from './motion'
import { OPEN_MARKETPLACE } from './plugins'
import { PageContext } from './stores/useVisible'

/** Routing for the shell (spec 3.3 / 3.4).
 *
 *  This app navigates by state, not a router: one module-level store holds
 *  the route, an in-memory history (50 entries), the keep-alive LRU, the
 *  layer stack and the breadcrumbs pages publish. The hash mirrors the route
 *  (`#/studio?video=…&clip=…`) with replaceState, so a reload lands where you
 *  were without filling the browser history. */

export type Page =
  | 'home'
  | 'dashboard'
  | 'queue'
  | 'watch'
  | 'studio'
  | 'creators'
  | 'marketplace'
  | 'models'
  | 'settings'
  | 'calendar'
  | 'storage'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'ai'
  | 'publishing'
  | 'downloads'
  | 'storage'
  | 'branding'
  | 'updates'
  | 'advanced'

export interface RouteParams {
  videoId?: string
  clipId?: number
  creatorId?: number
  section?: SettingsSection
  tab?: 'browse' | 'installed' | 'developers'
  view?: string
}
export interface Route {
  page: Page
  params?: RouteParams
}

export type LayerName = 'palette' | 'create' | 'activity' | 'assistant' | 'help' | 'shortcuts' | 'whatsnew' | 'tour'

export interface PageMeta {
  id: Page
  label: string
  group: 'Make' | 'Discover' | 'System'
  icon: IconName
  caption: string
  chord: string
}

/** Rail order. Labels and captions are English; render them through t().
 *  "Clip Editor" must stay exactly that (Microsoft Store listing). */
export const PAGES: PageMeta[] = [
  { id: 'home', label: 'Home', group: 'Make', icon: 'home', caption: 'Your studio at a glance', chord: 'G H' },
  { id: 'dashboard', label: 'Create', group: 'Make', icon: 'plus', caption: 'Turn a video into clips', chord: 'G N' },
  { id: 'queue', label: 'Queue', group: 'Make', icon: 'layers', caption: 'Line up many videos', chord: 'G Q' },
  { id: 'watch', label: 'Watched channels', group: 'Make', icon: 'radar', caption: 'Clip new videos automatically', chord: 'G W' },
  { id: 'studio', label: 'Clip Editor', group: 'Make', icon: 'scissors', caption: 'Review, edit and export', chord: 'G E' },
  { id: 'calendar', label: 'Schedule', group: 'Make', icon: 'calendar', caption: 'What goes out when', chord: 'G L' },
  { id: 'creators', label: 'Creators', group: 'Discover', icon: 'users', caption: 'What Solaris learned about each', chord: 'G C' },
  { id: 'marketplace', label: 'Marketplace', group: 'Discover', icon: 'store', caption: 'Add-ons that find and rate moments', chord: 'G M' },
  { id: 'models', label: 'AI models', group: 'System', icon: 'cpu', caption: 'Local AI downloads', chord: 'G A' },
  { id: 'storage', label: 'Storage & health', group: 'System', icon: 'hard-drive', caption: 'Disk use and readiness', chord: 'G D' },
  { id: 'settings', label: 'Settings', group: 'System', icon: 'gear', caption: 'Every preference', chord: 'G S' }
]

const PAGE_IDS = new Set<Page>(PAGES.map((p) => p.id))
const SECTIONS = new Set<SettingsSection>([
  'general',
  'appearance',
  'notifications',
  'ai',
  'publishing',
  'downloads',
  'storage',
  'branding',
  'updates',
  'advanced'
])

export function pageMeta(id: Page): PageMeta {
  return PAGES.find((p) => p.id === id) ?? PAGES[0]
}

/* ---------- hash mirror ---------- */

function toHash(r: Route): string {
  const q = new URLSearchParams()
  const p = r.params ?? {}
  if (p.videoId) q.set('video', p.videoId)
  if (p.clipId !== undefined) q.set('clip', String(p.clipId))
  if (p.creatorId !== undefined) q.set('creator', String(p.creatorId))
  if (p.section) q.set('section', p.section)
  if (p.tab) q.set('tab', p.tab)
  if (p.view) q.set('view', p.view)
  const qs = q.toString()
  return `#/${r.page}${qs ? `?${qs}` : ''}`
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function parseHash(hash: string): Route | null {
  const m = /^#\/([a-z]+)(?:\?(.*))?$/.exec(hash)
  if (!m || !PAGE_IDS.has(m[1] as Page)) return null
  const q = new URLSearchParams(m[2] ?? '')
  const params: RouteParams = {}
  const video = q.get('video')
  if (video) params.videoId = video
  const clip = num(q.get('clip'))
  if (clip !== undefined) params.clipId = clip
  const creator = num(q.get('creator'))
  if (creator !== undefined) params.creatorId = creator
  const section = q.get('section')
  if (section && SECTIONS.has(section as SettingsSection)) params.section = section as SettingsSection
  const tab = q.get('tab')
  if (tab === 'browse' || tab === 'installed' || tab === 'developers') params.tab = tab
  const view = q.get('view')
  if (view) params.view = view
  return { page: m[1] as Page, params: Object.keys(params).length ? params : undefined }
}

function writeHash(r: Route): void {
  try {
    const h = toHash(r)
    if (window.location.hash !== h) window.history.replaceState(window.history.state, '', h)
  } catch {
    /* sandboxed or file: URL quirks: the route still works in memory */
  }
}

/* ---------- store ---------- */

export interface Crumb {
  label: string
  onClick?: () => void
}

interface NavState {
  route: Route
  stack: Route[]
  index: number
  mounted: Page[]
  layers: { name: LayerName; payload: unknown }[]
  navState: { canBack: boolean; canForward: boolean }
}

const MAX_HISTORY = 50
const MAX_MOUNTED = 6

function initialRoute(): Route {
  try {
    return parseHash(window.location.hash) ?? { page: 'home' }
  } catch {
    return { page: 'home' }
  }
}

const first = initialRoute()
let state: NavState = {
  route: first,
  stack: [first],
  index: 0,
  mounted: first.page === 'home' ? ['home'] : [first.page, 'home'],
  layers: [],
  navState: { canBack: false, canForward: false }
}
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function sameRoute(a: Route, b: Route): boolean {
  return a.page === b.page && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {})
}

function touchMounted(mounted: Page[], page: Page): Page[] {
  const next = [page, ...mounted.filter((p) => p !== page)]
  while (next.length > MAX_MOUNTED) {
    // evict the least recently used page that is neither home nor active
    let i = next.length - 1
    while (i > 0 && (next[i] === 'home' || next[i] === page)) i--
    if (i <= 0) break
    next.splice(i, 1)
  }
  return next
}

function navFlags(stack: Route[], index: number): { canBack: boolean; canForward: boolean } {
  return { canBack: index > 0, canForward: index < stack.length - 1 }
}

function commit(next: NavState, dir: 'forward' | 'back', instant: boolean): void {
  const pageChanged = next.route.page !== state.route.page
  const targetMounted = state.mounted.includes(next.route.page)
  const apply = (): void => {
    state = next
    writeHash(next.route)
    emit()
  }
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> }
  }
  // Skip when unsupported, reduced motion, same page, or the target page is
  // not yet mounted (a cold heavy mount stutters inside a transition).
  if (instant || !pageChanged || !doc.startViewTransition || motionReduced() || !targetMounted || document.hidden) {
    apply()
    return
  }
  document.documentElement.dataset.navDir = dir
  try {
    const vt = doc.startViewTransition(() => flushSync(apply))
    vt.ready.catch(() => {})
    vt.updateCallbackDone.catch(() => {})
    vt.finished
      .catch(() => {})
      .finally(() => {
        delete document.documentElement.dataset.navDir
      })
  } catch {
    apply()
  }
}

export function navigate(to: Route, opts?: { replace?: boolean; instant?: boolean }): void {
  const route: Route = { page: PAGE_IDS.has(to.page) ? to.page : 'home', ...(to.params ? { params: to.params } : {}) }
  if (sameRoute(route, state.route) && !opts?.replace) return
  let stack: Route[]
  let index: number
  if (opts?.replace) {
    stack = state.stack.slice()
    stack[state.index] = route
    index = state.index
  } else {
    stack = [...state.stack.slice(0, state.index + 1), route]
    if (stack.length > MAX_HISTORY) stack = stack.slice(stack.length - MAX_HISTORY)
    index = stack.length - 1
  }
  commit(
    {
      ...state,
      route,
      stack,
      index,
      mounted: touchMounted(state.mounted, route.page),
      navState: navFlags(stack, index)
    },
    'forward',
    Boolean(opts?.instant)
  )
}

function go(delta: -1 | 1): void {
  const index = state.index + delta
  if (index < 0 || index >= state.stack.length) return
  const route = state.stack[index]
  commit(
    {
      ...state,
      route,
      index,
      mounted: touchMounted(state.mounted, route.page),
      navState: navFlags(state.stack, index)
    },
    delta < 0 ? 'back' : 'forward',
    false
  )
}

export function back(): void {
  go(-1)
}

export function forward(): void {
  go(1)
}

/** Current route, outside React. */
export function currentRoute(): Route {
  return state.route
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => state.route, () => state.route)
}

export function useNavState(): { canBack: boolean; canForward: boolean } {
  return useSyncExternalStore(subscribe, () => state.navState, () => state.navState)
}

/** Pages mounted by KeepAlive, most recently used first. */
export function useMountedPages(): Page[] {
  return useSyncExternalStore(subscribe, () => state.mounted, () => state.mounted)
}

export function isMounted(page: Page): boolean {
  return state.mounted.includes(page)
}

/** KeepAlive releases an idle heavy page (studio, marketplace). */
export function releasePage(page: Page): void {
  if (page === 'home' || page === state.route.page || !state.mounted.includes(page)) return
  state = { ...state, mounted: state.mounted.filter((p) => p !== page) }
  emit()
}

/* ---------- layers ---------- */

export function openLayer(name: LayerName, payload?: unknown): void {
  state = { ...state, layers: [...state.layers.filter((l) => l.name !== name), { name, payload }] }
  emit()
}

/** Close one layer, or the topmost when no name is given. */
export function closeLayer(name?: LayerName): void {
  if (state.layers.length === 0) return
  const layers = name ? state.layers.filter((l) => l.name !== name) : state.layers.slice(0, -1)
  if (layers.length === state.layers.length) return
  state = { ...state, layers }
  emit()
}

export function topLayer(): LayerName | null {
  return state.layers.length ? state.layers[state.layers.length - 1].name : null
}

export function toggleLayer(name: LayerName, payload?: unknown): void {
  if (state.layers.some((l) => l.name === name)) closeLayer(name)
  else openLayer(name, payload)
}

const layerCache = new Map<LayerName, { open: boolean; payload: unknown; close: () => void; ref: unknown }>()

function layerSnapshot(name: LayerName): { open: boolean; payload: unknown; close: () => void } {
  const entry = state.layers.find((l) => l.name === name)
  const cached = layerCache.get(name)
  const ref = entry ?? null
  if (cached && cached.ref === ref) return cached
  const snap = { open: Boolean(entry), payload: entry?.payload, close: () => closeLayer(name), ref }
  layerCache.set(name, snap)
  return snap
}

export function useLayer<T = unknown>(name: LayerName): { open: boolean; payload: T | undefined; close: () => void } {
  const snap = useSyncExternalStore(
    subscribe,
    () => layerSnapshot(name),
    () => layerSnapshot(name)
  )
  return snap as { open: boolean; payload: T | undefined; close: () => void }
}

/** Names of the open layers, bottom to top. */
export function useOpenLayers(): LayerName[] {
  const layers = useSyncExternalStore(subscribe, () => state.layers, () => state.layers)
  return layers.map((l) => l.name)
}

/* ---------- breadcrumbs ---------- */

const crumbsByPage = new Map<Page, Crumb[]>()
let crumbVersion = 0
const crumbListeners = new Set<() => void>()

function subscribeCrumbs(cb: () => void): () => void {
  crumbListeners.add(cb)
  return () => {
    crumbListeners.delete(cb)
  }
}

/** A page publishes its context crumbs (e.g. video title › clip). Only the
 *  active page's crumbs show. Pass [] to clear. */
export function useBreadcrumbs(crumbs: Crumb[]): void {
  const { page } = useContext(PageContext)
  const latest = useRef(crumbs)
  latest.current = crumbs
  const key = crumbs.map((c) => c.label).join('\u0001')
  useEffect(() => {
    if (!page) return
    // handlers are read through the ref so they stay current without churn
    crumbsByPage.set(
      page,
      latest.current.map((c, i) => ({ label: c.label, onClick: c.onClick ? () => latest.current[i]?.onClick?.() : undefined }))
    )
    crumbVersion++
    crumbListeners.forEach((l) => l())
    return () => {
      crumbsByPage.delete(page)
      crumbVersion++
      crumbListeners.forEach((l) => l())
    }
  }, [page, key])
}

/** The crumbs a page has published. */
export function useCrumbs(page: Page): Crumb[] {
  useSyncExternalStore(subscribeCrumbs, () => crumbVersion, () => crumbVersion)
  return crumbsByPage.get(page) ?? []
}

/* ---------- window events ---------- */

export const EV = {
  create: 'open-create',
  assistant: 'open-assistant',
  palette: 'open-palette',
  feedback: 'open-feedback',
  activity: 'open-activity',
  help: 'open-help'
} as const

export function openSettings(section?: SettingsSection): void {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { section } }))
}

export function openCreate(detail?: { link?: string; mode?: 'now' | 'queue'; originRect?: DOMRect | null }): void {
  window.dispatchEvent(new CustomEvent(EV.create, { detail: detail ?? {} }))
}

export function openAssistant(prompt?: string): void {
  window.dispatchEvent(new CustomEvent(EV.assistant, { detail: prompt ? { prompt } : {} }))
}

export function openFeedback(): void {
  window.dispatchEvent(new CustomEvent(EV.feedback))
}

function detailOf(e: Event): Record<string, unknown> | undefined {
  const d = (e as CustomEvent).detail
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : undefined
}

/** A window event that opens a shell layer stands down while a full-window
 *  <Overlay> (layout editor, setup wizard) is open, as the hotkeys do: a
 *  drawer or palette stacked over it would steal its Esc. */
function layerDoor(open: () => void): void {
  if (document.documentElement.dataset.overlay === undefined) open()
}

/** Install every window-event door and the mouse back/forward buttons.
 *  Called once from App; returns the cleanup. */
export function installNavEvents(): () => void {
  const pairs: [string, (e: Event) => void][] = [
    ['open-queue', () => navigate({ page: 'queue' })],
    [
      'open-settings',
      (e) => {
        const s = detailOf(e)?.section
        navigate({
          page: 'settings',
          params: typeof s === 'string' && SECTIONS.has(s as SettingsSection) ? { section: s as SettingsSection } : undefined
        })
      }
    ],
    ['open-models', () => navigate({ page: 'models' })],
    [OPEN_MARKETPLACE, () => navigate({ page: 'marketplace' })],
    [EV.create, (e) => layerDoor(() => openLayer('create', detailOf(e)))],
    [EV.assistant, (e) => layerDoor(() => openLayer('assistant', detailOf(e)))],
    [EV.palette, (e) => layerDoor(() => openLayer('palette', detailOf(e)))],
    [EV.activity, (e) => layerDoor(() => openLayer('activity', detailOf(e)))],
    [EV.help, (e) => layerDoor(() => openLayer('help', detailOf(e) ?? { page: state.route.page }))]
  ]
  pairs.forEach(([n, f]) => window.addEventListener(n, f))

  // Mouse buttons 3 (back) and 4 (forward).
  const onMouse = (e: MouseEvent): void => {
    if (e.button === 3) {
      e.preventDefault()
      back()
    } else if (e.button === 4) {
      e.preventDefault()
      forward()
    }
  }
  const swallow = (e: MouseEvent): void => {
    if (e.button === 3 || e.button === 4) e.preventDefault()
  }
  window.addEventListener('mouseup', onMouse)
  window.addEventListener('mousedown', swallow)

  // Someone edited the hash by hand (dev:web): follow it.
  const onHash = (): void => {
    const r = parseHash(window.location.hash)
    if (r && !sameRoute(r, state.route)) navigate(r)
  }
  window.addEventListener('hashchange', onHash)
  writeHash(state.route)

  return () => {
    pairs.forEach(([n, f]) => window.removeEventListener(n, f))
    window.removeEventListener('mouseup', onMouse)
    window.removeEventListener('mousedown', swallow)
    window.removeEventListener('hashchange', onHash)
  }
}
