import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import ScoreBadge from '../ScoreBadge'
import { Button, Card, EmptyState, Segmented, Skeleton, Tooltip, toast } from '../ui'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { navigate, openCreate } from '../../lib/nav'
import { invalidateLibrary, useRecentClips } from '../../lib/stores/library'
import type { Clip } from '../../lib/types'
import { RECENT_FILTER_KEY, readKey, tf, timecode, writeKey } from './homeUtil'
import { defaultPosterT, useHoverPreview } from '../library/HoverPreview'
import { motionReduced } from '../../lib/motion'

type RecentClip = Clip & { video_id: string; video_title: string }
type Filter = 'newest' | 'best' | 'unexported' | 'scheduled'
const FILTERS: Filter[] = ['newest', 'best', 'unexported', 'scheduled']

function openClip(c: RecentClip): void {
  navigate({ page: 'studio', params: { videoId: c.video_id, clipId: c.id } })
}

/** One 9:16 tile: poster, frame scrub, muted playback after 400ms, and quick
 *  actions on hover. */
function ClipTile({ clip, index, onChanged }: { clip: RecentClip; index: number; onChanged: () => void }): JSX.Element {
  const len = Math.max(0, clip.end_s - clip.start_s)
  const { ref, posterUrl, playing } = useHoverPreview(clip.id, { scrub: true, durationS: len })
  const [exported, setExported] = useState(Boolean(clip.exported_at))
  const [tightening, setTightening] = useState(false)
  const [broken, setBroken] = useState(false)
  useEffect(() => setExported(Boolean(clip.exported_at)), [clip.exported_at])

  const toggleStar = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const next = !exported
    setExported(next)
    try {
      await api.patchClip(clip.id, { exported: next })
      invalidateLibrary(clip.video_id)
      onChanged()
    } catch (err) {
      setExported(!next)
      toast({ title: t('Couldn’t save that'), body: err instanceof Error ? err.message : String(err), tone: 'error' })
    }
  }

  const tighten = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    setTightening(true)
    try {
      const r = await api.tightenClip(clip.id)
      if (r.cuts === 0 || r.removed_seconds < 0.3) {
        toast({ title: t('Already tight'), body: t('No dead air or filler words worth cutting.'), tone: 'success', icon: 'check' })
      } else {
        toast({
          title: tf('Could cut {s}s', { s: r.removed_seconds.toFixed(1) }),
          body: tf('{n} pauses and fillers found. Open the clip to review and apply the cuts.', { n: r.cuts }),
          tone: 'info',
          icon: 'scissors',
          action: { label: t('Open in Clip Editor'), run: () => openClip(clip) }
        })
      }
    } catch (err) {
      toast({ title: t('Couldn’t check this clip'), body: err instanceof Error ? err.message : String(err), tone: 'error' })
    } finally {
      setTightening(false)
    }
  }

  const title = clip.title || clip.hook || t('Untitled')
  return (
    <article
      className="home-tile"
      style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
      data-playing={playing ? 'true' : 'false'}
      data-clip-id={clip.id}
    >
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        className="home-tile-media"
        onClick={() => openClip(clip)}
        aria-label={tf('Open “{title}” in the Clip Editor', { title })}
      >
        {broken ? (
          <span className="home-tile-fallback" aria-hidden>
            <Icon name="film" size={28} />
          </span>
        ) : posterUrl ? (
          <img src={posterUrl} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <video
            src={`${api.mediaUrl(clip.id)}#t=${defaultPosterT(len).toFixed(2)}`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden
            className="home-tile-firstframe"
            onError={() => setBroken(true)}
          />
        )}
        <span className="home-tile-score">
          <ScoreBadge score={clip.score} />
        </span>
        {clip.scheduled_for && (
          <span className="home-tile-sched" title={t('Scheduled')}>
            <Icon name="calendar" size={12} />
          </span>
        )}
        <span className="home-tile-time t-mono">{timecode(len)}</span>
        <span className="home-tile-caption scrim-bottom">
          <span className="home-tile-title">{title}</span>
          <span className="home-tile-sub">{clip.video_title}</span>
        </span>
      </button>
      <div className="home-tile-actions" role="group" aria-label={t('Quick actions')}>
        <Tooltip content={t('Open')}>
          <button type="button" className="home-tile-act" aria-label={t('Open')} onClick={() => openClip(clip)}>
            <Icon name="eye" size={15} />
          </button>
        </Tooltip>
        <Tooltip content={exported ? t('Exported: click to unmark') : t('Mark as exported')}>
          <button
            type="button"
            className="home-tile-act"
            data-on={exported ? 'true' : 'false'}
            aria-pressed={exported}
            aria-label={t('Exported')}
            onClick={(e) => void toggleStar(e)}
          >
            <Icon name="star" size={15} />
          </button>
        </Tooltip>
        <Tooltip content={t('Tighten: find dead air to cut')}>
          <button type="button" className="home-tile-act" aria-label={t('Tighten')} disabled={tightening} onClick={(e) => void tighten(e)}>
            {tightening ? <span className="home-spinner" aria-hidden /> : <Icon name="scissors" size={15} />}
          </button>
        </Tooltip>
        <Tooltip content={t('Publish')}>
          <button type="button" className="home-tile-act" aria-label={t('Publish')} onClick={() => openClip(clip)}>
            <Icon name="send" size={15} />
          </button>
        </Tooltip>
      </div>
    </article>
  )
}

