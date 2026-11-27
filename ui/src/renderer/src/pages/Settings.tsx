import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_APPEARANCE,
  FONTS,
  loadAppearance,
  saveAppearance,
  type Appearance
} from '../lib/appearance'
import { api } from '../lib/api'
import type { Preflight } from '../lib/types'
import { getExportFolder, pickExportFolder, setExportFolder } from '../lib/exportFolder'
import {
  notifyOnFinish,
  notifyOnQueueEmpty,
  setNotifyOnFinish,
  setNotifyOnQueueEmpty
} from '../lib/queueNotifications'
import {
  APP_LANGUAGES,
  LANGUAGE_NAMES,
  appLanguageSetting,
  languageLabel,
  setAppLanguage,
  t
} from '../lib/i18n'
import AICard from '../components/AICard'
import UploadPostCard from '../components/UploadPostCard'
import WoopSocialCard from '../components/WoopSocialCard'
import YouTubeCard from '../components/YouTubeCard'
import RemoteRenderCard from '../components/RemoteRenderCard'
import { Icon, type IconName } from '../components/icons'
import { Button, EmptyState, PageHeader, StatusChip, Toggle, useConfirm } from '../components/ui'
import { openYoutubeConnect, useYoutubeAccount, type YtState } from '../lib/stores/youtubeAccount'
import { relativeTime } from '../components/home/homeUtil'
import { navigate, useBreadcrumbs, type SettingsSection } from '../lib/nav'
import { motionReduced } from '../lib/motion'
import SettingsNav from '../components/settings/SettingsNav'
import ConnectionChips from '../components/settings/ConnectionChips'
import MotionEffectsCard from '../components/settings/MotionEffectsCard'
import GpuSetupCard from '../components/GpuSetupCard'
import { SettingsItem, SettingsSectionBlock } from '../components/settings/SettingsSection'

// Content languages offered in the dropdown — the transcription/caption
// side accepts any ISO code via settings.yaml; these are the focus markets.
// Same set the publishing pipeline translates into (multilingual/languages.py).
const CONTENT_LANGUAGES: [string, string][] = [
  ['auto', 'Auto-detect (per video)'],
  ...Object.keys(LANGUAGE_NAMES)
    .map((code): [string, string] => [code, languageLabel(code)])
    .sort((a, b) => a[1].localeCompare(b[1]))
]

function LanguageCard(): JSX.Element {
  const [contentLang, setContentLang] = useState('auto')

  useEffect(() => {
    api.settings().then((s) => setContentLang(s.content_language || 'auto')).catch(() => {})
  }, [])

  return (
    <div className="card space-y-4" aria-label="Language">
      <h3 className="font-semibold text-ink">{t('Language')}</h3>
      <div>
        <label htmlFor="app-lang" className="label">
          {t('App language')}
        </label>
        <select
          id="app-lang"
          className="input mt-1"
          value={appLanguageSetting()}
          onChange={(e) => setAppLanguage(e.target.value)}
        >
          {APP_LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted mt-1">
          {t('The app follows your Windows language unless you choose one here.')}
        </p>
      </div>
      <div>
        <label htmlFor="content-lang" className="label">
          {t('Content language')}
        </label>
        <select
          id="content-lang"
          className="input mt-1"
          value={contentLang}
          onChange={async (e) => {
            setContentLang(e.target.value)
            try {
              await api.patchSettings({ content_language: e.target.value })
            } catch {
              /* backend not up yet */
            }
          }}
        >
          {CONTENT_LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {code === 'auto' ? t('Auto-detect (per video)') : label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted mt-1">
          {t('Transcription and burned-in captions use this language. Auto works for most streams; force it if a bilingual stream gets the wrong captions.')}
        </p>
      </div>
    </div>
  )
}

function ExportFolderCard(): JSX.Element {
  const [folder, setFolder] = useState('')

  useEffect(() => {
    getExportFolder().then(setFolder)
  }, [])

  return (
    <div className="card space-y-3" aria-label="Export location">
      <h3 className="font-semibold text-ink">{t('Export location')}</h3>
      <p className="text-xs text-muted">
        {t('Where exported clips are saved. Defaults to your Downloads folder.')}
      </p>
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 min-w-0"
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value)
            setExportFolder(e.target.value)
          }}
          placeholder={'e.g. C:\\Users\\you\\Downloads'}
          aria-label={t('Export location')}
          title={folder}
        />
        <Button
          variant="ghost"
          icon="folder"
          className="shrink-0"
          onClick={async () => {
            const chosen = await pickExportFolder()
            if (chosen) setFolder(chosen)
          }}
        >
          {t('Browse…')}
        </Button>
      </div>
    </div>
  )
}

/** The same sizes Storage & health shows, in the same units: decimal, GB to
 *  one decimal like AI models' "Free disk" (Storage.tsx fmtBytes). */
