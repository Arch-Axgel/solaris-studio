import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../lib/api'
import type { AutomationActivity } from '../../lib/types'
import { subscribeEvents } from '../../lib/stores/eventBus'

/** What the watcher is doing, shared by the Radar hero, the On-air strip and
 *  the events timeline: one request per change instead of one per panel.
 *
 *  Re-read on automation / progress / job events (collapsed into one
 *  request), and polled every 5s only while a visible consumer wants it. */

let value: AutomationActivity | null = null
const listeners = new Set<() => void>()
let stop: (() => void) | null = null
let inflight = false
let pending: ReturnType<typeof setTimeout> | null = null
let pollers = 0
let poll: ReturnType<typeof setInterval> | null = null

async function fetchNow(): Promise<void> {
  if (inflight) return
  inflight = true
  try {
    value = await api.automationActivity()
    listeners.forEach((l) => l())
  } catch {
    /* the engine restarting; the next event or tick catches up */
  } finally {
    inflight = false
  }
}

export function refreshWatchActivity(delay = 200): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    void fetchNow()
  }, delay)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) {
    void fetchNow()
    stop = subscribeEvents((e) => {
      if (e.type === 'automation' || e.type === 'progress' || e.type === 'job') refreshWatchActivity()
    })
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      stop?.()
      stop = null
    }
  }
}

/** The watcher's activity. `visible` gates the 5s safety poll. */
export function useWatchActivity(visible: boolean): AutomationActivity | null {
  const v = useSyncExternalStore(subscribe, () => value, () => null)
  useEffect(() => {
    if (!visible) return
    pollers += 1
    if (!poll) poll = setInterval(() => void fetchNow(), 5000)
    void fetchNow()
    return () => {
      pollers -= 1
      if (pollers === 0 && poll) {
        clearInterval(poll)
        poll = null
      }
    }
  }, [visible])
  return v
}
