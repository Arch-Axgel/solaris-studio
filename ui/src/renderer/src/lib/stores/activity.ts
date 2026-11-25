import { useSyncExternalStore } from 'react'
import { api } from '../api'
import { t } from '../i18n'
import { celebrate } from '../motion'
import { navigate } from '../nav'
import type { StudioEvent } from '../types'
import { toast } from '../../components/ui/Toast'
import { subscribeEvents } from './eventBus'

/** The activity feed (spec 4.14): what happened, newest first, with an
 *  unread count; the raw technical log; and the global toasts that go with
 *  it ("Your clips are ready", failed jobs, model downloads). */

export type ActivityKind = 'job' | 'publish' | 'watch' | 'model' | 'system'
export interface ActivityItem {
  id: string
  at: number
  kind: ActivityKind
  tone: 'success' | 'warn' | 'error' | 'info'
  title: string
  body?: string
  videoId?: string
  clipId?: number
  jobId?: number | string
  url?: string
  progress?: number
}

const SEEN_KEY = 'solaris.ui.activity.lastSeen'
const PUBLISHED_KEY = 'solaris.ui.activity.published'
const MAX_ITEMS = 200
const MAX_RAW = 500

function readNum(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0
  } catch {
    return 0
  }
}
function writeStr(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* storage refused: lasts this session */
  }
}

interface ActivityState {
  items: ActivityItem[]
  raw: string[]
  lastSeen: number
  hasPublished: boolean
  unread: number
}

let state: ActivityState = {
  items: [],
  raw: [],
  lastSeen: readNum(SEEN_KEY),
  hasPublished: (() => {
    try {
      return localStorage.getItem(PUBLISHED_KEY) === '1'
    } catch {
      return false
    }
  })(),
  unread: 0
}
const listeners = new Set<() => void>()
/** Live model downloads: tag → fraction (null = size unknown yet). */
let pulls: Record<string, number | null> = {}
const pullListeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function recount(items: ActivityItem[], lastSeen: number): number {
  return items.filter((i) => i.at > lastSeen).length
}

function add(list: ActivityItem[]): void {
  if (list.length === 0) return
  const byId = new Map(state.items.map((i) => [i.id, i]))
  for (const it of list) byId.set(it.id, { ...byId.get(it.id), ...it })
  const items = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS)
  state = { ...state, items, unread: recount(items, state.lastSeen) }
  emit()
}

function setPublished(): void {
  if (state.hasPublished) return
  writeStr(PUBLISHED_KEY, '1')
  state = { ...state, hasPublished: true }
  emit()
}

function ts(d: string | number | undefined): number {
  if (typeof d === 'number') return d < 1e12 ? d * 1000 : d
  const n = d ? Date.parse(d) : NaN
  return Number.isFinite(n) ? n : Date.now()
}

function describe(e: StudioEvent): string {
  if (e.type === 'progress') {
    if (e.stage === 'render') return `Rendering clip ${e.clip}/${e.total}${e.remote ? ` · ${e.remote}` : ''}`
    if (e.stage === 'done') return `Finished — ${e.clips ?? 0} clip(s) created`
    if (e.stage === 'prefetch') return 'Downloading the next queued video in the background'
    return `Stage: ${e.stage}${e.title ? ` — ${e.title}` : ''}${typeof e.fraction === 'number' ? ` (${Math.round(e.fraction * 100)}%)` : ''}`
  }
  if (e.type === 'job') return `Job ${e.job_id}: ${e.status}${e.error ? ` (${e.error})` : ''}`
  if (e.type === 'model_pull') return `Model ${e.tag}: ${e.status}${e.total ? ` ${Math.round(((e.completed ?? 0) / e.total) * 100)}%` : ''}`
  if (e.type === 'publish') return `Publish clip ${e.clip_id}: ${e.phase ?? e.status ?? ''}${e.error ? ` (${e.error})` : ''}`
  if (e.type === 'queue') return 'Queue changed'
  return JSON.stringify(e)
}

function pushRaw(e: StudioEvent): void {
  // Progress events arrive many times a second: keep the log readable.
  const line = `${new Date().toLocaleTimeString()}  ${describe(e)}`
  if (state.raw[0]?.endsWith(describe(e))) return
  const raw = [line, ...state.raw].slice(0, MAX_RAW)
  state = { ...state, raw }
  emit()
}

