// The burner YouTube account's browser.
//
// YouTube often answers a download with "Sign in to confirm you're not a
// bot". yt-dlp gets past that with a signed-in session's cookies, but reading
// them out of a browser's cookie database on Windows fails while the browser
// is open (it locks the file) and the values are encrypted per profile. So
// the app owns a DEDICATED, real Edge/Chrome profile instead: the user signs a
// throwaway Google account into it once, the app keeps that browser running
// minimized while it runs, and the engine (sources/ytdlp_common.py) asks it
// over the DevTools protocol for fresh cookies before each YouTube download.
//
// The sign-in persists because the profile folder does; "connected" in
// solaris-state.json is what makes the next app start launch it again. The
// state file sits beside the Default profile, not inside it, so signing out
// for good (wipe) can delete the profile and still keep the user's choices.
//
// Nothing here ever reads, logs or forwards a cookie VALUE: status only asks
// whether a sign-in cookie exists (cdp.ts readSessionCookies).
//
// Signing in happens in a PLAIN browser. Google refuses to sign anyone in to
// a browser that is under DevTools control ("This browser or app may not be
// secure"), and the background browser is started with a debugging port. So
// connect() closes that one, then starts the same executable on the same
// profile with only ordinary flags (plainArgs below): no debugging port, no
// throttling switches, and no CDP connection of any kind while it is open.
// Nothing hides or disguises anything from Google; the window simply is an
// ordinary browser. The user signs in, then clicks "I've signed in" (or just
// closes the window), and only after that browser has exited is the
// debug-enabled background browser started again to check the cookies.

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  bringToFront,
  browserPid,
  closeBrowser,
  connectBrowser,
  firstPage,
  getWindowState,
  isYoutubeUrl,
  listPages,
  loadPage,
  processAlive,
  readSessionCookies,
  setWindowState,
  type CdpClient
} from './cdp'

export type YtStatus = {
  browser: 'edge' | 'chrome' | null
  running: boolean
  signedIn: boolean
  visible: boolean
  connected: boolean
  signingIn: boolean
  dontAsk: boolean
  lastRefreshAt: number | null
  /** Where a sign-in stands: 'browser-open' while the plain sign-in window
   *  is up, 'checking' while it is closed and the result read back. */
  signInStep: SignInStep
  error?: string
}

export type SignInStep = 'idle' | 'browser-open' | 'checking'

const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'
const YOUTUBE_URL = 'https://www.youtube.com/'
// Google's sign-in form and the interstitials it can stop on before handing
// back to YouTube (matches _SIGN_IN_HOSTS in sources/ytdlp_common.py).
const SIGN_IN_HOSTS = ['accounts.google.com', 'gds.google.com']

function isSignInUrl(url: string): boolean {
  try {
    return SIGN_IN_HOSTS.includes(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** After this long the plain sign-in window is treated as finished. */
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000
/** How often the plain browser's process and profile lock are looked at
 *  (local process/file checks only; the browser itself is never contacted). */
const PLAIN_WATCH_MS = 1000
const NOT_SIGNED_IN =
  'Not signed in yet. Click Sign in and finish signing in to Google in the window that opens.'
const STATUS_POLL_MS = 15000
const RELAUNCH_DELAY_MS = 3000
const RELAUNCH_LIMIT = 3
const RELAUNCH_WINDOW_MS = 10 * 60 * 1000

export function youtubeBrowserProfile(): {
  browser: 'edge' | 'chrome'
  executable: string
  profile: string
} | null {
  const localAppData = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  const candidates: { browser: 'edge' | 'chrome'; executable: string }[] = [
    {
      browser: 'edge',
      executable: join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Microsoft',
        'Edge',
        'Application',
        'msedge.exe'
      )
    },
    {
      browser: 'edge',
      executable: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    },
    {
      browser: 'chrome',
      executable: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
    },
    {
      browser: 'chrome',
      executable: join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe'
      )
    },
    {
      browser: 'chrome',
      executable: join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    }
  ]
  const found = candidates.find((candidate) => existsSync(candidate.executable))
  return found
    ? {
        ...found,
        profile: join(localAppData, 'Solaris Studio', 'youtube-browser', 'Default')
      }
    : null
}

// ---- persisted choices ------------------------------------------------------

type SavedState = { connected: boolean; dontAsk: boolean }

function profileRoot(): string | null {
  const found = youtubeBrowserProfile()
  return found ? dirname(found.profile) : null
}

function statePath(): string {
  // Without a browser there is no profile root to sit beside, but "don't
  // ask again" must still stick, so the path is computed the same way.
  const localAppData = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(localAppData, 'Solaris Studio', 'youtube-browser', 'solaris-state.json')
}

function readState(): SavedState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    return { connected: raw?.connected === true, dontAsk: raw?.dontAsk === true }
  } catch {
    return { connected: false, dontAsk: false }
  }
}

