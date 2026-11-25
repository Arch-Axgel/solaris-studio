import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { getYoutubeStatus, useYoutubeAccount, youtubeAccount } from '../lib/stores/youtubeAccount'
import { setupDone } from './SetupWizard'
import { Icon } from './icons'
import { Button, Callout, Dialog } from './ui'

/** The burner-account prompt.
 *
 *  Opens by itself once per session when YouTube downloads would benefit
 *  from a signed-in browser and the user has not said no for good, and on
 *  demand through the 'open-youtube-connect' window event (palette,
 *  Settings, Storage & health). It walks through three steps: why, waiting
 *  for the sign-in in the real browser window, and done.
 *
 *  The sign-in window is an ordinary browser with no DevTools connection
 *  (Google refuses sign-in in one under remote control), so the app can't
 *  see when the user is done: they click "I've signed in" or just close the
 *  window, and the main process then checks the result ('checking'). */

type Mode = 'intro' | 'expired' | 'waiting' | 'success'

const SHOWN_KEY = 'solaris.ytPromptShown'
const EXPIRED_KEY = 'solaris.ytExpiredShown'

// Session flags. sessionStorage survives a dev reload but not an app
// restart, which is exactly "once per launch"; the in-memory copy covers a
// blocked sessionStorage, so the prompt never re-opens within one run.
const shownInMemory = new Set<string>()
function shownThisSession(key: string): boolean {
  if (shownInMemory.has(key)) return true
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
// When this run last saw a sign-in under way. A sign-in that has just ended
// without an account (cancelled, closed, or "I've signed in" too early) has
// already told the user why, in this dialog or the Settings card, so the
// automatic "signed you out" prompt does not pile on right after it.
let signInSeenAt = 0
const SIGN_IN_GRACE_MS = 60_000

function markShown(key: string): void {
  shownInMemory.add(key)
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    /* blocked storage: the in-memory flag still holds for this run */
  }
}

/** Another modal is up (a confirm, the setup wizard re-run from Settings or
 *  Help, a sheet): an automatic prompt waits its turn instead of stacking. */
function otherModalOpen(): boolean {
  try {
    return !!document.querySelector('dialog[open]:not(.yt-connect), .wiz-overlay, [aria-modal="true"]')
  } catch {
    return false
  }
}

/** Which automatic prompt (if any) the status calls for right now. */
function autoMode(s: YtStatus | null): 'intro' | 'expired' | null {
  if (!s || s.browser === null) return null
  // Not mid sign-in: one started from Settings already has the browser open.
  if (!s.signedIn && !s.connected && !s.dontAsk && !s.signingIn) return 'intro'
  // Signed in before, browser up, but the session cookie is gone: Google
  // ended the session (or the account was challenged).
  if (s.connected && !s.signedIn && !s.signingIn && s.running) return 'expired'
  return null
}

function browserName(b: YtStatus['browser'] | string | undefined): string {
  if (b === 'edge') return 'Microsoft Edge'
  if (b === 'chrome') return 'Google Chrome'
  return typeof b === 'string' && b ? b : t('the browser')
}