function openClips(videoId: string): void {
  navigate({ page: 'studio', params: { videoId } })
}

async function clipsReady(e: StudioEvent): Promise<void> {
  const videoId = e.video_id
  let thumbs: string[] = []
  let count = e.clips
  if (videoId) {
    try {
      const clips = await api.clips(videoId)
      count = clips.length
      thumbs = [...clips]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((c) => api.clipFrameUrl(c.id, Math.min(1, Math.max(0, (c.end_s - c.start_s) / 3))))
    } catch {
      /* the toast still says it's done */
    }
  }
  const pill = document.querySelector('[data-jobs-pill]') ?? document.querySelector('[data-fly-target="queue"]')
  celebrate(pill)
  toast({
    id: `ready-${e.job_id ?? videoId}`,
    tone: 'success',
    title: t('Your clips are ready'),
    body: `${e.title || t('A video')}${typeof count === 'number' ? ` · ${count} ${count === 1 ? t('clip') : t('clips')}` : ''}`,
    thumbs,
    duration: 9000,
    action: videoId ? { label: t('Open in Clip Editor'), run: () => openClips(videoId) } : undefined
  })
}

function onEvent(e: StudioEvent): void {
  if (e.type !== 'progress') pushRaw(e)
  else if (e.stage === 'done' || e.stage === 'render') pushRaw(e)

  if (e.type === 'job' && (!e.job_type || e.job_type === 'process')) {
    if (e.status === 'done') {
      add([
        {
          id: `job-${e.job_id}-done`,
          at: Date.now(),
          kind: 'job',
          tone: 'success',
          title: e.title || t('A video finished processing'),
          body: typeof e.clips === 'number' ? `${e.clips} ${t('clips')}` : t('Clips are ready'),
          videoId: e.video_id,
          jobId: e.job_id
        }
      ])
      void clipsReady(e)
    } else if (e.status === 'failed') {
      add([
        {
          id: `job-${e.job_id}-failed`,
          at: Date.now(),
          kind: 'job',
          tone: 'error',
          title: e.title || t('A video failed'),
          body: e.error || undefined,
          videoId: e.video_id,
          jobId: e.job_id
        }
      ])
      const jobId = e.job_id
      toast({
        id: `failed-${jobId}`,
        tone: 'error',
        title: `${e.title || t('A video')} ${t('failed')}`,
        body: e.error || t('See the queue for details'),
        action:
          typeof jobId === 'number'
            ? {
                label: t('Retry'),
                run: () => {
                  api
                    .retryJob(jobId)
                    .then(() => toast({ tone: 'info', title: t('Queued again') }))
                    .catch(() => toast({ tone: 'error', title: t('Could not retry it') }))
                }
              }
            : undefined,
        secondary: { label: t('Open queue'), run: () => navigate({ page: 'queue' }) }
      })
    }
  }

  if (e.type === 'publish' && e.terminal) {
    const ok = e.terminal === 'done'
    if (ok) setPublished()
    add([
      {
        id: `pub-${e.publish_job ?? e.clip_id}-${e.terminal}`,
        at: Date.now(),
        kind: 'publish',
        tone: ok ? 'success' : e.terminal === 'failed' ? 'error' : 'info',
        title: ok ? t('Published to YouTube') : e.terminal === 'failed' ? t('Publishing failed') : t('Publishing stopped'),
        body: e.title || e.error || undefined,
        clipId: e.clip_id,
        url: e.url
      }
    ])
  }

  if (e.type === 'model_pull' && e.tag) {
    const tag = e.tag
    const id = `model-${tag}`
    if (e.status === 'done' || e.status === 'success') {
      delete pulls[tag]
      pulls = { ...pulls }
      pullListeners.forEach((l) => l())
      toast({ id, tone: 'success', title: `${t('Downloaded')} ${tag}`, body: t('Ready to use') })
      add([{ id: `${id}-${Date.now()}`, at: Date.now(), kind: 'model', tone: 'success', title: `${t('Downloaded')} ${tag}` }])
    } else if (e.status === 'error') {
      delete pulls[tag]
      pulls = { ...pulls }
      pullListeners.forEach((l) => l())
      toast({ id, tone: 'error', title: `${t('Download failed:')} ${tag}`, body: e.error })
      add([{ id: `${id}-${Date.now()}`, at: Date.now(), kind: 'model', tone: 'error', title: `${t('Download failed:')} ${tag}`, body: e.error }])
    } else {
      const frac = e.total ? Math.min(1, (e.completed ?? 0) / e.total) : null
      const before = pulls[tag]
      pulls = { ...pulls, [tag]: frac }
      if (before !== frac) pullListeners.forEach((l) => l())
      toast.progress(id, { title: `${t('Downloading')} ${tag}`, body: e.status || undefined, value: frac, icon: 'download' })
    }
  }

  if (e.type === 'automation') scheduleWatchRefresh()
}