const GB = (b: number): string => {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`
  return `${Math.round(b)} B`
}

/** Where the disk went, and a way to get some of it back.
 *
 *  Repeated processing leaves things nothing references — staging files
 *  from renders that failed or were cancelled, `.part` fragments from
 *  interrupted downloads, and an editor preview per clip. None of it shows
 *  anywhere, so the drive just quietly shrinks. */
function StorageCard(): JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.storage>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const load = (): void => {
    api.storage().then(setInfo).catch(() => setInfo(null))
  }
  useEffect(load, [])

  const LABELS: Record<string, string> = {
    partial_downloads: 'Interrupted downloads',
    orphan_downloads: 'Downloads with no video',
    orphan_transcripts: 'Transcripts with no video',
    render_leftovers: 'Leftovers from failed renders',
    orphan_clips: 'Clip files not in your library',
    previews: 'Editor previews (rebuilt on demand)'
  }

  return (
    <div className="card space-y-3" aria-label="Storage">
      <h3 className="font-semibold text-ink">{t('Storage')}</h3>
      {!info ? (
        <p className="text-xs text-muted">{t('Checking…')}</p>
      ) : (
        <>
          <div className="space-y-1 text-xs">
            {Object.entries(info.reclaimable)
              .filter(([, v]) => v.files > 0)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted truncate">{LABELS[k] ?? k}</span>
                  <span className="tabular-nums shrink-0">
                    {v.files} · {GB(v.bytes)}
                  </span>
                </div>
              ))}
            {info.reclaimable_bytes === 0 && (
              <p className="sys-reclaim-clean !mt-0">
                <Icon name="check" size={14} className="text-success" />
                {t('Nothing to clean up - no leftovers on disk.')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 empty:hidden">
            {info.reclaimable_bytes > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon="sparkle"
              loading={busy}
              onClick={async () => {
                setBusy(true)
                setDone('')
                try {
                  const r = await api.storageCleanup()
                  setDone(`Freed ${GB(r.bytes_freed)} across ${r.files_removed} file(s).`)
                  load()
                } catch (e) {
                  setDone(`Error: ${e instanceof Error ? e.message : String(e)}`)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? t('Cleaning…') : `${t('Free up')} ${GB(info.reclaimable_bytes)}`}
            </Button>
            )}
            {done && <span className="text-xs text-muted">{done}</span>}
          </div>

          <p className="text-xs text-muted border-t border-line/60 pt-3">
            {t('Source videos')}: {info.sources.files} · {GB(info.sources.bytes)}.{' '}
            {t(
              'These are the biggest thing on disk and clean up never touches them: editing, re-rendering and translated burns all read them. Delete a video below, or from Storage & health, to remove its source along with its clips.'
            )}
          </p>
        </>
      )}
    </div>
  )
}

/** Per-video disk usage, with a way to remove everything a finished video
 *  still costs.
 *
 *  The cleanup above only sweeps leftovers, and deleting clips one by one
 *  frees the clip files while leaving the multi-gigabyte source behind — so
 *  a library of finished videos kept growing with no way to reclaim it from
 *  inside the app. This lists what each video actually costs and deletes the
 *  clips, the source and the transcript together. */
function VideoStorageCard(): JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.storageVideos>> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = (): void => {
    api.storageVideos().then(setInfo).catch(() => setInfo(null))
  }
  useEffect(load, [])

  const remove = async (videoId: string, freed: number): Promise<void> => {
    setBusy(videoId)
    setNote('')
    try {
      await api.deleteVideo(videoId)
      setNote(`${t('Removed')} ${GB(freed)}.`)
      load()
    } catch (e) {
      setNote(`${t('Could not delete')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  if (!info) return <></>
  if (info.videos.length === 0)
    return (
      <div className="card space-y-1" aria-label="Video storage">
        <h3 className="font-semibold text-ink">{t('Delete a finished video')}</h3>
        <p className="text-xs text-muted">{t('No finished videos on disk yet. Videos you process show up here with what each one costs.')}</p>
      </div>
    )

  return (
    <div className="card space-y-3" aria-label="Video storage">
      <h3 className="font-semibold text-ink">{t('Delete a finished video')}</h3>
      <p className="text-xs text-muted">
        {t(
          'Removes the clips, the source video and the transcript together. The clips you have already exported are files on your computer and are not affected.'
        )}
      </p>
      <div className="max-h-72 overflow-y-auto space-y-1">
        {info.videos.map((v) => (
          <div
            key={v.video_id}
            className="flex items-center gap-3 text-xs border-t border-line/50 pt-2"
          >
            <div className="flex-1 min-w-0">
              <p className="truncate">{v.title}</p>
              <p className="text-muted">
                {v.clips} {t('clips')} · {t('source')} {GB(v.source_bytes)} ·{' '}
                {t('clips')} {GB(v.clip_bytes)}
              </p>
            </div>
            <span className="tabular-nums shrink-0 font-medium">{GB(v.total_bytes)}</span>
            {confirming === v.video_id ? (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  className="shrink-0"
                  loading={busy === v.video_id}
                  disabled={busy !== null}
                  onClick={() => remove(v.video_id, v.total_bytes)}
                >
                  {busy === v.video_id ? t('Deleting…') : t('Delete everything')}
                </Button>
                <Button variant="subtle" size="sm" className="shrink-0" onClick={() => setConfirming(null)}>
                  {t('Cancel')}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                className="shrink-0"
                disabled={busy !== null}
                onClick={() => setConfirming(v.video_id)}
              >
                {t('Delete')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line/60 pt-2">
        <span className="text-xs text-muted">
          {t('Total on disk')}: {GB(info.total_bytes)}
        </span>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
    </div>
  )
}

function AppearanceCard(): JSX.Element {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance)

  const update = (patch: Partial<Appearance>): void => {
    const next = { ...appearance, ...patch }
    setAppearance(next)
    saveAppearance(next)
  }

  return (
    <div className="card space-y-4" aria-label="Appearance and accessibility">
      <h3 className="font-semibold text-ink">{t('Appearance & accessibility')}</h3>
      <div>
        <label htmlFor="app-font" className="label">
          {t('Font')}
        </label>
        <select
          id="app-font"
          className="input mt-1"
          value={appearance.font}
          onChange={(e) => update({ font: e.target.value })}
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="app-scale" className="label flex items-baseline justify-between gap-3">
          <span>{t('Text size')}</span>
          <span className="tabular text-ink">{appearance.scale}%</span>
        </label>
        <input
          id="app-scale"
          type="range"
          min={87.5}
          max={150}
          step={12.5}
          value={appearance.scale}
          onChange={(e) => update({ scale: Number(e.target.value) })}
          className="w-full mt-2"
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="app-color" className="label block">
            {t('Text colour')}
          </label>
          <div className="sys-swatch-row mt-1">
            <input
              id="app-color"
              type="color"
              value={appearance.textColor}
              onChange={(e) => update({ textColor: e.target.value })}
              className="sys-swatch"
            />
            <span className="font-mono text-xs text-muted uppercase">{appearance.textColor}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="undo" onClick={() => update(DEFAULT_APPEARANCE)}>
          {t('Reset to defaults')}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {t('Changes apply instantly and are remembered. Keyboard focus outlines and reduced-motion preferences are always honored.')}
      </p>
    </div>
  )
}

/** Manual update check and release channel.
 *
 *  The banner only appears when there IS an update, so this is where somebody
 *  goes to ask, to see why a check failed, or to opt into early builds. */
function UpdateCard(): JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null)
  const [channel, setChannel] = useState('stable')
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    // Guarded for the same reason as the update bar: a preload without this
    // API must degrade to "updates unavailable", never take the window down.
    const updater = window.studio?.update
    if (!updater) {
      setState({ state: 'error', message: 'Updates are unavailable — restart Solaris Studio.' })
      return
    }
    updater.prefs().then((p) => setChannel(p.channel))
    return updater.onState(setState)
  }, [])

  const line = ((): string => {
    if (!asked && !state) return 'Solaris Studio checks for updates when it starts.'
    switch (state?.state) {
      case 'checking':
        return 'Checking…'
      case 'available':
        return `Version ${state.version} is available — see the bar at the top.`
      case 'downloading':
        if (state.phase === 'package')
          return state.percent === undefined
            ? 'Downloading the app files…'
            : `Downloading the app files… ${state.percent}%`
        return (state.percent ?? 0) >= 100
          ? 'Preparing the app files download…'
          : `Downloading… ${state.percent ?? 0}%`
      case 'ready':
        return `Version ${state.version} is ready to install.`
      case 'none':
        return "You're on the latest version."
      case 'dev':
        return 'Updates are disabled while running from source.'
      case 'store':
        if (state.behind)
          return `Version ${state.version} is in the Microsoft Store. This copy is ${state.current}.`
        if (state.version)
          return `You're on the latest version (${state.current}). The Microsoft Store installs new versions for you.`
        return `Couldn't check the Microsoft Store just now. This copy is ${state.current}, and the Store keeps it up to date for you.`
      case 'error':
        return `Could not check: ${state.message ?? 'unknown error'}`
      default:
        return 'Solaris Studio checks for updates when it starts.'
    }
  })()

  return (
    <div className="card space-y-3" aria-label="Updates">
      <h3 className="font-semibold text-ink">{t('Updates')}</h3>
      <p className="text-sm text-muted">{line}</p>
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          loading={state?.state === 'checking'}
          onClick={() => {
            setAsked(true)
            void window.studio.update.check()
          }}
        >
          {state?.state === 'checking' ? t('Checking…') : t('Check for updates')}
        </Button>
        {state?.state === 'store' && (
          <Button
            variant={state.behind ? 'accent' : 'ghost'}
            size="sm"
            icon="external-link"
            onClick={() => void window.studio.update.openStore()}
          >
            {t('Open the Microsoft Store')}
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs text-muted sm:ml-auto">
          {t('Release channel')}
          <select
            className="input !w-32 !py-1 text-xs"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value)
              void window.studio.update.prefs({ channel: e.target.value })
            }}
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
            <option value="alpha">Alpha</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        {t('Stable is finished releases only. Beta and Alpha get new features earlier and break more often. Nothing downloads or installs without you asking.')}
      </p>
    </div>
  )
}

/** Re-run first-run setup, and a live view of what the install is missing.
 *  Ollama and the model are deliberately not bundled, so this is where
 *  someone checks whether the app can actually make a clip. */
function SetupCard(): JSX.Element {
  const [pre, setPre] = useState<Preflight | null>(null)
  useEffect(() => {
    api.preflight().then(setPre).catch(() => setPre(null))
  }, [])

  const missing = (pre?.checks ?? []).filter((c) => !c.ok && c.blocking)

  return (
    <div className="card space-y-3" aria-label="Setup">
      <h3 className="font-semibold text-ink">{t('Setup')}</h3>
      {pre === null ? (
        <p className="text-sm text-muted">{t('Checking what this install has…')}</p>
      ) : missing.length === 0 ? (
        <p className="text-sm text-muted flex items-center gap-2">
          <Icon name="check" size={14} className="text-success shrink-0" />
          {t('Everything Solaris Studio needs is installed and working.')}
        </p>
      ) : (
        <div className="text-sm">
          <p className="text-error font-medium">
            {missing.length} thing{missing.length === 1 ? '' : 's'} still missing:
          </p>
          <ul className="mt-1.5 space-y-1">
            {missing.map((c) => (
              <li key={c.name} className="text-muted text-xs">
                <span className="text-ink">{c.name}</span> — {c.fix || c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="ghost" size="sm" icon="wand" onClick={() => window.dispatchEvent(new Event('open-setup-wizard'))}>
        {t('Run setup again')}
      </Button>
    </div>
  )
}

/** Notifications for a queue left running unattended. Off by default would
 *  defeat the purpose — the batch takes hours and nobody is watching — so
 *  both start on and can be switched off here. */
function NotificationsCard(): JSX.Element {
  const [onFinish, setOnFinish] = useState(notifyOnFinish())
  const [onEmpty, setOnEmpty] = useState(notifyOnQueueEmpty())
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-ink">{t('Notifications')}</h3>
      <p className="text-sm text-muted">
        {t('Desktop notifications while a queue processes. Only shown when Solaris Studio is not the window you are looking at.')}
      </p>
      <Toggle
        checked={onFinish}
        onChange={(v) => {
          setOnFinish(v)
          setNotifyOnFinish(v)
        }}
        label={t('When each video finishes')}
      />
      <Toggle
        checked={onEmpty}
        onChange={(v) => {
          setOnEmpty(v)
          setNotifyOnQueueEmpty(v)
        }}
        label={t('When the whole queue is done')}
      />
    </div>
  )
}

/** The end-card toggle.
 *
 * Last card on the page, and just the one line. It is here so someone who
 * specifically wants the branding off can find and turn it off — not as a
 * decision every user is walked through. The label says plainly what it does;
 * it does not argue the case either way.
 */
/** The quality bar (clips.min_score). The "no clips" explanation sends
 *  people here to lower it, so it has to be here (#111). Saved when the
 *  field is left or Enter is pressed; put back if it doesn't save. */
function MinScoreSetting(): JSX.Element {
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSaved(s.min_score)
        setDraft(String(s.min_score))
      })
      .catch(() => {})
  }, [])

  const save = async (): Promise<void> => {
    const value = Math.round(Number(draft))
    if (saved === null || draft.trim() === '' || !Number.isFinite(value) || value === saved) {
      setDraft(saved === null ? '' : String(saved))
      return
    }
    const next = Math.max(0, Math.min(100, value))
    setDraft(String(next))
    try {
      await api.patchSettings({ min_score: next })
      setSaved(next)
    } catch {
      setDraft(String(saved))
    }
  }

  return (
    <div className="space-y-1">
      <label className="flex flex-wrap items-center gap-3 text-sm" htmlFor="min-score">
        <span className="text-ink font-medium">{t('Minimum score')}</span>
        <input
          id="min-score"
          type="number"
          min={0}
          max={100}
          className="input !w-20 tabular"
          value={draft}
          disabled={saved === null}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="text-xs text-muted">{t('0-100, 55 by default')}</span>
      </label>
      <p className="text-xs text-muted">
        {t(
          'Clips scoring below this are dropped. Lower it when a video gives few or no clips; higher keeps fewer, stronger ones.'
        )}
      </p>
    </div>
  )
}

function BrandingCard(): JSX.Element {
  const [outro, setOutro] = useState(true)

  useEffect(() => {
    api
      .settings()
      .then((s) => setOutro(s.outro !== false))
      .catch(() => {})
  }, [])

  return (
    <div className="card space-y-3" aria-label="Branding">
      <h3 className="font-semibold text-ink">{t('Branding')}</h3>
      <Toggle
        checked={outro}
        onChange={async (next) => {
          setOutro(next)
          try {
            await api.patchSettings({ outro: next })
          } catch {
            setOutro(!next) // put the switch back if it did not save
          }
        }}
        label={t('Add the Solaris Studio end card to every clip')}
      />
    </div>
  )
}

function LicenseCard(): JSX.Element {
  return (
    <div className="card flex items-center justify-between gap-4">
      <div>
        <h3 className="font-semibold text-ink">{t('License')}</h3>
        <p className="text-sm text-muted">AGPL-3.0-or-later</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon="external-link"
        className="shrink-0"
        onClick={() => void window.studio.openExternal('https://github.com/Arch-Axgel/solaris-studio')}
      >
        {t('Source code')}
      </Button>
    </div>
  )
}

/** Where the burner YouTube account stands, as a chip: icon plus words. */
function YtChip({ state }: { state: YtState }): JSX.Element | null {
  switch (state) {
    case 'signed-in':
      return <StatusChip status="done" label={t('Signed in')} />
    case 'signing-in':
      return <StatusChip status="running" label={t('Signing in…')} />
    case 'not-running':
      return <StatusChip status="paused" label={t('Browser not running')} />
    case 'no-browser':
      return <StatusChip status="failed" label={t('Edge or Chrome needed')} />
    case 'signed-out':
      return <StatusChip status="idle" label={t('Signed out')} />
    default:
      return null
  }
}

function YouTubeDownloadCard(): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const { status, supported, state, actions } = useYoutubeAccount()
  const ask = useConfirm()

  // Older preload: only the one-shot "open the profile" handler exists, so
  // keep the original single button.
  const connectLegacy = async (): Promise<void> => {
    const open = window.studio.connectYoutubeDownload
    if (!open) {
      setNotice(t('This requires the desktop app.'))
      return
    }
    setBusy('connect')
    setNotice('')
    try {
      const result = await open()
      setNotice(
        result.ok
          ? t('Sign in to YouTube in the browser window. This separate profile is used only for video downloads.')
          : result.error || t('Could not open a supported browser.')
      )
    } catch (error) {
      setNotice(String(error).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(null)
    }
  }

  // Every action reports through the same status line; errors are plain
  // English from the main process and never contain cookie values.
  const run = async (key: string, fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(key)
    setNotice('')
    try {
      await fn()
      if (done) setNotice(done)
    } catch (error) {
      setNotice(String(error).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(null)
    }
  }

  // connect() on a profile that is still signed in just opens YouTube, and
  // the main process counts that as a finished sign-in and minimizes the
  // window again within seconds, so there is no time to change accounts.
  // Switching therefore signs the current burner out (wipes the profile)
  // and starts a fresh sign-in, which the prompt then follows.
  const switchAccount = async (): Promise<void> => {
    const ok = await ask({
      title: t('Switch the burner account?'),
      body: (
        <p>
          {t('The current burner account is signed out and its cookies are deleted from this PC. A fresh browser window then opens for the other account.')}
        </p>
      ),
      confirmLabel: t('Switch account'),
      tone: 'danger'
    })
    if (!ok) return
    await run(
      'connect',
      async () => {
        await actions.disconnect(true)
        const r = await actions.connect()
        if (!r.ok) throw new Error(r.error || t('Could not open a supported browser.'))
        openYoutubeConnect()
      },
      t('Sign in with the other burner account in the browser window that opened.')
    )
  }

  const disconnect = async (): Promise<void> => {
    // An uncontrolled checkbox inside the confirm body: the dialog renders
    // it, and we read the choice once the user confirms.
    let wipe = false
    const ok = await ask({
      title: t('Disconnect the YouTube browser?'),
      body: (
        <>
          <p>
            {t('Solaris Studio stops running the download browser in the background. Downloads may hit YouTube’s bot check again until you sign in.')}
          </p>
          <label className="flex items-start gap-2 mt-3 text-ink cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              onChange={(e) => {
                wipe = e.target.checked
              }}
            />
            <span>
              {t('Also sign out and delete the browser profile')}
              <span className="block text-xs text-muted">
                {t('The burner account is signed out for good and its cookies are deleted from this PC.')}
              </span>
            </span>
          </label>
        </>
      ),
      confirmLabel: t('Disconnect'),
      tone: 'danger'
    })
    if (!ok) return
    await run(
      'disconnect',
      () => actions.disconnect(wipe),
      wipe ? t('Signed out and the browser profile was deleted.') : t('Disconnected.')
    )
  }

  return (
    <div className="card space-y-3" aria-label={t('YouTube downloads')}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{t('YouTube downloads')}</h3>
          {supported && <YtChip state={state} />}
        </div>
        <p className="text-xs text-muted mt-0.5">
          {t('If YouTube requires sign-in, connect a separate browser profile. Its cookies stay on this PC and are read locally for downloads only.')}
        </p>
      </div>

      {!supported || !status ? (
        <Button variant="ghost" size="sm" icon="youtube" loading={busy !== null} onClick={() => void connectLegacy()}>
          {busy ? t('Opening…') : t('Sign in for YouTube downloads')}
        </Button>
      ) : (
        <>
          <div className="yt-card-meta">
            <span>
              {status.browser === 'edge'
                ? 'Microsoft Edge'
                : status.browser === 'chrome'
                  ? 'Google Chrome'
                  : t('No supported browser found')}
            </span>
            {status.lastRefreshAt && (
              <span title={new Date(status.lastRefreshAt).toLocaleString()}>
                {t('Refreshed')} {relativeTime(status.lastRefreshAt)}
              </span>
            )}
            {status.running && <span>{status.visible ? t('Window open') : t('Running in the background')}</span>}
          </div>

          {state === 'no-browser' ? (
            <p className="text-xs text-muted">
              {t('Install Microsoft Edge or Google Chrome to use a burner account for downloads.')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {status.signingIn ? (
                // The sign-in window is an ordinary browser the app doesn't
                // watch, so the user says when they're done (closing that
                // window works too).
                <Button
                  size="sm"
                  variant="gold"
                  icon="check"
                  loading={busy === 'finish' || status.signInStep === 'checking'}
                  disabled={busy !== null || status.signInStep === 'checking'}
                  onClick={() => void run('finish', () => actions.finishSignIn())}
                >
                  {status.signInStep === 'checking' ? t('Checking your sign-in…') : t('I’ve signed in')}
                </Button>
              ) : status.signedIn ? (
                <Button size="sm" icon="users" loading={busy === 'connect'} disabled={busy !== null} onClick={() => void switchAccount()}>
                  {t('Switch account')}
                </Button>
              ) : (
                <Button size="sm" variant="gold" icon="youtube" disabled={busy !== null} onClick={openYoutubeConnect}>
                  {t('Sign in')}
                </Button>
              )}
              {status.signInStep === 'browser-open' && (
                // hide() during a sign-in is the main process's cancel: it
                // closes the sign-in window and puts things back as they were.
                <Button
                  size="sm"
                  variant="subtle"
                  loading={busy === 'cancel'}
                  disabled={busy !== null}
                  onClick={() => void run('cancel', () => actions.hide())}
                >
                  {t('Cancel')}
                </Button>
              )}
              {status.running && (
                <Button
                  size="sm"
                  icon={status.visible ? 'minimize' : 'maximize'}
                  loading={busy === 'show'}
                  disabled={busy !== null}
                  onClick={() => void run('show', () => (status.visible ? actions.hide() : actions.show()))}
                >
                  {status.visible ? t('Hide browser') : t('Show browser')}
                </Button>
              )}
              {state === 'not-running' && (
                // Connected but closed (the watchdog gave up, or it was
                // disconnected elsewhere): refresh() relaunches it minimized
                // on YouTube, which is all downloads need.
                <Button
                  size="sm"
                  icon="refresh"
                  loading={busy === 'start'}
                  disabled={busy !== null}
                  onClick={() => void run('start', () => actions.refresh())}
                >
                  {t('Start in the background')}
                </Button>
              )}
              {status.running && status.signedIn && (
                <Button
                  size="sm"
                  icon="refresh"
                  loading={busy === 'refresh'}
                  disabled={busy !== null}
                  onClick={() => void run('refresh', () => actions.refresh(), t('YouTube page refreshed.'))}
                >
                  {t('Refresh now')}
                </Button>
              )}
              {(status.connected || status.running) && (
                <Button
                  size="sm"
                  variant="subtle"
                  icon="x"
                  loading={busy === 'disconnect'}
                  disabled={busy !== null}
                  onClick={() => void disconnect()}
                >
                  {t('Disconnect')}
                </Button>
              )}
            </div>
          )}

          {status.browser !== null && (
            <Toggle
              size="sm"
              checked={!status.dontAsk}
              onChange={(v) => void run('dontask', () => actions.setDontAsk(!v))}
              label={t('Ask me on startup')}
              description={t('Offer to sign in a burner account when YouTube downloads aren’t signed in.')}
            />
          )}
          {status.error && <p className="text-xs text-warn">{status.error}</p>}
        </>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted empty:hidden">
        {notice}
      </p>
    </div>
  )
}

type CardDef = { id: string; title: string; keywords: string }

/** Sections in order (spec 4.12), each with its cards' titles and the words
 *  someone might type to find them. The filter matches against these. */
const SECTIONS: { id: SettingsSection; label: string; icon: IconName; hint?: string; cards: CardDef[] }[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'gear',
    cards: [
      { id: 'language', title: 'Language', keywords: 'app language content language translation captions transcription windows' },
      { id: 'setup', title: 'Setup', keywords: 'setup wizard first run missing install ffmpeg ollama preflight' }
    ]
  },
  {
    id: 'appearance',
    label: 'Appearance & accessibility',
    icon: 'palette',
    cards: [
      { id: 'appearance', title: 'Appearance & accessibility', keywords: 'font text size scale colour color contrast reset' },
      {
        id: 'motion',
        title: 'Motion & effects',
        keywords: 'reduce motion animation transitions visual effects blur grain glow density compact comfortable rail hover'
      }
    ]
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'bell',
    cards: [{ id: 'notifications', title: 'Notifications', keywords: 'desktop notification finish queue done alert' }]
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkle',
    cards: [
      { id: 'ai', title: 'AI', keywords: 'ai provider cloud openrouter api key model ollama local transcription whisper voice assistant' },
      { id: 'minscore', title: 'Quality bar', keywords: 'minimum score quality clips dropped threshold few no clips' }
    ]
  },
  {
    id: 'publishing',
    label: 'Publishing accounts',
    icon: 'send',
    cards: [
      { id: 'woopsocial', title: 'WoopSocial', keywords: 'woopsocial publish tiktok instagram social schedule api key' },
      { id: 'youtube', title: 'YouTube', keywords: 'youtube publish upload google channel shorts' },
      { id: 'uploadpost', title: 'Upload-Post', keywords: 'upload-post uploadpost publish bluesky social api key' }
    ]
  },
  {
    id: 'downloads',
    label: 'YouTube downloads',
    icon: 'download',
    cards: [{ id: 'ytdownload', title: 'YouTube downloads', keywords: 'youtube download sign in cookies browser profile age restricted burner account background refresh' }]
  },
  {
    id: 'storage',
    label: 'Files & storage',
    icon: 'hard-drive',
    cards: [
      { id: 'export', title: 'Export location', keywords: 'export folder location downloads save' },
      { id: 'storage', title: 'Storage', keywords: 'storage clean up free up leftovers disk space previews' },
      { id: 'videostorage', title: 'Delete a finished video', keywords: 'delete video disk source transcript space' },
      { id: 'health', title: 'Storage & health', keywords: 'storage health preflight checks disk readiness' }
    ]
  },
  {
    id: 'branding',
    label: 'Branding',
    icon: 'badge',
    cards: [{ id: 'branding', title: 'Branding', keywords: 'end card outro branding solaris' }]
  },
  {
    id: 'updates',
    label: 'Updates & license',
    icon: 'refresh',
    cards: [
      { id: 'updates', title: 'Updates', keywords: 'update version microsoft store release channel beta alpha stable' },
      { id: 'license', title: 'License', keywords: 'license agpl source code github' }
    ]
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: 'wand',
    cards: [
      { id: 'gpu', title: 'GPU & hardware', keywords: 'gpu graphics card nvidia cuda pytorch torch whisper nvenc encoder vram driver hardware acceleration install' },
      { id: 'remote', title: 'Remote rendering', keywords: 'remote render pc worker tailscale network multi-pc gateway pairing' },
      { id: 'config', title: 'Advanced settings', keywords: 'settings.yaml config scoring weights tracking captions models' }
    ]
  }
]

function matchesQuery(q: string, section: { label: string }, card: CardDef): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = `${t(card.title)} ${card.title} ${t(section.label)} ${section.label} ${card.keywords}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

function QualityCard(): JSX.Element {
  return (
    <div className="card space-y-3" aria-label="Quality bar">
      <h3 className="font-semibold text-ink">{t('Quality bar')}</h3>
      <MinScoreSetting />
    </div>
  )
}

function HealthLinkCard(): JSX.Element {
  return (
    <button type="button" className="card card-interactive sys-linkcard w-full text-left" onClick={() => navigate({ page: 'storage' })}>
      <span className="sys-linkcard-icon" aria-hidden>
        <Icon name="hard-drive" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{t('Open Storage & health')}</span>
        <span className="block text-xs text-muted mt-0.5">
          {t('Readiness checks, what each video costs on disk, and a one-click clean up.')}
        </span>
      </span>
      <Icon name="arrow-right" size={16} className="text-gold" />
    </button>
  )
}

function ConfigInfoCard(): JSX.Element {
  return (
    <div className="card flex flex-wrap items-center gap-3 text-sm text-muted">
      <p className="min-w-0 flex-1 basis-80">
        {t('Local models are managed on the AI models page; where the AI runs is chosen under AI above.')}{' '}
        {t('Advanced options (scoring weights, tracking, captions) live in')} <code className="sys-code">config/settings.yaml</code>.
      </p>
      <Button variant="ghost" size="sm" icon="cpu" iconRight="arrow-right" className="shrink-0" onClick={() => navigate({ page: 'models' })}>
        {t('AI models')}
      </Button>
    </div>
  )
}

export default function Settings({
  active = true,
  section = null
}: { active?: boolean; section?: SettingsSection | null } = {}): JSX.Element {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState<SettingsSection>(section ?? 'general')
  const content = useRef<HTMLDivElement>(null)
  // While a jump is scrolling, the scroll-spy must not fight the indicator.
  const jumping = useRef(0)

  const visibleCards = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const s of SECTIONS) for (const c of s.cards) out[c.id] = matchesQuery(query, s, c)
    return out
  }, [query])
  const sectionMatches = (id: SettingsSection): number =>
    (SECTIONS.find((s) => s.id === id)?.cards ?? []).filter((c) => visibleCards[c.id]).length
  const filtering = query.trim().length > 0
  const nothing = filtering && SECTIONS.every((s) => sectionMatches(s.id) === 0)
  const shown = (id: string): boolean => visibleCards[id] !== false

  const jump = useCallback((id: SettingsSection, flash = false) => {
    const el = document.getElementById(`settings-${id}`)
    if (!el) return
    setCurrent(id)
    jumping.current = Date.now()
    el.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
    if (flash) {
      el.classList.remove('anim-flash')
      void el.offsetWidth
      el.classList.add('anim-flash')
      setTimeout(() => el.classList.remove('anim-flash'), 3000)
    }
  }, [])

  // Deep links (open-settings with a section, #/settings?section=…).
  useEffect(() => {
    if (!active || !section) return
    setQuery('')
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => jump(section, true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [active, section, jump])

  // The same deep link again (the palette's "Settings › AI" while already
  // there) leaves the route unchanged, so the effect above does not re-run:
  // jump on the event itself.
  const deepLink = useRef({ active, section })
  deepLink.current = { active, section }
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const wanted = (e as CustomEvent<{ section?: SettingsSection } | undefined>).detail?.section
      const now = deepLink.current
      if (!now.active || !wanted || wanted !== now.section) return
      setQuery('')
      requestAnimationFrame(() => jump(wanted, true))
    }
    window.addEventListener('open-settings', onOpen)
    return () => window.removeEventListener('open-settings', onOpen)
  }, [jump])

  // Scroll-spy: the top-most section in the upper part of the view is current.
  useEffect(() => {
    const root = content.current
    if (!root || !active) return
    const seen = new Map<string, boolean>()
    const scroller = root.closest<HTMLElement>('.keep-page')
    const atBottom = (): boolean => {
      const el = scroller ?? document.documentElement
      return el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    }
    const pickLast = (): void => {
      const showing = Array.from(root.querySelectorAll<HTMLElement>('[data-section]')).filter((s) => !s.hidden)
      const last = showing[showing.length - 1]?.dataset.section as SettingsSection | undefined
      if (last) setCurrent(last)
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set((e.target as HTMLElement).dataset.section ?? '', e.isIntersecting)
        if (Date.now() - jumping.current < 900) return
        if (atBottom()) return pickLast()
        const first = SECTIONS.find((s) => seen.get(s.id))
        if (first) setCurrent(first.id)
      },
      { rootMargin: '-15% 0px -65% 0px' }
    )
    root.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => io.observe(el))
    // At the very bottom the last sections can never reach the band above,
    // so the end of the page selects the last section that is showing.
    const target: HTMLElement | Window = scroller ?? window
    const onScroll = (): void => {
      if (Date.now() - jumping.current < 900 || !atBottom()) return
      pickLast()
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      target.removeEventListener('scroll', onScroll)
    }
  }, [active])

  useBreadcrumbs([{ label: nothing ? t('Search') : t(SECTIONS.find((s) => s.id === current)?.label ?? 'General') }])

  const sectionProps = (id: SettingsSection): { id: SettingsSection; title: string; hint?: string; hidden: boolean } => {
    const def = SECTIONS.find((s) => s.id === id)
    return {
      id,
      title: t(def?.label ?? id),
      hint: def?.hint ? t(def.hint) : undefined,
      hidden: filtering && sectionMatches(id) === 0
    }
  }

  return (
    <div className="sys-page sys-settings max-w-[1200px] mx-auto p-6">
      <PageHeader
        eyebrow={t('SYSTEM')}
        title={t('Settings')}
        icon="gear"
        vtName="page-title"
        subtitle={t('Every preference in one place. Type in the box to find one.')}
      />
      <div className="sys-settings-grid">
        <SettingsNav
          sections={SECTIONS.map((s) => ({
            id: s.id,
            label: t(s.label),
            icon: s.icon,
            matches: filtering ? sectionMatches(s.id) : undefined
          }))}
          current={current}
          query={query}
          onQuery={setQuery}
          onPick={(id) => jump(id)}
        />

        <div ref={content} className="sys-settings-content">
          {nothing && (
            <EmptyState
              compact
              illustration="search"
              title={t('No setting matches')}
              body={`“${query}”`}
              action={
                <Button variant="ghost" size="sm" icon="x" onClick={() => setQuery('')}>
                  {t('Clear search')}
                </Button>
              }
            />
          )}

          <SettingsSectionBlock {...sectionProps('general')}>
            <SettingsItem id="language" hidden={!shown('language')}>
              <LanguageCard />
            </SettingsItem>
            <SettingsItem id="setup" hidden={!shown('setup')}>
              <SetupCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('appearance')}>
            <SettingsItem id="appearance" hidden={!shown('appearance')}>
              <AppearanceCard />
            </SettingsItem>
            <SettingsItem id="motion" hidden={!shown('motion')}>
              <MotionEffectsCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('notifications')}>
            <SettingsItem id="notifications" hidden={!shown('notifications')}>
              <NotificationsCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('ai')}>
            {/* Where the AI and transcription run: this PC first, or a cloud
                provider on the user's own key for PCs that cannot run them. */}
            <SettingsItem id="ai" hidden={!shown('ai')}>
              <AICard onOpenModels={() => navigate({ page: 'models' })} />
            </SettingsItem>
            <SettingsItem id="minscore" hidden={!shown('minscore')}>
              <QualityCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('publishing')}>
            {!filtering && <ConnectionChips active={active} />}
            {/* WoopSocial first: its free plan covers most creators, and it is
                the one Solaris Studio recommends. Upload-Post last, as the
                alternative for anyone who wants Bluesky, thumbnails or a queue. */}
            <SettingsItem id="woopsocial" hidden={!shown('woopsocial')}>
              <WoopSocialCard />
            </SettingsItem>
            <SettingsItem id="youtube" hidden={!shown('youtube')}>
              <YouTubeCard />
            </SettingsItem>
            <SettingsItem id="uploadpost" hidden={!shown('uploadpost')}>
              <UploadPostCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('downloads')}>
            <SettingsItem id="ytdownload" hidden={!shown('ytdownload')}>
              <YouTubeDownloadCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('storage')}>
            <SettingsItem id="export" hidden={!shown('export')}>
              <ExportFolderCard />
            </SettingsItem>
            <SettingsItem id="storage" hidden={!shown('storage')}>
              <StorageCard />
            </SettingsItem>
            <SettingsItem id="videostorage" hidden={!shown('videostorage')}>
              <VideoStorageCard />
            </SettingsItem>
            <SettingsItem id="health" hidden={!shown('health')}>
              <HealthLinkCard />
            </SettingsItem>
          </SettingsSectionBlock>

          {/* Near the end on purpose: it is here for someone who goes looking
              for it, not something to walk everyone past. */}
          <SettingsSectionBlock {...sectionProps('branding')}>
            <SettingsItem id="branding" hidden={!shown('branding')}>
              <BrandingCard />
            </SettingsItem>
          </SettingsSectionBlock>

          <SettingsSectionBlock {...sectionProps('updates')}>
            <SettingsItem id="updates" hidden={!shown('updates')}>
              <UpdateCard />
            </SettingsItem>
            <SettingsItem id="license" hidden={!shown('license')}>
              <LicenseCard />
            </SettingsItem>
          </SettingsSectionBlock>

          {/* For the few with more than one PC: most people never need it,
              and nothing it controls shows anywhere else until it is on. */}
          <SettingsSectionBlock {...sectionProps('advanced')}>
            <SettingsItem id="gpu" hidden={!shown('gpu')}>
              <GpuSetupCard />
            </SettingsItem>
            <SettingsItem id="remote" hidden={!shown('remote')}>
              <div className="card space-y-3">
                {/* The card's own switch is titled Remote rendering, so the frame only says who it is for. */}
                <p className="t-micro">{t('For multi-PC setups')}</p>
                <RemoteRenderCard />
              </div>
            </SettingsItem>
            <SettingsItem id="config" hidden={!shown('config')}>
              <ConfigInfoCard />
            </SettingsItem>
          </SettingsSectionBlock>
        </div>
      </div>
    </div>
  )
}
