import { api } from './api'
import type { Clip, Video } from './types'

/** The publishing calendar's data (spec 4.8), merged on the client.
 *
 *  Four sources, each optional and each checked before it is asked:
 *  - WoopSocial's schedule (only when WoopSocial is switched on);
 *  - clips with a `scheduled_for` in the library;
 *  - YouTube uploads (only when YouTube publishing is on), shown as posted
 *    or, with a future publish time, as scheduled;
 *  - the next free posting slots (/automation/slots), drawn as ghosts.
 *  Plus the WoopSocial posts still in the air, for the "In flight" list.
 *  Nothing here writes: there is no endpoint to move a post. */

export type CalState = 'scheduled' | 'uploading' | 'failed' | 'posted'

export interface CalEvent {
  id: string
  when: Date
  platform: string
  title: string
  state: CalState
  source: 'woopsocial' | 'library' | 'youtube'
  clipId?: number
  videoId?: string
  poster?: string
  url?: string
  error?: string
}

export interface CalProviders {
  woop: boolean
  youtube: boolean
  uploadPost: boolean
}

export interface CalData {
  events: CalEvent[]
  slots: Date[]
  inFlight: string[]
  providers: CalProviders
}

const EMPTY_PROVIDERS: CalProviders = { woop: false, youtube: false, uploadPost: false }

function parse(when: string | null | undefined): Date | null {
  if (!when) return null
  const d = new Date(when)
  return Number.isNaN(d.getTime()) ? null : d
}

function woopState(state: string, when: Date, now: number): CalState | null {
  switch (state) {
    case 'published':
      return 'posted'
    case 'failed':
      return 'failed'
    case 'skipped':
      return null
    default:
      // queued / processing / sending: waiting for its time, or on its way
      return when.getTime() > now ? 'scheduled' : 'uploading'
  }
}

/** Which providers are switched on and usable. Each status call fails soft. */
export async function loadProviders(): Promise<CalProviders> {
  const [woop, yt, up] = await Promise.all([
    api.woopSocialStatus().catch(() => null),
    api.youtubeStatus().catch(() => null),
    api.uploadPostStatus().catch(() => null)
  ])
  return {
    woop: Boolean(woop?.enabled && woop.has_key),
    youtube: Boolean(yt?.enabled && yt.connected),
    uploadPost: Boolean(up?.enabled && up.has_key)
  }
}

/** Everything the calendar shows. `videos` is the library store's list;
 *  clips are read for the newest 60 videos through its 6-wide loader. */
export async function loadCalendar(
  videos: Video[] | null,
  loadClipsFor: (ids: string[]) => Promise<Record<string, Clip[]>>
): Promise<CalData> {
  const now = Date.now()
  const providers = await loadProviders().catch(() => EMPTY_PROVIDERS)

  const ids = [...(videos ?? [])]
    .filter((v) => v.clip_count > 0)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 60)
    .map((v) => v.video_id)

  const [byVideo, woop, yt, slots, flight] = await Promise.all([
    ids.length ? loadClipsFor(ids).catch(() => ({}) as Record<string, Clip[]>) : Promise.resolve({} as Record<string, Clip[]>),
    providers.woop ? api.woopSocialSchedule().catch(() => null) : Promise.resolve(null),
    providers.youtube ? api.youtubeUploads(50).catch(() => null) : Promise.resolve(null),
    api.automationSlots(5, 1, '', 10).catch(() => null),
    providers.woop ? api.woopSocialInFlight().catch(() => null) : Promise.resolve(null)
  ])

  const clipVideo = new Map<number, string>()
  const libClips: Clip[] = []
  for (const [vid, clips] of Object.entries(byVideo)) {
    for (const c of clips) {
      clipVideo.set(c.id, vid)
      if (c.scheduled_for) libClips.push(c)
    }
  }

  const events: CalEvent[] = []
  const covered = new Set<number>()

  for (const p of woop?.posts ?? []) {
    const when = parse(p.scheduled_for)
    if (!when) continue
    const state = woopState(p.state, when, now)
    if (!state) continue
    covered.add(p.clip_id)
    events.push({
      id: `w-${p.clip_id}-${p.platform}-${p.scheduled_for}`,
      when,
      platform: p.platform,
      title: p.title || `Clip ${p.clip_id}`,
      state,
      source: 'woopsocial',
      clipId: p.clip_id,
      videoId: clipVideo.get(p.clip_id),
      poster: api.clipFrameUrl(p.clip_id, 1),
      url: p.post_url || undefined,
      error: p.error || undefined
    })
  }

  for (const u of yt?.uploads ?? []) {
    const publishAt = parse(u.publish_at)
    const uploaded = parse(u.uploaded_at)
    const future = publishAt && publishAt.getTime() > now
    const when = future ? publishAt : (uploaded ?? publishAt)
    if (!when) continue
    covered.add(u.clip_id)
    events.push({
      id: `y-${u.clip_id}-${u.youtube_id || u.uploaded_at}`,
      when,
      platform: 'youtube',
      title: u.title || `Clip ${u.clip_id}`,
      state: u.state === 'failed' || u.error ? 'failed' : future ? 'scheduled' : 'posted',
      source: 'youtube',
      clipId: u.clip_id,
      videoId: clipVideo.get(u.clip_id),
      poster: api.clipFrameUrl(u.clip_id, 1),
      url: u.youtube_id ? `https://www.youtube.com/watch?v=${u.youtube_id}` : undefined,
      error: u.error || undefined
    })
  }

  for (const c of libClips) {
    if (covered.has(c.id)) continue
    const when = parse(c.scheduled_for)
    if (!when) continue
    events.push({
      id: `c-${c.id}`,
      when,
      platform: 'clip',
      title: c.title || c.hook || `Clip ${c.id}`,
      state: when.getTime() > now ? 'scheduled' : 'posted',
      source: 'library',
      clipId: c.id,
      videoId: c.video_id || clipVideo.get(c.id),
      poster: api.clipFrameUrl(c.id, 1)
    })
  }

  events.sort((a, b) => a.when.getTime() - b.when.getTime())

  return {
    events,
    slots: (slots?.times ?? []).map(parse).filter((d): d is Date => d !== null && d.getTime() > now),
    inFlight: flight?.request_ids ?? [],
    providers
  }
}

/* ---------- date helpers (local time) ---------- */

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Monday-first week start. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** The 42 days of a 6×7 month grid, Monday first. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
