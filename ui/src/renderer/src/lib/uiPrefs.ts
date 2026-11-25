import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useActiveJob } from './stores/activeJob'
import { useSystemStats } from './stores/statsStore'

/** Shell preferences (spec 2.8 / 3.5), stored under `solaris.ui.prefs`.
 *  Applied to <html> as data attributes so CSS does the work:
 *  - data-motion   "reduced" (Reduce motion: On) or "full" (Off); absent = System
 *  - data-effects  "reduced" when Visual effects is Reduced, or Auto under GPU load
 *  - data-density  "comfortable" | "compact"
 *  - data-rail     "expanded" | "collapsed" */

export type MotionPref = 'system' | 'on' | 'off'
export type EffectsPref = 'full' | 'reduced' | 'auto'
export type DensityPref = 'comfortable' | 'compact'

export interface UiPrefs {
  /** Rail pinned open (expanded). Ctrl+B toggles it. */
  railPinned: boolean
  /** Expand the collapsed rail on hover (350ms delay). Off by default. */
  railHover: boolean
  /** "Reduce motion": System / On / Off. */
  motion: MotionPref
  /** "Visual effects": Full / Reduced / Auto. */
  effects: EffectsPref
  density: DensityPref
  /** One-time flags (tour, what's new, hints…). */
  seen: Record<string, boolean>
}

const KEY = 'solaris.ui.prefs'

const DEFAULTS: UiPrefs = {
  railPinned: true,
  railHover: false,
  motion: 'system',
  effects: 'full',
  density: 'comfortable',
  seen: {}
}

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return { ...DEFAULTS, ...parsed, seen: { ...(parsed.seen ?? {}) } }
  } catch {
    return { ...DEFAULTS }
  }
}

let prefs: UiPrefs = load()
/** Auto effects: set while the GPU is pegged during a job. */
let autoReduced = false
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private window or blocked storage: the choice lasts this session */
  }
}

/** Write the prefs onto <html>. Called on boot and on every change. */
export function applyUiPrefs(): void {
  const h = document.documentElement
  if (prefs.motion === 'on') h.dataset.motion = 'reduced'
  else if (prefs.motion === 'off') h.dataset.motion = 'full'
  else delete h.dataset.motion
  const reduced = prefs.effects === 'reduced' || (prefs.effects === 'auto' && autoReduced)
  if (reduced) h.dataset.effects = 'reduced'
  else delete h.dataset.effects
  h.dataset.density = prefs.density
  h.dataset.rail = prefs.railPinned ? 'expanded' : 'collapsed'
}

export function getUiPrefs(): UiPrefs {
  return prefs
}

export function setUiPrefs(patch: Partial<UiPrefs>): void {
  prefs = { ...prefs, ...patch, seen: { ...prefs.seen, ...(patch.seen ?? {}) } }
  save()
  applyUiPrefs()
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Reactive prefs plus a setter. */
export function useUiPrefs(): [UiPrefs, (patch: Partial<UiPrefs>) => void] {
  const p = useSyncExternalStore(subscribe, () => prefs, () => prefs)
  return [p, setUiPrefs]
}

export function toggleRail(): void {
  setUiPrefs({ railPinned: !prefs.railPinned })
}

export function hasSeen(flag: string): boolean {
  return Boolean(prefs.seen[flag])
}

export function markSeen(flag: string): void {
  if (prefs.seen[flag]) return
  setUiPrefs({ seen: { [flag]: true } })
}

/** True while Auto effects has reduced them. */
export function autoEffectsActive(): boolean {
  return autoReduced
}

function setAutoReduced(on: boolean): void {
  if (autoReduced === on) return
  autoReduced = on
  applyUiPrefs()
  emit()
}

/** Visual effects: Auto. Samples /system/stats (through the shared 8s stats
 *  store) only while a job is processing; three samples in a row above 90%
 *  GPU reduce effects, and they come back 60s after the job ends. Mounted
 *  once by the Shell. */
export function useAutoEffects(): void {
  const [p] = useUiPrefs()
  const job = useActiveJob()
  const sampling = p.effects === 'auto' && job.running
  const stats = useSystemStats(sampling)
  const hot = useRef(0)
  const lastStats = useRef<typeof stats>(null)

  useEffect(() => {
    if (!sampling || !stats || stats === lastStats.current) return
    lastStats.current = stats
    const gpu = stats.gpu?.gpu_percent ?? 0
    hot.current = gpu > 90 ? hot.current + 1 : 0
    if (hot.current >= 3) setAutoReduced(true)
  }, [sampling, stats])

  useEffect(() => {
    if (p.effects !== 'auto') {
      hot.current = 0
      setAutoReduced(false)
      return
    }
    if (job.running) return
    hot.current = 0
    const id = setTimeout(() => setAutoReduced(false), 60_000)
    return () => clearTimeout(id)
  }, [p.effects, job.running])
}

// Apply as early as the module loads, so the first paint already honours them.
if (typeof document !== 'undefined') applyUiPrefs()
