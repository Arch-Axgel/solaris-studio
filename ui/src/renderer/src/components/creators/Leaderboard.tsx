import { useEffect, useState } from 'react'
import type { CreatorSummary } from '../../lib/types'
import { t } from '../../lib/i18n'
import { Avatar } from '../ui'

/** Creators as a ranked board: a clips bar and an average-score bar each,
 *  growing in with a staggered scaleX so the ranking reads at a glance. */
export default function Leaderboard({
  creators,
  selected,
  onSelect
}: {
  creators: CreatorSummary[]
  selected: number | null
  onSelect: (id: number) => void
}): JSX.Element {
  // Bars start at zero and grow once mounted (and again when the set changes).
  const [grown, setGrown] = useState(false)
  const key = creators.map((c) => c.creator_id).join(',')
  useEffect(() => {
    setGrown(false)
    // A timer rather than rAF: rAF never fires in a window that isn't
    // drawing, which would leave the bars at zero.
    const id = setTimeout(() => setGrown(true), 40)
    return () => clearTimeout(id)
  }, [key])

  const maxClips = Math.max(1, ...creators.map((c) => c.clips))
  return (
    <ol className="ops-board" aria-label={t('Leaderboard')}>
      {creators.map((c, i) => {
        const clips = c.clips / maxClips
        const score = (c.avg_score ?? 0) / 100
        return (
          <li key={c.creator_id} style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
            <button
              type="button"
              className="ops-board-row"
              aria-current={selected === c.creator_id ? 'true' : undefined}
              onClick={() => onSelect(c.creator_id)}
              data-creator={c.creator_id}
            >
              <span className="ops-board-rank tabular" data-top={i < 3 ? String(i + 1) : undefined}>
                {i + 1}
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
                  <span className="ops-board-bar" data-k="clips" style={{ transform: `scaleX(${grown ? clips : 0})` }} />
                  <span className="ops-board-bar" data-k="score" style={{ transform: `scaleX(${grown ? score : 0})` }} />
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
