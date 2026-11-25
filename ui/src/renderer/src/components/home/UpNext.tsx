import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Button, Card, EmptyState, Skeleton } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { navigate } from '../../lib/nav'
import { useLibrary } from '../../lib/stores/library'
import { useVisible } from '../../lib/stores/useVisible'
import { parseTime, relativeTime, useTicker } from './homeUtil'

interface Post {
  key: string
  clipId: number
  videoId?: string
  title: string
  at: number
  platforms: string[]
  source: 'woop' | 'library'
}

function platformLabel(p: string): string {
  const map: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X', twitter: 'X', linkedin: 'LinkedIn', threads: 'Threads' }
  return map[p.toLowerCase()] ?? p
}

/** "Up next to publish": the next five scheduled posts, from WoopSocial
 *  (only when it is set up) and from clips with a scheduled time. */
export default function UpNext({ active, className }: { active: boolean; className?: string }): JSX.Element {
  const visible = useVisible(active)
  const { videos, loadClipsFor } = useLibrary()
  const [woop, setWoop] = useState<Post[] | null>(null)
  const [lib, setLib] = useState<Post[] | null>(null)
  const now = useTicker(visible, 30_000)

  // Provider-gated: ask whether WoopSocial is on before reading its schedule.
  useEffect(() => {
    if (!visible) return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const st = await api.woopSocialStatus()
        if (!st.enabled || !st.has_key) {
          if (alive) setWoop([])
          return
        }
        const r = await api.woopSocialSchedule()
        if (!alive) return
        const byClip = new Map<string, Post>()
        for (const p of r.posts) {
          const at = parseTime(p.scheduled_for)
          if (!Number.isFinite(at) || at < Date.now() - 60_000) continue
          if (/fail|skip|cancel/i.test(p.state)) continue
          const key = `${p.clip_id}@${p.scheduled_for}`
          const prev = byClip.get(key)
          if (prev) prev.platforms.push(platformLabel(p.platform))
          else byClip.set(key, { key: `w${key}`, clipId: p.clip_id, title: p.title, at, platforms: [platformLabel(p.platform)], source: 'woop' })
        }
        setWoop([...byClip.values()])
      } catch {
        if (alive) setWoop([])
      }
    }
    void load()
    const id = setInterval(() => void load(), 120_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [visible])

  // Clips that carry their own scheduled time, among the newest videos.
  const ids = useMemo(
    () =>
      (videos ?? [])
        .filter((v) => v.clip_count > 0)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 24)
        .map((v) => v.video_id),
    [videos]
  )
  useEffect(() => {
    if (!visible) return
    if (videos !== null && ids.length === 0) {
      setLib([])
      return
    }
    let alive = true
    void loadClipsFor(ids).then((by) => {
      if (!alive) return
      const out: Post[] = []
      for (const id of ids)
        for (const c of by[id] ?? []) {
          const at = parseTime(c.scheduled_for)
          if (Number.isFinite(at) && at > Date.now() - 60_000)
            out.push({ key: `c${c.id}`, clipId: c.id, videoId: id, title: c.title || c.hook, at, platforms: [], source: 'library' })
        }
      setLib(out)
    })
    return () => {
      alive = false
    }
  }, [ids, visible, videos, loadClipsFor])

  const posts = useMemo(() => {
    if (woop === null && lib === null) return null
    const seen = new Set<number>()
    const videoOf = new Map((lib ?? []).map((p) => [p.clipId, p.videoId]))
    const all = [...(woop ?? []).map((p) => ({ ...p, videoId: p.videoId ?? videoOf.get(p.clipId) })), ...(lib ?? [])].sort((a, b) => a.at - b.at)
    const out: Post[] = []
    for (const p of all) {
      if (p.source === 'library' && seen.has(p.clipId)) continue
      seen.add(p.clipId)
      out.push(p)
      if (out.length === 5) break
    }
    return out
  }, [woop, lib])

  return (
    <Card className={`home-upnext ${className ?? ''}`} aria-labelledby="home-upnext-title">
      <div className="home-tile-head">
        <div>
          <p className="t-micro">{t('Up next to publish')}</p>
          <h2 id="home-upnext-title" className="t-md text-ink">
            {t('On the schedule')}
          </h2>
        </div>
        <Button variant="subtle" size="sm" icon="calendar" onClick={() => navigate({ page: 'calendar' })}>
          {t('Open calendar')}
        </Button>
      </div>
      {posts === null ? (
        <div className="space-y-2 mt-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} h={48} radius={12} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          compact
          illustration="calendar"
          title={t('Nothing scheduled')}
          body={t('Schedule clips from the Clip Editor and they line up here.')}
        />
      ) : (
        <ol className="home-upnext-list stagger">
          {posts.map((p, i) => {
            const d = new Date(p.at)
            return (
              <li key={p.key} style={{ '--i': i } as React.CSSProperties}>
                <button
                  type="button"
                  className="home-upnext-row"
                  onClick={() =>
                    p.videoId ? navigate({ page: 'studio', params: { videoId: p.videoId, clipId: p.clipId } }) : navigate({ page: 'calendar' })
                  }
                >
                  <span className="home-upnext-date" aria-hidden>
                    <span className="home-upnext-day">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    <span className="home-upnext-num">{d.getDate()}</span>
                  </span>
                  <img className="home-upnext-thumb" src={api.clipFrameUrl(p.clipId, 1)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">{p.title || t('Untitled')}</span>
                    <span className="block text-xs text-muted truncate">
                      {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {relativeTime(p.at, now)}
                      {p.platforms.length > 0 && ` · ${p.platforms.join(', ')}`}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} className="text-muted shrink-0" />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