export default function YouTubeConnect(): JSX.Element | null {
  const { status, supported, canConnect, actions } = useYoutubeAccount()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('intro')
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')
  // Which heading the error callout gets: the browser failed to open, or the
  // user closed it / ran out of time before signing in.
  const [errorKind, setErrorKind] = useState<'start' | 'unfinished'>('start')
  const [ready, setReady] = useState(setupDone())
  // Bumped to re-check an automatic prompt that had to wait for another modal.
  const [retry, setRetry] = useState(0)
  // Did the main process report a sign-in in progress since we clicked? Only
  // then does "no longer signing in, still signed out" mean it was abandoned.
  const sawSigningIn = useRef(false)
  const primary = useRef<HTMLButtonElement>(null)
  // While checking, both buttons are disabled (and a disabled button drops
  // focus to <body>), so focus moves to the checking message instead.
  const checkingRef = useRef<HTMLDivElement>(null)

  // Never on top of the setup wizard. setupDone() is a localStorage flag the
  // wizard writes when it finishes, so watch it until it flips.
  useEffect(() => {
    if (ready) return
    const id = setInterval(() => {
      if (setupDone()) setReady(true)
    }, 1500)
    return () => clearInterval(id)
  }, [ready])

  // The first-run intro is for someone who has never connected. Once this
  // run has seen any sign of an account (connected, signed in, a sign-in
  // under way) or a standing "don't ask", it is settled for the session:
  // otherwise Disconnect, or switching "Ask me on startup" back on in
  // Settings, would pop the intro right under the user's click.
  useEffect(() => {
    if (status && (status.connected || status.signedIn || status.signingIn || status.dontAsk)) markShown(SHOWN_KEY)
    if (status?.signingIn) signInSeenAt = Date.now()
  }, [status])

  // Automatic prompt: once per session per kind, never over another modal.
  // Keyed on the wanted prompt, not the status object: every read yields a
  // new object, and the fresh read below would otherwise cancel its own timer.
  const wanted = autoMode(status)
  useEffect(() => {
    if (!supported || !ready || open) return
    const want = wanted
    if (!want) return
    const key = want === 'intro' ? SHOWN_KEY : EXPIRED_KEY
    if (shownThisSession(key)) return
    let cancelled = false
    // "Signed you out" is only believed if it still holds a few seconds and
    // one fresh read later: a browser that has just been relaunched can
    // answer a cookie read before its profile has loaded.
    const id = setTimeout(
      async () => {
        if (want === 'expired') await youtubeAccount.refreshStatus()
        if (cancelled) return
        if (!setupDone()) {
          // Setup was reset since: wait for the wizard to finish again.
          setReady(false)
          return
        }
        if (autoMode(getYoutubeStatus()) !== want || shownThisSession(key)) return
        if (want === 'expired' && Date.now() - signInSeenAt < SIGN_IN_GRACE_MS) return
        if (otherModalOpen()) {
          setRetry((n) => n + 1)
          return
        }
        markShown(key)
        setErrorKind('start')
        setError('')
        setMode(want)
        setOpen(true)
      },
      want === 'expired' ? 5000 : retry ? 2500 : 900
    )
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [wanted, supported, ready, open, retry])

  // Manual door.
  useEffect(() => {
    const onOpen = (): void => {
      // The store's snapshot, not this render's: a caller that has just
      // awaited connect() (Switch account) dispatches before React re-renders.
      const s = getYoutubeStatus()
      markShown(SHOWN_KEY)
      setError('')
      setErrorKind('start')
      sawSigningIn.current = false
      // "Signed you out" only when the browser is up and says so: a
      // connected browser that just isn't running gets the plain intro, and
      // signing in from there relaunches it.
      setMode(s?.signingIn ? 'waiting' : s?.connected && s.running && !s.signedIn ? 'expired' : 'intro')
      setOpen(true)
    }
    window.addEventListener('open-youtube-connect', onOpen)
    return () => window.removeEventListener('open-youtube-connect', onOpen)
  }, [])

  // Follow the real browser while waiting.
  useEffect(() => {
    if (!open || mode !== 'waiting' || !status) return
    if (status.signingIn) sawSigningIn.current = true
    if (status.signedIn && !status.signingIn) {
      setMode('success')
    } else if (sawSigningIn.current && !status.signingIn && !status.signedIn) {
      // The check found no sign-in (the window was closed or "I've signed
      // in" clicked too early, or the 15-minute window ran out): back to the
      // previous step with the reason, instead of waiting forever.
      sawSigningIn.current = false
      setErrorKind('unfinished')
      // No error from the main process means the window was closed (the
      // timeout sets one); the callout's heading already says it didn't finish.
      setError(status.error || t('The browser window closed before you signed in. You can try again whenever you like.'))
      setMode(status.connected && status.running ? 'expired' : 'intro')
    }
  }, [status, open, mode])

  // A "signed you out" prompt still open when the session comes back (the
  // user signed in from Settings, or the reading was a blip) would be stale.
  useEffect(() => {
    if (open && mode === 'expired' && status?.signedIn && !status.signingIn) setMode('success')
  }, [status, open, mode])

  // Each step moves focus to its main button, so keyboard users land on the
  // next thing to do instead of the dialog's close button.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => primary.current?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(id)
  }, [mode, open])

  const isChecking = open && mode === 'waiting' && (finishing || status?.signInStep === 'checking')
  useEffect(() => {
    if (!isChecking) return
    const id = setTimeout(() => checkingRef.current?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(id)
  }, [isChecking])

  if (!canConnect) return null

  const close = (): void => {
    setOpen(false)
    setBusy(false)
  }

  // "I've signed in": the main process closes the sign-in window and checks;
  // the status it pushes moves this dialog on (success, or back with why).
  const finishSignIn = async (): Promise<void> => {
    setFinishing(true)
    try {
      await actions.finishSignIn()
    } catch (e) {
      setErrorKind('unfinished')
      setError(String(e).replace(/^Error:\s*/, ''))
      setMode(status?.connected && status.running ? 'expired' : 'intro')
    } finally {
      setFinishing(false)
    }
  }

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setErrorKind('start')
    sawSigningIn.current = false
    try {
      const r = await actions.connect()
      if (!r.ok) {
        setError(r.error ? t(r.error) : t('Could not open a supported browser.'))
        return
      }
      setMode('waiting')
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const dontAsk = async (): Promise<void> => {
    close()
    try {
      await actions.setDontAsk(true)
    } catch {
      /* the prompt is closed either way; Settings can still change it */
    }
  }

  // Cancel means stop. During a sign-in, hide() is the main process's
  // cancel: it closes the sign-in window (nothing is deleted) and brings a
  // previously connected browser back to the background. Without a sign-in
  // under way, a never-connected browser has nothing to keep running.
  const cancelWaiting = async (): Promise<void> => {
    close()
    try {
      if (status?.signingIn || status?.connected) await actions.hide()
      else if (status) await actions.disconnect(false)
    } catch {
      /* nothing to undo */
    }
  }

  const name = browserName(status?.browser)
  const checking = mode === 'waiting' && (finishing || status?.signInStep === 'checking')

  const title =
    mode === 'waiting'
      ? t('Finish signing in')
      : mode === 'success'
        ? t('You’re all set')
        : mode === 'expired'
          ? t('YouTube signed you out')
          : t('Keep YouTube downloads working')

  const liveText =
    mode === 'waiting'
      ? checking
        ? t('Checking your sign-in…')
        : t('Waiting for you to sign in in the browser window.')
      : mode === 'success'
        ? t('Signed in.')
        : ''

  const footer =
    mode === 'waiting' ? (
      <>
        <Button variant="ghost" disabled={checking} onClick={() => void cancelWaiting()}>
          {t('Cancel')}
        </Button>
        {supported ? (
          <Button ref={primary} variant="gold" icon="check" loading={checking} onClick={() => void finishSignIn()}>
            {t('I’ve signed in')}
          </Button>
        ) : (
          <Button ref={primary} variant="gold" icon="check" onClick={close}>
            {t('I’ve signed in')}
          </Button>
        )}
      </>
    ) : mode === 'success' ? (
      <Button ref={primary} variant="gold" icon="check" onClick={close}>
        {t('Done')}
      </Button>
    ) : (
      <>
        {mode === 'intro' && supported && (
          <Button variant="subtle" size="sm" className="mr-auto" onClick={() => void dontAsk()}>
            {t('Don’t ask again')}
          </Button>
        )}
        <Button variant="ghost" onClick={close}>
          {t('Not now')}
        </Button>
        <Button ref={primary} variant="gold" icon="youtube" loading={busy} onClick={() => void signIn()}>
          {error && errorKind === 'unfinished'
            ? t('Try again')
            : mode === 'expired'
              ? t('Sign in again')
              : t('Sign in with a burner account')}
        </Button>
      </>
    )

  return (
    <Dialog open={open} onClose={close} title={title} size="md" footer={footer} className="yt-connect">
      <p className="sr-only" role="status" aria-live="polite">
        {liveText}
      </p>

      {(mode === 'intro' || mode === 'expired') && (
        <div className="space-y-3 text-sm text-muted leading-relaxed anim-fade" key={mode}>
          {mode === 'expired' ? (
            <p>
              {t(
                'The burner account’s session ended, so YouTube may start asking downloads to prove they aren’t a bot again. Sign in once more and Solaris Studio will keep it running in the background as before.'
              )}
            </p>
          ) : (
            <p>
              {t(
                'YouTube sometimes blocks downloads with a “confirm you’re not a bot” check. Signing a Google account into a browser that Solaris Studio keeps for downloads fixes it.'
              )}
            </p>
          )}
          <Callout tone="gold" icon="alert" title={t('Use a burner account, not your main one')}>
            {t('Create a throwaway Google account for this. If YouTube ever flags the downloads, your real account stays out of it.')}
          </Callout>
          <ul className="yt-connect-points">
            <li>
              <Icon name="check" size={14} className="text-gold" />
              <span>{t('It stays signed in, even after you restart Solaris Studio.')}</span>
            </li>
            <li>
              <Icon name="minimize" size={14} className="text-gold" />
              <span>{t('The browser runs minimized in the background and is refreshed before each download.')}</span>
            </li>
            <li>
              <Icon name="hard-drive" size={14} className="text-gold" />
              <span>{t('Its cookies never leave this PC.')}</span>
            </li>
            <li>
              <Icon name="info" size={14} className="text-gold" />
              <span>{t('Google may ask you to verify a brand-new account with a phone number or a captcha. That happens in the browser, not here.')}</span>
            </li>
          </ul>
          {error && (
            // role="alert": the error lands in a dialog that is already open,
            // so a screen reader would otherwise not hear it.
            <div role="alert">
              <Callout
                tone="error"
                title={errorKind === 'unfinished' ? t('Sign-in didn’t finish') : t('Couldn’t start the sign-in')}
              >
                {error}
              </Callout>
            </div>
          )}
        </div>
      )}

      {mode === 'waiting' && checking && (
        <div className="yt-connect-wait anim-fade outline-none" key="checking" ref={checkingRef} tabIndex={-1}>
          <span className="yt-connect-pulse" aria-hidden>
            <span className="ui-spinner" />
          </span>
          <div className="min-w-0">
            <p className="text-ink font-medium">{t('Checking your sign-in…')}</p>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              {t('Solaris Studio is closing the sign-in window and starting its background browser to confirm the account.')}
            </p>
          </div>
        </div>
      )}

      {mode === 'waiting' && !checking && (
        <div className="yt-connect-wait anim-fade">
          <span className="yt-connect-pulse" aria-hidden>
            <Icon name="youtube" size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-ink font-medium">{t('Finish signing in in the browser window that opened')}</p>
            {supported ? (
              // The sign-in window is an ordinary browser with no remote
              // connection, so there is no "show it again" here: the app
              // can't bring it forward, and the user can see it already.
              <p className="text-sm text-muted mt-1 leading-relaxed">
                {t('Sign in to your burner Google account in the browser window that opened. When you’re done, click I’ve signed in — or just close that window.')}
              </p>
            ) : (
              <p className="text-sm text-muted mt-1 leading-relaxed">
                {t('Sign in to your burner Google account in')} {name}. {t('Come back here when you’re done.')}
              </p>
            )}
          </div>
        </div>
      )}

      {mode === 'success' && (
        <div className="yt-connect-done">
          <span className="yt-connect-check anim-pop" aria-hidden>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path className="draw" pathLength={24} d="M5 12.5l4.5 4.5L19 7" style={{ '--delay': '160ms' } as React.CSSProperties} />
            </svg>
          </span>
          <p className="text-sm text-muted leading-relaxed text-center max-w-sm anim-rise">
            {t('Signed in. Solaris Studio will keep this browser running quietly in the background and refresh it before each download.')}
          </p>
        </div>
      )}
    </Dialog>
  )
}