function writeState(patch: Partial<SavedState>): void {
  const next = { ...readState(), ...patch }
  try {
    mkdirSync(dirname(statePath()), { recursive: true })
    writeFileSync(statePath(), JSON.stringify(next, null, 2))
  } catch (error) {
    console.warn(`Could not save the YouTube browser settings: ${(error as Error).message}`)
  }
}

// ---- session state ----------------------------------------------------------

let getMainWindow: () => BrowserWindow | null = () => null
/** The browser process we spawned this session, while it lives. */
let child: ChildProcess | null = null
/** True once we launched the browser, or found it running and used it.
 *  Only then is it ours to close when the app quits. */
let owned = false
/** Set while we are the ones closing it, so the watchdog stays out. */
let expectingExit = false
let appQuitting = false
let shutdownDone = false
let signingIn = false
let signInStep: SignInStep = 'idle'
/** The plain (no DevTools) browser the user signs in with, while it is open. */
type PlainBrowser = {
  proc: ChildProcess
  pid: number
  root: string
  /** connected before this sign-in began (a re-sign-in): the background
   *  browser comes back afterwards whatever the outcome. */
  wasConnected: boolean
  /** The profile lock was seen held, so its release means the browser went. */
  sawLocked: boolean
  exited: boolean
}
let plain: PlainBrowser | null = null
let plainWatch: NodeJS.Timeout | null = null
let plainTimeout: NodeJS.Timeout | null = null
/** The finish/cancel under way, so a second trigger joins it. */
let plainEnding: Promise<YtStatus> | null = null
/** A browser we asked to close, which may still be shutting down. */
let closingPid: number | null = null
let statusTimer: NodeJS.Timeout | null = null
let statusTickBusy = false
let relaunchTimer: NodeJS.Timeout | null = null
const relaunches: number[] = []
let lastRefreshAt: number | null = null
/** The last successful cookie check, reused when one read fails mid-start. */
let lastSignedIn = false
let lastError: string | undefined
let lastPushed = ''

/** Launching, closing and navigating are run one at a time so a connect
 *  clicked during a background start can't spawn a second browser. Status
 *  reads don't need this; they only look. */
let opChain: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn)
  opChain = run.catch(() => undefined)
  return run
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** True while some browser process holds the profile. Chromium keeps
 *  <user-data-dir>/lockfile open for as long as it runs (and deletes it on
 *  a clean exit). It shares that handle for READING only, so the probe asks
 *  for read+write access ('r+': no create, no truncate, nothing written);
 *  failing to get it means "in use". A read-only probe always succeeded,
 *  even with the browser up (checked live against Edge 158).
 *  This is the only reliable liveness signal: DevToolsActivePort is left
 *  behind after EVERY exit, clean or not, and the DevTools endpoint stops
 *  answering several seconds before a closing browser lets go of the
 *  profile (checked against a real Edge). Opening it only looks; nothing is
 *  written or deleted. */
function profileLocked(root: string): boolean {
  try {
    closeSync(openSync(join(root, 'lockfile'), 'r+'))
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
  }
}

/** Waits up to `ms` for whichever browser holds the profile to let go. */
async function waitForProfileFree(root: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (profileLocked(root)) {
    if (Date.now() >= deadline) return false
    await sleep(150)
  }
  return true
}

async function computeStatus(): Promise<YtStatus> {
  const found = youtubeBrowserProfile()
  const saved = readState()
  const status: YtStatus = {
    browser: found?.browser ?? null,
    running: false,
    signedIn: false,
    visible: false,
    connected: saved.connected,
    signingIn,
    dontAsk: saved.dontAsk,
    lastRefreshAt,
    signInStep
  }
  if (lastError) status.error = lastError
  if (!found) return status
  // During a sign-in the profile belongs to the plain browser, which has no
  // DevTools endpoint and must never be contacted; report the last reading.
  if (signInStep !== 'idle') {
    status.signedIn = lastSignedIn
    return status
  }
  const cdp = await connectBrowser(dirname(found.profile))
  if (!cdp) return status
  try {
    status.running = true
    const pages = await listPages(cdp)
    if (pages[0]) {
      const win = await getWindowState(cdp, pages[0].targetId).catch(() => null)
      status.visible = !!win && win.state !== 'minimized'
    }
    status.signedIn = (await readSessionCookies(cdp)).signedIn
    lastSignedIn = status.signedIn
  } catch {
    // A browser mid-start or mid-close; the next poll will see it settled.
    // Keep the last cookie reading meanwhile: a blip reported as "signed
    // out" would pop the renderer's "YouTube signed you out" prompt.
    status.signedIn = lastSignedIn
  } finally {
    cdp.close()
  }
  return status
}

/** Recomputes the status and tells the window when anything changed.
 *  Never rejects: it runs from timers and `void` calls, where a rejection
 *  would surface as an unhandled one in the main process. */
async function publish(): Promise<YtStatus> {
  const status = await computeStatus()
  const json = JSON.stringify(status)
  if (json !== lastPushed) {
    lastPushed = json
    try {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) win.webContents.send('youtube-download:changed', status)
    } catch {
      // the window is going away (quit, reload); the next push catches up
    }
  }
  return status
}

