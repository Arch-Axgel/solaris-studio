import { useEffect, useMemo, useState } from 'react'
import { t } from '../../lib/i18n'
import { loadClipsFor } from '../../lib/stores/library'
import type { Video } from '../../lib/types'
import { Icon } from '../icons'
import { MenuButton, SearchInput, Segmented, Tooltip } from '../ui'
import { ClipPoster, framesAvailable } from './HoverPreview'
import { readPref, writePref } from './prefs'

/** The Clip Editor's left rail (spec 4.6): every processed video, with
 *  search, creator chips, sort and a List / By creator view. It replaces the
 *  old creator-chip dropdown and the Dashboard's "Processed videos" table:
 *  search, channel filter, sort and delete all live here. */

export const ALL_CLIPS = '__all__'

export type RailSort = 'newest' | 'channel' | 'clips'
export type RailView = 'list' | 'creator'

/** A video's creator: the Creators profile when it has one, else its channel. */
export function creatorKeyOf(v: Video): string {
  const channel = (v.channel_name || '').trim()
  return v.creator_id != null ? `creator:${v.creator_id}` : channel ? `channel:${channel}` : ''
}
export function creatorLabelOf(v: Video): string {
  return (v.creator_name || '').trim() || (v.channel_name || '').trim() || t('Other videos')
}

export function matchesSearch(v: Video, q: string): boolean {
  if (!q) return true
  return (
    (v.title || '').toLowerCase().includes(q) ||
    (v.channel_name || '').toLowerCase().includes(q) ||
    (v.creator_name || '').toLowerCase().includes(q) ||
    v.video_id.toLowerCase().includes(q)
  )
}

export function fmtProcess(s: number): string {
  if (!s || s <= 0) return ''
  const sec = Math.round(s)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function ago(iso: string): string {
  const then = Date.parse(iso)
  if (!then) return ''
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(then).toLocaleDateString()
}

function statusOf(v: Video): { tone: 'done' | 'failed' | 'running'; word: string } {
  if (v.status === 'done') return { tone: 'done', word: t('Ready') }
  if (v.status === 'failed') return { tone: 'failed', word: t('Failed') }
  return { tone: 'running', word: t('Processing') }
}

/** Initials on a hash gradient, for a video with no frame to show. */
function Monogram({ seed, label }: { seed: string; label: string }): JSX.Element {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 40
  const letters =
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '•'
  return (
    <span
      className="lib-row-mono"
      style={{
        background: `linear-gradient(135deg, hsl(${340 + hue} 55% 26%), hsl(${30 + hue} 45% 32%))`
      }}
      aria-hidden
    >
      {letters}
    </span>
  )
}

/** First (best) clip's frame, loaded once the row is near the viewport. */
function RowThumb({ video }: { video: Video }): JSX.Element {
  const [clip, setClip] = useState<{ id: number; dur: number } | null>(null)
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [el, near])
  useEffect(() => {
    if (!near || video.clip_count <= 0 || !framesAvailable()) return
    let alive = true
    void loadClipsFor([video.video_id]).then((r) => {
      const list = r[video.video_id] ?? []
      const best = [...list].sort((a, b) => b.score - a.score)[0]
      if (alive && best) setClip({ id: best.id, dur: best.end_s - best.start_s })
    })
    return () => {
      alive = false
    }
  }, [near, video.video_id, video.clip_count])
  return (
    <span ref={setEl} className="lib-row-thumb">
      {clip && framesAvailable() ? (
        <ClipPoster clipId={clip.id} durationS={clip.dur} hover={false} className="lib-row-poster" />
      ) : (
        <Monogram seed={video.channel_name || video.video_id} label={creatorLabelOf(video)} />
      )}
    </span>
  )
}

