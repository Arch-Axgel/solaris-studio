import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { celebrate } from '../lib/motion'
import { navigate, openCreate, openLayer } from '../lib/nav'
import { useEvents } from '../lib/useEvents'
import type { Preflight, PreflightCheck, SystemStats } from '../lib/types'
import OpenRouterPrompt from './OpenRouterPrompt'
import { t } from '../lib/i18n'
import { Icon, type IconName } from './icons'
import { Button, ProgressBar, ProgressRing, StepProgress } from './ui'
import fullLogo from '../assets/solaris-logo-full.png'
import { Overlay } from './ui/Overlay'

const DONE_KEY = 'setup-wizard-done'

/** Has the wizard been completed on this machine? */
export function setupDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function resetSetup(): void {
  try {
    localStorage.removeItem(DONE_KEY)
  } catch {
    /* nothing stored, nothing to reset */
  }
}

const LABEL: Record<string, string> = {
  ffmpeg: 'Video engine',
  ffprobe: 'Video inspector',
  // Not "Ollama" any more. It ships inside the app and starts itself, so its
  // brand name is an implementation detail — naming it here only invites
  // someone to go and install a second copy.
  ollama: 'AI runtime',
  model: 'AI model',
  ai: 'AI model',
  whisper: 'Transcription',
  transcription: 'Transcription',
  gpu: 'Graphics card',
  disk: 'Free space'
}

/** A plain one-liner for a check. Engines report raw tool output (ffmpeg's
 *  whole version banner, "no transcription weights bundled"): the full text
 *  stays in the tooltip, the row says what it means. */
function checkSummary(check: PreflightCheck): string {
  const d = (check.detail ?? '').trim()
  if (check.name === 'ffmpeg' || check.name === 'ffprobe') {
    if (!check.ok) return d
    const v = d.match(/^n?(\d+(?:\.\d+)*)/)
    return v ? `${t('Installed')} · ${t('version')} ${v[1]}` : t('Installed')
  }
  if ((check.name === 'whisper' || check.name === 'transcription') && !check.ok && /weights|not (?:bundled|downloaded)/i.test(d))
    return t('Downloads with your first video')
  return d.replace(/\s*Copyright.*$/i, '')
}

// Start fetching the logo as soon as this module loads, so the welcome step
// doesn't show an empty glow while the image is still on its way.
if (typeof Image !== 'undefined') {
  const pre = new Image()
  pre.decoding = 'async'
  pre.src = fullLogo
}

function CheckRow({ check, index = 0 }: { check: PreflightCheck; index?: number }): JSX.Element {
  const state = check.ok ? 'ok' : check.blocking ? 'bad' : 'warn'
  const icon: IconName = state === 'ok' ? 'check' : state === 'bad' ? 'x' : 'alert'
  const summary = checkSummary(check)
  return (
    <div className="wiz-check" data-state={state} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      <span
        className="wiz-check-mark"
        role="img"
        aria-label={state === 'ok' ? 'ready' : state === 'bad' ? 'missing' : 'warning'}
      >
        <Icon name={icon} size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{LABEL[check.name] ?? check.name}</p>
        <p className="text-xs text-muted truncate" title={check.detail}>
          {summary}
        </p>
        {!check.ok && check.fix && <p className="text-xs text-gold mt-1">{check.fix}</p>}
      </div>
    </div>
  )
}

/** First-run setup. Walks a new creator from "just installed" to "ready to
 *  make a clip".
 *
 *  This used to be a checkpoint: it stopped, told people Ollama was a separate
 *  program, and sent them to a website to install it. The runtime now ships
 *  inside the app, so the only thing left that cannot be bundled is the
 *  language model — several gigabytes, under a licence that has to be accepted
 *  by the person downloading it rather than on their behalf. So the wizard
 *  asks for nothing and installs nothing. It starts that one download by
 *  itself and shows how far along it is. */
