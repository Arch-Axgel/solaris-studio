import { memo, useCallback, useEffect, useRef } from 'react'
import { attachTilt, useEffectsReduced, useReducedMotion } from '../../lib/motion'
import type { Clip } from '../../lib/types'
import ClipCard from '../ClipCard'

export type Density = 's' | 'm' | 'l'

/** The clip grid (spec 4.6): ClipCards that reveal as they scroll in, tilt
 *  toward the pointer, and collapse away when deleted.
 *
 *  Two wrappers per card on purpose: `.reveal` animates transform with a
 *  `both` fill, which would pin `transform: none` over the tilt's own
 *  transform, so the tilt lives one level down. */

interface ItemProps {
  clip: Clip
  index: number
  selected: boolean
  checked: boolean
  selecting: boolean
  canPublish: boolean
  onCardClick: (clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => void
  onCheck: (clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => void
  onOpen: (clip: Clip) => void
  onDelete: (clip: Clip) => void
  onToggleExported: (clip: Clip) => void
  onPublish: (clip: Clip) => void
  registerPoster: (id: number, el: HTMLDivElement | null) => void
  tilt: boolean
}

const GridItem = memo(function GridItem({
  clip,
  index,
  selected,
  checked,
  selecting,
  canPublish,
  onCardClick,
  onCheck,
  onOpen,
  onDelete,
  onToggleExported,
  onPublish,
  registerPoster,
  tilt
}: ItemProps): JSX.Element {
  const tiltRef = useRef<HTMLDivElement>(null)
  const posterRef = useCallback((el: HTMLDivElement | null) => registerPoster(clip.id, el), [registerPoster, clip.id])
  useEffect(() => {
    const el = tiltRef.current
    if (!el || !tilt) return
    return attachTilt(el)
  }, [tilt])
  return (
    <div className="lib-grid-item reveal" data-clip-id={clip.id} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <div ref={tiltRef} className={tilt ? 'lib-tilt tilt' : 'lib-tilt'}>
        <ClipCard
          clip={clip}
          selected={selected}
          checked={checked}
          selecting={selecting}
          onClick={(e) => onCardClick(clip, e)}
          onCheck={(e) => onCheck(clip, e)}
          onOpen={() => onOpen(clip)}
          onDelete={() => onDelete(clip)}
          onToggleExported={() => onToggleExported(clip)}
          onPublish={canPublish ? () => onPublish(clip) : undefined}
          posterRef={posterRef}
        />
      </div>
    </div>
  )
})

export default function ClipGrid({
  clips,
  density,
  selectedClip,
  checked,
  selecting,
  canPublish,
  onCardClick,
  onCheck,
  onOpen,
  onDelete,
  onToggleExported,
  onPublish,
  registerPoster
}: {
  clips: Clip[]
  density: Density
  selectedClip: number | null
  checked: Set<number>
  selecting: boolean
  canPublish: boolean
  onCardClick: (clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => void
  onCheck: (clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => void
  onOpen: (clip: Clip) => void
  onDelete: (clip: Clip) => void
  onToggleExported: (clip: Clip) => void
  onPublish: (clip: Clip) => void
  registerPoster: (id: number, el: HTMLDivElement | null) => void
}): JSX.Element {
  const reduced = useReducedMotion()
  const effects = useEffectsReduced()
  const tilt = !reduced && !effects
  return (
    <div className={`lib-grid lib-grid-${density}`} role="list" aria-label="Clips">
      {clips.map((clip, i) => (
        <GridItem
          key={clip.id}
          clip={clip}
          index={i}
          selected={clip.id === selectedClip}
          checked={checked.has(clip.id)}
          selecting={selecting}
          canPublish={canPublish}
          onCardClick={onCardClick}
          onCheck={onCheck}
          onOpen={onOpen}
          onDelete={onDelete}
          onToggleExported={onToggleExported}
          onPublish={onPublish}
          registerPoster={registerPoster}
          tilt={tilt}
        />
      ))}
    </div>
  )
}

/** Collapse a card away (height and opacity) before it leaves the grid. */
export function collapseCard(root: ParentNode, clipId: number, reduced: boolean): Promise<void> {
  const el = root.querySelector<HTMLElement>(`.lib-grid-item[data-clip-id="${clipId}"]`)
  if (!el || reduced || typeof el.animate !== 'function') return Promise.resolve()
  const h = el.offsetHeight
  el.style.pointerEvents = 'none'
  const anim = el.animate(
    [
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', maxHeight: `${h}px` },
      { opacity: 0, transform: 'scale(.86)', filter: 'blur(6px)', maxHeight: `${h}px`, offset: 0.55 },
      { opacity: 0, transform: 'scale(.6)', filter: 'blur(6px)', maxHeight: '0px' }
    ],
    { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
  )
  return anim.finished.then(
    () => undefined,
    () => undefined
  )
}