function VideoRow({
  video,
  active,
  onSelect,
  onDelete,
  index
}: {
  video: Video
  active: boolean
  onSelect: () => void
  onDelete: () => void
  index: number
}): JSX.Element {
  const st = statusOf(video)
  const proc = fmtProcess(video.process_seconds)
  return (
    <li className="lib-row-wrap" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <button
        type="button"
        className="lib-row"
        aria-current={active ? 'true' : undefined}
        data-video-id={video.video_id}
        onClick={onSelect}
        title={video.title || video.video_id}
      >
        <RowThumb video={video} />
        <span className="min-w-0 flex-1">
          <span className="lib-row-title">{video.title || video.video_id}</span>
          <span className="lib-row-meta">
            <span className="truncate">{video.channel_name || creatorLabelOf(video)}</span>
            {video.created_at && <span className="shrink-0 opacity-70">· {ago(video.created_at)}</span>}
          </span>
          <span className="lib-row-stats">
            <span className={`lib-status lib-status-${st.tone}`}>
              <span className="lib-status-dot" aria-hidden />
              {st.word}
            </span>
            <span className="tabular">
              {video.clip_count} {video.clip_count === 1 ? t('clip') : t('clips')}
            </span>
            {proc && (
              <span className="tabular opacity-75" title={t('Processing time')}>
                <Icon name="clock" size={11} className="inline -mt-px mr-0.5" />
                {proc}
              </span>
            )}
          </span>
        </span>
      </button>
      <span className="lib-row-menu">
        <MenuButton
          label={t('Video actions')}
          items={[
            { label: t('Open clips'), icon: 'film', onSelect },
            { label: t('Delete video'), icon: 'trash', danger: true, onSelect: onDelete }
          ]}
        />
      </span>
    </li>
  )
}

