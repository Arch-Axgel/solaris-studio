import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, openSettings } from '../lib/nav'
import { celebrate } from '../lib/motion'
import { invalidateLibrary } from '../lib/stores/library'
import { useSystemStats } from '../lib/stores/statsStore'
import { useVisible } from '../lib/stores/useVisible'
import { canConnectYoutube, openYoutubeConnect, useYoutubeAccount, youtubeAccount } from '../lib/stores/youtubeAccount'
import { relativeTime } from '../components/home/homeUtil'
import GpuSetupCard from '../components/GpuSetupCard'
import type { Preflight, PreflightCheck } from '../lib/types'
import { Icon, type IconName } from '../components/icons'
import {
  Button,
  Card,
  CountUp,
  EmptyState,
  PageHeader,
  ProgressRing,
  SectionHeader,
  Skeleton,
  toast,
  useConfirm
} from '../components/ui'

/** Storage & health (spec 4.13): can this PC make a clip right now, where
 *  the disk went, and a way to get some of it back. */

type StorageInfo = Awaited<ReturnType<typeof api.storage>>
type VideosInfo = Awaited<ReturnType<typeof api.storageVideos>>

/** Decimal units (1 GB = 10^9 bytes), GB to one decimal like AI models'
 *  "Free disk". Settings › Files & storage uses the same function
 *  (Settings.tsx fmtBytes); keep the two in step. */