/** Runs one browser action, logging instead of throwing. A CDP call can
 *  fail any time the browser closes under us; the caller then just reports
 *  the status as it now is. */
async function attempt(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.warn(`YouTube browser: could not ${what}: ${(error as Error).message}`)
  }
}

// ---- launching --------------------------------------------------------------

const ALREADY_OPEN =
  'The YouTube browser is already open without cookie access. Close all its windows, then try again.'

/** Starts the dedicated browser on `url` and waits for its DevTools endpoint.
 *  Returns a connection to it, or a plain-English error. */
async function launch(url: string, minimized: boolean): Promise<CdpClient | string> {
  const found = youtubeBrowserProfile()
  if (!found) return 'Install Microsoft Edge or Google Chrome to use a YouTube download account.'
  const root = dirname(found.profile)
  mkdirSync(root, { recursive: true })
  // Hard stop: never start the debug-enabled browser while the plain
  // sign-in browser lives. Chromium runs one process per profile, so the two
  // would merge, and whichever won would carry (or lose) the debugging port.
  // Every caller already checks signInStep; this catches a call that was
  // queued before a sign-in began. checkSignIn() only gets here once the
  // plain browser is gone.
  if (plain && plainAlive(plain)) return 'Finish signing in to Google first, then try again.'
  // Never start a second process on a profile something still holds: it
  // would hand our URL to that browser and quit, and since the port file is
  // deleted below, the one still running would be unreachable for the rest
  // of its life. That happens when the endpoint merely answered slowly, or
  // the browser is a few seconds into closing (its endpoint goes quiet well
  // before it exits). So: wait for it to either answer or go.
  if (profileLocked(root)) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && profileLocked(root)) {
      const cdp = await connectBrowser(root, 1500)
      if (cdp) {
        owned = true
        expectingExit = false
        return cdp
      }
      await sleep(250)
    }
    if (profileLocked(root)) return ALREADY_OPEN
  }
  // A browser we just closed lets go of the profile lock almost at once
  // but keeps its cookie database open until its process exits (~6.5 s
  // on Edge). A new browser started in that gap can't open those files;
  // let the old one finish first.
  if (closingPid !== null) {
    const pid = closingPid
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && processAlive(pid)) await sleep(150)
    closingPid = null
  }
  // Every exit, clean or crashed, leaves the port file behind; remove it
  // so the wait below only succeeds on the new browser's own.
  try {
    unlinkSync(join(root, 'DevToolsActivePort'))
  } catch {
    // not there, which is the usual case
  }

  const args = [
    `--user-data-dir=${root}`,
    '--profile-directory=Default',
    '--remote-debugging-address=127.0.0.1',
    // 0 = any free port; the browser writes the one it got to
    // DevToolsActivePort, which is how both this file and the engine find it.
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    // A minimized window is throttled hard by default, and then a refresh
    // before a download can stall. These keep its page working normally.
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows'
  ]
  // Honoured by some builds only, so it just cuts the flash; the CDP
  // minimize after start is what actually enforces it.
  if (minimized) args.push('--start-minimized')
  args.push('--new-window', url)

  // The app began quitting while this launch waited its turn.
  if (appQuitting) return 'Solaris Studio is closing.'
  const proc = spawn(found.executable, args, { detached: true, stdio: 'ignore', windowsHide: false })
  const started = await new Promise<boolean>((done) => {
    // `on`, not `once`: an 'error' with no listener left (a later failed
    // kill, say) would be an uncaught exception that takes the app down.
    proc.on('error', (error) => {
      console.error(`Could not open the YouTube browser: ${error.message}`)
      done(false)
    })
    proc.once('spawn', () => done(true))
  })
  if (!started) return 'Could not open the browser. Check that it is installed and try again.'
  proc.unref()
  child = proc
  owned = true
  expectingExit = false
  let exitedEarly = false
  proc.once('exit', () => {
    exitedEarly = true
    onChildExit(proc)
  })

  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const cdp = await connectBrowser(root)
    if (cdp) {
      // The endpoint answers a moment before the first tab is registered;
      // without this wait firstPage() would open a second one.
      const pagesBy = Date.now() + 5000
      while (Date.now() < pagesBy && !(await listPages(cdp).catch(() => [])).length) await sleep(150)
      return cdp
    }
    // The process quitting before any port file appeared means the profile
    // was already open in a browser started without the debugging port: it
    // handed our URL to that one and left.
    if (exitedEarly && !existsSync(join(root, 'DevToolsActivePort'))) return ALREADY_OPEN
    await sleep(200)
  }
  return ALREADY_OPEN
}

/** Waits for the browser's first tab to have a window, then minimizes it
 *  and checks that it stayed minimized. --start-minimized is ignored by
 *  Edge, and a minimize sent while the new window is still being shown can
 *  be silently undone (seen live: the call succeeded, the window came back
 *  'normal'), so it is re-sent until the window reports minimized twice in
 *  a row. */
