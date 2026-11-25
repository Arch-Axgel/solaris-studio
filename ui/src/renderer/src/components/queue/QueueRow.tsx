import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { QueueJob } from '../../lib/types'
import { Icon } from '../icons'
import { t } from '../../lib/i18n'

/** "Up next" with drag-to-reorder.
 *
 *  Each waiting job is wrapped in a row with a grip. Dragging the grip lifts
 *  the row, the others slide out of its way and a dashed slot shows where it
 *  lands. On drop the page sends the move to the server (the server stays the
 *  authority); the dropped order is only held on screen while that request
 *  is in flight, then the next snapshot replaces it.
 *
 *  Keyboard: Alt+↑ / Alt+↓ on a focused row (or its grip) moves it one place. */

interface Drag {
  id: number
  from: number
  over: number
  dy: number
}

interface Measure {
  tops: number[]
  heights: number[]
  startY: number
  gap: number
}

export default function QueueRows({
  jobs,
  renderItem,
  onMove,
  disabled = false
}: {
  jobs: QueueJob[]
  renderItem: (job: QueueJob, index: number) => React.ReactNode
  /** Move a job from one 0-based position to another. */
  onMove: (job: QueueJob, from: number, to: number) => Promise<void>
  disabled?: boolean
}): JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<number[] | null>(null)
  const [settling, setSettling] = useState(false)
  const [dropped, setDropped] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')
  const rows = useRef(new Map<number, HTMLDivElement>())
  const list = useRef<HTMLDivElement>(null)
  const measure = useRef<Measure | null>(null)

  // Hold the dropped order only while the move is in flight.
  const ordered: QueueJob[] = pending
    ? (pending.map((id) => jobs.find((j) => j.id === id)).filter(Boolean) as QueueJob[]).concat(
        jobs.filter((j) => !pending.includes(j.id))
      )
    : jobs

  // A drop re-orders the DOM and clears every transform in the same frame;
  // with transitions on, the rows would animate from the wrong place.
  useLayoutEffect(() => {
    if (!settling) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
    return () => cancelAnimationFrame(id)
  }, [settling])

  useEffect(() => {
    if (dropped === null) return
    const id = setTimeout(() => setDropped(null), 700)
    return () => clearTimeout(id)
  }, [dropped])

  const commit = async (job: QueueJob, from: number, to: number): Promise<void> => {
    if (from === to) return
    const ids = ordered.map((j) => j.id)
    ids.splice(from, 1)
    ids.splice(to, 0, job.id)
    setPending(ids)
    setDropped(job.id)
    setAnnounce(`${t('Moved to position')} ${to + 1} ${t('of')} ${ordered.length}`)
    try {
      await onMove(job, from, to)
    } finally {
      setPending(null)
    }
  }

  const start = (e: React.PointerEvent<HTMLButtonElement>, job: QueueJob, from: number): void => {
    if (disabled || e.button !== 0 || ordered.length < 2) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const base = list.current?.getBoundingClientRect().top ?? 0
    const tops: number[] = []
    const heights: number[] = []
    ordered.forEach((j) => {
      const r = rows.current.get(j.id)?.getBoundingClientRect()
      tops.push((r?.top ?? 0) - base)
      heights.push(r?.height ?? 0)
    })
    const gap = tops.length > 1 ? Math.max(0, tops[1] - tops[0] - heights[0]) : 8
    measure.current = { tops, heights, startY: e.clientY, gap }
    setDrag({ id: job.id, from, over: from, dy: 0 })
  }

  const move = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const m = measure.current
    if (!drag || !m) return
    const dy = e.clientY - m.startY
    const centre = m.tops[drag.from] + m.heights[drag.from] / 2 + dy
    let over = 0
    m.tops.forEach((top, i) => {
      if (i === drag.from) return
      if (top + m.heights[i] / 2 < centre) over += 1
    })
    setDrag({ ...drag, dy, over })
  }

  const end = (): void => {
    // pointerup and lostpointercapture both land here; the ref is cleared
    // synchronously so the second call is a no-op.
    if (!drag || !measure.current) return
    const { from, over, id } = drag
    const job = ordered.find((j) => j.id === id)
    setSettling(true)
    setDrag(null)
    measure.current = null
    if (job && over !== from) void commit(job, from, over)
  }

  const keys = (e: React.KeyboardEvent<HTMLElement>, job: QueueJob, i: number): void => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    // Only the row itself or its grip: Alt+↓ opens a native select inside.
    const target = e.target as HTMLElement
    if (target !== e.currentTarget && !target.closest('.ops-grip')) return
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    const to = e.key === 'ArrowUp' ? i - 1 : i + 1
    if (to < 0 || to >= ordered.length) return
    setSettling(true)
    void commit(job, i, to)
  }

  const shift = (i: number): number => {
    const m = measure.current
    if (!drag || !m || i === drag.from) return 0
    const h = m.heights[drag.from] + m.gap
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -h
    if (drag.over < drag.from && i >= drag.over && i < drag.from) return h
    return 0
  }

  // Where the dashed slot sits: the space the row will land in.
  let slot: { top: number; height: number } | null = null
  if (drag && measure.current) {
    const m = measure.current
    const h = m.heights[drag.from]
    const top =
      drag.over > drag.from
        ? m.tops[drag.over] + m.heights[drag.over] - h
        : drag.over < drag.from
          ? m.tops[drag.over]
          : m.tops[drag.from]
    slot = { top, height: h }
  }

  return (
    <div
      ref={list}
      className="ops-rows"
      role="list"
      data-dragging={drag ? 'true' : undefined}
      data-settling={settling ? 'true' : undefined}
    >
      {slot && <div className="ops-drop-slot" style={{ top: slot.top, height: slot.height }} aria-hidden />}
      {ordered.map((job, i) => {
        const lifted = drag?.id === job.id
        const y = lifted ? drag.dy : shift(i)
        return (
          <div
            key={job.id}
            ref={(el) => {
              if (el) rows.current.set(job.id, el)
              else rows.current.delete(job.id)
            }}
            role="listitem"
            tabIndex={0}
            aria-label={`${i + 1}. ${job.display_title || job.url || `#${job.id}`}`}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            className="ops-row"
            data-lifted={lifted ? 'true' : undefined}
            data-dropped={dropped === job.id ? 'true' : undefined}
            data-pending={pending ? 'true' : undefined}
            style={y ? { transform: `translateY(${y}px)${lifted ? ' scale(1.015)' : ''}` } : undefined}
            onKeyDown={(e) => keys(e, job, i)}
          >
            <div className="ops-row-gutter">
              <span className="ops-row-num tabular" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <button
                type="button"
                className="ops-grip"
                aria-label={t('Drag to reorder (Alt+Up / Alt+Down)')}
                title={t('Drag to reorder')}
                disabled={disabled || ordered.length < 2}
                onPointerDown={(e) => start(e, job, i)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
              >
                <Icon name="grip" size={16} />
              </button>
            </div>
            <div className="min-w-0 flex-1">{renderItem(job, i)}</div>
          </div>
        )
      })}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}
