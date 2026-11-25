import { useEffect, useSyncExternalStore } from 'react'
import type { IconName } from '../components/icons'
import { api } from './api'
import { t } from './i18n'
import { navigate } from './nav'
import { openMarketplace, plugins } from './plugins'
import { subscribeEvents } from './stores/eventBus'
import type { Clip, Video } from './types'

/** The palette's library index (spec 4.16).
 *
 *  Built lazily the first time the palette opens: the video list, the clips
 *  of the newest 150 videos (6 requests at a time), creators, watched
 *  channels and installed add-ons. Cached in this module. A finished job, or
 *  invalidateLibrary(), rebuilds just that video. */

export type SearchKind = 'clip' | 'video' | 'creator' | 'watch' | 'addon'

export interface SearchItem {
  key: string
  kind: SearchKind
  label: string
  sub?: string
  keywords?: string[]
  icon: IconName
  /** newest first ordering when there is no query */
  at: number
  videoId?: string
  clipId?: number
  creatorId?: number
  poster?: string
  score?: number
  duration?: number
  stats?: { videos: number; clips: number; avgScore: number | null; accounts: string[] }
  run: () => void
}

const MAX_VIDEOS = 150
const CONCURRENCY = 6

let items = new Map<string, SearchItem>()
let snapshot: SearchItem[] = []
let state: 'idle' | 'loading' | 'ready' = 'idle'
let videoById = new Map<string, Video>()
let creatorNames = new Map<number, string>()
let building: Promise<void> | null = null
let liveOff: (() => void) | null = null
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  snapshot = [...items.values()]
  version++
  listeners.forEach((l) => l())
}

function ts(s: string | undefined): number {
  const n = s ? Date.parse(s) : NaN
  return Number.isFinite(n) ? n : 0
}

function clipLabel(c: Clip): string {
  return (c.title || c.hook || `${t('Clip')} ${c.id}`).replace(/\s+/g, ' ').trim()
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

function videoItem(v: Video, poster?: string): SearchItem {
  return {
    key: `video:${v.video_id}`,
    kind: 'video',
    label: v.title || v.video_id,
    sub: [v.channel_name || v.creator_name, `${v.clip_count} ${v.clip_count === 1 ? t('clip') : t('clips')}`].filter(Boolean).join(' · '),
    keywords: [v.channel_name, v.creator_name ?? ''].filter(Boolean),
    icon: 'film',
    at: ts(v.created_at),
    videoId: v.video_id,
    creatorId: v.creator_id ?? undefined,
    poster,
    run: () => navigate({ page: 'studio', params: { videoId: v.video_id } })
  }
}

function clipItems(v: Video, clips: Clip[]): SearchItem[] {
  return clips.map((c) => {
    const dur = Math.max(0, c.end_s - c.start_s)
    return {
      key: `clip:${c.id}`,
      kind: 'clip' as const,
      label: clipLabel(c),
      sub: `${v.title || v.channel_name} · ${fmtDur(dur)}`,
      keywords: [c.hook, ...(c.hashtags ?? []), v.channel_name].filter(Boolean),
      icon: 'scissors' as IconName,
      at: ts(c.created_at) || ts(v.created_at),
      videoId: v.video_id,
      clipId: c.id,
      poster: api.clipFrameUrl(c.id, Math.min(1.5, dur / 3)),
      score: c.score,
      duration: dur,
      run: () => navigate({ page: 'studio', params: { videoId: v.video_id, clipId: c.id } })
    }
  })
}

function bestPoster(clips: Clip[]): string | undefined {
  if (clips.length === 0) return undefined
  const best = clips.reduce((a, b) => (b.score > a.score ? b : a))
  return api.clipFrameUrl(best.id, Math.min(1.5, (best.end_s - best.start_s) / 3))
}

function setVideoClips(v: Video, clips: Clip[]): void {
  for (const [k, it] of items) if (it.kind === 'clip' && it.videoId === v.video_id) items.delete(k)
  items.set(`video:${v.video_id}`, videoItem(v, bestPoster(clips)))
  for (const it of clipItems(v, clips)) items.set(it.key, it)
}

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < list.length) {
      const x = list[i++]
      await fn(x).catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker))
}

async function loadVideos(): Promise<Video[]> {
  const vids = await api.videos()
  videoById = new Map(vids.map((v) => [v.video_id, v]))
  return vids
}

