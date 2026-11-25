import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Page } from '../nav'

/** Which keep-alive page a component lives in, and whether it is the one on
 *  screen. Provided by KeepAlive around each page. Outside any page (shell
 *  layers) the component counts as always active. */
export const PageContext = createContext<{ page: Page | null; active: boolean }>({ page: null, active: true })

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

function documentVisible(): boolean {
  return !document.hidden
}

/** active && the window is visible: gate polls on this. */
export function useVisible(active: boolean): boolean {
  const visible = useSyncExternalStore(subscribeVisibility, documentVisible, () => true)
  return active && visible
}

/** Whether the surrounding keep-alive page is the active one. */
export function usePageActive(): boolean {
  return useContext(PageContext).active
}

/** The id of the surrounding keep-alive page, or null in the shell. */
export function usePageId(): Page | null {
  return useContext(PageContext).page
}
