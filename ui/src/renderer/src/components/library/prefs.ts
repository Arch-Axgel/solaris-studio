/** Small per-viewer conveniences for the Clip Editor (rail collapsed, sort,
 *  density…). localStorage under `solaris.ui.lib.*`, always guarded. */

const PREFIX = 'solaris.ui.lib.'

export function readPref<T extends string | boolean>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    if (typeof fallback === 'boolean') return (raw === '1') as T
    return raw as T
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: string | boolean): void {
  try {
    localStorage.setItem(PREFIX + key, typeof value === 'boolean' ? (value ? '1' : '0') : value)
  } catch {
    /* private window or blocked storage: the default comes back next time */
  }
}

/** First time the full editor opens (Home's "First clips" quest reads it). */
export function markEditorOpened(): void {
  try {
    localStorage.setItem('solaris.ui.quest.openedEditor', '1')
  } catch {
    /* the quest just won't tick */
  }
}