async function minimizeWhenReady(cdp: CdpClient): Promise<void> {
  const deadline = Date.now() + 10000
  let confirmed = 0
  while (Date.now() < deadline && cdp.isOpen && confirmed < 2) {
    try {
      const [page] = await listPages(cdp)
      if (page) {
        if ((await getWindowState(cdp, page.targetId)).state === 'minimized') confirmed++
        else {
          confirmed = 0
          await setWindowState(cdp, page.targetId, 'minimized')
        }
      }
    } catch {
      // the window isn't there yet
    }
    await sleep(300)
  }
}

/** Connects to the running browser (adopting it), or launches it. */
async function ensureRunning(url: string, minimized: boolean): Promise<CdpClient | string> {
  const root = profileRoot()
  if (!root) return 'Install Microsoft Edge or Google Chrome to use a YouTube download account.'
  const cdp = await connectBrowser(root)
  if (cdp) {
    owned = true
    // Adopting re-arms the watchdog; a disconnect whose close didn't take
    // would otherwise leave it switched off for good.
    expectingExit = false
    return cdp
  }
  return launch(url, minimized)
}

/** The app's start, or the watchdog: bring the browser up on YouTube,
 *  minimized, without the user having to look at it. */
function backgroundStart(): Promise<void> {
  return exclusive(async () => {
    // The plain sign-in browser holds the profile; it is expected to have no
    // DevTools endpoint, so its being "unreachable" is not a crash.
    if (appQuitting || signInStep !== 'idle' || !readState().connected) return
    const cdp = await ensureRunning(YOUTUBE_URL, true)
    if (typeof cdp === 'string') {
      lastError = cdp
      return
    }
    try {
      await attempt('open YouTube in the background', async () => {
        await firstPage(cdp, YOUTUBE_URL)
        await minimizeWhenReady(cdp)
      })
    } finally {
      cdp.close()
    }
  })
    .catch((error) => console.warn(`YouTube browser: background start failed: ${(error as Error).message}`))
    .finally(() => void publish())
}

// ---- watchdog ---------------------------------------------------------------

function onChildExit(proc: ChildProcess): void {
  if (child === proc) child = null
  if (expectingExit || appQuitting) return
  // A sign-in owns the profile now; its finish step relaunches it itself.
  if (signInStep === 'idle' && readState().connected) scheduleRelaunch()
  void publish()
}

function scheduleRelaunch(): void {
  if (relaunchTimer || appQuitting || signInStep !== 'idle') return
  const now = Date.now()
  while (relaunches.length && now - relaunches[0] > RELAUNCH_WINDOW_MS) relaunches.shift()
  if (relaunches.length >= RELAUNCH_LIMIT) {
    lastError =
      'The YouTube download browser keeps closing, so Solaris Studio stopped reopening it. Reconnect it in Settings.'
    owned = false
    void publish()
    return
  }
  relaunches.push(now)
  relaunchTimer = setTimeout(() => {
    relaunchTimer = null
    void backgroundStart()
  }, RELAUNCH_DELAY_MS)
}

/** Every 15 s: notices a sign-out (session expired), a browser that
 *  vanished without our child process telling us (one adopted from an
 *  earlier run), and pushes whatever changed. One websocket handshake. */
async function statusTick(): Promise<void> {
  if (statusTickBusy || appQuitting) return
  statusTickBusy = true
  try {
    const status = await publish()
    const root = profileRoot()
    // A held profile lock means the browser is still there, just slow to
    // answer or a few seconds into closing; relaunching then would burn a
    // retry and, worse, race the dying process for the profile.
    if (
      !status.running &&
      status.connected &&
      owned &&
      !signingIn &&
      signInStep === 'idle' &&
      !expectingExit &&
      !child &&
      !(root && profileLocked(root))
    ) {
      scheduleRelaunch()
    }
  } catch (error) {
    console.warn(`YouTube browser: status check failed: ${(error as Error).message}`)
  } finally {
    statusTickBusy = false
  }
}

// ---- sign-in ----------------------------------------------------------------
//
// connect() closes the background browser, then opens the plain one (no
// DevTools) on Google's sign-in page and leaves it entirely to the user. It
// ends one of three ways, all landing in endPlainSignIn():
//   - "I've signed in" in the app (finishSignIn): close it, then check;
//   - the browser goes away by itself (the user closed its window): check;
//   - SIGN_IN_TIMEOUT_MS passes: treated like the user closing it;
// or Cancel (hide() while it is open): close it and don't check.
// "Goes away" is judged from local process and profile-lock checks only.

/** The plain browser's command line: an ordinary window on the profile.
 *  Deliberately no --remote-debugging-*, no throttling switches, nothing
 *  else; Google blocks sign-in in a browser started for automation.
 *  --disable-background-mode is left out too: checked live, a fresh
 *  profile's Edge exits as soon as its last window closes, and every flag
 *  added here is one more way to look unlike a normal browser. */
