import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { Clip, Video } from '../types'
import { subscribeEvents } from './eventBus'

/** The video library and a lazy per-video clip cache.
 *
 *  Videos are fetched once and refreshed when a processing job finishes or
 *  someone calls invalidateLibrary(). Clips are fetched per video on demand,
 *  at most 6 requests at a time, and cached until that video is invalidated.
 *  `unexported` (the Clip Editor badge) is counted in the background over the
 *  newest 200 videos once the app has settled. */

type RecentClip = Clip & { video_id: string; video_title: string }

let videos: Video[] | null = null
const clipCache = new Map<string, Clip[]>()
const clipInflight = new Map<string, Promise<Clip[]>>()
let unexported = 0
let version = 0
const listeners = new Set<() => void>()
let stopFns: (() => void)[] = []
let videosInflight: Promise<void> | null = null
let countTimer: ReturnType<typeof setTimeout> | null = null

function emit(): void {
  version++
  listeners.forEach((l) => l())
}

async function fetchVideos(): Promise<void> {
  if (videosInflight) return videosInflight
  videosInflight = api
    .videos()
    .then((v) => {
      videos = v
      emit()
      scheduleCount()
    })
    .catch(() => {
      if (videos === null) {
        videos = []
        emit()
      }
    })
    .finally(() => {
      videosInflight = null
    })
  return videosInflight
}

function clipsOf(id: string): Promise<Clip[]> {
  const cached = clipCache.get(id)
  if (cached) return Promise.resolve(cached)
  const running = clipInflight.get(id)
  if (running) return running
  const p = api
    .clips(id)
    .then((c) => {
      clipCache.set(id, c)
      return c
    })
    .catch(() => [] as Clip[])
    .finally(() => {
      clipInflight.delete(id)
    })
  clipInflight.set(id, p)
  return p
}

/** Load clips for these videos (cached), 6 at a time. */
export async function loadClipsFor(ids: string[]): Promise<Record<string, Clip[]>> {
  const out: Record<string, Clip[]> = {}
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < ids.length) {
      const id = ids[i++]
      out[id] = await clipsOf(id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker))
  return out
}

function newestIds(n: number): string[] {
  if (!videos) return []
  return [...videos]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .filter((v) => v.clip_count > 0)
    .slice(0, n)
    .map((v) => v.video_id)
}

function scheduleCount(delay = 3000): void {
  if (countTimer) clearTimeout(countTimer)
  countTimer = setTimeout(() => {
    countTimer = null
    const ids = newestIds(200)
    void loadClipsFor(ids).then((byVideo) => {
      let n = 0
      for (const id of ids) for (const c of byVideo[id] ?? []) if (!c.exported_at) n++
      if (n !== unexported) {
        unexported = n
        emit()
      }
    })
  }, delay)
}

/** Forget cached data (one video, or everything) and re-read. Also tells
 *  the rest of the app through a `library-changed` window event. */
export function invalidateLibrary(videoId?: string): void {
  if (videoId) clipCache.delete(videoId)
  else clipCache.clear()
  void fetchVideos()
  emit()
  window.dispatchEvent(new CustomEvent('library-changed', { detail: { videoId } }))
}

function start(): void {
  if (videos === null) void fetchVideos()
  const off = subscribeEvents((e) => {
    if (e.type === 'job' && e.status === 'done' && (!e.job_type || e.job_type === 'process' || e.job_type === 'render')) {
      invalidateLibrary(e.video_id)
    }
  })
  stopFns = [off]
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

const refresh = (): void => invalidateLibrary()

export function useLibrary(): {
  videos: Video[] | null
  unexported: number
  loadClipsFor: (ids: string[]) => Promise<Record<string, Clip[]>>
  refresh: () => void
} {
  useSyncExternalStore(subscribe, () => version, () => version)
  return { videos, unexported, loadClipsFor, refresh }
}

/** The newest `n` clips across the newest 12 videos, newest first. */
export function useRecentClips(n: number): { clips: RecentClip[] | null } {
  const v = useSyncExternalStore(subscribe, () => version, () => version)
  const [clips, setClips] = useState<RecentClip[] | null>(null)
  useEffect(() => {
    if (videos === null) return
    let cancelled = false
    const ids = newestIds(12)
    const titles = new Map((videos ?? []).map((x) => [x.video_id, x.title]))
    void loadClipsFor(ids).then((byVideo) => {
      if (cancelled) return
      const all: RecentClip[] = []
      for (const id of ids)
        for (const c of byVideo[id] ?? []) all.push({ ...c, video_id: id, video_title: titles.get(id) ?? '' })
      all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || b.score - a.score)
      setClips(all.slice(0, n))
    })
    return () => {
      cancelled = true
    }
  }, [v, n])
  return { clips }
}
