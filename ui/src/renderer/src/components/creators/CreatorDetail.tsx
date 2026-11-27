import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { BrandingProfile, CreatorDetail as Detail, CreatorSummary, WatermarkConfig } from '../../lib/types'
import WatermarkControls, { DEFAULT_WATERMARK } from '../WatermarkControls'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { Avatar, Badge, Button, CountUp, EmptyState, IconButton, Meter, Tabs, Toggle, Tooltip, useConfirm } from '../ui'
import { PlatformBadge } from './CreatorList'
import DangerZone from './DangerZone'

const KNOWLEDGE_LABELS: Record<string, string> = {
  topic: 'Topics',
  game: 'Games',
  series: 'Series',
  catchphrase: 'Catchphrases',
  joke: 'Running jokes',
  collaborator: 'Collaborators',
  format: 'Formats',
  life: 'Life & events'
}

/** A type the app has no label for yet: "life_event" reads "Life event". */
function knowledgeLabel(type: string): string {
  const known = KNOWLEDGE_LABELS[type]
  if (known) return t(known)
  const words = type.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type
}

// Why a learned fact is or isn't being used. Catchphrases used to fill up
// with lines the creator said once, so the count is shown and anything not in
// play is dimmed and labelled rather than quietly listed as fact.
const STATE_CHIP: Record<string, { label: string; title: string }> = {
  candidate: {
    label: 'not confirmed',
    title:
      'Only heard once or twice. It stays here in case they say it again, but it is not used for scoring or titles until it repeats.'
  },
  dormant: {
    label: 'dormant',
    title:
      'They have not said this again in months of videos, so it no longer affects scoring or titles. It comes back the next time they say it.'
  }
}

const EVENT_TONE: Record<string, 'gold' | 'warn' | 'success' | 'muted'> = {
  announced: 'gold',
  in_progress: 'warn',
  completed: 'success',
  stale: 'muted'
}

type Tab = 'overview' | 'knowledge' | 'branding' | 'preferences'

/** The right-hand detail of one creator, in tabs. Every action goes through
 *  the page's `act`, which re-reads the list and this detail afterwards. */
