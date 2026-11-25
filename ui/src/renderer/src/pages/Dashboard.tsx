import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/icons'
import AddVideos from '../components/queue/AddVideos'
import ProcessingBar from '../components/ProcessingBar'
import PresetChips, { presetFromGenerateBar, setPreset, type PresetId } from '../components/home/PresetChips'
import { duration, parseTime, relativeTime, tf } from '../components/home/homeUtil'
import { Button, Card, EmptyState, PageHeader, Skeleton, StatusChip, toast } from '../components/ui'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { flyTo } from '../lib/motion'
import { navigate, useLayer } from '../lib/nav'
import { useLibrary } from '../lib/stores/library'
import { refreshQueue } from '../lib/stores/queueStore'
import { useVisible } from '../lib/stores/useVisible'
import type { Video } from '../lib/types'

type Chip = 'running' | 'queued' | 'done' | 'failed' | 'paused' | 'stopping' | 'idle'

function chipFor(status: string): { status: Chip; label?: string } {
  if (status === 'done') return { status: 'done' }
  if (status === 'failed') return { status: 'failed' }
  if (status === 'cancelled') return { status: 'idle', label: t('Stopped') }
  if (status === 'queued' || status === 'pending') return { status: 'queued' }
  return { status: 'running', label: status ? status.charAt(0).toUpperCase() + status.slice(1) : undefined }
}

/** One row of "Recently processed": poster from the first clip, title,
 *  channel, status, clip count, process time. */
