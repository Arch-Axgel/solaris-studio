import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import { applyEvent, emptyProgress, etaSeconds, progressStore, type JobProgress } from '../jobProgress'
import { queueEta } from '../queue'
import { subscribeEvents } from './eventBus'
import { getQueueSnapshot, useQueueSnapshot } from './queueStore'

/** The one running video, from the progress events (jobProgress) plus the
 *  queue snapshot, so a window opened mid-job still shows what is running. */

export interface ActiveJob {
  running: boolean
  videoId?: string
  title?: string
  stage?: string
  stageLabel?: string
  fraction: number
  clip?: { current: number; total: number }
  remote?: string
  plugin?: string
  etaSeconds: number | null
  paused: boolean
  queuedAfter: number
}

interface Live {
  progress: JobProgress
  stage?: string
  clip?: { current: number; total: number }
  plugin?: string
}

let live: Live = { progress: { ...progressStore.current } }
let lastEventAt = Date.now()
const listeners = new Set<() => void>()
let stopFns: (() => void)[] = []

function emit(): void {
  listeners.forEach((l) => l())
}

function onEvent(e: Parameters<Parameters<typeof subscribeEvents>[0]>[0]): void {
  if (e.type !== 'progress' && e.type !== 'job') return
  lastEventAt = Date.now()
  const progress = applyEvent(live.progress, e)
  // Keep the legacy store in step so components that seed from it agree.
  progressStore.current = applyEvent(progressStore.current, e)
  let { stage, clip, plugin } = live
  if (!progress.active) {
    stage = undefined
    clip = undefined
    plugin = undefined
  } else if (e.type === 'progress' && e.stage && e.stage !== 'publish') {
    stage = e.stage
    clip = e.stage === 'render' && e.clip && e.total ? { current: e.clip, total: e.total } : undefined
    plugin = e.plugin ?? (stage === live.stage ? plugin : undefined)
  }
  live = { progress, stage, clip, plugin }
  emit()
}

function start(): void {
  const off = subscribeEvents(onEvent)
  // Events can go missing (socket down, server queue full): when they go
  // quiet for 45s while "running", ask the server what is really running.
  const watchdog = setInterval(() => {
    if (!live.progress.active || Date.now() - lastEventAt < 45_000) return
    void api
      .jobs()
      .then((jobs) => {
        if (!jobs.some((j) => j.status === 'running' || j.status === 'queued')) {
          live = { progress: { ...emptyProgress } }
          progressStore.current = { ...emptyProgress }
          emit()
        } else lastEventAt = Date.now()
      })
      .catch(() => {})
  }, 10_000)
  stopFns = [off, () => clearInterval(watchdog)]
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

export function getLiveProgress(): JobProgress {
  return live.progress
}

export function useActiveJob(): ActiveJob {
  const l = useSyncExternalStore(subscribe, () => live, () => live)
  const { snapshot, queued } = useQueueSnapshot()
  const processingJob = snapshot?.processing[0]
  const running = l.progress.active || Boolean(processingJob)
  // 1s ETA tick only while running
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  if (!running) {
    return { running: false, fraction: 0, etaSeconds: null, paused: snapshot?.paused ?? false, queuedAfter: queued }
  }
  const p = l.progress
  const eta = p.active ? etaSeconds(p, now) : null
  return {
    running: true,
    videoId: p.videoId || processingJob?.video_id || undefined,
    title: p.title || processingJob?.display_title || undefined,
    stage: l.stage,
    stageLabel: p.active ? p.label || 'Working…' : 'Working…',
    fraction: p.active ? p.fraction : 0,
    clip: l.clip,
    remote: p.remote,
    plugin: l.plugin,
    etaSeconds: eta ?? (snapshot && !p.active ? snapshot.estimate.per_video_seconds || null : null),
    paused: snapshot?.paused ?? false,
    queuedAfter: queued
  }
}

/** Seconds until the whole queue is done (running + waiting), or null. */
export function useQueueEta(): number | null {
  const l = useSyncExternalStore(subscribe, () => live, () => live)
  const { snapshot } = useQueueSnapshot()
  const [now, setNow] = useState(() => Date.now())
  const busy = Boolean(snapshot && snapshot.processing.length + snapshot.queued.length > 0)
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])
  return queueEta(snapshot ?? getQueueSnapshot(), l.progress, now)
}