let watchTimer: ReturnType<typeof setTimeout> | null = null
function scheduleWatchRefresh(): void {
  if (watchTimer) return
  watchTimer = setTimeout(() => {
    watchTimer = null
    void loadWatchEvents()
  }, 1500)
}

async function loadWatchEvents(): Promise<void> {
  try {
    const a = await api.automationActivity()
    add(
      a.events.slice(0, 50).map((ev) => ({
        id: `watch-${ev.at}-${ev.text.slice(0, 40)}`,
        at: ts(ev.at),
        kind: 'watch' as const,
        tone: (/fail|error|couldn/i.test(ev.text) ? 'error' : 'info') as ActivityItem['tone'],
        title: ev.text,
        url: ev.url
      }))
    )
  } catch {
    /* watching is optional */
  }
}

async function seed(): Promise<void> {
  try {
    const q = await api.queue()
    add([
      ...q.completed.slice(0, 40).map((j) => ({
        id: `job-${j.id}-done`,
        at: ts(j.finished_at || j.updated_at),
        kind: 'job' as const,
        tone: 'success' as const,
        title: j.display_title || j.url || `Job ${j.id}`,
        body: t('Finished processing'),
        videoId: j.video_id || undefined,
        jobId: j.id
      })),
      ...q.failed.slice(0, 40).map((j) => ({
        id: `job-${j.id}-failed`,
        at: ts(j.finished_at || j.updated_at),
        kind: 'job' as const,
        tone: 'error' as const,
        title: j.display_title || j.url || `Job ${j.id}`,
        body: j.error || t('Failed'),
        videoId: j.video_id || undefined,
        jobId: j.id
      }))
    ])
  } catch {
    /* engine not up yet */
  }
  await loadWatchEvents()
  try {
    const yt = await api.youtubeStatus()
    if (yt.enabled) {
      const { uploads } = await api.youtubeUploads(50)
      if (uploads.length > 0) setPublished()
      add(
        uploads.map((u) => ({
          id: `yt-${u.youtube_id || u.clip_id}`,
          at: ts(u.uploaded_at),
          kind: 'publish' as const,
          tone: (u.error ? 'error' : 'success') as ActivityItem['tone'],
          title: u.title || t('Uploaded to YouTube'),
          body: u.channel_title || undefined,
          clipId: u.clip_id,
          url: u.youtube_id ? `https://www.youtube.com/watch?v=${u.youtube_id}` : undefined
        }))
      )
    }
  } catch {
    /* YouTube not set up */
  }
}

let started = false
/** Called once by the Shell: one event subscription and the history seed. */
export function startActivityFeed(): () => void {
  if (started) return () => {}
  started = true
  // First launch: history from before now is not "unread news".
  if (state.lastSeen === 0) {
    const now = Date.now()
    writeStr(SEEN_KEY, String(now))
    state = { ...state, lastSeen: now }
  }
  const off = subscribeEvents(onEvent)
  void seed()
  return () => {
    started = false
    off()
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function markAllRead(): void {
  const now = Date.now()
  writeStr(SEEN_KEY, String(now))
  state = { ...state, lastSeen: now, unread: 0 }
  emit()
}

export function useActivity(): {
  items: ActivityItem[]
  unread: number
  raw: string[]
  hasPublished: boolean
  markAllRead: () => void
} {
  const s = useSyncExternalStore(subscribe, () => state, () => state)
  return { items: s.items, unread: s.unread, raw: s.raw, hasPublished: s.hasPublished, markAllRead }
}

function subscribePulls(cb: () => void): () => void {
  pullListeners.add(cb)
  return () => {
    pullListeners.delete(cb)
  }
}

/** Live model downloads, tag → fraction (null while the size is unknown). */
export function useModelPulls(): Record<string, number | null> {
  return useSyncExternalStore(subscribePulls, () => pulls, () => pulls)
}