function RecentRow({ video, poster, index, onOpen }: { video: Video; poster: number | null | undefined; index: number; onOpen: () => void }): JSX.Element {
  const chip = chipFor(video.status)
  const [broken, setBroken] = useState(false)
  const at = parseTime(video.created_at)
  return (
    <li style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <button type="button" className="create-row" onClick={onOpen} aria-label={tf('Open “{title}” in the Clip Editor', { title: video.title || video.video_id })}>
        <span className="create-row-thumb">
          {poster === undefined ? (
            <Skeleton h="100%" radius={8} />
          ) : poster && !broken ? (
            <img src={api.clipFrameUrl(poster, 1)} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <Icon name="film" size={18} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink truncate font-medium">{video.title || video.video_id}</span>
          <span className="block text-xs text-muted truncate">
            {video.creator_name || video.channel_name || t('Unknown channel')}
            {Number.isFinite(at) ? ` · ${relativeTime(at)}` : ''}
          </span>
        </span>
        <StatusChip status={chip.status} label={chip.label} />
        <span className="create-row-stat tabular" title={t('Clips')}>
          <Icon name="film" size={12} />
          {video.clip_count}
        </span>
        <span className="create-row-stat tabular" title={t('Time')}>
          <Icon name="clock" size={12} />
          {duration(video.process_seconds)}
        </span>
        <Icon name="chevron-right" size={14} className="text-muted shrink-0 create-row-chev" />
      </button>
    </li>
  )
}

/** Create (spec 4.2): the full-page generate studio, for people who want
 *  every option on screen. The Generate bar (AddVideos) is mounted unchanged. */
export default function Dashboard({
  onOpenInStudio,
  active = true
}: {
  onOpenInStudio: (videoId: string, clipId?: number) => void
  active?: boolean
}): JSX.Element {
  const visible = useVisible(active)
  const { videos, loadClipsFor } = useLibrary()
  const [model, setModel] = useState<string | null>(null)
  const [barKey, setBarKey] = useState(0)
  const [barPreset, setBarPreset] = useState<PresetId>(presetFromGenerateBar)
  const [posters, setPosters] = useState<Record<string, number | null>>({})
  const surface = useRef<HTMLDivElement>(null)

  // The bar's own switches may have been changed since: show what they say.
  useEffect(() => {
    if (visible) setBarPreset(presetFromGenerateBar())
  }, [visible])

  // The Create sheet runs its own Generate bar on the same saved draft. When
  // this page comes back (or the sheet closes over it), remount ours so it
  // re-reads that draft instead of showing rows the sheet already queued.
  const sheetOpen = useLayer('create').open
  const wasShown = useRef(visible && !sheetOpen)
  useEffect(() => {
    const shown = visible && !sheetOpen
    if (shown && !wasShown.current) setBarKey((k) => k + 1)
    wasShown.current = shown
  }, [visible, sheetOpen])

  useEffect(() => {
    if (!visible) return
    let alive = true
    api
      .settings()
      .then((s) => alive && setModel(s.model))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [visible])

  const recent = useMemo(
    () => [...(videos ?? [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 10),
    [videos]
  )
  const recentKey = recent.map((v) => `${v.video_id}:${v.clip_count}`).join(',')
  useEffect(() => {
    if (!visible) return
    const ids = recent.filter((v) => v.clip_count > 0).map((v) => v.video_id)
    if (ids.length === 0) return
    let alive = true
    void loadClipsFor(ids).then((by) => {
      if (!alive) return
      const next: Record<string, number | null> = {}
      for (const id of ids) {
        const list = [...(by[id] ?? [])].sort((a, b) => b.score - a.score)
        next[id] = list[0]?.id ?? null
      }
      setPosters((p) => ({ ...p, ...next }))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey, visible])

  const onAdded = (): void => {
    if (surface.current) flyTo(surface.current, document.querySelector('[data-fly-target="queue"]'))
    refreshQueue(0)
    toast({
      title: t('Added to the queue'),
      body: t('Clips start appearing as each video finishes.'),
      tone: 'success',
      icon: 'layers',
      action: { label: t('View queue'), run: () => navigate({ page: 'queue' }) }
    })
  }

  return (
    <div className="create">
      <PageHeader
        eyebrow={t('MAKE')}
        title={t('Create')}
        subtitle={t('Paste links or drop files. Pick a preset, fine-tune, generate.')}
        vtName="page-title"
        actions={
          <>
            {model && (
              <button type="button" className="create-model" onClick={() => navigate({ page: 'models' })} title={t('AI models')}>
                <span className="create-model-dot" aria-hidden />
                <span className="text-muted">{t('Model')}</span>
                <span className="text-gold font-medium truncate">{model}</span>
              </button>
            )}
            <Button variant="ghost" icon="layers" onClick={() => navigate({ page: 'queue' })}>
              {t('Open queue')}
            </Button>
          </>
        }
      />

      <section className="create-presets" aria-label={t('Preset')}>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="t-micro shrink-0">{t('Start from')}</p>
          <PresetChips
            value={barPreset}
            onChange={(id) => {
              setBarPreset(id)
              setPreset(id)
            }}
            applyToGenerateBar
            onApplied={() => setBarKey((k) => k + 1)}
          />
        </div>
        <p className="text-xs text-muted mt-2">
          {t('A preset sets how new videos in the list start. Videos already listed keep their own settings, and every switch below can still be changed.')}
        </p>
      </section>

      <div ref={surface} className="card create-surface">
        <div className="create-surface-scroll">
          <AddVideos key={barKey} onAdded={onAdded} />
        </div>
      </div>

      <div className="create-progress">
        <ProcessingBar />
      </div>

      <Card as="section" className="create-recent" aria-labelledby="create-recent-title">
        <div className="home-tile-head">
          <div>
            <p className="t-micro">{t('Recently processed')}</p>
            <h2 id="create-recent-title" className="t-md text-ink">
              {t('Your latest videos')}
            </h2>
          </div>
          <Button variant="subtle" size="sm" iconRight="arrow-right" className="nudge" onClick={() => navigate({ page: 'studio' })}>
            {t('See all in Clip Editor')}
          </Button>
        </div>
        {videos === null ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} h={56} radius={12} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState compact illustration="film" title={t('No videos yet')} body={t('Nothing yet - paste a link above to make your first clips.')} />
        ) : (
          <ul className="create-list stagger">
            {recent.map((v, i) => (
              <RecentRow
                key={v.video_id}
                video={v}
                index={i}
                poster={v.clip_count > 0 ? posters[v.video_id] : null}
                onOpen={() => onOpenInStudio(v.video_id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
