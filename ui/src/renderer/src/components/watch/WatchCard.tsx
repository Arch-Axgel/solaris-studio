import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../../lib/api'
import type { AutomationStatus, Watch, WatchCreator, WatchItem } from '../../lib/types'
import { platformLabel } from '../../lib/uploadpost'
import QueueItemSettings from '../queue/QueueItemSettings'
import WatchPublishSettings from './WatchPublishSettings'
import { t } from '../../lib/i18n'
import { motionReduced } from '../../lib/motion'
import { Icon } from '../icons'
import { Button, Callout, IconButton, Skeleton, Toggle, useConfirm } from '../ui'

export const WATCH_PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  kick: 'Kick'
}

/** How many videos the history shows before "show more". */
const SHOWN = 3

/** "14:30", or "Thu 14:30" when it is not in the next day. */
function clockTime(seconds: number): string {
  const when = new Date(seconds * 1000)
  const soon = Math.abs(seconds - Date.now() / 1000) < 20 * 3600
  return when.toLocaleString([], {
    ...(soon ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** "5 min ago" / "in 12 min", from unix seconds. */
export function relative(seconds: number, now = Date.now() / 1000): string {
  const diff = Math.round(seconds - now)
  const abs = Math.abs(diff)
  // The engine's clock and this one differ by a fraction of a second, which
  // otherwise reads "checked in 0 sec" for something that just happened.
  if (abs < 10) return t('just now')
  const unit =
    abs < 90
      ? `${abs} ${t('sec')}`
      : abs < 5400
        ? `${Math.round(abs / 60)} ${t('min')}`
        : abs < 172800
          ? `${Math.round(abs / 3600)} ${t('h')}`
          : `${Math.round(abs / 86400)} ${t('days')}`
  return diff < 0 ? `${unit} ${t('ago')}` : `${t('in')} ${unit}`
}

/** The creator profile the channel's videos learn into, how much it knows so
 *  far, and the way to it. The profile exists from the moment the channel is
 *  watched, so this is there before the first video too. */
function CreatorLine({
  creator,
  onOpen
}: {
  creator: WatchCreator
  onOpen?: (creatorId: number) => void
}): JSX.Element {
  const learned = !creator.learning
    ? t('Learning is off for this creator.')
    : creator.facts > 0
      ? `${creator.facts} ${t(creator.facts === 1 ? 'thing learned from' : 'things learned from')} ` +
        `${creator.videos} ${t(creator.videos === 1 ? 'video' : 'videos')}`
      : t('Learns about them from every video it clips.')
  return (
    <div className="ops-wc-creator">
      <Icon name="users" size={14} className="text-gold shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-muted">{t('Creator profile')}:</span>{' '}
        <span className="font-semibold text-ink">{creator.name}</span>{' '}
        <span className="text-muted">· {learned}</span>
      </span>
      {onOpen && (
        <Button size="sm" variant="subtle" iconRight="arrow-right" className="shrink-0" onClick={() => onOpen(creator.id)}>
          {t('Open in Creators')}
        </Button>
      )}
    </div>
  )
}

/** One watched channel: its settings, and what became of each video it saw.
 *
 *  Everything shown is read from the server, which reads a video's state live
 *  from its job and its delivery rows. Nothing is applied optimistically; an
 *  action is sent, then the list is read again. */
export default function WatchCard({
  watch,
  automation,
  version,
  onChanged,
  onOpenInStudio,
  onOpenCreator,
  openSetup = false,
  lead,
  stats
}: {
  watch: Watch
  automation: AutomationStatus
  /** Bumped by the page whenever the server says something moved. */
  version: number
  onChanged: () => void
  onOpenInStudio?: (videoId: string) => void
  onOpenCreator?: (creatorId: number) => void
  /** Just added: open everything so it is set up before the first new video.
   *  A new channel only records what is already there, so there is time. */
  openSetup?: boolean
  /** Shown before the name (the tile's avatar). */
  lead?: React.ReactNode
  /** Shown under the name row (the tile's counts). */
  stats?: React.ReactNode
}): JSX.Element {
  const ask = useConfirm()
  const [items, setItems] = useState<WatchItem[] | null>(null)
  const [openClips, setOpenClips] = useState(openSetup)
  const [openPublish, setOpenPublish] = useState(openSetup)
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (openSetup) cardRef.current?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
  }, [openSetup])
  const [showAll, setShowAll] = useState(false)
  const [showEarlier, setShowEarlier] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await api.watchItems(watch.id, 200))
    } catch (e) {
      setError(errorText(e))
    }
  }, [watch.id])

  useEffect(() => {
    void load()
  }, [load, version])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const ok = await ask({
      title: t('Stop watching?'),
      body: (
        <div className="space-y-2">
          <p className="font-medium text-ink">{watch.name || watch.channel_key}</p>
          <p>{t('New videos from this channel won’t be clipped any more. Clips it already made stay in your library.')}</p>
        </div>
      ),
      confirmLabel: t('Remove'),
      tone: 'danger'
    })
    if (ok) void act(() => api.deleteWatch(watch.id))
  }

  const now = Date.now() / 1000
  const status = !automation.enabled
    ? t('Watching is switched off.')
    : !watch.enabled
      ? t('Paused.')
      : watch.last_ok_poll_at
        ? `${t('Checked')} ${relative(watch.last_ok_poll_at, now)}` +
          (watch.next_poll_at > now ? ` · ${t('next check')} ${relative(watch.next_poll_at, now)}` : '')
        : t('Looking at the channel for the first time…')

  const visible = (items ?? []).filter((i) => showEarlier || i.status !== 'earlier')
  const earlier = (items ?? []).filter((i) => i.status === 'earlier').length
  const shown = showAll ? visible : visible.slice(0, SHOWN)
  const name = watch.name || watch.channel_key
  const platform = WATCH_PLATFORM_LABEL[watch.platform] ?? watch.platform

  return (
    <section ref={cardRef} className="ops-wc" aria-label={watch.name}>
      <div className="ops-wc-head">
        {lead}
        <div className="ops-wc-id">
          <h3 className="ops-wc-name">
            <span className="truncate min-w-0" title={name}>
              {name}
            </span>
            <span className="sr-only"> ({platform})</span>
            {automation.enabled && watch.enabled && (
              <span className="ops-wc-watching">
                <span className="size-1.5 rounded-full bg-success animate-pulse" aria-hidden />
                {t('Watching')}
              </span>
            )}
          </h3>
          <p className="text-xs text-muted truncate" title={status}>
            {status}
          </p>
        </div>
        <div className="ops-wc-actions">
          <span className="ops-wc-switch" title={t('Watch this channel')}>
            <Toggle
              hideLabel
              label={t('Watch this channel')}
              checked={watch.enabled}
              disabled={busy}
              onChange={(on) => void act(() => api.patchWatch(watch.id, { enabled: on }))}
            />
            <span aria-hidden className={watch.enabled ? 'text-ink' : 'text-muted'}>
              {watch.enabled ? t('On') : t('Off')}
            </span>
          </span>
          <Button
            size="sm"
            variant="subtle"
            icon="refresh"
            disabled={busy || !watch.enabled || !automation.enabled}
            onClick={() => void act(() => api.checkWatch(watch.id))}
          >
            {t('Check now')}
          </Button>
          <IconButton size="sm" icon="trash" tone="error" label={t('Remove')} disabled={busy} onClick={() => void remove()} />
        </div>
      </div>

      {stats}

      <div className="ops-wc-body space-y-3">
        {watch.last_error && (
          <Callout tone="error" title={t('Could not check this channel:')}>
            <span className="break-words">{watch.last_error}</span>
            {watch.platform === 'kick' &&
              ` ${t('Kick has no official way to list videos, so this can stop working without notice.')}`}
            {watch.enabled && automation.enabled && (
              <span className="block mt-2">
                <Button size="sm" variant="subtle" icon="refresh" disabled={busy} onClick={() => void act(() => api.checkWatch(watch.id))}>
                  {t('Check now')}
                </Button>
              </span>
            )}
          </Callout>
        )}

        {watch.creator && <CreatorLine creator={watch.creator} onOpen={onOpenCreator} />}

        {openSetup && (
          <p className="ops-wc-setup">
            <Icon name="sparkle" size={14} />
            {t('Set it up now. Nothing is clipped until the channel posts something new.')}
          </p>
        )}
        <div className="ops-wc-tabs">
          <Button
            size="sm"
            variant="subtle"
            icon="scissors"
            iconRight={openClips ? 'chevron-up' : 'chevron-down'}
            aria-expanded={openClips}
            onClick={() => setOpenClips(!openClips)}
          >
            {t('Clip settings')}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            icon="send"
            iconRight={openPublish ? 'chevron-up' : 'chevron-down'}
            aria-expanded={openPublish}
            onClick={() => setOpenPublish(!openPublish)}
          >
            {t('Publishing')}: {t(publishModeLabel(watch.publish.mode))}
          </Button>
        </div>

        {openClips && (
          <div className="ops-wc-panel anim-rise">
            <label className="ops-field-inline">
              <span className="label">{t('Preset')}</span>
              <select
                className="input !w-56"
                value={watch.preset}
                disabled={busy}
                onChange={(e) => void act(() => api.patchWatch(watch.id, { preset: e.target.value }))}
              >
                {automation.presets.map((p) => (
                  <option key={p.id} value={p.id} title={p.description}>
                    {t(p.name)}
                  </option>
                ))}
              </select>
            </label>
            <QueueItemSettings
              key={`watch-${watch.id}`}
              job={{ id: watch.id, settings: watch.options }}
              heading="Settings for every video from this channel"
              autoSave
              save={(patch) => api.patchWatch(watch.id, { options: patch })}
              onSaved={onChanged}
              channel={{
                mode: watch.publish.mode,
                max_posts: watch.publish.max_posts,
                presetLongform: Boolean(automation.presets.find((p) => p.id === watch.preset)?.options?.longform)
              }}
            />
          </div>
        )}
        {openPublish && (
          <div className="ops-wc-panel anim-rise">
            <WatchPublishSettings watch={watch} onSaved={onChanged} />
          </div>
        )}

        {error && (
          <p className="ops-qi-fail" role="alert">
            <Icon name="alert" size={13} />
            {error}
          </p>
        )}

        <div className="space-y-2">
          {items === null ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton h={52} radius={12} />
              <Skeleton h={52} radius={12} />
            </div>
          ) : visible.length === 0 ? (
            <p className="ops-wc-none">
              <Icon name="clock" size={14} />
              {earlier > 0
                ? t('Nothing new yet. New videos from this channel will show up here.')
                : t('Nothing found yet.')}
            </p>
          ) : (
            shown.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                busy={busy}
                act={act}
                onOpenInStudio={onOpenInStudio}
              />
            ))
          )}
          {(visible.length > SHOWN || earlier > 0) && (
            <div className="flex gap-2 flex-wrap">
              {visible.length > SHOWN && (
                <Button
                  size="sm"
                  variant="subtle"
                  iconRight={showAll ? 'chevron-up' : 'chevron-down'}
                  aria-expanded={showAll}
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? t('Show fewer') : `${t('Show all')} (${visible.length})`}
                </Button>
              )}
              {earlier > 0 && (
                <Button
                  size="sm"
                  variant="subtle"
                  icon="clock"
                  onClick={() => setShowEarlier(!showEarlier)}
                  title={t('Videos that were already on the channel when you started watching it.')}
                >
                  {showEarlier
                    ? t('Hide earlier videos')
                    : `${t('Show earlier videos')} (${earlier})`}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function publishModeLabel(mode: Watch['publish']['mode']): string {
  return mode === 'auto' ? 'Automatic' : mode === 'ask' ? 'Ask first' : 'Off'
}

function statusText(item: WatchItem): { text: string; tone: string } {
  switch (item.status) {
    case 'earlier':
      return { text: 'Before you started watching', tone: 'text-muted' }
    case 'waiting_for_video':
      return { text: 'Waiting for the video to be ready', tone: 'text-warn' }
    case 'waiting_for_queue':
      return { text: 'Waiting for room in the queue', tone: 'text-warn' }
    case 'queued':
      return { text: 'In the queue', tone: 'text-ink' }
    case 'processing':
      return { text: 'Making clips', tone: 'text-gold' }
    case 'complete':
      return { text: 'Clips made', tone: 'text-gold' }
    case 'failed':
      return { text: 'Failed', tone: 'text-error' }
    case 'cancelled':
      return { text: 'Cancelled', tone: 'text-muted' }
    case 'skipped':
      return { text: 'Skipped', tone: 'text-muted' }
    default:
      return { text: 'Problem', tone: 'text-error' }
  }
}

/** Per-platform delivery counts, so twenty clips read as one line each. */
function deliverySummary(item: WatchItem): {
  platform: string
  published: number
  waiting: number
  failed: number
  skipped: number
  errors: string[]
}[] {
  const by = new Map<string, ReturnType<typeof deliverySummary>[number]>()
  for (const d of item.deliveries ?? []) {
    const row = by.get(d.platform) ?? {
      platform: d.platform,
      published: 0,
      waiting: 0,
      failed: 0,
      skipped: 0,
      errors: []
    }
    if (d.state === 'published') row.published += 1
    else if (d.state === 'failed') {
      row.failed += 1
      if (d.error && !row.errors.includes(d.error)) row.errors.push(d.error)
    } else if (d.state === 'skipped') row.skipped += 1
    else row.waiting += 1
    by.set(d.platform, row)
  }
  return [...by.values()]
}

function ItemRow({
  item,
  busy,
  act,
  onOpenInStudio
}: {
  item: WatchItem
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
  onOpenInStudio?: (videoId: string) => void
}): JSX.Element {
  const { text, tone } = statusText(item)
  const deliveries = deliverySummary(item)
  const anyFailed = deliveries.some((d) => d.failed > 0 || d.skipped > 0)
  const when = item.published_at || item.detected_at

  // The status already says it for the back catalogue; its reason would
  // only repeat it on every row.
  let detail = item.status === 'earlier' ? '' : item.reason
  if (item.status === 'queued') {
    detail = item.queue_paused
      ? t('The queue is stopped. Press Start queue on the Queue page.')
      : item.waiting_behind
        ? `${item.waiting_behind} ${t('ahead of it')}`
        : ''
  } else if (item.status === 'processing' && item.progress?.percent != null) {
    detail = `${item.progress.percent}% · ${item.progress.label ?? ''}`
  } else if (item.status === 'failed') {
    detail = item.retry_at
      ? `${t('Trying again at')} ${clockTime(item.retry_at)} (${t('retry')} ${item.retries + 1} ${t('of')} 2)`
      : item.details || ''
  } else if (item.status === 'complete') {
    detail = `${item.clips ?? 0} ${item.clips === 1 ? t('clip') : t('clips')}`
  }

  return (
    <div className="ops-wc-item space-y-1.5" data-status={item.status}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="ops-wc-item-title"
            title={item.url}
            onClick={() => void window.studio?.openExternal(item.url)}
          >
            {item.title || item.video_id}
          </button>
          <p className="ops-wc-item-meta">
            {when ? <span>{relative(when)}</span> : null}
            <span className={tone}>{t(text)}</span>
            {detail && <span className="min-w-0">{t(detail)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(item.status === 'earlier' || item.status === 'skipped' || item.status === 'error') && (
            <Button size="sm" variant="subtle" icon="scissors" disabled={busy} onClick={() => void act(() => api.clipWatchItem(item.id))}>
              {t('Clip this')}
            </Button>
          )}
          {(item.status === 'waiting_for_video' || item.status === 'waiting_for_queue') && (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void act(() => api.skipWatchItem(item.id))}>
              {t('Skip')}
            </Button>
          )}
          {item.status === 'failed' && (
            <Button size="sm" variant="subtle" iconRight="arrow-right" onClick={() => window.dispatchEvent(new CustomEvent('open-queue'))}>
              {t('Open queue')}
            </Button>
          )}
          {item.status === 'complete' && onOpenInStudio && (
            <Button size="sm" variant="subtle" icon="film" onClick={() => onOpenInStudio(item.video_id)}>
              {t('Open in editor')}
            </Button>
          )}
        </div>
      </div>

      {item.status === 'complete' && (
        <div className="text-xs space-y-1.5">
          {item.publish_state === 'ask' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-warn">{t('Ready to publish.')}</span>
              <Button size="sm" variant="accent" icon="send" disabled={busy} onClick={() => void act(() => api.publishWatchItem(item.id))}>
                {t('Publish')}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => api.skipWatchItem(item.id))}>
                {t("Don't publish")}
              </Button>
            </div>
          )}
          {item.publish_state === 'publishing' &&
            (item.publish_retry_at > Date.now() / 1000 ? (
              <span className="text-warn">
                {t('Publishing did not start.')} {t('Trying again at')}{' '}
                {clockTime(item.publish_retry_at)} ({t('attempt')} {item.publish_attempts + 1}{' '}
                {t('of')} 7)
              </span>
            ) : (
              <span className="text-gold">{t('Publishing…')}</span>
            ))}
          {item.publish_state === 'done' && item.publish_retry_at > 0 && (
            <span className="text-muted">
              {t('Sending the rejected ones again at')} {clockTime(item.publish_retry_at)}
            </span>
          )}
          {item.source_freed === 1 && (
            <span className="text-muted block">{t('Download deleted to save space.')}</span>
          )}
          {item.publish_state === 'off' && deliveries.length === 0 && (
            <span className="text-muted">{t('Not published.')}</span>
          )}
          {item.publish_error && <p className="text-warn">{item.publish_error}</p>}
          {deliveries.length > 0 && (
            <div className="flex gap-x-2 gap-y-1.5 flex-wrap items-center">
              {deliveries.map((d) => (
                <span key={d.platform} className="ops-delivery" title={d.errors.join('\n')}>
                  <span className="font-medium text-ink">{platformLabel(d.platform)}</span>
                  {d.published > 0 && (
                    <span className="text-success" aria-label={`${d.published} ${t('published')}`}>
                      <Icon name="check" size={11} /> {d.published}
                    </span>
                  )}
                  {d.waiting > 0 && (
                    <span className="text-muted" aria-label={`${d.waiting} ${t('waiting')}`}>
                      <Icon name="clock" size={11} /> {d.waiting}
                    </span>
                  )}
                  {d.failed > 0 && (
                    <span className="text-error" aria-label={`${d.failed} ${t('failed')}`}>
                      <Icon name="x" size={11} /> {d.failed}
                    </span>
                  )}
                  {d.skipped > 0 && (
                    <span className="text-warn" aria-label={`${d.skipped} ${t('skipped')}`}>
                      <Icon name="ban" size={11} /> {d.skipped}
                    </span>
                  )}
                </span>
              ))}
              {anyFailed && item.publish_state === 'done' && (
                <Button
                  size="sm"
                  variant="subtle"
                  icon="retry"
                  disabled={busy}
                  onClick={() => void act(() => api.publishWatchItem(item.id))}
                  title={t('Send again only the ones that failed.')}
                >
                  {t('Retry failed')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