export default function SetupWizard({ onClose }: { onClose: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [pre, setPre] = useState<Preflight | null>(null)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [rec, setRec] = useState<{ model: string; reason: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [pullStatus, setPullStatus] = useState<string | null>(null)
  const [pullPct, setPullPct] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [logoReady, setLogoReady] = useState(false)
  const finishRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setChecking(true)
    setError('')
    try {
      // The recommendation comes from the SERVER, which owns the one hardware
      // table. Deciding it here as well produced advice that contradicted the
      // Models page for the same graphics card.
      const [p, s, m] = await Promise.all([
        api.preflight(),
        api.systemStats().catch(() => null),
        api.models().catch(() => null)
      ])
      setPre(p)
      if (s) setStats(s)
      if (m?.recommended) setRec(m.recommended)
    } catch (e) {
      setError(
        'Could not reach the Solaris Studio engine. If you just installed, give it a few seconds and try again.'
      )
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEvents((e) => {
    if (e.type !== 'model_pull') return
    if (e.status === 'done') {
      setPullStatus('Downloaded')
      setPullPct(100)
      void refresh()
    } else if (e.status === 'error') {
      setPullStatus(`Download failed: ${e.error ?? 'unknown error'}`)
      setPullPct(null)
    } else {
      setPullStatus(e.status ?? 'downloading')
      setPullPct(e.completed && e.total ? Math.round((e.completed / e.total) * 100) : null)
    }
  })

  // Defensive: a partial answer from an older engine must not take the window down.
  const checks: PreflightCheck[] = Array.isArray(pre?.checks) ? pre.checks : []
  const check = (name: string): PreflightCheck | undefined => checks.find((c) => c.name === name)
  const ollamaOk = check('ollama')?.ok ?? false
  const modelOk = check('model')?.ok ?? false
  // The AI runs locally only when the engine reports the bundled runtime.
  // On a cloud provider (OpenRouter on the user's own key) the 'ai' check
  // carries the whole answer and there is nothing to download.
  const localAI = !!check('ollama') || !!check('model')
  const aiCheck = check('ai')
  const cloudReady = !localAI && !!aiCheck?.ok
  // /system/stats can come back without a GPU reading while the preflight's
  // own GPU check sees the card; trust whichever one actually found it.
  const gpuCheck = check('gpu')
  const gpuName = stats?.gpu?.name ?? (gpuCheck?.ok ? gpuCheck.detail : null)
  const gpuVram = (() => {
    if (stats?.gpu?.vram_total) return stats.gpu.vram_total
    const m = gpuCheck?.ok ? gpuCheck.detail.match(/([\d.]+)\s*GB/i) : null
    return m ? parseFloat(m[1]) * 1024 ** 3 : 0
  })()

  // A pull is server-side and survives this component, so "have we already
  // asked for one" is not something the render state can be trusted for —
  // re-entering the step would queue a second download of the same model.
  const pullStarted = useRef(false)

  const startPull = useCallback(async (): Promise<void> => {
    if (!rec || pullStarted.current) return
    pullStarted.current = true
    setPullStatus('starting…')
    setPullPct(null)
    try {
      await api.pullModel(rec.model)
    } catch (e) {
      setPullStatus(`Could not start: ${e instanceof Error ? e.message : e}`)
      pullStarted.current = false // so Try again actually tries again
    }
  }, [rec])

  // Start the download the moment the setup step opens. Nobody installs a
  // clipping app in order to choose a language model, and the one worth having
  // is decided by their graphics card — which the server already knows.
  useEffect(() => {
    if (step === 1 && ollamaOk && rec && !modelOk) void startPull()
  }, [step, ollamaOk, rec, modelOk, startPull])

  // The finish screen: a burst of gold when everything is ready.
  useEffect(() => {
    if (step !== 2 || !pre?.ready) return
    const id = setTimeout(() => celebrate(finishRef.current), 220)
    return () => clearTimeout(id)
  }, [step, pre?.ready])

  const finish = (): void => {
    try {
      localStorage.setItem(DONE_KEY, '1')
    } catch {
      /* the wizard may show again next time; nothing else depends on it */
    }
    onClose()
  }

  /** Finish, then go somewhere (onClose lands on Home first). */
  const finishTo = (go: () => void): void => {
    finish()
    setTimeout(go, 0)
  }

  const steps = ['Welcome', 'Setting up', 'Ready']
  // The orbit ring around the logo doubles as the model download's progress.
  const ringValue = modelOk ? 1 : pullPct !== null ? pullPct / 100 : step === 1 && pullStatus ? null : 0

  return (
    // A native modal in the top layer (components/ui/Overlay): the app behind
    // is inert, focus stays in the wizard, toasts and Esc can't fall through.
    <Overlay onClose={() => undefined} escCloses={false} backdropCloses={false} labelledBy="wiz-title" className="wiz-overlay">
      <span className="wiz-letterbox wiz-letterbox-top" aria-hidden />
      <span className="wiz-letterbox wiz-letterbox-bottom" aria-hidden />
      {/* Never taller than the window: the steps scroll inside, and the
          progress rail and the Skip/Continue bar stay in view. */}
      <div className="wiz-card w-full max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
        {/* progress rail */}
        <div className="wiz-steps shrink-0">
          <StepProgress steps={steps} current={step} />
        </div>

        <div className="wiz-body flex-1 min-h-0 overflow-y-auto">

          {/* ---------------------------------------------- 0: welcome */}
          {step === 0 && (
            <div key="s0" className="anim-rise">
              {/* The logo's burgundy lettering was drawn for a light ground, so
                  a soft ivory-gold glow sits behind it to keep it legible. */}
              {/* Smaller on short screens so the welcome text still fits. */}
              <div className="wiz-emblem wiz-emblem-lg">
                <span className="wiz-orbit border-orbit" aria-hidden />
                <span className="wiz-glow" aria-hidden />
                <img
                  src={fullLogo}
                  alt="Solaris Studio by Arch"
                  width={176}
                  height={176}
                  className="wiz-logo"
                  decoding="async"
                  // Fades in once decoded instead of popping in over the glow.
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0 && !logoReady) setLogoReady(true)
                  }}
                  onLoad={() => setLogoReady(true)}
                  style={{ opacity: logoReady ? 1 : 0, transition: 'opacity var(--dur-4, 320ms) var(--ease-out, ease-out)' }}
                />
              </div>
              <h2 id="wiz-title" className="t-xl text-ink text-center">
                Welcome to <span className="text-foil">Solaris Studio</span>
              </h2>
              <p className="text-sm text-muted mt-3 leading-relaxed">
                Paste a link to a YouTube video, Twitch VOD or Kick VOD and Solaris Studio finds
                the best moments, crops them to fit a phone screen, and writes captions and
                titles for you.
              </p>
              <div className="wiz-promises stagger">
                {(
                  [
                    ['hard-drive', 'Runs on this computer', 'Your videos are never uploaded anywhere.'],
                    ['heart', 'No subscription', 'No limit on how many clips you make.'],
                    ['clock', 'About a minute', 'We check everything, then pick a model for your graphics card.']
                  ] as [IconName, string, string][]
                ).map(([icon, title, body], i) => (
                  <div key={title} className="wiz-promise" style={{ '--i': i } as React.CSSProperties}>
                    <Icon name={icon} size={18} />
                    <p className="text-sm text-ink font-medium">{title}</p>
                    <p className="text-xs text-muted">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------- 1: checks + the one download */}
          {step === 1 && (
            <div key="s1" className="anim-rise">
              <div className="flex items-center gap-5">
                <div className="wiz-emblem wiz-emblem-sm">
                  <ProgressRing value={ringValue} size={84} stroke={5} label="AI model download" tone={modelOk ? 'success' : 'gold'}>
                    <img src={fullLogo} alt="" width={56} height={56} className="wiz-logo-sm" />
                  </ProgressRing>
                </div>
                <div className="min-w-0">
                  <h2 id="wiz-title" className="t-xl text-ink">Setting up</h2>
                  {cloudReady ? (
                    <p className="text-sm text-muted mt-1 leading-relaxed">
                      {t('Everything Solaris Studio needs came with it, and your AI is already set up, so there is nothing to download. Here is what we checked.')}
                    </p>
                  ) : (
                    <p className="text-sm text-muted mt-1 leading-relaxed">
                      Everything Solaris Studio needs came with it, apart from the AI model that picks
                      the moments worth clipping. We&apos;re fetching the one that suits your graphics
                      card now — it downloads once and then works offline.
                    </p>
                  )}
                </div>
              </div>
              {/* For the old laptop or low-spec mini PC that cannot run the
                  model: OpenRouter on their own key instead. Prominent when
                  the card is under the "Under 6 GB VRAM, or an older PC" tier
                  the model guide uses (llm/manager.recommend_for), or there is
                  no card at all. The local download carries on either way, so
                  a machine that can run it still ends up ready. */}
              {/* Only while the AI would run on this PC: someone already on
                  OpenRouter doesn't need to be sold it. */}
              {pre && !cloudReady && (() => {
                const lowSpec = (!!stats || !!gpuCheck) && (!gpuName || gpuVram < 5.5 * 1024 ** 3)
                return (
                  <OpenRouterPrompt
                    className="mt-4"
                    prominent={lowSpec}
                    title={lowSpec ? 'Local AI may be slow on this computer.' : 'PC too old to run AI?'}
                    body={
                      lowSpec
                        ? 'Recommended: OpenRouter. Bring your own OpenRouter key to use a cloud model instead (billed by OpenRouter to your account).'
                        : 'Use OpenRouter with your own key instead, billed by OpenRouter to your account.'
                    }
                    onSetup={finish}
                  />
                )
              })()}
              {error && (
                <div className="wiz-error mt-4" role="alert">
                  <Icon name="alert" size={16} />
                  {error}
                </div>
              )}
              {!pre && !error && (
                <div className="mt-4 space-y-2" aria-busy="true">
                  <p className="text-sm text-muted">Checking…</p>
                  <div className="skeleton h-12" />
                  <div className="skeleton h-12" />
                </div>
              )}

              {pre && (
                <>
                  <div className="wiz-model mt-4">
                    <p className="text-xs text-muted flex items-center gap-1.5">
                      <Icon name="cpu" size={13} />
                      {gpuName ? `Detected: ${gpuName}` : 'No graphics card detected'}
                    </p>
                    {cloudReady ? (
                      <p className="text-sm font-semibold text-gold-strong mt-1 flex items-center gap-1.5">
                        <Icon name="check" size={15} className="text-success" />
                        <span className="min-w-0">
                          {t('AI ready')}: <span className="font-medium text-ink">{aiCheck?.detail}</span>
                        </span>
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-gold-strong mt-1">
                          {modelOk
                            ? `✓ ${check('model')?.detail}`
                            : pullStatus
                              ? `Downloading ${rec ? rec.model : '…'}`
                              : rec
                                ? `${t('AI model')}: ${rec.model}`
                                : aiCheck && !aiCheck.ok && !localAI
                                  ? `${t('AI not set up yet')} · ${aiCheck.detail}`
                                  : t('Looking for the right AI model…')}
                        </p>
                        {rec?.reason && <p className="text-xs text-muted mt-1 leading-relaxed">{rec.reason}</p>}
                      </>
                    )}

                    {!modelOk && pullStatus && (
                      <div className="mt-3">
                        <p className="text-xs text-muted tabular-nums">
                          {pullStatus}
                          {pullPct !== null ? ` · ${pullPct}%` : ''}
                        </p>
                        <ProgressBar
                          value={pullPct !== null ? Math.max(0.02, pullPct / 100) : null}
                          label="AI model download"
                          tone="gold"
                          striped
                          size="sm"
                          className="mt-1.5"
                        />
                        <p className="text-[11px] text-muted mt-1.5">
                          Several gigabytes — it can take a while on a slow connection. You can
                          leave this window open, or carry on and let it finish in the
                          background.
                        </p>
                        {!pullStarted.current && (
                          <Button variant="ghost" size="sm" icon="retry" className="mt-2" onClick={startPull}>
                            Try again
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="wiz-checks mt-4 stagger">
                    {/* The box above already reports the AI and the graphics
                        card; the list carries the rest. */}
                    {checks
                      .filter((c) => !(cloudReady && c.name === 'ai') && !(c.name === 'gpu' && c.ok && gpuName))
                      .map((c, i) => (
                      <CheckRow key={c.name} check={c} index={i} />
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" icon="refresh" className="mt-4" loading={checking} disabled={checking} onClick={refresh}>
                    {checking ? 'Checking…' : 'Check again'}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ---------------------------------------------- 2: done */}
          {step === 2 && (
            <div key="s2" className="anim-rise" ref={finishRef}>
              <div className="wiz-finish-mark" data-ready={pre?.ready ? 'true' : 'false'} aria-hidden>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  {pre?.ready ? (
                    <path className="draw" pathLength={24} d="m4.5 12.5 5 5L20 7" />
                  ) : (
                    <path className="draw" pathLength={24} d="M12 7v6m0 4h.01" />
                  )}
                </svg>
              </div>
              <h2 id="wiz-title" className="t-xl text-ink text-center">
                {pre?.ready ? "You're ready" : 'Nearly there'}
              </h2>
              {pre?.ready ? (
                <>
                  <p className="text-sm text-muted mt-3 leading-relaxed text-center">
                    Everything is installed. Paste a video link on Home and press <b>Generate</b>.
                  </p>
                  <p className="text-sm text-muted mt-2 leading-relaxed text-center">
                    A first video takes a while — it downloads, transcribes, then studies the
                    whole thing before it renders anything. Later videos from the same creator
                    get faster as the app learns them.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted mt-3 leading-relaxed">
                    Some things are still missing. You can carry on and sort them out later —
                    the app will tell you what it needs when you try to make a clip.
                  </p>
                  <div className="wiz-checks mt-4">
                    {checks.filter((c) => !c.ok).map((c, i) => (
                      <CheckRow key={c.name} check={c} index={i} />
                    ))}
                  </div>
                </>
              )}
              <div className="wiz-next stagger">
                {(
                  [
                    ['plus', 'Make your first clips', 'Paste a link and pick a preset.', () => finishTo(() => openCreate())],
                    ['radar', 'Watch a channel', 'New uploads get clipped by themselves.', () => finishTo(() => navigate({ page: 'watch' }))],
                    ['orbit', 'Take the tour', 'Thirty seconds around the studio.', () => finishTo(() => openLayer('tour'))]
                  ] as [IconName, string, string, () => void][]
                ).map(([icon, title, body, run], i) => (
                  <button key={title} type="button" className="wiz-next-card lift" style={{ '--i': i } as React.CSSProperties} onClick={run}>
                    <span className="wiz-next-icon">
                      <Icon name={icon} size={20} />
                    </span>
                    <span className="text-sm text-ink font-medium">{title}</span>
                    <span className="text-xs text-muted">{body}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-4 text-center">
                You can run this again any time from Settings.
              </p>
            </div>
          )}
        </div>

        {/* ---------------------------------------------- footer */}
        <div className="wiz-footer shrink-0 flex items-center gap-2">
          {step > 0 && (
            <Button variant="ghost" icon="arrow-left" onClick={() => setStep((n) => n - 1)}>
              Back
            </Button>
          )}
          {/* Nothing to skip on the last step: Start clipping already does it. */}
          {step < steps.length - 1 ? (
            <Button variant="subtle" size="sm" className="ml-auto" onClick={finish}>
              Skip setup
            </Button>
          ) : (
            <span className="ml-auto" />
          )}
          {step < steps.length - 1 ? (
            // No gate any more. There is nothing left for a creator to go and
            // install, so nothing they could be blocked on fixing — and the
            // model download continues server-side whether this window is on
            // this step or not.
            <Button variant="accent" iconRight="arrow-right" className="nudge" onClick={() => setStep((n) => n + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="gold" icon="sparkle" onClick={finish}>
              Start clipping
            </Button>
          )}
        </div>
      </div>
    </Overlay>
  )
}
