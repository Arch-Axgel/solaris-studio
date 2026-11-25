// The renderer talks to the local API over HTTP; only narrow native
// affordances are exposed here, so the renderer never gains Node access.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  // Native audio-file picker (editor's background-music field).
  pickAudioFile: (): Promise<string | null> => ipcRenderer.invoke('pick-audio-file'),
  // Native video-file picker (Dashboard "upload a video file").
  pickVideoFile: (): Promise<string | null> => ipcRenderer.invoke('pick-video-file'),
  // Multi-select variant, for queueing a batch of local files at once.
  pickVideoFiles: (): Promise<string[]> => ipcRenderer.invoke('pick-video-files'),
  // Native image-file picker (watermark logo upload).
  pickImageFile: (): Promise<string | null> => ipcRenderer.invoke('pick-image-file'),
  /** A thumbnail as base64 data rather than a path — the backend never sees a
   *  filename, so it never has to trust one. */
  pickThumbnailImage: (): Promise<
    { name: string; data: string } | { error: string } | null
  > => ipcRenderer.invoke('pick-thumbnail-image'),
  // Export destination: the OS Downloads folder + a folder picker.
  /** Whatever is on the clipboard IF it looks like an API key, else ''.
   *  The main process does the shape check, so the page can never read
   *  arbitrary clipboard contents. */
  readClipboardKey: (): Promise<string> => ipcRenderer.invoke('read-clipboard-key'),
  getDownloadsPath: (): Promise<string> => ipcRenderer.invoke('get-downloads-path'),
  /** The older name for youtube.connect(), kept for renderers that still use it. */
  connectYoutubeDownload: (): Promise<{ ok: boolean; browser?: string; error?: string }> =>
    ipcRenderer.invoke('youtube-download:connect'),
  // The burner YouTube account's browser (main/youtubeBrowser.ts): a
  // dedicated Edge/Chrome profile kept running minimized so the engine can
  // take fresh cookies from it before each YouTube download. Statuses are
  // plain objects; cookie values never cross this bridge.
  youtube: {
    status: (): Promise<unknown> => ipcRenderer.invoke('youtube-download:status'),
    connect: (): Promise<{ ok: boolean; browser?: string; error?: string }> =>
      ipcRenderer.invoke('youtube-download:connect'),
    show: (): Promise<unknown> => ipcRenderer.invoke('youtube-download:show'),
    hide: (): Promise<unknown> => ipcRenderer.invoke('youtube-download:hide'),
    /** "I've signed in": closes the plain sign-in window and checks the result. */
    finishSignIn: (): Promise<unknown> => ipcRenderer.invoke('youtube-download:finish-sign-in'),
    refresh: (): Promise<unknown> => ipcRenderer.invoke('youtube-download:refresh'),
    disconnect: (opts: { wipe: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('youtube-download:disconnect', { wipe: opts?.wipe === true }),
    setDontAsk: (on: boolean): Promise<unknown> => ipcRenderer.invoke('youtube-download:dont-ask', on === true),
    /** Subscribe to status changes. Returns an unsubscribe function. */
    onChange: (fn: (s: unknown) => void): (() => void) => {
      const handler = (_e: unknown, s: unknown): void => fn(s)
      ipcRenderer.on('youtube-download:changed', handler)
      return () => ipcRenderer.removeListener('youtube-download:changed', handler)
    }
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  // Desktop notification when a queued video finishes. Text only — the main
  // process builds the toast, so the renderer cannot attach actions or links.
  notify: (title: string, body: string): Promise<boolean> =>
    ipcRenderer.invoke('notify', { title, body }),
  // Open a link in the real browser. The main process allow-lists which
  // hosts are permitted, so this cannot be used to launch arbitrary URLs.
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('open-external', url),
  // The session secret the engine's plugin-manager routes ask for, in an
  // X-Solaris-Studio-Session header. Given only to this app's own pages.
  pluginSession: (): Promise<string> => ipcRenderer.invoke('plugin-session'),
  // A plugin's own links (its repository, docs, developer). The main process
  // shows the full address and opens it only if the user agrees.
  openPluginLink: (url: string): Promise<boolean> => ipcRenderer.invoke('open-plugin-link', url),
  // A link from an Awesome Solaris Studio entry (its download page or home), the same way.
  openCatalogLink: (url: string, ours: boolean): Promise<boolean> =>
    ipcRenderer.invoke('open-catalog-link', url, ours),
  pickPluginFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-plugin-folder'),
  // Whether closing the window keeps Solaris Studio running in the tray, for
  // watched channels. Off unless turned on; the main process remembers it.
  tray: {
    get: (): Promise<{ keepInTray: boolean }> => ipcRenderer.invoke('tray:get'),
    set: (on: boolean): Promise<{ keepInTray: boolean }> => ipcRenderer.invoke('tray:set', on)
  },

  // Updates. The renderer never touches electron-updater directly; it asks
  // the main process and listens for state.
  update: {
    check: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('update:check'),
    download: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:download'),
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:install'),
    skip: (version: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('update:skip', version),
    prefs: (patch?: { channel?: string }): Promise<{ channel: string; skipped?: string }> =>
      ipcRenderer.invoke('update:prefs', patch),
    /** Solaris Studio's page in the Microsoft Store app (a Store copy's update button). */
    openStore: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:openStore'),
    /** Subscribe to update state. Returns an unsubscribe function. */
    onState: (fn: (s: Record<string, unknown>) => void): (() => void) => {
      const handler = (_e: unknown, s: Record<string, unknown>): void => fn(s)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  }
})