function plainArgs(root: string): string[] {
  return [
    `--user-data-dir=${root}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    SIGN_IN_URL
  ]
}

/** Clears the sign-in timers only. Quitting uses this as well, and leaves
 *  an open plain browser alone: the user may be mid sign-in. */
function stopSignIn(): void {
  if (plainWatch) clearInterval(plainWatch)
  plainWatch = null
  if (plainTimeout) clearTimeout(plainTimeout)
  plainTimeout = null
}

function endSignInState(): void {
  stopSignIn()
  plain = null
  signingIn = false
  signInStep = 'idle'
}

/** Runs taskkill with `args` and resolves once it is done. Never rejects. */
function taskkill(args: string[]): Promise<void> {
  return new Promise((done) => {
    try {
      // Full path: PATH can be trimmed in a packaged app's environment.
      const exe = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'taskkill.exe')
      const proc = spawn(existsSync(exe) ? exe : 'taskkill', args, { stdio: 'ignore', windowsHide: true })
      proc.on('error', () => done())
      proc.once('exit', () => done())
    } catch {
      done()
    }
  })
}

function plainAlive(pb: PlainBrowser): boolean {
  return !pb.exited && pb.proc.exitCode === null && pb.proc.signalCode === null && processAlive(pb.pid)
}

async function waitUntil(test: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (!test()) {
    if (Date.now() >= deadline) return false
    await sleep(150)
  }
  return true
}

/** Closes the plain browser the way its window's close button would,
 *  without any DevTools connection: `taskkill /PID` with no /F posts
 *  WM_CLOSE to the process's windows, so it shuts down normally and saves
 *  its cookies (measured on Edge 158: gone, profile released, in under a
 *  second). /T (still no force) only if that didn't do it; /F /T only after
 *  ~10 s. Returns false when it had to be forced. */
async function closePlainBrowser(pb: PlainBrowser): Promise<boolean> {
  const deadline = Date.now() + 10000
  const left = (): number => Math.max(0, deadline - Date.now())
  if (plainAlive(pb)) {
    await taskkill(['/PID', String(pb.pid)])
    if (!(await waitUntil(() => !plainAlive(pb), Math.min(5000, left())))) {
      // A window owned by another process of its tree: ask them too.
      await taskkill(['/PID', String(pb.pid), '/T'])
      await waitUntil(() => !plainAlive(pb), left())
    }
  }
  const free = await waitForProfileFree(pb.root, Math.max(500, left()))
  if (!plainAlive(pb) && free) return true
  console.warn('YouTube browser: the sign-in window did not close in time; forcing it.')
  await taskkill(['/PID', String(pb.pid), '/T', '/F'])
  await waitUntil(() => !plainAlive(pb), 3000)
  await waitForProfileFree(pb.root, 3000)
  return false
}

/** Every PLAIN_WATCH_MS while the plain browser is open: has it gone? Its
 *  own process exiting is not enough by itself (a browser that re-launched
 *  itself would still hold the profile), so the profile lock decides. */
function watchPlain(): void {
  const pb = plain
  if (!pb || plainEnding || signInStep !== 'browser-open' || appQuitting) return
  const locked = profileLocked(pb.root)
  if (locked) pb.sawLocked = true
  if (!locked && (pb.sawLocked || !plainAlive(pb))) void endPlainSignIn('finish')
}

/** After the plain browser is closed: start the background browser again
 *  (minimized, on YouTube) and see whether the sign-in took. */
async function checkSignIn(pb: PlainBrowser, graceful: boolean): Promise<void> {
  const cdp = await ensureRunning(YOUTUBE_URL, true)
  if (typeof cdp === 'string') {
    lastError = cdp
    endSignInState()
    return
  }
  let signedIn = false
  try {
    await attempt('open YouTube in the background', async () => {
      await firstPage(cdp, YOUTUBE_URL)
      await minimizeWhenReady(cdp)
    })
    // A browser that has just started can answer before its profile's
    // cookies are loaded, so a "no" is re-asked for a few seconds.
    const by = Date.now() + 6000
    for (;;) {
      signedIn = (await readSessionCookies(cdp).catch(() => ({ signedIn: false }))).signedIn
      if (signedIn || Date.now() >= by || !cdp.isOpen) break
      await sleep(500)
    }
  } finally {
    cdp.close()
  }
  lastSignedIn = signedIn
  if (signedIn) {
    writeState({ connected: true })
    lastError = undefined
    relaunches.length = 0
  } else {
    lastError = graceful
      ? NOT_SIGNED_IN
      : `${NOT_SIGNED_IN} The sign-in window had to be force-closed, so anything it had not saved was lost.`
    // A profile that was never connected has nothing to serve; don't keep
    // an unused browser running. A re-sign-in keeps the old one going.
    if (!pb.wasConnected && !readState().connected) {
      await closeGracefully(0)
      owned = false
    }
  }
  endSignInState()
}

/** Ends the plain sign-in: 'finish' closes it and checks the result,
 *  'cancel' closes it and puts things back as they were. A second call while
 *  one is under way joins it. */
function endPlainSignIn(kind: 'finish' | 'cancel'): Promise<YtStatus> {
  if (plainEnding) return plainEnding
  const pb = plain
  if (!pb || signInStep !== 'browser-open') return publish()
  stopSignIn()
  if (kind === 'finish') signInStep = 'checking'
  void publish()
  let restore = false
  plainEnding = exclusive(async () => {
    // Already ended another way (a disconnect queued ahead of this).
    if (plain !== pb) return
    const graceful = await closePlainBrowser(pb)
    if (appQuitting || kind === 'cancel') {
      endSignInState()
      restore = kind === 'cancel' && pb.wasConnected && !appQuitting
      return
    }
    await checkSignIn(pb, graceful)
  })
    .catch((error) => {
      console.warn(`YouTube browser: finishing the sign-in failed: ${(error as Error).message}`)
      if (plain === pb) {
        endSignInState()
        lastError = NOT_SIGNED_IN
      }
    })
    .then(() => {
      plainEnding = null
      if (restore) void backgroundStart()
      return publish()
    })
  return plainEnding
}

async function connect(): Promise<{ ok: boolean; browser?: string; error?: string }> {
  const found = youtubeBrowserProfile()
  if (!found) {
    return { ok: false, error: 'Install Microsoft Edge or Google Chrome to connect a YouTube download account.' }
  }
  let restore = false
  const result = await exclusive(async (): Promise<{ ok: boolean; browser?: string; error?: string }> => {
    if (appQuitting) return { ok: false, error: 'Solaris Studio is closing.' }
    // Already signing in: the plain window is the user's to find (there is
    // no DevTools connection to bring it forward with).
    if (signInStep !== 'idle') return { ok: true, browser: found.browser }
    lastError = undefined
    relaunches.length = 0
    if (relaunchTimer) clearTimeout(relaunchTimer)
    relaunchTimer = null
    const root = dirname(found.profile)
    mkdirSync(root, { recursive: true })
    const wasConnected = readState().connected
    // Chromium runs one process per profile: started while the background
    // browser is up, the new one would hand the sign-in page to it, with
    // its debugging port still on. So that one is closed first, and its
    // process waited out (it holds the cookie database until it exits).
    await closeGracefully(9000)
    owned = false
    if (closingPid !== null) {
      const pid = closingPid
      const gone = await waitUntil(() => !processAlive(pid), 10000)
      closingPid = null
      // The profile lock goes seconds before the process does; a browser
      // started in that gap could hand the sign-in page to the dying
      // debug-enabled one. Don't start the plain browser until it is gone.
      if (!gone) {
        restore = wasConnected
        return { ok: false, error: 'The YouTube browser is still closing. Wait a moment, then try again.' }
      }
    }
    if (!(await waitForProfileFree(root, 5000))) {
      restore = wasConnected
      return { ok: false, error: 'The YouTube browser is still open. Close all its windows, then try again.' }
    }
    // Stale from the last debug run; nothing should find a port meanwhile.
    try {
      unlinkSync(join(root, 'DevToolsActivePort'))
    } catch {
      // not there
    }
    if (appQuitting) return { ok: false, error: 'Solaris Studio is closing.' }
    const proc = spawn(found.executable, plainArgs(root), { detached: true, stdio: 'ignore', windowsHide: false })
    const started = await new Promise<boolean>((done) => {
      // `on`, not `once`: a later 'error' with no listener would crash the app.
      proc.on('error', (error) => {
        console.error(`Could not open the YouTube sign-in browser: ${error.message}`)
        done(false)
      })
      proc.once('spawn', () => done(true))
    })
    if (!started || !proc.pid) {
      restore = wasConnected
      return { ok: false, error: 'Could not open the browser. Check that it is installed and try again.' }
    }
    proc.unref()
    const pb: PlainBrowser = { proc, pid: proc.pid, root, wasConnected, sawLocked: false, exited: false }
    proc.once('exit', () => {
      pb.exited = true
      if (plain === pb) watchPlain()
    })
    plain = pb
    signingIn = true
    signInStep = 'browser-open'
    plainWatch = setInterval(watchPlain, PLAIN_WATCH_MS)
    plainTimeout = setTimeout(() => void endPlainSignIn('finish'), SIGN_IN_TIMEOUT_MS)
    return { ok: true, browser: found.browser }
  }).catch((error) => {
    console.warn(`YouTube browser: connect failed: ${(error as Error).message}`)
    return { ok: false, error: 'Could not open the YouTube sign-in page. Try again.' }
  })
  if (restore) void backgroundStart()
  await publish()
  return result
}

/** "I've signed in": close the plain browser and check the sign-in. */
async function finishSignIn(): Promise<YtStatus> {
  if (plainEnding) return plainEnding
  if (signInStep === 'browser-open') return endPlainSignIn('finish')
  return publish()
}

// ---- the other actions ------------------------------------------------------

async function show(): Promise<YtStatus> {
  // The plain sign-in window has no DevTools connection to bring it forward
  // with, and starting the browser again would hand off to it; leave it.
  if (signInStep !== 'idle') return publish()
  await exclusive(() => attempt('show the browser', async () => {
    // A connect queued ahead of this may have opened the plain browser.
    if (signInStep !== 'idle') return
    const cdp = await ensureRunning(YOUTUBE_URL, false)
    if (typeof cdp === 'string') {
      lastError = cdp
      return
    }
    try {
      const page = await firstPage(cdp, YOUTUBE_URL)
      await bringToFront(cdp, page.targetId)
    } finally {
      cdp.close()
    }
  }))
  return publish()
}

/** Minimizes the background browser. During a sign-in it is the Cancel:
 *  the plain sign-in window is closed (gracefully, without DevTools) and,
 *  for a profile that was connected before, the background browser comes
 *  back. While the result is being checked it does nothing. */
async function hide(): Promise<YtStatus> {
  if (signInStep === 'browser-open') return endPlainSignIn('cancel')
  if (signInStep !== 'idle') return plainEnding ?? publish()
  await exclusive(() => attempt('hide the browser', async () => {
    if (signInStep !== 'idle') return
    const root = profileRoot()
    const cdp = root ? await connectBrowser(root) : null
    if (!cdp) return
    try {
      const [page] = await listPages(cdp)
      if (page) await setWindowState(cdp, page.targetId, 'minimized').catch(() => undefined)
    } finally {
      cdp.close()
    }
  }))
  return publish()
}

async function refresh(): Promise<YtStatus> {
  await exclusive(() => attempt('refresh YouTube', async () => {
    // Mid sign-in the tab is Google's sign-in form; reloading or sending it
    // to YouTube would throw away what the user is typing.
    if (signingIn) return
    // Refreshing a browser that isn't running means starting it, which is
    // only wanted once the user has connected an account.
    const root = profileRoot()
    let cdp: CdpClient | string | null = root ? await connectBrowser(root) : null
    if (!cdp && readState().connected) cdp = await ensureRunning(YOUTUBE_URL, true)
    if (!cdp || typeof cdp === 'string') {
      if (typeof cdp === 'string') lastError = cdp
      return
    }
    try {
      const page = await firstPage(cdp, YOUTUBE_URL)
      // signingIn can already be cleared while Google still shows one of its
      // sign-in interstitials; same rule as the engine's refresh: leave it.
      if (isSignInUrl(page.url)) return
      // YouTube's load event can take well over ten seconds on a slow link,
      // but its cookies are set when the response arrives, so a few seconds
      // is enough for the button to report back.
      await loadPage(cdp, page.targetId, isYoutubeUrl(page.url) ? null : YOUTUBE_URL, 6000)
      lastRefreshAt = Date.now()
    } catch (error) {
      console.warn(`Could not refresh the YouTube browser: ${(error as Error).message}`)
    } finally {
      cdp.close()
    }
  }))
  return publish()
}

/** Asks the browser to quit the normal way (that is what writes its cookie
 *  database to disk) and, with `waitMs`, waits for its process to go.
 *
 *  Measured on a real Edge with this profile's flags: Browser.close is
 *  acknowledged at once, the profile lock goes within milliseconds, but the
 *  process lives ~6.5 s more while it shuts down. So "the endpoint went
 *  quiet" and "the lock is free" both come far too early to mean "done",
 *  and killing it at a short deadline (what app quit used to do at 2.5 s)
 *  cuts its shutdown short. The process id is what's waited on: our child's,
 *  or for a browser adopted from an earlier run, the one CDP reports.
 *
 *  waitMs 0 (app quit): returns as soon as the browser has taken the
 *  request; it is detached and finishes by itself after the app is gone.
 *  The process is only killed when it never took the request (hung, or
 *  still starting with no endpoint yet), or for a disconnect that has to
 *  have it gone. */
async function closeGracefully(waitMs: number): Promise<void> {
  const root = profileRoot()
  if (!root) return
  expectingExit = true
  if (relaunchTimer) clearTimeout(relaunchTimer)
  relaunchTimer = null
  const proc = child
  const cdp = await connectBrowser(root, 1000)
  const pid = proc?.pid ?? (cdp ? await browserPid(cdp) : null)
  const taken = cdp ? await closeBrowser(cdp) : false
  if (pid !== null) closingPid = pid
  const alive = (): boolean =>
    proc ? proc.exitCode === null && proc.signalCode === null : pid !== null && processAlive(pid)
  if (taken && waitMs <= 0) return
  const deadline = Date.now() + Math.max(waitMs, 2000)
  while (Date.now() < deadline && alive()) await sleep(150)
  if (alive()) {
    try {
      if (proc) proc.kill()
      else if (pid !== null) process.kill(pid)
    } catch {
      // already gone
    }
  }
  if (child === proc) child = null
}

async function disconnect(wipe: boolean): Promise<YtStatus> {
  await exclusive(() => attempt('sign out', async () => {
    // An open plain sign-in window is closed first (it holds the profile).
    const pb = plain
    if (pb) {
      stopSignIn()
      await closePlainBrowser(pb)
      endSignInState()
    }
    writeState({ connected: false })
    // Wiping needs the files let go of, which only exit guarantees; a plain
    // sign-out can let the browser finish closing in its own time.
    await closeGracefully(wipe ? 9000 : 0)
    owned = false
    lastError = undefined
    // A closed browser can't vouch for its cookies; the next launch reads them.
    lastSignedIn = false
    relaunches.length = 0
    const root = profileRoot()
    if (wipe && root) {
      // Deleting files under a browser that is still running would leave
      // it with a half-gone profile (and fail on the locked ones anyway),
      // so a profile something still holds is left alone.
      if (!(await waitForProfileFree(root, 3000))) {
        lastError = 'Could not delete the YouTube browser profile. Close any open windows of it and try again.'
        return
      }
      // Windows can hold the profile's files a moment after the browser
      // exits; rm's own retries cover that.
      const opts = { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }
      try {
        await rm(join(root, 'Default'), opts)
        await rm(join(root, 'DevToolsActivePort'), opts)
      } catch (error) {
        lastError = 'Could not delete the YouTube browser profile. Close any open windows of it and try again.'
        console.warn(`Could not delete the YouTube browser profile: ${(error as Error).message}`)
      }
    }
  }))
  return publish()
}

// ---- wiring -----------------------------------------------------------------

/** Only this app's own window may drive the browser: the bundled renderer
 *  (file:) or, in development, the Vite server. */
function isOwnFrame(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return (
    url.startsWith('file:') ||
    (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
  )
}

const DESKTOP_ONLY = 'This action is only available in the desktop app.'

export function registerYoutubeBrowserIpc(): void {
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isOwnFrame(event)) return Promise.reject(new Error(DESKTOP_ONLY))
      return fn(...args)
    }
  ipcMain.handle('youtube-download:status', guarded(() => publish()))
  ipcMain.handle('youtube-download:connect', (event) =>
    isOwnFrame(event) ? connect() : Promise.resolve({ ok: false, error: DESKTOP_ONLY })
  )
  ipcMain.handle('youtube-download:show', guarded(() => show()))
  ipcMain.handle('youtube-download:hide', guarded(() => hide()))
  ipcMain.handle('youtube-download:finish-sign-in', guarded(() => finishSignIn()))
  ipcMain.handle('youtube-download:refresh', guarded(() => refresh()))
  ipcMain.handle(
    'youtube-download:disconnect',
    guarded((opts: unknown) => disconnect((opts as { wipe?: unknown } | null)?.wipe === true))
  )
  ipcMain.handle(
    'youtube-download:dont-ask',
    guarded(async (on: unknown) => {
      writeState({ dontAsk: on === true })
      return publish()
    })
  )
}

/** At app start: relaunch the connected browser minimized (not awaited, so
 *  the window never waits on it) and start the status poll. */
export function startYoutubeBrowser(mainWindow: () => BrowserWindow | null): void {
  getMainWindow = mainWindow
  if (youtubeBrowserProfile() && readState().connected) void backgroundStart()
  if (statusTimer) clearInterval(statusTimer)
  statusTimer = setInterval(() => void statusTick(), STATUS_POLL_MS)
}

/** Called on every quit, owned browser or not: stops the polls and any
 *  pending relaunch, and makes a background start that is still on its way
 *  give up before it spawns a browser nobody would then close. An open plain
 *  sign-in window is not touched (the user may be mid sign-in). */
export function youtubeBrowserQuitStarted(): void {
  appQuitting = true
  stopSignIn()
  if (statusTimer) clearInterval(statusTimer)
  statusTimer = null
  if (relaunchTimer) clearTimeout(relaunchTimer)
  relaunchTimer = null
}

/** True when quitting should first close the browser we launched or adopted. */
export function youtubeBrowserNeedsShutdown(): boolean {
  // An open plain sign-in window is the user's: left alone on quit. Only
  // while it is open, though: during 'checking' the debug browser may
  // already be relaunched (owned again) and must be closed like any other.
  return owned && !shutdownDone && !(plain && signInStep === 'browser-open')
}

/** Asks the browser to close so its cookies reach disk. Normally returns
 *  in a few ms and never takes more than ~4 s. */
export async function shutdownYoutubeBrowser(): Promise<void> {
  youtubeBrowserQuitStarted()
  shutdownDone = true
  // Normally done in a few ms: the browser takes Browser.close and finishes
  // its own shutdown after the app has gone. The race only caps a browser
  // that never answers (closeGracefully then kills it after ~2 s).
  await Promise.race([closeGracefully(0), sleep(4000)])
}
