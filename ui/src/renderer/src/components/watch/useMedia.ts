import { useSyncExternalStore } from 'react'

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
