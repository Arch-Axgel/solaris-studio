declare module '*.css'

/** Importing an image gives you its URL — Vite copies the file into the
 *  build and hands back a hashed path. Bundled rather than referenced from
 *  disk so it survives being packed into the installer, and so the renderer's
 *  strict CSP treats it as same-origin. */
declare module '*.png' {
  const src: string
  export default src
}

/** What the main process reports about updates. */
interface UpdateState {
  // 'store': installed from the Microsoft Store, which updates the app itself.
  // `version` is then what the Store offers (absent when it couldn't be asked).
  state: 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev' | 'store'
  version?: string
  /** 'store' only: the version running, whether the Store has a newer one,
   *  and whether the user chose to skip that one (the bar stays hidden). */
  current?: string
  behind?: boolean
  skipped?: boolean
  notes?: string
  date?: string
  /** A web-installer update downloads twice: the small setup, then the app
   *  files. Which of the two the numbers describe. */
  phase?: 'installer' | 'package'
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

/** The burner YouTube account's background browser, as the main process
 *  (main/youtubeBrowser.ts) reports it. Global, so no import is needed. */
type YtStatus = {
  /** null = neither Edge nor Chrome is installed. */
  browser: 'edge' | 'chrome' | null
  /** The dedicated browser is up and its DevTools endpoint answers. */
  running: boolean
  /** A Google/YouTube session cookie is present (never its value). */
  signedIn: boolean
  /** Its window is shown, not minimized. */
  visible: boolean
  /** The user finished sign-in before (persisted); the app relaunches the
   *  browser at start while this is true. */
  connected: boolean
  /** connect() opened the plain sign-in browser and the sign-in has not
   *  finished yet (true through signInStep 'browser-open' and 'checking'). */
  signingIn: boolean
  /** 'browser-open': the plain sign-in window (no DevTools; Google refuses
   *  sign-in otherwise) is up, waiting for "I've signed in" or for the user
   *  to close it. 'checking': it closed and the result is being read. */
  signInStep: 'idle' | 'browser-open' | 'checking'
  /** "Don't ask again" for the first-run prompt (persisted). */
  dontAsk: boolean
  /** ms epoch of the last page refresh the main process made. */
  lastRefreshAt: number | null
  /** A plain-English problem. */
  error?: string
}

interface Window {
  studio: {
    platform: string
    pickAudioFile: () => Promise<string | null>
    pickVideoFile: () => Promise<string | null>
    /** Multi-select, for queueing a batch of local files at once. */
    pickVideoFiles: () => Promise<string[]>
    pickImageFile: () => Promise<string | null>
    pickThumbnailImage: () => Promise<
      { name: string; data: string } | { error: string } | null
    >
    /** Whatever is on the clipboard IF it looks like an API key, otherwise
     *  an empty string. The shape check happens in the main process, so the
     *  page can never read arbitrary clipboard contents. */
    readClipboardKey: () => Promise<string>
    getDownloadsPath: () => Promise<string>
    /** Opens YouTube in the dedicated browser profile used for video
     *  downloads. The older name for youtube.connect(). */
    connectYoutubeDownload?: () => Promise<{ ok: boolean; browser?: string; error?: string }>
    /** The burner YouTube account's background browser. Absent in a preload
     *  older than the renderer. */
    youtube?: {
      status: () => Promise<YtStatus>
      /** Closes the background browser and opens an ordinary one (no
       *  DevTools) on Google's sign-in page. The sign-in ends with
       *  finishSignIn(), the user closing that window, or hide() (cancel). */
      connect: () => Promise<{ ok: boolean; browser?: string; error?: string }>
      /** Does nothing while the plain sign-in window is open. */
      show: () => Promise<YtStatus>
      /** Minimizes the background browser; during a sign-in, cancels it. */
      hide: () => Promise<YtStatus>
      /** "I've signed in": closes the sign-in window, relaunches the
       *  background browser and reports whether the sign-in took. */
      finishSignIn: () => Promise<YtStatus>
      refresh: () => Promise<YtStatus>
      /** Closes the browser; wipe also deletes its profile (signs out for good). */
      disconnect: (opts: { wipe: boolean }) => Promise<YtStatus>
      setDontAsk: (on: boolean) => Promise<YtStatus>
      onChange: (cb: (s: YtStatus) => void) => () => void
    }
    pickFolder: () => Promise<string | null>
    /** Desktop notification. Resolves false if the OS refused it. */
    notify: (title: string, body: string) => Promise<boolean>
    /** Opens an allow-listed URL in the user's browser. Resolves false if
     *  the main process refused it. */
    openExternal: (url: string) => Promise<boolean>
    /** The session secret for the engine's plugin-manager routes (an
     *  X-Solaris-Studio-Session header). Absent in the browser shim and in a
     *  preload older than the renderer. */
    pluginSession?: () => Promise<string>
    /** Opens a plugin's link (from its developer) in the browser after a
     *  native dialog showing the full address. Resolves false if refused or
     *  cancelled. Absent in the browser shim and in an older preload. */
    openPluginLink?: (url: string) => Promise<boolean>
    /** Opens a link from an Awesome Solaris Studio entry the same way; `ours`
     *  says it is in one of Solaris Studio's own lists, which the dialog names.
     *  Absent in the browser shim and in an older preload. */
    openCatalogLink?: (url: string, ours: boolean) => Promise<boolean>
    /** Folder picker for installing a plugin from a folder on this PC. */
    pickPluginFolder?: () => Promise<string | null>
    /** Absent in the browser shim and in a preload older than the renderer. */
    tray?: {
      get: () => Promise<{ keepInTray: boolean }>
      set: (on: boolean) => Promise<{ keepInTray: boolean }>
    }
    update: {
      check: () => Promise<{ ok: boolean; reason?: string }>
      download: () => Promise<{ ok: boolean }>
      install: () => Promise<{ ok: boolean }>
      skip: (version: string) => Promise<{ ok: boolean }>
      prefs: (patch?: { channel?: string }) => Promise<{ channel: string; skipped?: string }>
      openStore: () => Promise<{ ok: boolean }>
      onState: (fn: (s: UpdateState) => void) => () => void
    }
  }
}
