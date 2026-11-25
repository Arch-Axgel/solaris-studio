import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { openSettings } from '../lib/nav'
import { speedNote } from '../lib/modelSpeed'
import { useModelPulls } from '../lib/stores/activity'
import { useStudioEvents } from '../lib/stores/eventBus'
import { useSystemStats } from '../lib/stores/statsStore'
import { useVisible } from '../lib/stores/useVisible'
import type { AIStatus, ModelsInfo } from '../lib/types'
import OpenRouterPrompt from '../components/OpenRouterPrompt'
import { Icon } from '../components/icons'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Meter,
  PageHeader,
  ProgressBar,
  ProgressRing,
  SectionHeader,
  Skeleton,
  toast,
  useConfirm
} from '../components/ui'

/** AI models (spec 4.11): where the AI runs, what this PC can run, the
 *  models installed, and one-click downloads of the recommended ones. */

const GiB = 1024 ** 3
const gb = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GB`

function WhereAIRuns({
  ai,
  offline,
  vram,
  onRetry
}: {
  ai: AIStatus | null
  offline: boolean
  vram: number | null
  onRetry: () => void
}): JSX.Element {
  const local = ai ? ai.active.local : true
  const label = ai ? (ai.providers.find((p) => p.id === ai.active.provider)?.label ?? ai.active.provider) : ''
  const state = !ai ? 'loading' : local ? (offline ? 'down' : 'ok') : 'cloud'
  return (
    <Card variant="hero" className="sys-where">
      <div className="sys-where-main">
        <span className="sys-where-dot" data-state={state} aria-hidden>
          <span />
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-micro">{t('Where your AI runs')}</p>
          {!ai ? (
            <Skeleton w={220} h={24} className="mt-1" />
          ) : (
            <h2 className="t-lg text-ink mt-0.5">
              {local ? t('This PC (Ollama)') : `${t('Cloud')}: ${label}`}
              <span className="text-muted t-sm font-normal ml-2 font-mono">{ai.active.model}</span>
            </h2>
          )}
          <p className="text-sm text-muted mt-1">
            {!ai
              ? t('Checking…')
              : local
                ? offline
                  ? t('Ollama isn’t answering, so clips can’t be picked until it runs.')
                  : t('Clip picking and titles run on this PC. Nothing leaves it.')
                : t('Clip picking and titles use your own API key. Local models are only needed if you switch back.')}
            {ai && (
              <>
                {' '}
                <span className="text-muted/80">
                  {t('Transcription')}: <span className="text-ink">{ai.transcription.backend}</span>
                  {ai.transcription.model ? ` · ${ai.transcription.model}` : ''}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {state === 'down' && (
            <Button variant="ghost" size="sm" icon="refresh" onClick={onRetry}>
              {t('Retry')}
            </Button>
          )}
          <Button variant="accent" size="sm" icon="gear" onClick={() => openSettings('ai')}>
            {t('Change')}
          </Button>
        </div>
      </div>
      {ai && local && (
        // Highlighted when the card is under the "Under 6 GB VRAM" tier or
        // there is no reading of one: the model guide's own threshold.
        <div className="mt-4">
          <OpenRouterPrompt
            prominent={vram !== null && vram < 5.5 * GiB}
            title="Don't want to run models locally?"
            body="Try OpenRouter with your own key: one key for many cloud models, billed by OpenRouter to your account."
          />
        </div>
      )}
    </Card>
  )
}

function Hardware({ active }: { active: boolean }): JSX.Element {
  const stats = useSystemStats(active)
  const gpu = stats?.gpu ?? null
  const vramFrac = gpu && gpu.vram_total ? gpu.vram_used / gpu.vram_total : null
  return (
    <Card className="sys-hw">
      <div className="sys-hw-gauge">
        <ProgressRing value={stats ? (vramFrac ?? 0) : null} size={92} stroke={7} label={t('Graphics memory in use')} tone="gold">
          <span className="text-center">
            <span className="block t-md tabular text-ink">{vramFrac === null ? '—' : `${Math.round(vramFrac * 100)}%`}</span>
            <span className="t-micro">VRAM</span>
          </span>
        </ProgressRing>
        <ProgressRing value={stats ? stats.ram_percent / 100 : null} size={92} stroke={7} label={t('Memory in use')} tone="accent">
          <span className="text-center">
            <span className="block t-md tabular text-ink">{stats ? `${Math.round(stats.ram_percent)}%` : '—'}</span>
            <span className="t-micro">RAM</span>
          </span>
        </ProgressRing>
      </div>
      <div className="min-w-0 flex-1">
        <p className="t-micro">{t('This PC')}</p>
        <p className="t-md text-ink mt-0.5 truncate" title={gpu?.name}>
          {gpu?.name ?? (stats ? t('No graphics card reading') : t('Reading…'))}
        </p>
        <dl className="sys-hw-facts">
          <div>
            <dt>{t('Graphics memory')}</dt>
            <dd className="tabular">{gpu ? `${gb(gpu.vram_used)} / ${gb(gpu.vram_total)}` : '—'}</dd>
          </div>
          <div>
            <dt>{t('GPU load')}</dt>
            <dd className="tabular">{gpu ? `${Math.round(gpu.gpu_percent)}%` : '—'}</dd>
          </div>
          <div>
            <dt>{t('Free disk')}</dt>
            <dd className="tabular">{stats ? gb(stats.disk_free_bytes) : '—'}</dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}

export default function Models({ active = true }: { active?: boolean } = {}): JSX.Element {
  const visible = useVisible(active)
  const ask = useConfirm()
  const [info, setInfo] = useState<ModelsInfo | null>(null)
  const [offline, setOffline] = useState(false)
  const [ai, setAi] = useState<AIStatus | null>(null)
  const [pullTag, setPullTag] = useState('')
  const [pullError, setPullError] = useState<string | null>(null)
  const [starting, setStarting] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [swapped, setSwapped] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const pulls = useModelPulls()
  // For the "won't fit your card" warning — the one speed difference big
  // enough that people report it as the app being broken.
  const stats = useSystemStats(visible)
  const vram = stats?.gpu?.vram_total ?? null

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setInfo(await api.models())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
    api
      .ai()
      .then(setAi)
      .catch(() => setAi(null))
  }, [visible, refresh])

  useStudioEvents((e) => {
    if (e.type !== 'model_pull') return
    const tag = String((e as { tag?: string }).tag ?? '')
    if (e.status === 'done') {
      setStarting((s) => {
        const n = new Set(s)
        n.delete(tag)
        return n
      })
      void refresh()
    } else if (e.status === 'error') {
      setStarting((s) => {
        const n = new Set(s)
        n.delete(tag)
        return n
      })
      setPullError(`${t('Download failed')}: ${(e as { error?: string }).error ?? t('unknown error')}`)
    }
  })

  const activate = async (tag: string): Promise<void> => {
    setBusy(tag)
    try {
      await api.activateModel(tag)
      await refresh()
      setSwapped(tag)
      setTimeout(() => setSwapped(null), 900)
      toast({ title: `${t('Now using')} ${tag}`, tone: 'success', icon: 'cpu' })
    } catch (e) {
      toast({ title: t('Couldn’t switch models'), body: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (tag: string, size: number): Promise<void> => {
    const ok = await ask({
      title: `${t('Remove')} ${tag}?`,
      body: `${t('Frees')} ${size.toFixed(1)} GB. ${t('You can download it again any time.')}`,
      confirmLabel: t('Remove'),
      tone: 'danger'
    })
    if (!ok) return
    setBusy(tag)
    try {
      await api.deleteModel(tag)
      setLeaving(tag)
      setTimeout(() => {
        setLeaving(null)
        void refresh()
      }, 340)
    } catch (e) {
      toast({ title: t('Couldn’t remove it'), body: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const pull = async (tag: string): Promise<void> => {
    const clean = tag.trim()
    if (!clean) return
    setPullError(null)
    setStarting((s) => new Set(s).add(clean))
    try {
      await api.pullModel(clean)
    } catch (e) {
      setStarting((s) => {
        const n = new Set(s)
        n.delete(clean)
        return n
      })
      setPullError(`${t('Download failed')}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const installedNames = new Set((info?.installed ?? []).map((m) => m.name))
  const downloading = Array.from(new Set([...Object.keys(pulls), ...starting]))
  const isPulling = (tag: string): boolean => tag in pulls || starting.has(tag)
  const cloud = ai !== null && !ai.active.local

  return (
    <div className="sys-page max-w-[1200px] mx-auto p-6 space-y-5">
      <PageHeader
        eyebrow={t('SYSTEM')}
        title={t('AI models')}
        icon="cpu"
        vtName="page-title"
        subtitle={t('The local AI that picks and titles your clips. Download, switch and remove models here.')}
      />

      <div className="sys-models-top">
        <WhereAIRuns ai={ai} offline={offline} vram={vram} onRetry={() => void refresh()} />
        <Hardware active={visible} />
      </div>

      {downloading.length > 0 && (
        <Card variant="glow" className="space-y-3 anim-rise">
          <SectionHeader title={t('Downloading')} count={downloading.length} />
          {downloading.map((tag) => (
            <div key={tag} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-mono text-ink">{tag}</span>
                <span className="tabular text-muted">
                  {pulls[tag] !== undefined && pulls[tag] !== null ? `${Math.round((pulls[tag] as number) * 100)}%` : t('starting…')}
                </span>
              </div>
              <ProgressBar value={pulls[tag] ?? null} label={`${t('Downloading')} ${tag}`} tone="gold" striped />
            </div>
          ))}
        </Card>
      )}
      {pullError && (
        <p className="text-sm text-error flex items-center gap-2 anim-shake" role="alert">
          <Icon name="alert" size={14} />
          {pullError}
        </p>
      )}

      {offline && !info ? (
        cloud ? (
          <Card variant="sunken" className="text-sm text-muted">
            {t('Ollama isn’t running, which is fine while the cloud is chosen. Local models show here once it runs.')}
          </Card>
        ) : (
          <Card>
            <EmptyState
              illustration="sun"
              title={t('Ollama isn’t reachable')}
              body={t('Make sure it’s installed and running, then try again.')}
              action={
                <>
                  <Button variant="accent" icon="refresh" onClick={() => void refresh()}>
                    {t('Retry')}
                  </Button>
                  <Button variant="ghost" icon="wand" onClick={() => window.dispatchEvent(new Event('open-setup-wizard'))}>
                    {t('Run setup again')}
                  </Button>
                </>
              }
            />
          </Card>
        )
      ) : !info ? (
        <div className="sys-model-grid">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={150} radius={16} />
          ))}
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeader title={t('Installed')} count={info.installed.length} hint={t('The active model picks and titles every clip.')} />
            {info.installed.length === 0 ? (
              <Card>
                <EmptyState compact illustration="sun" title={t('No local models yet')} body={t('Download the one recommended for this PC below.')} />
              </Card>
            ) : (
              <div className="sys-model-grid stagger">
                {info.installed.map((m) => {
                  const isActive = info.active === `ollama/${m.name}`
                  const note = speedNote(m, info.installed, vram)
                  const speed = !note ? 0.9 : note.tone === 'ok' ? 0.75 : note.tone === 'slow' ? 0.45 : 0.15
                  return (
                    <article
                      key={m.name}
                      className={`sys-model card ${isActive ? 'sys-model-active' : 'lift'} ${swapped === m.name ? 'anim-pop' : ''} ${leaving === m.name ? 'sys-leaving' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="sys-model-chip" aria-hidden>
                          <Icon name="cpu" size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm text-ink truncate" title={m.name}>
                            {m.name}
                          </p>
                          <p className="text-xs text-muted tabular">
                            {m.size_gb.toFixed(1)} {t('GB on disk')}
                          </p>
                        </div>
                        {isActive && (
                          <Badge tone="gold" icon="check">
                            {t('Active')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-3 space-y-1">
                        <Meter value={speed} label={t('Speed')} tone={!note || note.tone === 'ok' ? 'success' : note.tone === 'slow' ? 'warn' : 'error'} />
                        {note && (
                          <p className={`text-xs ${note.tone === 'warn' ? 'text-error' : note.tone === 'slow' ? 'text-warn' : 'text-muted'}`}>
                            {note.tone !== 'ok' && <Icon name="alert" size={12} className="inline mr-1 -mt-0.5" />}
                            {note.text}
                          </p>
                        )}
                      </div>
                      {!isActive && (
                        <div className="flex gap-2 mt-3">
                          <Button variant="accent" size="sm" icon="zap" loading={busy === m.name} disabled={busy !== null} onClick={() => void activate(m.name)}>
                            {t('Use')}
                          </Button>
                          <Button variant="subtle" size="sm" icon="trash" disabled={busy !== null} onClick={() => void remove(m.name, m.size_gb)}>
                            {t('Remove')}
                          </Button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader title={t('Recommended for your hardware')} hint={info.recommended?.reason} />
            <div className="sys-rec-grid stagger">
              {info.recommendations.map((r) => {
                const have = installedNames.has(r.model)
                const pulling = isPulling(r.model)
                const best = info.recommended?.model === r.model
                return (
                  <button
                    key={r.hardware}
                    type="button"
                    className={`sys-rec card card-interactive ${best ? 'sys-rec-best' : ''}`}
                    disabled={have || pulling}
                    onClick={() => void pull(r.model)}
                    aria-label={`${t('Download')} ${r.model}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="t-micro flex-1 text-left">{r.hardware}</span>
                      {best && (
                        <Badge tone="gold" icon="star" size="xs">
                          {t('For this PC')}
                        </Badge>
                      )}
                    </span>
                    <span className="block font-mono text-ink mt-1.5 text-left">{r.model}</span>
                    <span className="block text-xs text-muted mt-1 text-left leading-relaxed">{r.note}</span>
                    <span className="sys-rec-cta">
                      {have ? (
                        <>
                          <Icon name="check" size={14} /> {t('Installed')}
                        </>
                      ) : pulling ? (
                        <>
                          <Icon name="download" size={14} className="anim-float" /> {t('Downloading…')}
                        </>
                      ) : (
                        <>
                          <Icon name="download" size={14} /> {t('Download')}
                        </>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {info.other_models && info.other_models.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                title={t('Other models')}
                hint={t('Picked for a purpose rather than for your graphics card. All run locally, and all are free to use on clips you earn from.')}
              />
              <p className="text-xs text-muted">
                Only <code>gemma:7b</code>, <code>gemma3:4b</code> and <code>gemma3:12b</code> have been tested against real streams. The rest
                should work &mdash; they are all driven the same way &mdash; but nobody has measured whether they pick better clips.
              </p>
              <div className="sys-rec-grid stagger">
                {info.other_models.map((r) => {
                  const have = installedNames.has(r.model)
                  const pulling = isPulling(r.model)
                  return (
                    <button
                      key={r.purpose}
                      type="button"
                      className="sys-rec card card-interactive"
                      disabled={have || pulling}
                      onClick={() => void pull(r.model)}
                      aria-label={`${t('Download')} ${r.model}`}
                    >
                      <span className="t-micro block text-left">{r.purpose}</span>
                      <span className="block font-mono text-ink mt-1.5 text-left">{r.model}</span>
                      <span className="block text-xs text-muted mt-1 text-left leading-relaxed">{r.note}</span>
                      <span className="sys-rec-cta">
                        <Icon name={have ? 'check' : 'download'} size={14} />
                        {have ? t('Installed') : pulling ? t('Downloading…') : t('Download')}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <Card className="space-y-2">
            <h3 className="t-md text-ink">{t('Download another model')}</h3>
            <p className="text-xs text-muted">{t('Any tag from the Ollama library.')}</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void pull(pullTag)
                setPullTag('')
              }}
            >
              <input
                className="input flex-1 font-mono"
                placeholder="e.g. gemma3:12b"
                value={pullTag}
                aria-label={t('Model tag')}
                onChange={(e) => setPullTag(e.target.value)}
              />
              <Button type="submit" variant="accent" icon="download" disabled={!pullTag.trim()}>
                {t('Download')}
              </Button>
            </form>
          </Card>
        </>
      )}
    </div>
  )
}
