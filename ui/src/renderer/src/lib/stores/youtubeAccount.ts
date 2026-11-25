import { useEffect, useSyncExternalStore } from 'react'

/** The burner YouTube account used for downloads.
 *
 *  YouTube sometimes answers a download with "Sign in to confirm you're not
 *  a bot". The main process owns a dedicated Edge/Chrome profile that the
 *  user signs a throwaway Google account into; it keeps that browser running
 *  minimized while the app is open, and the engine refreshes it and reads
 *  its cookies before each YouTube download. This store is the renderer's
 *  one view of that browser: the first-run prompt, the Settings card, the
 *  Storage & health row and the palette all read the same status, so a
 *  sign-in finished in one place updates the others at once. */

// YtStatus is the global type from env.d.ts (the exact shape the main
// process sends), so it is not redeclared here.

type YtApi = NonNullable<Window['studio']['youtube']>
export type YtConnectResult = Awaited<ReturnType<YtApi['connect']>>

/** window.studio can be missing in a bare test page, and `youtube` is absent
 *  in a preload older than this renderer. Every caller copes with null. */
function studio(): Window['studio'] | null {
  try {
    return window.studio ?? null
  } catch {
    return null
  }
}

function ytApi(): YtApi | null {
  const yt = studio()?.youtube
  // A half-wired preload is treated as absent rather than crashing on a
  // missing method later.
  return yt && typeof yt.status === 'function' && typeof yt.connect === 'function' ? yt : null
}

/** True when the desktop app exposes the full background-browser API. */
export function hasYoutubeApi(): boolean {
  return ytApi() !== null
}

/** True when at least sign-in works (the full API, or the older one-shot
 *  connectYoutubeDownload). */
export function canConnectYoutube(): boolean {
  return hasYoutubeApi() || typeof studio()?.connectYoutubeDownload === 'function'
}

/* ---------- the shared store ---------- */

let status: YtStatus | null = null
let loaded = false
let started = false
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function set(next: YtStatus | null | undefined): YtStatus | null {
  // A malformed reply (older main process, IPC error turned into undefined)
  // must not wipe a good status.
  if (next && typeof next === 'object' && 'running' in next) {
    status = next
    loaded = true
    emit()
  }
  return status
}

async function poll(): Promise<void> {
  const yt = ytApi()
  if (!yt) {
    if (!loaded) {
      loaded = true
      emit()
    }
    return
  }
  try {
    set(await yt.status())
  } catch {
    // Main process busy or restarting: keep the last reading, but stop
    // showing "loading" forever.
    if (!loaded) {
      loaded = true
      emit()
    }
  }
}

/** Starts the one status read, the push subscription and the focus re-poll.
 *  Runs once for the whole app, on the first consumer. */
function start(): void {
  if (started) return
  started = true
  const yt = ytApi()
  if (yt && typeof yt.onChange === 'function') {
    try {
      // Lives as long as the window: the store is app-wide.
      yt.onChange((s) => set(s))
    } catch {
      /* no push channel: the focus re-poll still keeps it fresh */
    }
  }
  void poll()
  // Coming back to the window after signing in elsewhere is the moment the
  // status most likely changed; a push may have been missed while the main
  // window was in the background.
  window.addEventListener('focus', () => void poll())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  start()
  return () => {
    listeners.delete(cb)
  }
}

/** Current snapshot, for non-React callers (the command palette). */
export function getYoutubeStatus(): YtStatus | null {
  start()
  return status
}

/* ---------- actions (each returns the fresh status where there is one) ---------- */

async function call(fn: (yt: YtApi) => Promise<YtStatus>): Promise<YtStatus | null> {
  const yt = ytApi()
  if (!yt) return status
  return set(await fn(yt))
}

export const youtubeAccount = {
  refreshStatus: (): Promise<void> => poll(),
  /** Opens the dedicated browser visibly on the Google sign-in page. Falls
   *  back to the older one-shot handler on an older preload. */
  connect: async (): Promise<YtConnectResult> => {
    const yt = ytApi()
    const legacy = studio()?.connectYoutubeDownload
    if (!yt && typeof legacy !== 'function') return { ok: false, error: 'This requires the desktop app.' }
    const result = yt ? await yt.connect() : await legacy!()
    // The push event normally follows, but read once too so the waiting
    // state appears even if the main window misses it.
    void poll()
    return result ?? { ok: false }
  },
  show: (): Promise<YtStatus | null> => call((yt) => yt.show()),
  /** During a sign-in this is Cancel: the main process closes the sign-in window. */
  hide: (): Promise<YtStatus | null> => call((yt) => yt.hide()),
  /** "I've signed in": closes the plain sign-in window and checks the result. */
  finishSignIn: (): Promise<YtStatus | null> =>
    call((yt) => (typeof yt.finishSignIn === 'function' ? yt.finishSignIn() : yt.status())),
  refresh: (): Promise<YtStatus | null> => call((yt) => yt.refresh()),
  disconnect: (wipe: boolean): Promise<YtStatus | null> => call((yt) => yt.disconnect({ wipe })),
  setDontAsk: (on: boolean): Promise<YtStatus | null> => call((yt) => yt.setDontAsk(on))
}

/** Where the account stands, as one word the UI can switch on. */
export type YtState = 'unsupported' | 'no-browser' | 'signing-in' | 'signed-in' | 'not-running' | 'signed-out'

export function youtubeState(s: YtStatus | null): YtState {
  if (!s) return 'unsupported'
  if (s.browser === null) return 'no-browser'
  if (s.signingIn) return 'signing-in'
  if (s.signedIn) return 'signed-in'
  // Connected before but the browser is down: it will come back on its own
  // (auto-launch) or with "Show browser", so this is not "signed out" yet.
  if (s.connected && !s.running) return 'not-running'
  return 'signed-out'
}

/** The shared hook: status (null until known or when unsupported), whether
 *  the first read finished, and the actions. */
export function useYoutubeAccount(): {
  status: YtStatus | null
  loaded: boolean
  supported: boolean
  canConnect: boolean
  state: YtState
  actions: typeof youtubeAccount
} {
  const s = useSyncExternalStore(subscribe, () => status, () => null)
  const isLoaded = useSyncExternalStore(subscribe, () => loaded, () => false)
  useEffect(() => {
    start()
  }, [])
  return {
    status: s,
    loaded: isLoaded,
    supported: hasYoutubeApi(),
    canConnect: canConnectYoutube(),
    state: youtubeState(s),
    actions: youtubeAccount
  }
}

/** Opens the sign-in dialog from anywhere (palette, Settings, Storage). */
export function openYoutubeConnect(): void {
  window.dispatchEvent(new Event('open-youtube-connect'))
}

