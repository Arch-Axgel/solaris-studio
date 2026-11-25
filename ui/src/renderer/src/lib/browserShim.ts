/** Lets the interface run in a plain browser, for contributors.
 *
 *  `window.studio` is injected by Electron's preload. Open the Vite dev
 *  server directly — which is what the Docker `ui` service serves — and it
 *  does not exist, so the first click on anything native throws.
 *
 *  This installs a stand-in that says what it cannot do instead of failing
 *  silently. Everything that matters for interface work still functions,
 *  because that all goes over HTTP to the engine, not through Electron.
 *
 *  Never active under Electron: the real preload sets window.studio before
 *  any of this runs, and it is left strictly alone.
 */

function unavailable(what: string): void {
  console.warn(
    `[browser] ${what} needs the desktop app — it lives in Electron's preload. ` +
      'Run the app on your host for the full thing; see docs/DOCKER.md.'
  )
}

/* ---------- a pretend burner YouTube browser ----------
 *
 * The real one is an Edge/Chrome window the main process keeps minimized
 * (main/youtubeBrowser.ts). Here connect() "opens" the plain sign-in
 * window, and finishSignIn() (the "I've signed in" button) checks for ~1.5 s
 * and then reports signed in, so the prompt, the Settings card and the
 * health row can be walked through end to end. The pretend profile is
 * remembered in localStorage so a reload behaves like an app restart.
 *
 * To walk through a failed sign-in, run this in the console first:
 *   localStorage.setItem('solaris.browserShim.youtubeFail', '1') */

const YT_KEY = 'solaris.browserShim.youtube'
const YT_FAIL_KEY = 'solaris.browserShim.youtubeFail'

function fakeSignInFails(): boolean {
  try {
    return localStorage.getItem(YT_FAIL_KEY) === '1'
  } catch {
    return false
  }
}

type FakeProfile = { connected: boolean; dontAsk: boolean; profileSignedIn: boolean }

function loadFakeProfile(): FakeProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(YT_KEY) ?? '{}')
    return {
      connected: raw?.connected === true,
      dontAsk: raw?.dontAsk === true,
      profileSignedIn: raw?.profileSignedIn === true
    }
  } catch {
    return { connected: false, dontAsk: false, profileSignedIn: false }
  }
}

function makeFakeYoutube(): NonNullable<Window['studio']['youtube']> {
  const profile = loadFakeProfile()
  // Like the desktop app, a connected profile is "already running" at start.
  let status: YtStatus = {
    browser: 'edge',
    running: profile.connected,
    signedIn: profile.connected && profile.profileSignedIn,
    visible: false,
    connected: profile.connected,
    signingIn: false,
    dontAsk: profile.dontAsk,
    lastRefreshAt: null,
    signInStep: 'idle'
  }
  const listeners = new Set<(s: YtStatus) => void>()
  let signInTimer: ReturnType<typeof setTimeout> | null = null
  let wasConnected = false

  const save = (): void => {
    try {
      localStorage.setItem(YT_KEY, JSON.stringify(profile))
    } catch {
      // private window or blocked storage: the pretend profile just won't stick
    }
  }
  const set = (patch: Partial<YtStatus>): YtStatus => {
    status = { ...status, ...patch }
    profile.connected = status.connected
    profile.dontAsk = status.dontAsk
    save()
    const snapshot = { ...status }
    for (const fn of [...listeners]) fn(snapshot)
    return snapshot
  }

  return {
    status: async () => ({ ...status }),
    connect: async () => {
      if (signInTimer) clearTimeout(signInTimer)
      signInTimer = null
      // Like the desktop app: the background browser closes and a plain one
      // opens for the sign-in, so nothing is "running" meanwhile.
      wasConnected = status.connected
      set({ running: false, visible: false, signingIn: true, signInStep: 'browser-open', error: undefined })
      return { ok: true, browser: 'edge' }
    },
    finishSignIn: async () => {
      if (status.signInStep !== 'browser-open') return { ...status }
      set({ signInStep: 'checking' })
      return new Promise<YtStatus>((done) => {
        signInTimer = setTimeout(() => {
          signInTimer = null
          if (fakeSignInFails()) {
            done(
              set({
                running: wasConnected,
                signedIn: wasConnected && profile.profileSignedIn,
                signingIn: false,
                signInStep: 'idle',
                error: 'Not signed in yet. Click Sign in and finish signing in to Google in the window that opens.'
              })
            )
            return
          }
          profile.profileSignedIn = true
          done(set({ running: true, signedIn: true, connected: true, signingIn: false, signInStep: 'idle', visible: false }))
        }, 1500)
      })
    },
    show: async () =>
      status.signingIn ? { ...status } : set({ running: true, visible: true, signedIn: profile.profileSignedIn }),
    hide: async () =>
      status.signInStep === 'browser-open'
        ? set({
            signingIn: false,
            signInStep: 'idle',
            running: wasConnected,
            signedIn: wasConnected && profile.profileSignedIn
          })
        : set({ visible: false }),
    refresh: async () =>
      status.running || status.connected
        ? set({ running: true, signedIn: profile.profileSignedIn, lastRefreshAt: Date.now() })
        : { ...status },
    disconnect: async (opts) => {
      if (signInTimer) clearTimeout(signInTimer)
      signInTimer = null
      if (opts?.wipe) profile.profileSignedIn = false
      // A closed browser can't be asked about its cookies, so signedIn
      // reads false until it runs again, as in the desktop app.
      return set({
        running: false,
        visible: false,
        signedIn: false,
        connected: false,
        signingIn: false,
        signInStep: 'idle',
        error: undefined
      })
    },
    setDontAsk: async (on) => set({ dontAsk: on === true }),
    onChange: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

export function installBrowserShim(): void {
  if (window.studio) return // running under Electron; leave it alone
  const fakeYoutube = makeFakeYoutube()

  console.info(
    '[browser] Running outside Electron. Native features are stubbed; ' +
      'everything that talks to the engine works normally.'
  )

  window.studio = {
    platform: 'browser',
    pickAudioFile: async () => {
      unavailable('Choosing an audio file')
      return null
    },
    pickVideoFile: async () => {
      unavailable('Choosing a video file')
      return null
    },
    pickVideoFiles: async () => {
      unavailable('Choosing video files')
      return []
    },
    pickThumbnailImage: async () => null,
    // No warning: this one is polled speculatively after a signup link is
    // opened, so a browser contributor would get console noise for a
    // feature they never asked for. Empty simply means "nothing offered",
    // which is the same thing an empty clipboard means.
    readClipboardKey: async () => '',
    pickImageFile: async () => {
      unavailable('Choosing an image')
      return null
    },
    pickFolder: async () => {
      unavailable('Choosing a folder')
      return null
    },
    // Somewhere plausible, so export flows can be walked through end to end.
    getDownloadsPath: async () => '/downloads',
    connectYoutubeDownload: () => fakeYoutube.connect(),
    youtube: fakeYoutube,
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener')
      return true
    },
    // The browser has its own Notification API, but it needs a permission
    // prompt this shim has no business triggering. The queue treats a false
    // return as "no notification happened", which is the truth here.
    notify: async () => {
      unavailable('Desktop notifications')
      return false
    },
    update: {
      check: async () => ({ ok: false, reason: 'browser' }),
      download: async () => ({ ok: false }),
      install: async () => ({ ok: false }),
      skip: async () => ({ ok: false }),
      prefs: async () => ({ channel: 'stable' }),
      openStore: async () => ({ ok: false }),
      // No updates in a browser, and no listener to clean up.
      onState: () => () => undefined
    }
  }
}
