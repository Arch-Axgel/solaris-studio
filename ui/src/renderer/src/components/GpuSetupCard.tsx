import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText, gpuApi, type GpuLayer, type GpuReport, type GpuSetupStatus } from '../lib/api'
import { t } from '../lib/i18n'
import { useReducedMotion } from '../lib/motion'
import { Button, Callout, Card, Disclosure, ProgressBar, SectionHeader, Skeleton, StatusChip, useConfirm } from './ui'
import '../styles/gpu.css'

/* Where each GPU-capable part of the app runs, and the one-click fix when the
   PyTorch build is the reason a real GPU sits idle.

   The engine runs scripts/setup_gpu.py as a separate process (server/
   gpu_routes.py): the running engine has PyTorch loaded, so the new build
   only takes effect after a restart, and the card says so instead of
   pretending the GPU is live. Not mounted here on purpose: Storage & health
   and Settings mount it. */

const POLL_MS = 1000

/** The download the button names. PyTorch's CUDA wheels for Windows are about
 *  2.6 GB (torch 2.14.1+cu126), and Linux pulls a similar total in NVIDIA's
 *  libraries; the exact size is in the dry run. */
const DOWNLOAD = '≈2.5 GB'

function chipFor(layer: GpuLayer, hasGpu: boolean): JSX.Element {
  if (layer.status === 'gpu') return <StatusChip status="done" label={t('On GPU')} />
  if (layer.status === 'off') return <StatusChip status="idle" label={t('Not available')} />
  // On the CPU is a warning only when there is a GPU it could be using; on a
  // GPU-less VPS it is simply how the app runs.
  return hasGpu ? <StatusChip status="paused" label={t('On CPU')} /> : <StatusChip status="idle" label={t('On CPU')} />
}

function cardLine(report: GpuReport): string {
  const gpus = report.nvidia.gpus
  if (!gpus.length) return t('No NVIDIA GPU found. Everything runs on the CPU, which works but is slower.')
  const driver = report.nvidia.driver
    ? `${t('driver')} ${report.nvidia.driver}${report.nvidia.driver_max_cuda ? ` (CUDA ${report.nvidia.driver_max_cuda})` : ''}`
    : ''
  return gpus
    .map((g) =>
      [g.name, g.compute_capability ? `${t('compute')} ${g.compute_capability}` : '', g.vram_gb ? `${g.vram_gb} GB` : '']
        .filter(Boolean)
        .join(' · ')
    )
    .concat(driver ? [driver] : [])
    .join(' · ')
}

function CopyCommand({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="gpu-command">
      <code>{command}</code>
      <Button
        size="sm"
        variant="subtle"
        icon={copied ? 'check' : 'copy'}
        onClick={() =>
          void navigator.clipboard.writeText(command).then(
            () => setCopied(true),
            () => setCopied(false)
          )
        }
      >
        {copied ? t('Copied') : t('Copy')}
      </Button>
    </div>
  )
}

