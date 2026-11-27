import { useEffect, useMemo, useState } from 'react'
import type { CreatorSummary } from '../../lib/types'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { Avatar } from '../ui'

/** Creators as a ranked board: a clips bar and an average-score bar each,
 *  growing in with a staggered scaleX so the ranking reads at a glance.
 *
 *  The board always ranks by clips, then average score, whatever order the
 *  list beside it is sorted in: an alphabetical "ranking" would hand out
 *  medals by name. Ties share a rank, and a medal goes only to someone who
 *  actually has clips. */
export default function Leaderboard({
  creators,
  selected,
  onSelect
}: {
  creators: CreatorSummary[]
  selected: number | null
  onSelect: (id: number | null) => void
}): JSX.Element {
  // Bars start at zero and grow once mounted (and again when the set changes).
  const [grown, setGrown] = useState(false)
  const ranked = useMemo(
    () =>
      creators
        .slice()
        .sort((a, b) => b.clips - a.clips || (b.avg_score ?? -1) - (a.avg_score ?? -1) || a.display_name.localeCompare(b.display_name)),
    [creators]
  )
  const key = ranked.map((c) => c.creator_id).join(',')
  useEffect(() => {
    setGrown(false)
    // A timer rather than rAF: rAF never fires in a window that isn't
    // drawing, which would leave the bars at zero.
    const id = setTimeout(() => setGrown(true), 40)
    return () => clearTimeout(id)
  }, [key])

  // Standard competition ranking: 1, 2, 2, 4.
  const ranks: number[] = []
  ranked.forEach((c, i) => {
    const prev = ranked[i - 1]
    ranks.push(prev && prev.clips === c.clips && (prev.avg_score ?? -1) === (c.avg_score ?? -1) ? ranks[i - 1] : i + 1)
  })

  const maxClips = Math.max(1, ...ranked.map((c) => c.clips))
  const nobody = ranked.every((c) => c.clips === 0)
  return (
    <div className="space-y-2">
      {nobody && ranked.length > 0 && (
        <p className="ops-board-note">
          <Icon name="trend-up" size={14} />
          {t('Process some videos to see a ranking.')}
        </p>
      )}
      <ol className="ops-board" aria-label={t('Leaderboard')}>
        {ranked.map((c, i) => {
          const clips = c.clips / maxClips
          const score = (c.avg_score ?? 0) / 100
          const rank = ranks[i]
          const medal = c.clips > 0 && rank <= 3 ? String(rank) : undefined
          return (
            <li key={c.creator_id} style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
              <button
                type="button"
                className="ops-board-row"
                aria-current={selected === c.creator_id ? 'true' : undefined}
                onClick={() => onSelect(selected === c.creator_id ? null : c.creator_id)}
                data-creator={c.creator_id}
              >
                <span className="ops-board-rank tabular" data-top={medal}>
                  {nobody ? '–' : rank}
                </span>
                <Avatar seed={c.creator_id} name={c.display_name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-ink">{c.display_name}</span>
                    <span className="ml-auto text-xs text-muted tabular shrink-0">
                      {c.clips} {t(c.clips === 1 ? 'clip' : 'clips')}
                      {c.avg_score != null && ` · ${c.avg_score}`}
                    </span>
                  </span>
                  <span className="ops-board-bars" aria-hidden>
                    <span className="ops-board-track">
                      <span className="ops-board-bar" data-k="clips" style={{ transform: `scaleX(${grown ? clips : 0})` }} />
                    </span>
                    <span className="ops-board-track" data-k="score">
                      <span className="ops-board-bar" data-k="score" style={{ transform: `scaleX(${grown ? score : 0})` }} />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