export default function VideoRail({
  videos,
  loaded,
  activeVideo,
  onSelect,
  onDelete,
  search,
  onSearch,
  creator,
  onCreator,
  collapsed,
  onToggleCollapsed
}: {
  videos: Video[]
  loaded: boolean
  activeVideo: string | null
  onSelect: (videoId: string) => void
  onDelete: (video: Video) => void
  search: string
  onSearch: (q: string) => void
  /** The creator chip that is on (creatorKeyOf), or null for everyone. */
  creator: string | null
  onCreator: (key: string | null) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}): JSX.Element {
  const [sort, setSortState] = useState<RailSort>(() => readPref<RailSort>('railSort', 'newest'))
  const [view, setViewState] = useState<RailView>(() => readPref<RailView>('railView', 'list'))
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const setSort = (s: RailSort): void => {
    setSortState(s)
    writePref('railSort', s)
  }
  const setView = (v: RailView): void => {
    setViewState(v)
    writePref('railView', v)
  }

  // Creator chips: everyone with a video, most videos first.
  const creators = useMemo(() => {
    const m = new Map<string, { key: string; label: string; n: number }>()
    for (const v of videos) {
      const key = creatorKeyOf(v)
      if (!key) continue
      const c = m.get(key) ?? { key, label: creatorLabelOf(v), n: 0 }
      c.n++
      m.set(key, c)
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  }, [videos])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = videos.filter((v) => matchesSearch(v, q) && (!creator || creatorKeyOf(v) === creator))
    const by = [...list]
    if (sort === 'newest') by.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    else if (sort === 'channel')
      by.sort(
        (a, b) =>
          creatorLabelOf(a).localeCompare(creatorLabelOf(b)) || (b.created_at || '').localeCompare(a.created_at || '')
      )
    else by.sort((a, b) => b.clip_count - a.clip_count)
    return by
  }, [videos, q, creator, sort])

  const groups = useMemo(() => {
    if (view !== 'creator') return null
    const m = new Map<string, { key: string; label: string; list: Video[] }>()
    for (const v of shown) {
      const key = creatorKeyOf(v)
      const g = m.get(key) ?? { key, label: creatorLabelOf(v), list: [] }
      g.list.push(v)
      m.set(key, g)
    }
    return [...m.values()].sort((a, b) => Number(a.key === '') - Number(b.key === ''))
  }, [shown, view])

  const totalClips = useMemo(() => shown.reduce((n, v) => n + (v.clip_count || 0), 0), [shown])

  // Arrow keys walk the rows.
  const onListKey = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.lib-row, .lib-row-all'))
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  if (collapsed) {
    return (
      <aside className="lib-rail lib-rail-collapsed" aria-label={t('Videos')}>
        <Tooltip content={t('Show videos')} side="right">
          <button type="button" className="btn-icon" aria-label={t('Show videos')} onClick={onToggleCollapsed}>
            <Icon name="panel-right" size={18} className="-scale-x-100" />
          </button>
        </Tooltip>
        <span className="lib-rail-vert t-micro">{t('Videos')}</span>
        <span className="lib-rail-count tabular">{videos.length}</span>
      </aside>
    )
  }

  const row = (v: Video, i: number): JSX.Element => (
    <VideoRow
      key={v.video_id}
      video={v}
      index={i}
      active={activeVideo === v.video_id}
      onSelect={() => onSelect(v.video_id)}
      onDelete={() => onDelete(v)}
    />
  )

  return (
    <aside className="lib-rail" aria-label={t('Videos')}>
      <div className="lib-rail-head">
        <div className="flex items-center gap-2">
          <p className="t-micro flex-1">
            {t('Videos')} <span className="tabular text-muted">{videos.length}</span>
          </p>
          <Tooltip content={t('Hide videos')}>
            <button type="button" className="btn-icon ui-icon-sm" aria-label={t('Hide videos')} onClick={onToggleCollapsed}>
              <Icon name="chevron-left" size={16} />
            </button>
          </Tooltip>
        </div>
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t('Search your videos or channels…')}
          ariaLabel="Search processed videos by title or channel"
          hotkey
        />
        {creators.length > 1 && (
          <div className="lib-chips" role="group" aria-label={t('Filter by creator')}>
            <button
              type="button"
              className="lib-filter-chip"
              aria-pressed={creator === null}
              onClick={() => onCreator(null)}
            >
              {t('Everyone')}
            </button>
            {creators.map((c) => (
              <button
                key={c.key}
                type="button"
                className="lib-filter-chip"
                aria-pressed={creator === c.key}
                onClick={() => onCreator(creator === c.key ? null : c.key)}
                title={c.label}
              >
                <span className="truncate max-w-[9rem]">{c.label}</span>
                <span className="tabular opacity-70">{c.n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="lib-rail-sort">
            {t('Sort videos')}
          </label>
          <select
            id="lib-rail-sort"
            className="input lib-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as RailSort)}
          >
            <option value="newest">{t('Newest')}</option>
            <option value="channel">{t('Channel A–Z')}</option>
            <option value="clips">{t('Most clips')}</option>
          </select>
          <Segmented
            size="sm"
            ariaLabel={t('Video list view')}
            value={view}
            onChange={(v) => setView(v as RailView)}
            items={[
              { id: 'list', label: t('List'), icon: 'list' },
              { id: 'creator', label: t('By creator'), icon: 'users' }
            ]}
          />
        </div>
      </div>

      <nav className="lib-rail-list" aria-label={t('Processed videos')} onKeyDown={onListKey}>
        {!loaded ? (
          <ul className="space-y-2 p-1" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex gap-3 items-center p-2">
                <span className="skeleton block w-10 h-14 shrink-0" />
                <span className="flex-1 space-y-2">
                  <span className="skeleton block h-3 w-4/5" />
                  <span className="skeleton block h-2.5 w-1/2" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <button
              type="button"
              className="lib-row-all"
              aria-current={activeVideo === ALL_CLIPS ? 'true' : undefined}
              onClick={() => onSelect(ALL_CLIPS)}
            >
              <span className="lib-row-all-icon" aria-hidden>
                <Icon name="grid" size={18} />
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-sm font-semibold text-ink">{t('All clips')}</span>
                <span className="block text-[11px] text-muted tabular">
                  {totalClips} {t('clips')} · {shown.length} {shown.length === 1 ? t('video') : t('videos')}
                </span>
              </span>
              <Icon name="chevron-right" size={14} className="text-muted" />
            </button>
            {shown.length === 0 && (
              <div className="lib-rail-empty">
                <Icon name="search" size={20} className="text-gold/70" />
                <p>{q || creator ? t('No video matches.') : t('No videos yet.')}</p>
                {(q || creator) && (
                  <button
                    type="button"
                    className="text-xs text-gold hover:text-gold-strong underline-offset-2 hover:underline"
                    onClick={() => {
                      onSearch('')
                      onCreator(null)
                    }}
                  >
                    {t('Clear filters')}
                  </button>
                )}
              </div>
            )}
            {groups ? (
              groups.map((g) => {
                const open = !closedGroups.has(g.key)
                return (
                  <section key={g.key || '(none)'} className="lib-group" data-open={open ? 'true' : 'false'}>
                    <button
                      type="button"
                      className="lib-group-head"
                      aria-expanded={open}
                      onClick={() =>
                        setClosedGroups((c) => {
                          const n = new Set(c)
                          if (n.has(g.key)) n.delete(g.key)
                          else n.add(g.key)
                          return n
                        })
                      }
                    >
                      <Icon name="chevron-right" size={14} className="lib-group-chev" />
                      <span className="flex-1 truncate text-left">{g.label}</span>
                      <span className="tabular text-muted">{g.list.length}</span>
                    </button>
                    <div className="collapse" data-open={open ? 'true' : 'false'}>
                      <ul className="lib-rows">{g.list.map(row)}</ul>
                    </div>
                  </section>
                )
              })
            ) : (
              <ul className="lib-rows stagger">{shown.map(row)}</ul>
            )}
          </>
        )}
      </nav>
    </aside>
  )
}