export default function GpuSetupCard(): JSX.Element {
  const confirm = useConfirm()
  const reduced = useReducedMotion()
  const [report, setReport] = useState<GpuReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<GpuSetupStatus | null>(null)
  const [canSetup, setCanSetup] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const r = await gpuApi.report()
      if (alive.current) setReport(r)
    } catch (e) {
      if (alive.current) setLoadError(errorText(e))
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const s = await gpuApi.setupStatus()
      if (!alive.current) return
      setStatus(s)
      if (s.running) {
        timer.current = window.setTimeout(() => void poll(), POLL_MS)
      } else if (s.result && !s.dry_run) {
        void load() // the report's "restart required" changed
      }
    } catch {
      // The engine restarting mid-poll: try again rather than show an error.
      if (alive.current) timer.current = window.setTimeout(() => void poll(), POLL_MS * 3)
    }
  }, [load])

  useEffect(() => {
    alive.current = true
    void load()
    void poll() // picks up an install already running from an earlier visit
    void gpuApi.canSetup().then((ok) => alive.current && setCanSetup(ok))
    return () => {
      alive.current = false
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [load, poll])

  const start = async (dryRun: boolean): Promise<void> => {
    if (!dryRun) {
      const candidate = report?.recommendation.candidates[0]
      const ok = await confirm({
        title: t('Install GPU support?'),
        body: (
          <div className="space-y-2">
            <p>
              {t('This downloads about 2.5 GB from download.pytorch.org')}
              {candidate ? ` (PyTorch, ${candidate})` : ''}
              {t(' and replaces the PyTorch this copy of Solaris Studio uses. It can take a while on a slow connection.')}
            </p>
            <p>{t('When it finishes, restart Solaris Studio to use the GPU. If the new build cannot run on your card, the CPU build is put back.')}</p>
          </div>
        ),
        confirmLabel: t('Download and install')
      })
      if (!ok) return
    }
    setStarting(true)
    setStartError(null)
    try {
      const s = await gpuApi.startSetup({ mode: 'auto', dry_run: dryRun })
      setStatus(s)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void poll(), POLL_MS / 2)
    } catch (e) {
      setStartError(errorText(e))
    } finally {
      setStarting(false)
    }
  }

  if (!report) {
    return (
      <Card className="gpu-card">
        <SectionHeader title={t('GPU')} />
        {loadError ? (
          <Callout tone="error" title={t('Could not check the GPU')}>
            <p>{loadError}</p>
            <Button size="sm" variant="subtle" icon="refresh" className="mt-2" onClick={() => void load()}>
              {t('Try again')}
            </Button>
          </Callout>
        ) : (
          <Skeleton lines={4} />
        )}
      </Card>
    )
  }

  const hasGpu = report.nvidia.gpus.length > 0
  const setup = report.setup
  const running = Boolean(status?.running)
  const result = status?.result && !status.running ? status.result : null
  const restart = setup.restart_required || Boolean(status?.restart_required)
  const showOffer = setup.offer && !restart && !running
  // A run that changed PyTorch always needs a restart, but only a run that
  // ended on a GPU build that passed its test may promise the GPU. A failed
  // run that put the CPU build back still needs the restart, and its reason
  // must stay on screen rather than hide behind a green "restart" banner.
  const gpuInstalled = Boolean(result?.ok && result.gpu)
  const showResult = Boolean(result) && !(restart && gpuInstalled)

  return (
    <Card className="gpu-card">
      <SectionHeader title={t('GPU')} />
      <p className="gpu-card-line">{cardLine(report)}</p>

      <ul className="gpu-layers">
        {report.layers.map((layer) => (
          <li key={layer.id} className="gpu-layer">
            <span className="gpu-layer-name">{t(layer.label)}</span>
            {chipFor(layer, hasGpu)}
            <span className="gpu-layer-reason">{layer.reason}</span>
          </li>
        ))}
      </ul>

      {restart &&
        (gpuInstalled || !result ? (
          <Callout tone="success" title={t('Restart Solaris Studio to use the GPU')}>
            {t('The new PyTorch is installed. The running engine still has the old one loaded until the app restarts.')}
          </Callout>
        ) : (
          <Callout tone="warn" title={t('Restart Solaris Studio')}>
            {t('PyTorch was changed, and the running engine still has the old one loaded until the app restarts.')}
          </Callout>
        ))}

      {running && status && (
        <div className="gpu-progress" aria-live="polite">
          <ProgressBar
            value={status.pct / 100}
            label={t('Installing GPU support')}
            tone="gold"
            striped={!reduced}
            showValue
          />
          <p className="gpu-progress-msg">{status.message}</p>
        </div>
      )}

      {result && showResult && (
        <Callout
          tone={result.ok ? (result.dry_run ? 'info' : 'success') : 'error'}
          title={result.locked ? t('Close Solaris Studio to finish') : undefined}
        >
          <p className="gpu-result">{result.locked ? result.message.split('\n')[0] : result.message}</p>
          {result.locked && result.command && <CopyCommand command={result.command} />}
        </Callout>
      )}

      {showOffer && setup.available && (
        <div className="gpu-offer">
          {report.recommendation.why && <p className="gpu-why">{report.recommendation.why}</p>}
          {canSetup ? (
            <div className="gpu-actions">
              <Button variant="gold" icon="download" loading={starting} onClick={() => void start(false)}>
                {t('Install GPU support')} ({DOWNLOAD} {t('download')})
              </Button>
              <Button variant="subtle" size="sm" disabled={starting} onClick={() => void start(true)}>
                {t('Show the steps first')}
              </Button>
            </div>
          ) : (
            setup.command && (
              <>
                <p className="gpu-why">{t('Run this in a terminal with Solaris Studio closed, then start it again:')}</p>
                <CopyCommand command={setup.command} />
              </>
            )
          )}
          {startError && (
            <Callout tone="error" className="mt-2">
              {startError}
            </Callout>
          )}
        </div>
      )}

      {/* The installed app's PyTorch is part of the build: say what that means
          instead of offering a button that cannot work. */}
      {!setup.available && report.recommendation.needed && hasGpu && setup.unavailable_reason && (
        <Callout tone="info">{setup.unavailable_reason}</Callout>
      )}

      {status && status.lines.length > 0 && (
        <Disclosure summary={t('Details')} className="gpu-details">
          <pre className="gpu-log">{status.lines.map((l) => l.msg).join('\n')}</pre>
        </Disclosure>
      )}
    </Card>
  )
}