async function build(): Promise<void> {
  state = 'loading'
  emit()
  const side: Promise<unknown>[] = []

  side.push(
    api
      .creators()
      .then(({ creators }) => {
        creatorNames = new Map(creators.map((c) => [c.creator_id, c.display_name]))
        for (const c of creators) {
          items.set(`creator:${c.creator_id}`, {
            key: `creator:${c.creator_id}`,
            kind: 'creator',
            label: c.display_name,
            sub: `${c.videos} ${t('videos')} · ${c.clips} ${t('clips')}`,
            keywords: [...c.aliases, ...c.accounts.map((a) => a.username)].filter(Boolean),
            icon: 'users',
            at: c.clips,
            creatorId: c.creator_id,
            stats: {
              videos: c.videos,
              clips: c.clips,
              avgScore: c.avg_score,
              accounts: c.accounts.map((a) => a.platform).filter(Boolean)
            },
            run: () => navigate({ page: 'creators', params: { creatorId: c.creator_id } })
          })
        }
        emit()
      })
      .catch(() => {})
  )
  side.push(
    api
      .watches()
      .then((ws) => {
        for (const w of ws) {
          items.set(`watch:${w.id}`, {
            key: `watch:${w.id}`,
            kind: 'watch',
            label: w.name || w.channel_key,
            sub: `${w.platform}${w.enabled ? '' : ` · ${t('paused')}`}`,
            keywords: [w.channel_key, w.platform],
            icon: w.platform === 'twitch' ? 'twitch' : w.platform === 'kick' ? 'kick' : 'youtube',
            at: w.last_ok_poll_at || 0,
            creatorId: w.creator?.id,
            run: () => navigate({ page: 'watch' })
          })
        }
        emit()
      })
      .catch(() => {})
  )
  side.push(
    plugins
      .list()
      .then((r) => {
        for (const p of r.plugins) {
          items.set(`addon:${p.id}`, {
            key: `addon:${p.id}`,
            kind: 'addon',
            label: p.name || p.id,
            sub: p.enabled ? p.description?.slice(0, 80) || t('Installed') : t('Turned off'),
            keywords: [p.id, p.category ?? '', ...(p.tags ?? [])].filter(Boolean),
            icon: 'store',
            at: ts(p.installed_at),
            run: () => openMarketplace('installed')
          })
        }
        emit()
      })
      .catch(() => {})
  )

  try {
    const vids = await loadVideos()
    for (const v of vids) items.set(`video:${v.video_id}`, videoItem(v))
    emit()
    const newest = [...vids].sort((a, b) => ts(b.created_at) - ts(a.created_at)).slice(0, MAX_VIDEOS)
    let pending = 0
    await pool(newest, CONCURRENCY, async (v) => {
      const clips = await api.clips(v.video_id)
      setVideoClips(v, clips)
      // batch re-renders: every few videos
      if (++pending % 6 === 0) emit()
    })
  } catch {
    /* engine offline: commands still work */
  }
  await Promise.allSettled(side)
  state = 'ready'
  emit()
}

async function rebuildVideo(videoId: string): Promise<void> {
  try {
    let v = videoById.get(videoId)
    if (!v) {
      await loadVideos()
      v = videoById.get(videoId)
    }
    if (!v) return
    const clips = await api.clips(videoId)
    // the video list carries the clip count; refresh this row's numbers
    setVideoClips({ ...v, clip_count: clips.length }, clips)
    emit()
  } catch {
    /* keep what we had */
  }
}

async function refreshVideoList(): Promise<void> {
  try {
    const vids = await loadVideos()
    const ids = new Set(vids.map((v) => v.video_id))
    for (const [k, it] of items) {
      if ((it.kind === 'video' || it.kind === 'clip') && it.videoId && !ids.has(it.videoId)) items.delete(k)
    }
    for (const v of vids) {
      const prev = items.get(`video:${v.video_id}`)
      items.set(`video:${v.video_id}`, videoItem(v, prev?.poster))
    }
    emit()
  } catch {
    /* offline */
  }
}

function startLive(): void {
  if (liveOff) return
  const offEvents = subscribeEvents((e) => {
    if (e.type === 'job' && e.status === 'done' && (!e.job_type || e.job_type === 'process') && e.video_id) {
      void rebuildVideo(e.video_id)
    }
  })
  const onLib = (e: Event): void => {
    const id = (e as CustomEvent<{ videoId?: string }>).detail?.videoId
    if (id) void rebuildVideo(id)
    else void refreshVideoList()
  }
  window.addEventListener('library-changed', onLib)
  liveOff = () => {
    offEvents()
    window.removeEventListener('library-changed', onLib)
  }
}

/** Start building (once). Safe to call on every palette open. */
export function ensureIndex(): Promise<void> {
  startLive()
  if (!building) {
    building = build().catch(() => {
      state = 'ready'
      emit()
    })
  }
  return building
}

/** Forget everything and build again (e.g. after the engine restarted). */
export function rebuildIndex(): Promise<void> {
  items = new Map()
  building = null
  return ensureIndex()
}

export function creatorName(id: number | undefined): string | undefined {
  return id === undefined ? undefined : creatorNames.get(id)
}

export function findItem(key: string): SearchItem | undefined {
  return items.get(key)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The index, reactive. `active` starts the lazy build. */
export function useSearchIndex(active: boolean): { items: SearchItem[]; loading: boolean; version: number } {
  useEffect(() => {
    if (active) void ensureIndex()
  }, [active])
  useSyncExternalStore(subscribe, () => version, () => version)
  return { items: snapshot, loading: state !== 'ready', version }
}
