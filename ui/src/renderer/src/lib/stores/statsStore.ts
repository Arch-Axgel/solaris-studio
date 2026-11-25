import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { SystemStats } from '../types'

/** One /system/stats poll for the whole app: every 8s, and only while at
 *  least one consumer is active and the window is visible. */

let stats: SystemStats | null = null
const listeners = new Set<() => void>()
let activeConsumers = 0
let timer: ReturnType<typeof setInterval> | null = null
let lastFetch = 0

function emit(): void {
  listeners.forEach((l) => l())
}

async function sample(): Promise<void> {
  lastFetch = Date.now()
  try {
    stats = await api.systemStats()
    emit()
  } catch {
    /* engine unreachable: keep the last reading */
  }
}

function reconcile(): void {
  const want = activeConsumers > 0 && !document.hidden
  if (want && !timer) {
    if (Date.now() - lastFetch > 4000) void sample()
    timer = setInterval(() => void sample(), 8000)
  } else if (!want && timer) {
    clearInterval(timer)
    timer = null
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', reconcile)

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useSystemStats(active: boolean): SystemStats | null {
  useEffect(() => {
    if (!active) return
    activeConsumers++
    reconcile()
    return () => {
      activeConsumers--
      reconcile()
    }
  }, [active])
  return useSyncExternalStore(subscribe, () => stats, () => null)
}
