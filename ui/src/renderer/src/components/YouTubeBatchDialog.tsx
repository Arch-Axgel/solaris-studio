import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import type { Clip } from '../lib/types'
import {
  type YouTubePlanItem,
  type YouTubeStatus
} from '../lib/youtube'
import { openSettings } from '../lib/nav'
import { Dialog, Toggle } from './ui'
import { SuccessMark } from './library/SuccessMark'
import { useClosingDialog } from './library/useClosingDialog'

interface Result {
  started: { clip_id: number; publish_job_id: number; render_job_id: number | null }[]
  skipped: { clip_id: number; reason: string }[]
}

export default function YouTubeBatchDialog({
  clips,
  onClose
}: {
  clips: Clip[]
  onClose: () => void
}): JSX.Element {
  const [open, close] = useClosingDialog(onClose)
  const [status, setStatus] = useState<YouTubeStatus | null>(null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(clips.map((clip) => clip.id)))
  const [channelId, setChannelId] = useState('')
  const [privacy, setPrivacy] = useState('public')
  const [madeForKids, setMadeForKids] = useState<boolean | null>(null)
  const [spread, setSpread] = useState(true)
  const [perDay, setPerDay] = useState(5)
  const [gapHours, setGapHours] = useState(0.5)
  const [plan, setPlan] = useState<YouTubePlanItem[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .youtubeStatus()
      .then((current) => {
        if (!alive) return
        setStatus(current)
        setPrivacy(current.settings?.privacy ?? 'public')
        setChannelId(
          current.accounts?.find((account) => account.default)?.id ??
            current.accounts?.[0]?.id ??
            current.channel?.id ??
            ''
        )
      })
      .catch((e) => alive && setError(String(e).replace(/^Error:\s*/, '')))
    return () => {
      alive = false
    }
  }, [])

  const selectedClips = clips.filter((clip) => selected.has(clip.id))
  const scheduleInvalid = spread && gapHours * (perDay - 1) >= 24

  const update = (): void => {
    setPlan(null)
    setWarnings([])
    setError('')
  }

  const toggleClip = (id: number): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    update()
  }

  const preview = async (): Promise<void> => {
    if (!selectedClips.length || madeForKids === null || scheduleInvalid) return
    setBusy(true)
    setError('')
    try {
      const proposed = await api.planYoutubeBatch({
        clip_ids: selectedClips.map((clip) => clip.id),
        privacy,
        made_for_kids: madeForKids,
        ...(channelId ? { channel_id: channelId } : {}),
        ...(spread
          ? {
              start_at: new Date(
                Date.now() + Math.max(30, selectedClips.length * 10) * 60_000
              ).toISOString(),
              per_day: perDay,
              gap_hours: gapHours
            }
          : {})
      })
      setPlan(proposed.items)
      setWarnings(proposed.warnings)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const publish = async (): Promise<void> => {
    if (!plan?.length || madeForKids === null) return
    setBusy(true)
    setError('')
    try {
      setResult(
        await api.executeYoutubePlan(
          plan.map((item) => ({
            ...item,
            made_for_kids: madeForKids,
            ...(channelId ? { channel_id: channelId } : {})
          }))
        )
      )
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const formatTime = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(value))
      : t('Uploading now')

  const connected = Boolean(status?.enabled && status.connected)
  // One clip reads in the singular throughout: "this video", not "these".
  // Keyed off the clips actually selected, so deselecting down to one reads
  // the same as opening the dialog with one.
  const single = selectedClips.length === 1
  // Why "Preview upload plan" can't be pressed yet, said under it rather than
  // leaving a dead button.
  const previewBlocker = !status
    ? t('Loading your YouTube account…')
    : !connected
      ? t('Connect YouTube first.')
      : !selectedClips.length
        ? t('Pick at least one clip to preview.')
        : madeForKids === null
          ? t('Choose an audience (made for kids or not) to preview the upload.')
          : scheduleInvalid
            ? t('Fix the schedule above to preview the upload.')
            : ''
  const footer = result ? (
    <button className="btn-accent w-full !py-2" onClick={close}>
      {t('Done')}
    </button>
  ) : (
    <div className="flex gap-2 w-full">
      <button className="btn-ghost flex-1 !py-2" onClick={close} disabled={busy}>
        {t('Cancel')}
      </button>
      {plan ? (
        <button
          className="btn-accent flex-1 !py-2"
          disabled={busy || !plan.length}
          onClick={() => void publish()}
        >
          {busy
            ? t('Queueing…')
            : `${t('Upload')} ${plan.length} ${plan.length === 1 ? t('video') : t('videos')}`}
        </button>
      ) : (
        <button
          className="btn-accent flex-1 !py-2"
          disabled={busy || Boolean(previewBlocker)}
          title={previewBlocker || undefined}
          aria-describedby={previewBlocker && connected ? 'yt-batch-blocker' : undefined}
          onClick={() => void preview()}
        >
          {busy ? t('Preparing preview…') : t('Preview upload plan')}
        </button>
      )}
    </div>
  )

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!busy}
      size="md"
      className="lib-dialog"
      title={
        clips.length === 1
          ? t('Publish this clip to YouTube')
          : `${t('Publish')} ${selectedClips.length} ${single ? t('clip') : t('clips')} ${t('to YouTube')}`
      }
      description={
        single
          ? t('Solaris Studio uploads this video through your connected Google account.')
          : t('Solaris Studio uploads these videos through your connected Google account.')
      }
      footer={footer}
    >
      <div className="space-y-4">
        {result ? (
          <div className="space-y-3 text-sm">
            <div className="lib-done">
              <SuccessMark />
              <p className="text-success">
                {result.started.length}{' '}
                {result.started.length === 1 ? t('YouTube upload queued.') : t('YouTube uploads queued.')}
              </p>
            </div>
            {result.skipped.length > 0 && (
              <div className="text-xs text-warn space-y-1">
                <p>{t('Skipped')}:</p>
                {result.skipped.map((item) => (
                  <p key={item.clip_id}>
                    {t('Clip')} {item.clip_id}: {item.reason}
                  </p>
                ))}
              </div>
            )}
            <p className="text-xs text-muted">
              {single
                ? t('You can follow upload progress in the clip’s YouTube tab.')
                : t('You can follow upload progress in each clip’s YouTube tab.')}
            </p>
          </div>
        ) : (
          <>
            {!status && !error && (
              <div className="space-y-2" aria-busy>
                <p className="text-sm text-muted">{t('Loading YouTube account…')}</p>
                <span className="skeleton block h-9 w-full" />
                <span className="skeleton block h-9 w-2/3" />
              </div>
            )}
            {status && !connected && (
              <div className="space-y-2 text-sm">
                <p className="text-warn">{t('YouTube publishing is not connected or enabled.')}</p>
                <button
                  className="btn-accent w-full"
                  onClick={() => {
                    openSettings('publishing')
                    close()
                  }}
                >
                  {t('Open YouTube settings')}
                </button>
              </div>
            )}

            {status?.enabled && status.connected && (
              <>
                {status.accounts && status.accounts.length > 1 && (
                  <label className="block">
                    <span className="label">{t('Publishing to')}</span>
                    <select
                      className="input mt-1"
                      value={channelId}
                      onChange={(event) => {
                        setChannelId(event.target.value)
                        update()
                      }}
                    >
                      {status.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.handle || account.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {status.quota && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted">
                      {status.quota.remaining} {t('of')} {status.quota.uploads_limit}{' '}
                      {t('uploads left today')}
                    </p>
                    <div className="lib-quota" aria-hidden>
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(100, (status.quota.remaining / Math.max(1, status.quota.uploads_limit)) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                {clips.length > 1 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="label">{t('Clips')}</p>
                      <button
                        className="text-xs text-muted hover:text-gold"
                        onClick={() => {
                          setSelected(
                            selected.size === clips.length
                              ? new Set()
                              : new Set(clips.map((clip) => clip.id))
                          )
                          update()
                        }}
                      >
                        {selected.size === clips.length ? t('Select none') : t('Select all')}
                      </button>
                    </div>
                    <div className="lib-dialog-list max-h-44">
                      {clips.map((clip) => (
                        <label key={clip.id} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(clip.id)}
                            onChange={() => toggleClip(clip.id)}
                          />
                          <span className="text-xs truncate">
                            {clip.title || clip.hook || `${t('Clip')} ${clip.id}`}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="label">{t('Visibility')}</span>
                    <select
                      className="input mt-1"
                      value={privacy}
                      onChange={(event) => {
                        setPrivacy(event.target.value)
                        update()
                      }}
                    >
                      <option value="public">{t('Public')}</option>
                      <option value="unlisted">{t('Unlisted')}</option>
                      <option value="private">{t('Private')}</option>
                    </select>
                  </label>
                  <fieldset>
                    <legend className="label">{t('Audience')}</legend>
                    <div className="flex gap-3 mt-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="batch-made-for-kids"
                          checked={madeForKids === false}
                          onChange={() => {
                            setMadeForKids(false)
                            update()
                          }}
                        />
                        {t('Not made for kids')}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="batch-made-for-kids"
                          checked={madeForKids === true}
                          onChange={() => {
                            setMadeForKids(true)
                            update()
                          }}
                        />
                        {t('Made for kids')}
                      </label>
                    </div>
                  </fieldset>
                </div>

                <div className="space-y-2">
                  <Toggle
                    size="sm"
                    checked={spread}
                    onChange={(v) => {
                      setSpread(v)
                      update()
                    }}
                    label={single ? t('Schedule it') : t('Schedule and space them out')}
                  />
                  {spread && single ? (
                    <p className="text-[11px] text-muted">
                      {t('The video uploads now, then YouTube publishes it about 30 minutes later. Solaris Studio must stay open until the upload finishes.')}
                    </p>
                  ) : spread ? (
                    <>
                      <div className="flex items-center gap-2 text-sm flex-wrap pl-1">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          className="input !py-1 text-sm !w-16"
                          value={perDay}
                          onChange={(event) => {
                            setPerDay(Math.min(100, Math.max(1, Number(event.target.value) || 1)))
                            update()
                          }}
                          aria-label={t('Posts per day')}
                        />
                        <span className="text-muted text-xs">{t('a day,')}</span>
                        <input
                          type="number"
                          min={0.5}
                          max={23.5}
                          step={0.5}
                          className="input !py-1 text-sm !w-16"
                          value={gapHours}
                          onChange={(event) => {
                            setGapHours(Math.min(23.5, Math.max(0.5, Number(event.target.value) || 0.5)))
                            update()
                          }}
                          aria-label={t('Hours between videos')}
                        />
                        <span className="text-muted text-xs">{t('hours apart')}</span>
                      </div>
                      <p className="text-[11px] text-muted">
                        {t('Videos upload now, then YouTube publishes them on this schedule. Solaris Studio must stay open until uploads finish.')}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-warn">
                      {single ? t('This video will be uploaded now.') : t('All selected videos will be uploaded now.')}
                    </p>
                  )}
                  {scheduleInvalid && (
                    <p className="text-xs text-error">
                      {t('That many videos at this interval will not fit in one day.')}
                    </p>
                  )}
                </div>

                <div className="lib-warn-box">
                  {t('Google may lock uploads to Private until your YouTube API project passes its audit.')}
                </div>
              </>
            )}

            {plan && (
              <div className="lib-about">
                <p className="font-medium text-sm text-ink">
                  {t('Preview')}: {plan.length} {plan.length === 1 ? t('video') : t('videos')}
                </p>
                <ol className="max-h-36 overflow-y-auto space-y-1 lib-plan">
                  {plan.map((item, i) => (
                    <li key={item.clip_id} className="flex justify-between gap-3" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
                      <span className="truncate">{item.title}</span>
                      <span className="text-muted shrink-0 t-mono">{formatTime(item.publish_at)}</span>
                    </li>
                  ))}
                </ol>
                {warnings.map((warning) => (
                  <p key={warning} className="text-warn">{warning}</p>
                ))}
                <p className="text-muted">{t('Uploads cannot be taken back.')}</p>
              </div>
            )}

            {!plan && connected && previewBlocker && (
              <p id="yt-batch-blocker" className="text-xs text-muted">
                {previewBlocker}
              </p>
            )}

            {error && <p className="text-xs text-error">{error}</p>}
          </>
        )}
      </div>
    </Dialog>
  )
}
