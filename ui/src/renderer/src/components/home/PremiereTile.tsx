import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import ScoreBadge from '../ScoreBadge'
import { Button, Card, Skeleton } from '../ui'
import { t } from '../../lib/i18n'
import { attachTilt } from '../../lib/motion'
import { navigate } from '../../lib/nav'
import { useRecentClips } from '../../lib/stores/library'
import { parseTime, timecode } from './homeUtil'
import { api } from '../../lib/api'
import { defaultPosterT, useHoverPreview } from '../library/HoverPreview'

const WEEK = 7 * 86_400_000

/** "Premiere: Best this week": the top-scoring clip of the last 7 days, on a
 *  velvet stage. Plays muted on hover only (never on its own). */
export default function PremiereTile({ className }: { className?: string }): JSX.Element | null {
  const { clips } = useRecentClips(24)
  const best = useMemo(() => {
    if (!clips) return undefined
    const since = Date.now() - WEEK
    const week = clips.filter((c) => {
      const at = parseTime(c.created_at)
      return Number.isFinite(at) ? at >= since : false
    })
    return [...(week.length ? week : [])].sort((a, b) => b.score - a.score)[0] ?? null
  }, [clips])

  const len = best ? Math.max(0, best.end_s - best.start_s) : 0
  const { ref, posterUrl, playing } = useHoverPreview(best?.id ?? 0, { scrub: false, durationS: len })
  const tiltRef = useRef<HTMLDivElement>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [best?.id])
  useEffect(() => {
    const el = tiltRef.current
    if (!el || !best) return
    return attachTilt(el)
  }, [best])

  if (best === undefined) {
    return (
      <Card className={`home-premiere ${className ?? ''}`} padded={false}>
        <Skeleton h="100%" radius={16} />
      </Card>
    )
  }
  if (best === null) {
    return (
      <Card variant="sunken" className={`home-premiere home-premiere-empty ${className ?? ''}`}>
        <span className="home-premiere-reel" aria-hidden>
          <Icon name="clapper" size={30} />
        </span>
        <p className="t-micro">{t('Premiere')}</p>
        <p className="t-md text-ink">{t('Best this week')}</p>
        <p className="text-sm text-muted">{t('Your top clip from the last 7 days takes the stage here.')}</p>
      </Card>
    )
  }

  const title = best.title || best.hook || t('Untitled')
  const open = (): void => navigate({ page: 'studio', params: { videoId: best.video_id, clipId: best.id } })
  return (
    <Card padded={false} className={`home-premiere ${className ?? ''}`} aria-label={t('Premiere: best this week')}>
      <div ref={tiltRef} className="home-premiere-stage tilt" data-playing={playing ? 'true' : 'false'}>
        <div ref={ref as React.Ref<HTMLDivElement>} className="home-premiere-media">
          {broken ? (
            <span className="home-tile-fallback" aria-hidden>
              <Icon name="film" size={32} />
            </span>
          ) : posterUrl ? (
            <img src={posterUrl} alt="" draggable={false} onError={() => setBroken(true)} />
          ) : (
            <video
              src={`${api.mediaUrl(best.id)}#t=${defaultPosterT(len).toFixed(2)}`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              aria-hidden
              className="home-tile-firstframe"
              onError={() => setBroken(true)}
            />
          )}
        </div>
        <span className="home-premiere-letterbox" aria-hidden />
        <div className="home-premiere-top">
          <span className="home-premiere-eyebrow">
            <Icon name="flame" size={13} />
            {t('Premiere · Best this week')}
          </span>
          <ScoreBadge score={best.score} />
        </div>
        <div className="home-premiere-bottom scrim-bottom">
          <p className="t-md text-foil home-premiere-title">{title}</p>
          <p className="text-xs text-muted truncate">
            {best.video_title} · <span className="t-mono">{timecode(len)}</span>
          </p>
          <Button variant="gold" size="sm" icon="scissors" className="mt-2" onClick={open}>
            {t('Open in Clip Editor')}
          </Button>
        </div>
        {!playing && (
          <span className="home-premiere-play" aria-hidden>
            <Icon name="play" size={18} />
          </span>
        )}
      </div>
    </Card>
  )
}
