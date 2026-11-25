import { useSyncExternalStore } from 'react'
import { api } from '../api'
import type { QueueSnapshot } from '../types'
import { onReconnect, subscribeEvents } from './eventBus'

/** The queue, shared by the Rail badge, JobsPill, TransportDock, Home and
 *  anyone else: one fetch per change instead of one per component.
 *
 *  Refreshed on `queue` / `job` events (debounced), on reconnect, and by a
 *  20s poll while something is subscribed and the window is visible. */

let snapshot: QueueSnapshot | null = null
let run = { baseline: new Set<number>(), active: false }
let done = 0
const listeners = new Set<() => void>()
let stopFns: (() => void)[] = []
let pending: ReturnType<typeof setTimeout> | null = null
let inflight = false
let unreachable = false

function emit(): void {
  listeners.forEach((l) => l())
}

function trackRun(next: QueueSnapshot): void {
  const remaining = next.processing.length + next.queued.length
  if (remaining > 0 && !run.active) {
    // A run starts when the queue becomes non-empty: whatever is already in
    // "completed" belongs to an earlier run.
    run = { baseline: new Set(next.completed.map((j) => j.id)), active: true }
  } else if (remaining === 0 && run.active) {
    run = { baseline: run.baseline, active: false }
  }
  done = run.active ? next.completed.filter((j) => !run.baseline.has(j.id)).length : 0
}

async function fetchNow(): Promise<void> {
  if (inflight) return
  inflight = true
  try {
    const next = await api.queue()
    trackRun(next)
    snapshot = next
    unreachable = false
    emit()
  } catch {
    /* engine unreachable: keep the last snapshot, but let pages that have
       nothing to show yet say so instead of loading forever */
    if (!unreachable) {
      unreachable = true
      emit()
    }
  } finally {
    inflight = false
  }
}

/** Re-read soon; bursts of events collapse into one request. */
export function refreshQueue(delay = 250): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    void fetchNow()
  }, delay)
}

function start(): void {
  void fetchNow()
  const off = subscribeEvents((e) => {
    if (e.type === 'queue' || e.type === 'job') refreshQueue()
  })
  const offRe = onReconnect(() => refreshQueue(0))
  const id = setInterval(() => {
    if (!document.hidden) void fetchNow()
  }, 20_000)
  const onVis = (): void => {
    if (!document.hidden) refreshQueue(0)
  }
  document.addEventListener('visibilitychange', onVis)
  stopFns = [off, offRe, () => clearInterval(id), () => document.removeEventListener('visibilitychange', onVis)]
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      stopFns.forEach((f) => f())
      stopFns = []
    }
  }
}

export function getQueueSnapshot(): QueueSnapshot | null {
  return snapshot
}

const refresh = (): void => refreshQueue(0)

export function useQueueSnapshot(): {
  snapshot: QueueSnapshot | null
  remaining: number
  failed: number
  processing: number
  queued: number
  /** The last fetch failed (engine not answering). */
  unreachable: boolean
  refresh: () => void
} {
  const s = useSyncExternalStore(subscribe, () => snapshot, () => null)
  const down = useSyncExternalStore(subscribe, () => unreachable, () => false)
  const processing = s?.processing.length ?? 0
  const queued = s?.queued.length ?? 0
  return {
    snapshot: s,
    remaining: processing + queued,
    failed: s?.failed.length ?? 0,
    processing,
    queued,
    unreachable: down,
    refresh
  }
}

/** Jobs completed during the current queue run (since it last became
 *  non-empty). Drives the TransportDock's overall progress. */
export function useQueueRun(): { done: number } {
  useSyncExternalStore(subscribe, () => snapshot, () => null)
  return { done }
}