/** "Fresh clips": the newest 24 clips as a scroll-snap strip of 9:16 tiles. */
export default function RecentClips({ className }: { className?: string }): JSX.Element {
  const { clips } = useRecentClips(24)
  const [filter, setFilterState] = useState<Filter>(() => {
    const v = readKey(RECENT_FILTER_KEY)
    return v && (FILTERS as string[]).includes(v) ? (v as Filter) : 'newest'
  })
  const [, bump] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const setFilter = (f: string): void => {
    setFilterState(f as Filter)
    writeKey(RECENT_FILTER_KEY, f)
    strip.current?.scrollTo({ left: 0, behavior: motionReduced() ? 'auto' : 'smooth' })
  }

  const shown = useMemo(() => {
    const list = [...(clips ?? [])]
    if (filter === 'best') list.sort((a, b) => b.score - a.score)
    if (filter === 'unexported') return list.filter((c) => !c.exported_at)
    if (filter === 'scheduled') return list.filter((c) => c.scheduled_for).sort((a, b) => (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? ''))
    return list
  }, [clips, filter])

  const updateEdges = (): void => {
    const el = strip.current
    if (!el) return
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
  }
  useEffect(() => {
    updateEdges()
    const el = strip.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown.length])

  const page = (dir: 1 | -1): void => {
    const el = strip.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: motionReduced() ? 'auto' : 'smooth' })
  }

  return (
    <Card className={`home-recent ${className ?? ''}`} aria-labelledby="home-recent-title">
      <div className="home-tile-head">
        <div className="min-w-0">
          <p className="t-micro">{t('Fresh clips')}</p>
          <h2 id="home-recent-title" className="t-md text-ink">
            {t('Newest from your videos')}
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Segmented
            size="sm"
            ariaLabel={t('Filter clips')}
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'newest', label: t('Newest') },
              { id: 'best', label: t('Best'), icon: 'flame' },
              { id: 'unexported', label: t('Not exported') },
              { id: 'scheduled', label: t('Scheduled'), icon: 'calendar' }
            ]}
          />
          <Button variant="subtle" size="sm" iconRight="arrow-right" className="nudge" onClick={() => navigate({ page: 'studio' })}>
            {t('All clips')}
          </Button>
        </div>
      </div>

      <div className="home-strip-wrap" data-start={edges.start ? 'true' : 'false'} data-end={edges.end ? 'true' : 'false'}>
        {!edges.start && (
          <button type="button" className="home-strip-arrow home-strip-prev" aria-label={t('Previous clips')} onClick={() => page(-1)}>
            <Icon name="chevron-left" size={18} />
          </button>
        )}
        <div ref={strip} className="home-strip stagger" onScroll={updateEdges} tabIndex={-1}>
          {clips === null
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="home-tile home-tile-skel" style={{ '--i': i } as React.CSSProperties}>
                  <Skeleton h="100%" radius={14} />
                </div>
              ))
            : shown.map((c, i) => <ClipTile key={c.id} clip={c} index={i} onChanged={() => bump((n) => n + 1)} />)}
          {clips !== null && shown.length === 0 && (
            <div className="home-strip-empty">
              <EmptyState
                compact
                illustration={filter === 'scheduled' ? 'calendar' : 'film'}
                title={
                  clips.length === 0
                    ? t('No clips yet')
                    : filter === 'unexported'
                      ? t('Everything here is exported')
                      : filter === 'scheduled'
                        ? t('Nothing scheduled')
                        : t('No clips match')
                }
                body={clips.length === 0 ? t('Clips appear here the moment a video finishes.') : undefined}
                action={
                  clips.length === 0 ? (
                    <Button variant="accent" size="sm" icon="plus" onClick={() => openCreate()}>
                      {t('Make clips')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
        {!edges.end && (
          <button type="button" className="home-strip-arrow home-strip-next" aria-label={t('More clips')} onClick={() => page(1)}>
            <Icon name="chevron-right" size={18} />
          </button>
        )}
      </div>
    </Card>
  )
}
