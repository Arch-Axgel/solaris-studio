import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, kept live. Used by the ops pages to
 *  switch between side-by-side lanes/columns and tabs/disclosures. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** The rendered width of an element, kept live with a ResizeObserver.
 *
 *  The ops pages lay out by the room they actually get (the viewport minus
 *  the rail, the page padding and any drawer), not by the window width: a
 *  1280px window with the rail pinned leaves about 1000px of content. A
 *  hidden keep-alive page measures 0; the last real width is kept then, so
 *  coming back to the page does not flash the narrow layout. */
export function useWidth<T extends HTMLElement>(fallback = 1200): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (w: number): void => {
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w))
    }
    read(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) read(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