export default function CreatorDetail({
  detail,
  summary,
  busy,
  act,
  brandingProfiles,
  onBrandingChanged,
  onDeleted,
  onSeeClips
}: {
  detail: Detail
  summary?: CreatorSummary
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
  brandingProfiles: BrandingProfile[]
  onBrandingChanged: () => void
  onDeleted: () => void
  onSeeClips: () => void
}): JSX.Element {
  const ask = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')
  const [addPlatform, setAddPlatform] = useState('youtube')
  const [addChannel, setAddChannel] = useState('')
  const [wmCreating, setWmCreating] = useState(false)
  const [wmName, setWmName] = useState('')
  const [wmConfig, setWmConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK)

  // A different creator starts on Overview with the branding form closed.
  useEffect(() => {
    setTab('overview')
    setWmCreating(false)
    setAddChannel('')
  }, [detail.creator_id])

  const knowledgeByType = detail.knowledge.reduce<Record<string, Detail['knowledge']>>((acc, k) => {
    ;(acc[k.knowledge_type] ??= []).push(k)
    return acc
  }, {})
  // Facts sitting there doing nothing: unconfirmed phrases and dormant items.
  const unusedCount = detail.knowledge.filter((k) => k.state !== 'active').length
  const maxSeen = Math.max(2, ...detail.knowledge.map((k) => k.times_seen))

  const setLearning = (enabled: boolean): void => {
    void act(async () => {
      await api.setCreatorLearning(detail.creator_id, enabled)
      if (
        !enabled &&
        (await ask({
          title: `${t('Learning is now off for')} ${detail.display_name}`,
          body: t(
            'Also wipe everything already learned about them (knowledge, storylines, feedback history) to save space? This can’t be undone.'
          ),
          confirmLabel: t('Wipe learned memory'),
          cancelLabel: t('Keep it'),
          tone: 'danger'
        }))
      ) {
        await api.wipeCreatorMemory(detail.creator_id)
      }
    })
  }

  const forgetUnused = async (): Promise<void> => {
    const ok = await ask({
      title: `${t('Forget')} ${unusedCount} ${t(unusedCount === 1 ? 'unused entry' : 'unused entries')} ${t('for')} ${detail.display_name}?`,
      body: t(
        'These are phrases heard only once and facts they’ve stopped mentioning — none of them affect your clips today. Anything they say again is relearned.'
      ),
      confirmLabel: t('Forget them'),
      tone: 'danger'
    })
    if (ok) void act(() => api.clearUnusedKnowledge(detail.creator_id))
  }

  const stats: [string, number | null][] = [
    [t('Videos'), summary?.videos ?? null],
    [t('Clips'), summary?.clips ?? null],
    [t('Avg score'), summary?.avg_score ?? null],
    [t('Facts learned'), detail.knowledge.filter((k) => k.state === 'active').length],
    [t('Storylines'), detail.events.length]
  ]

  return (
    <div className="card ops-cdetail anim-scale" key={detail.creator_id}>
      <header className="ops-cdetail-head">
        <Avatar seed={detail.creator_id} name={detail.display_name} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="t-xl text-ink truncate">{detail.display_name}</h2>
          {detail.aliases.length > 1 && (
            <p className="text-xs text-muted mt-0.5">
              {t('Also known as:')} {detail.aliases.filter((a) => a !== detail.display_name).join(', ')}
            </p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {detail.accounts.map((a) => (
              <PlatformBadge key={a.account_id} platform={a.platform} />
            ))}
            {summary?.watched && (
              <Badge tone="success" size="xs" icon="radar">
                {t('Watched')}
              </Badge>
            )}
          </div>
        </div>
        <Tooltip
          content={t('Learns their topics, running jokes and storylines from every video, to pick and title clips better. Stays on this computer.')}
        >
          <span className="ops-cdetail-learn">
            <Toggle
              checked={!!detail.learning_enabled}
              disabled={busy}
              onChange={setLearning}
              label={t('Learning enabled')}
            />
          </span>
        </Tooltip>
      </header>

      <Tabs
        ariaLabel={t('Creator details')}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: 'overview', label: t('Overview'), icon: 'eye' },
          { id: 'knowledge', label: t('Knowledge'), icon: 'bulb', badge: detail.knowledge.length || undefined },
          { id: 'branding', label: t('Branding'), icon: 'badge' },
          { id: 'preferences', label: t('Preferences'), icon: 'heart' }
        ]}
      />

      <div key={tab} className="ops-cdetail-body anim-fade">
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="ops-cstats">
              {stats.map(([label, n]) => (
                <div key={label} className="ops-cstat">
                  <p className="t-micro text-muted ops-cstat-label" title={label}>
                    {label}
                  </p>
                  <p className="t-kpi">{n === null ? <span className="text-muted">—</span> : <CountUp value={n} />}</p>
                </div>
              ))}
            </div>

            {/* Gold only when there is something to see: with no clips the
                way to the editor stays, but doesn't shout. */}
            <div className="flex gap-2 flex-wrap items-center">
              <Button
                variant={(summary?.clips ?? 0) > 0 ? 'gold' : 'subtle'}
                icon="film"
                iconRight="arrow-right"
                onClick={onSeeClips}
              >
                {t('See their clips')}
              </Button>
              {summary && summary.clips === 0 && (
                <span className="text-xs text-muted">{t('No clips from this creator yet.')}</span>
              )}
            </div>

            <section className="space-y-2">
              <h4 className="t-micro text-gold">{t('Channels')}</h4>
              <div className="space-y-1.5">
                {detail.accounts.map((a) => (
                  <div key={a.account_id} className="ops-cchannel">
                    <PlatformBadge platform={a.platform} />
                    <span className="text-sm text-ink truncate">{a.username}</span>
                    {detail.accounts.length > 1 && (
                      <Button
                        size="sm"
                        variant="subtle"
                        icon="scissors"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() => void act(() => api.splitCreatorAccount(a.account_id))}
                        title={t('Detach this channel into its own profile')}
                      >
                        {t('Detach')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <form
                className="ops-cadd"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!addChannel.trim()) return
                  void act(() => api.addCreatorAccount(detail.creator_id, addPlatform, addChannel.trim())).then(() =>
                    setAddChannel('')
                  )
                }}
              >
                <select
                  value={addPlatform}
                  onChange={(e) => setAddPlatform(e.target.value)}
                  className="input ops-cadd-platform"
                  aria-label={t('Platform of the channel to add')}
                >
                  <option value="youtube">YouTube</option>
                  <option value="twitch">Twitch</option>
                  <option value="kick">Kick</option>
                </select>
                <input
                  value={addChannel}
                  onChange={(e) => setAddChannel(e.target.value)}
                  placeholder={t('Add another channel (exact name)')}
                  className="input ops-cadd-name"
                  aria-label={t('Channel name to add')}
                />
                <Button type="submit" variant="accent" icon="plus" disabled={busy || !addChannel.trim()}>
                  {t('Add')}
                </Button>
              </form>
              <p className="text-xs text-muted leading-relaxed">
                {t(
                  'Use this when the same creator has a channel the app didn’t connect automatically. Their future videos will land on this profile.'
                )}
              </p>
            </section>

            {detail.events.length > 0 && (
              <section className="space-y-2">
                <h4 className="t-micro text-gold">{t('Storylines & events')}</h4>
                <div className="flex gap-2 flex-wrap">
                  {detail.events.map((ev) => (
                    <span key={ev.event_id} className="ops-story" title={ev.description || undefined}>
                      <Badge tone={EVENT_TONE[ev.status] ?? 'muted'} size="xs">
                        {t(ev.status.replace('_', ' '))}
                      </Badge>
                      <span className="text-sm text-ink">{ev.event_name}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <DangerZone
              detail={detail}
              videos={summary?.videos ?? 0}
              busy={busy}
              act={act}
              onDeleted={onDeleted}
            />
          </div>
        )}

        {tab === 'knowledge' &&
          (detail.knowledge.length === 0 ? (
            <EmptyState
              compact
              illustration="creators"
              title={t('Nothing learned yet')}
              body={t('Knowledge builds up as this creator’s videos are processed.')}
            />
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-3 flex-wrap">
                <p className="text-xs text-muted flex-1 min-w-60 leading-relaxed">
                  {t(
                    'A catchphrase has to actually repeat before it counts, and anything they stop saying goes dormant. Greyed-out entries aren’t used for scoring or titles.'
                  )}
                </p>
                {unusedCount > 0 && (
                  <Button size="sm" variant="subtle" icon="trash" disabled={busy} onClick={() => void forgetUnused()}>
                    {t('Forget the')} {unusedCount} {t('unused')}
                  </Button>
                )}
              </div>
              {Object.entries(knowledgeByType).map(([type, items]) => (
                <section key={type} className="space-y-1.5">
                  <h4 className="t-micro text-gold flex items-center gap-2">
                    {knowledgeLabel(type)}
                    <span className="ops-lane-count tabular">{items!.length}</span>
                  </h4>
                  <div className="ops-facts">
                    {items!.map((k) => {
                      const chip = STATE_CHIP[k.state]
                      return (
                        <div key={k.knowledge_id} className="ops-fact" data-state={k.state}>
                          <span className="ops-fact-text">{k.information}</span>
                          {k.times_seen > 1 && (
                            <span
                              className="ops-fact-seen"
                              title={`${t('Heard')} ${k.times_seen} ${t('times across this creator’s videos')}`}
                            >
                              <Meter value={k.times_seen / maxSeen} label={`${t('Heard')} ${k.times_seen}×`} tone="gold" />
                              <span className="tabular">{k.times_seen}×</span>
                            </span>
                          )}
                          {chip && (
                            <span className="ops-fact-chip" title={t(chip.title)}>
                              {t(chip.label)}
                            </span>
                          )}
                          <IconButton
                            size="sm"
                            icon="trash"
                            tone="error"
                            className="ops-fact-del"
                            disabled={busy}
                            label={t('Delete — this fact is wrong')}
                            aria-label={`${t('Delete learned fact:')} ${k.information}`}
                            onClick={() => void act(() => api.deleteCreatorKnowledge(detail.creator_id, k.knowledge_id))}
                          />
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ))}

        {tab === 'branding' && (
          <div className="space-y-4">
            <div>
              <h4 className="t-micro text-gold mb-2">{t('Default branding')}</h4>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="input !w-56"
                  value={detail.default_branding_id ?? ''}
                  disabled={busy}
                  aria-label={t('Default branding')}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null
                    void act(() => api.setCreatorBranding(detail.creator_id, v))
                  }}
                >
                  <option value="">{t('None')}</option>
                  {brandingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!wmCreating && (
                  <Button
                    size="sm"
                    variant="subtle"
                    icon="plus"
                    onClick={() => {
                      setWmCreating(true)
                      setWmName(`${detail.display_name} branding`)
                      setWmConfig({ ...DEFAULT_WATERMARK, text: `@${detail.display_name}` })
                    }}
                  >
                    {t('New branding')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted mt-2 ops-cap-first">
                <span>{t('auto-applied to this creator’s videos')}</span>
              </p>
            </div>

            {wmCreating && (
              <div className="ops-wm anim-rise space-y-3">
                <input
                  className="input !w-64 max-w-full"
                  value={wmName}

                  placeholder={t('Profile name')}
                  aria-label={t('Profile name')}
                  onChange={(e) => setWmName(e.target.value)}
                />
                <WatermarkControls config={wmConfig} onChange={(patch) => setWmConfig((c) => ({ ...c, ...patch }))} />
                <div className="flex items-center gap-2">
                  <Button
                    variant="accent"
                    icon="check"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const { id } = await api.createBranding(wmName || 'Branding', wmConfig)
                        await api.setCreatorBranding(detail.creator_id, id)
                        onBrandingChanged()
                        setWmCreating(false)
                      })
                    }
                  >
                    {t('Create & assign')}
                  </Button>
                  <Button variant="ghost" onClick={() => setWmCreating(false)}>
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'preferences' && (
          <div className="space-y-4">
            <h4 className="t-micro text-gold">{t('Your preferences for this creator')}</h4>
            {detail.preferences ? (
              <>
                <div className="ops-pref">
                  <Icon name="heart" size={18} className="text-gold" />
                  <p className="text-sm text-muted leading-relaxed">
                    {t('Active — based on')} <span className="text-ink tabular">{detail.preferences.signals}</span>{' '}
                    {t('of your exports/edits, clip scoring now leans toward what you keep')}
                    {detail.preferences.preferred_duration != null &&
                      ` (${t('you tend to keep')} ~${Math.round(detail.preferences.preferred_duration)}s ${t('clips')})`}
                    .
                  </p>
                </div>
                {Object.keys(detail.preferences.weight_bias ?? {}).length > 0 && (
                  <div className="ops-bias">
                    {Object.entries(detail.preferences.weight_bias).map(([k, v]) => (
                      <div key={k} className="ops-bias-row">
                        <span className="text-xs text-muted truncate">{k.replace(/_/g, ' ')}</span>
                        <span className="ops-bias-track" aria-hidden>
                          <span
                            data-sign={v >= 0 ? 'up' : 'down'}
                            style={{ transform: `scaleX(${Math.min(1, Math.abs(v))})` }}
                          />
                        </span>
                        <span className="text-xs tabular text-ink">
                          {v >= 0 ? '+' : ''}
                          {v.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                compact
                illustration="sun"
                title={t('Not enough data yet')}
                body={t('As you export and edit clips, scoring will learn what works for this creator.')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