const fmtBytes = (b: number): string => {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`
  return `${Math.round(b)} B`
}

const RECLAIM_LABELS: Record<string, string> = {
  partial_downloads: 'Interrupted downloads',
  orphan_downloads: 'Downloads with no video',
  orphan_transcripts: 'Transcripts with no video',
  render_leftovers: 'Leftovers from failed renders',
  orphan_clips: 'Clip files not in your library',
  previews: 'Editor previews (rebuilt on demand)'
}

/** Engine check ids as words. Unknown ids fall through unchanged. */
const CHECK_LABELS: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  ffprobe: 'FFprobe',
  ai: 'AI model',
  ollama: 'AI model',
  whisper: 'Transcription (Whisper)',
  gpu: 'Graphics card',
  disk: 'Disk space'
}
const checkLabel = (name: string): string => {
  const known = CHECK_LABELS[name.toLowerCase()]
  return known ? t(known) : name
}
/** Version banners carry a copyright line nobody needs here. */
const checkDetail = (text: string): string => text.split(/\s+Copyright /)[0].trim()

function StateMark({ ok, i }: { ok: boolean; i: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      {ok ? (
        <path className="draw" pathLength={24} d="M5 12.5l4.5 4.5L19 7" style={{ '--delay': `${200 + i * 60}ms` } as React.CSSProperties} />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <path d="M12 7.5v5.5M12 16.5h.01" />
        </>
      )}
    </svg>
  )
}

function checkIcon(name: string): IconName {
  const n = name.toLowerCase()
  if (n.includes('ffmpeg') || n.includes('ffprobe')) return 'film'
  if (n.includes('ollama') || n.includes('model') || n.includes('ai')) return 'cpu'
  if (n.includes('whisper') || n.includes('transcri')) return 'note'
  if (n.includes('gpu') || n.includes('cuda')) return 'zap'
  if (n.includes('disk') || n.includes('space')) return 'hard-drive'
  return 'check'
}

function CheckRow({ c, i }: { c: PreflightCheck; i: number }): JSX.Element {
  const tone = c.ok ? 'ok' : c.blocking ? 'bad' : 'warn'
  return (
    <li className="sys-check" data-tone={tone} style={{ animationDelay: `${i * 60}ms` }}>
      <span className="sys-check-icon" aria-hidden>
        <Icon name={checkIcon(c.name)} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="sys-check-head">
          <p className="text-sm text-ink font-medium" title={c.name}>
            {checkLabel(c.name)}
          </p>
          <span className="sys-check-state">
            <StateMark ok={c.ok} i={i} />
            {c.ok ? t('Ready') : t('Needs attention')}
          </span>
        </div>
        <p className="sys-check-detail">{checkDetail(c.ok ? c.detail : c.fix || c.detail)}</p>
      </div>
    </li>
  )
}

/** The burner YouTube account, as one more health check. It is not part of
 *  the engine's preflight (the main process owns that browser), so it is
 *  drawn here from the shared store. Never blocking: downloads work without
 *  it until YouTube asks for a sign-in. */
function YouTubeCheckRow({ i }: { i: number }): JSX.Element | null {
  const { status, supported, canConnect, state } = useYoutubeAccount()
  const [starting, setStarting] = useState(false)
  if (!canConnect) return null
  const ok = state === 'signed-in'
  const tone = ok ? 'ok' : 'warn'
  const detail = !supported
    ? t('Sign in a burner account if YouTube asks downloads to confirm you’re not a bot.')
    : state === 'signed-in'
      ? `${t('A burner account is signed in and kept running in the background.')}${
          status?.lastRefreshAt ? ` ${t('Refreshed')} ${relativeTime(status.lastRefreshAt)}.` : ''
        }`
      : state === 'signing-in'
        ? status?.signInStep === 'checking'
          ? t('Checking your sign-in…')
          : t('Waiting for you to finish signing in in the browser window.')
        : state === 'not-running'
          ? t('Signed in before, but the download browser isn’t running right now.')
          : state === 'no-browser'
            ? t('Install Microsoft Edge or Google Chrome to use a burner account for downloads.')
            : t('Not signed in. YouTube may block some downloads with a bot check.')
  const showFix = supported ? state === 'signed-out' || state === 'not-running' : true
  return (
    <li className="sys-check" data-tone={tone} style={{ animationDelay: `${i * 60}ms` }}>
      <span className="sys-check-icon" aria-hidden>
        <Icon name="youtube" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="sys-check-head">
          <p className="text-sm text-ink font-medium">{t('YouTube sign-in')}</p>
          <span className="sys-check-state" aria-live="polite">
            <StateMark ok={ok} i={i} />
            {ok ? t('Ready') : state === 'signing-in' ? t('Signing in…') : t('Needs attention')}
          </span>
        </div>
        <p className="sys-check-detail">{detail}</p>
        {supported && state === 'signing-in' && status?.signInStep === 'browser-open' && (
          // The sign-in window is an ordinary browser the app doesn't watch,
          // so the user says when they're done (closing it works too).
          <Button
            variant="subtle"
            size="sm"
            icon="check"
            className="sys-check-fix"
            loading={starting}
            onClick={() => {
              setStarting(true)
              void youtubeAccount
                .finishSignIn()
                .catch(() => undefined)
                .finally(() => setStarting(false))
            }}
          >
            {t('I’ve signed in')}
          </Button>
        )}
        {showFix &&
          (supported && state === 'not-running' ? (
            // Already signed in before, just not running: relaunch it in the
            // background rather than walking through sign-in again.
            <Button
              variant="subtle"
              size="sm"
              icon="refresh"
              className="sys-check-fix"
              loading={starting}
              onClick={() => {
                setStarting(true)
                void youtubeAccount
                  .refresh()
                  .catch(() => undefined)
                  .finally(() => setStarting(false))
              }}
            >
              {t('Start in the background')}
            </Button>
          ) : (
            <Button variant="subtle" size="sm" icon="youtube" className="sys-check-fix" onClick={openYoutubeConnect}>
              {t('Sign in')}
            </Button>
          ))}
      </div>
    </li>
  )
}

function Health({ active }: { active: boolean }): JSX.Element {
  const [pf, setPf] = useState<Preflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(0)
  const load = useCallback(() => {
    setBusy(true)
    api
      .preflight()
      .then(setPf)
      .catch(() => setPf({ ready: false, checks: [] }))
      .finally(() => {
        setBusy(false)
        setRun((n) => n + 1)
      })
  }, [])
  useEffect(() => {
    if (active && !pf) load()
  }, [active, pf, load])

  const yt = useYoutubeAccount()
  const checks = pf?.checks ?? []
  // The YouTube row is drawn with the engine's checks, so the ring counts it too.
  const ytShown = yt.canConnect && pf !== null && (checks.length > 0 || canConnectYoutube())
  const total = checks.length + (ytShown ? 1 : 0)
  const okCount = checks.filter((c) => c.ok).length + (ytShown && yt.state === 'signed-in' ? 1 : 0)
  const blocking = checks.filter((c) => !c.ok && c.blocking).length
  const frac = total ? okCount / total : 0
  const offline = pf !== null && checks.length === 0

  return (
    <Card className="sys-health" variant={pf?.ready ? 'plain' : 'plain'}>
      <div className="sys-health-hero">
        <ProgressRing
          value={pf ? frac : null}
          size={112}
          stroke={7}
          label={t('Checks passed')}
          tone={blocking ? 'error' : okCount === total && total ? 'success' : 'gold'}
        >
          <span className="text-center">
            <span className="block t-kpi tabular leading-none">
              {pf ? `${okCount}/${total}` : '…'}
            </span>
            <span className="t-micro">{t('ready')}</span>
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="t-micro">{t('Preflight')}</p>
          <h2 className="t-lg text-ink mt-1">
            {!pf
              ? t('Checking this PC…')
              : offline
                ? t('The engine isn’t answering')
                : blocking
                  ? `${blocking} ${blocking === 1 ? t('thing stops clips being made') : t('things stop clips being made')}`
                  : pf.ready && okCount === total
                    ? t('Ready to make clips')
                    : t('Ready, with a few things to look at')}
          </h2>
          <p className="text-sm text-muted mt-1 max-w-lg">
            {offline
              ? t('Solaris Studio’s engine didn’t reply. If it was just starting, give it a moment and run the checks again.')
              : t('FFmpeg, the AI, the transcription model, the graphics card and free disk space, checked the way a job would use them.')}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="ghost" size="sm" icon="refresh" loading={busy} onClick={load}>
              {t('Re-run checks')}
            </Button>
            {blocking > 0 && (
              <Button variant="accent" size="sm" icon="wand" onClick={() => window.dispatchEvent(new Event('open-setup-wizard'))}>
                {t('Run setup again')}
              </Button>
            )}
            <Button variant="subtle" size="sm" icon="cpu" onClick={() => navigate({ page: 'models' })}>
              {t('AI models')}
            </Button>
          </div>
        </div>
      </div>
      {!pf ? (
        <div className="space-y-2 mt-4">
          <Skeleton lines={5} h={44} />
        </div>
      ) : (
        (checks.length > 0 || canConnectYoutube()) && (
          <ul className="sys-checks" key={run}>
            {checks.map((c, i) => (
              <CheckRow key={c.name} c={c} i={i} />
            ))}
            <YouTubeCheckRow i={checks.length} />
          </ul>
        )
      )}
    </Card>
  )
}

function DiskBar({ videos, free }: { videos: VideosInfo | null; free: number | null }): JSX.Element {
  const [grown, setGrown] = useState(false)
  const totals = useMemo(() => {
    const v = videos?.videos ?? []
    return {
      source: v.reduce((n, x) => n + x.source_bytes, 0),
      transcript: v.reduce((n, x) => n + x.transcript_bytes, 0),
      clips: v.reduce((n, x) => n + x.clip_bytes, 0)
    }
  }, [videos])
  useEffect(() => {
    if (!videos) return
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [videos])
  // The engine's own total, the number Settings › Files & storage shows.
  const used = videos ? videos.total_bytes : totals.source + totals.transcript + totals.clips
  const whole = used + (free ?? 0) || 1
  const segs = [
    { key: 'source', label: t('Source videos'), bytes: totals.source },
    { key: 'clips', label: t('Clips'), bytes: totals.clips },
    { key: 'transcript', label: t('Transcripts'), bytes: totals.transcript },
    ...(free !== null ? [{ key: 'free', label: t('Free on this drive'), bytes: free }] : [])
  ]
  return (
    <Card>
      <SectionHeader
        title={t('Disk')}
        hint={videos ? `${fmtBytes(used)} ${t('used by Solaris Studio')}` : t('Measuring…')}
      />
      <div className="sys-disk mt-4" role="img" aria-label={segs.map((s) => `${s.label} ${fmtBytes(s.bytes)}`).join(', ')}>
        {segs.map((s, i) => (
          <span
            key={s.key}
            className="sys-disk-seg"
            data-kind={s.key}
            style={{ flexGrow: grown ? Math.max(s.bytes / whole, s.bytes ? 0.004 : 0) : 0, transitionDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      <ul className="sys-disk-legend">
        {segs.map((s) => (
          <li key={s.key}>
            <span className="sys-disk-swatch" data-kind={s.key} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="tabular text-ink">{fmtBytes(s.bytes)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function VideoRanking({ info, reload }: { info: VideosInfo | null; reload: () => void }): JSX.Element {
  const ask = useConfirm()
  const [all, setAll] = useState(false)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => [...(info?.videos ?? [])].sort((a, b) => b.total_bytes - a.total_bytes), [info])
  const max = rows[0]?.total_bytes || 1
  const shown = all ? rows : rows.slice(0, 30)

  const remove = async (v: VideosInfo['videos'][number]): Promise<void> => {
    const ok = await ask({
      title: t('Delete this video?'),
      body: (
        <>
          <p className="text-ink font-medium">{v.title}</p>
          <p className="mt-2">
            {t(
              'Removes the clips, the source video and the transcript together. The clips you have already exported are files on your computer and are not affected.'
            )}
          </p>
          <p className="mt-2 tabular text-gold-strong">
            {t('Frees')} {fmtBytes(v.total_bytes)}
          </p>
        </>
      ),
      confirmLabel: t('Delete everything'),
      tone: 'danger'
    })
    if (!ok) return
    setBusy(v.video_id)
    try {
      await api.deleteVideo(v.video_id)
      setLeaving((s) => new Set(s).add(v.video_id))
      toast({ title: `${t('Removed')} ${fmtBytes(v.total_bytes)}`, body: v.title, tone: 'success', icon: 'trash' })
      invalidateLibrary(v.video_id)
      setTimeout(reload, 380)
    } catch (e) {
      toast({ title: t('Could not delete'), body: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <SectionHeader
        title={t('Biggest videos')}
        count={info ? rows.length : undefined}
        hint={t('Each one with its clips, source and transcript.')}
      />
      {!info ? (
        <div className="mt-4">
          <Skeleton lines={6} h={36} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState compact illustration="storage" title={t('No videos on disk')} body={t('Videos you process show up here with what each one costs.')} />
      ) : (
        <>
          <ol className="sys-rank mt-3">
            {shown.map((v, i) => (
              <li key={v.video_id} className="sys-collapse" data-open={leaving.has(v.video_id) ? 'false' : 'true'}>
                <div>
                  <div className="sys-rank-row" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                    <span className="sys-rank-n tabular">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <p className="truncate text-sm text-ink flex-1" title={v.title}>
                          {v.title}
                        </p>
                        <span className="tabular text-sm text-ink shrink-0">{fmtBytes(v.total_bytes)}</span>
                      </div>
                      <div className="sys-rank-bar" aria-hidden>
                        <span data-kind="source" style={{ width: `${(v.source_bytes / max) * 100}%` }} />
                        <span data-kind="clips" style={{ width: `${(v.clip_bytes / max) * 100}%` }} />
                        <span data-kind="transcript" style={{ width: `${(v.transcript_bytes / max) * 100}%` }} />
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        {v.channel ? `${v.channel} · ` : ''}
                        {v.clips} {t('clips')} · {t('source')} {fmtBytes(v.source_bytes)} · {t('clips')} {fmtBytes(v.clip_bytes)}
                      </p>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      icon="trash"
                      loading={busy === v.video_id}
                      disabled={busy !== null}
                      onClick={() => void remove(v)}
                      aria-label={`${t('Delete video')}: ${v.title}`}
                    >
                      {t('Delete video')}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {rows.length > 30 && (
            <Button variant="subtle" size="sm" className="mt-2" iconRight={all ? 'chevron-up' : 'chevron-down'} onClick={() => setAll((a) => !a)}>
              {all ? t('Show fewer') : `${t('Show all')} (${rows.length})`}
            </Button>
          )}
        </>
      )}
    </Card>
  )
}

function Reclaimable({ info, reload }: { info: StorageInfo | null; reload: () => void }): JSX.Element {
  const [cleaning, setCleaning] = useState(false)
  const [freed, setFreed] = useState<number | null>(null)
  const entries = Object.entries(info?.reclaimable ?? {}).filter(([, v]) => v.files > 0)
  const max = Math.max(1, ...entries.map(([, v]) => v.bytes))

  const clean = async (e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    const btn = e.currentTarget
    setCleaning(true)
    setFreed(null)
    try {
      const r = await api.storageCleanup()
      setFreed(r.bytes_freed)
      if (r.bytes_freed > 0) celebrate(btn, { count: 28 })
      toast({
        title: `${t('Freed')} ${fmtBytes(r.bytes_freed)}`,
        body: `${r.files_removed} ${t('files removed')}`,
        tone: 'success',
        icon: 'sparkle'
      })
      setTimeout(reload, 500)
    } catch (err) {
      toast({ title: t('Clean up failed'), body: err instanceof Error ? err.message : String(err), tone: 'error' })
    } finally {
      setTimeout(() => setCleaning(false), 520)
    }
  }

  return (
    <Card className="sys-reclaim" variant={info && info.reclaimable_bytes > 0 ? 'glass' : 'plain'}>
      <SectionHeader title={t('Reclaimable')} hint={t('Leftovers nothing in your library uses.')} />
      {!info ? (
        <div className="mt-4">
          <Skeleton lines={4} h={20} />
        </div>
      ) : (
        <>
          <div className="sys-reclaim-total">
            <span className="t-kpi text-foil tabular">
              {freed !== null ? <CountUp value={freed} format={fmtBytes} /> : fmtBytes(info.reclaimable_bytes)}
            </span>
            <span className="t-micro">{freed !== null ? t('freed just now') : t('can be freed')}</span>
          </div>
          {entries.length === 0 ? (
            <p className="sys-reclaim-clean">
              <Icon name="check" size={14} className="text-success" />
              {t('Nothing to clean up - no leftovers on disk.')}
            </p>
          ) : (
            <ul className="sys-reclaim-list">
              {entries.map(([k, v]) => (
                <li key={k}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span className="text-muted truncate">{t(RECLAIM_LABELS[k] ?? k)}</span>
                    <span className="tabular text-ink shrink-0">
                      {v.files} · {fmtBytes(v.bytes)}
                    </span>
                  </div>
                  <span className="sys-reclaim-bar" aria-hidden>
                    <span style={{ transform: `scaleX(${cleaning ? 0 : v.bytes / max})` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(info.reclaimable_bytes > 0 || cleaning) && (
            <Button
              variant="gold"
              icon="sparkle"
              className="mt-4 w-full"
              loading={cleaning}
              disabled={cleaning}
              onClick={(e) => void clean(e)}
            >
              {cleaning ? t('Cleaning…') : `${t('Clean up')} ${fmtBytes(info.reclaimable_bytes)}`}
            </Button>
          )}
          <p className="text-[11px] text-muted mt-3">
            {t('Source videos')}: {info.sources.files} · {fmtBytes(info.sources.bytes)}.{' '}
            {t('Source videos are never touched by clean up: editing and re-rendering read them. Delete a video above to remove its source.')}
          </p>
        </>
      )}
    </Card>
  )
}

export default function Storage({ active = true }: { active?: boolean } = {}): JSX.Element {
  const visible = useVisible(active)
  const stats = useSystemStats(visible)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [videos, setVideos] = useState<VideosInfo | null>(null)
  const [health, setHealth] = useState<{ app_version?: string; api_version?: string | number } | null>(null)

  const reload = useCallback(() => {
    api.storage().then(setStorage).catch(() => setStorage(null))
    api.storageVideos().then(setVideos).catch(() => setVideos({ videos: [], total_bytes: 0 }))
  }, [])

  useEffect(() => {
    if (!visible) return
    reload()
    api
      .health()
      .then((h) => setHealth(h as { app_version?: string; api_version?: string | number }))
      .catch(() => setHealth(null))
  }, [visible, reload])

  // Another screen deleting a video changes what this one shows.
  useEffect(() => {
    const on = (): void => {
      if (visible) reload()
    }
    window.addEventListener('library-changed', on)
    return () => window.removeEventListener('library-changed', on)
  }, [visible, reload])

  return (
    <div className="sys-page max-w-[1200px] mx-auto p-6 space-y-5">
      <PageHeader
        eyebrow={t('SYSTEM')}
        title={t('Storage & health')}
        icon="hard-drive"
        vtName="page-title"
        subtitle={t('Whether this PC can make a clip right now, where the disk went, and a way to get some of it back.')}
        actions={
          <Button variant="ghost" icon="gear" onClick={() => openSettings('storage')}>
            {t('Storage settings')}
          </Button>
        }
      />

      <Health active={visible} />

      <GpuSetupCard />

      <div className="sys-storage-grid">
        <div className="space-y-5 min-w-0">
          <DiskBar videos={videos} free={stats?.disk_free_bytes ?? null} />
          <VideoRanking info={videos} reload={reload} />
        </div>
        <div className="min-w-0">
          <Reclaimable info={storage} reload={reload} />
        </div>
      </div>

      <footer className="sys-footer">
        <span>
          <Icon name="sun" size={14} /> Solaris Studio {health?.app_version ?? ''}
        </span>
        {health?.api_version !== undefined && (
          <span className="tabular">
            {t('Engine API')} {String(health.api_version)}
          </span>
        )}
        {stats?.uptime_seconds !== undefined && (
          <span className="tabular">
            {t('Engine up for')} {Math.floor(stats.uptime_seconds / 3600)}h {Math.floor((stats.uptime_seconds % 3600) / 60)}m
          </span>
        )}
        {!health && <span>{t('The engine isn’t answering')}</span>}
      </footer>
    </div>
  )
}
