import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../../lib/api'
import type { JobOptions, WatchPlatform } from '../../lib/types'
import { useWoopAccounts } from './WatchPublishSettings'
import WatchSchedule, { type ScheduleValue } from './WatchSchedule'
import { seedOptions } from '../queue/AddVideos'
import { platformLabel, WOOPSOCIAL_PLATFORMS } from '../../lib/uploadpost'
import { t } from '../../lib/i18n'
import SportFields from '../SportFields'
import { fitSport, sportForVertical, startingSport, useSports, verticalSports, verticalValue } from '../../lib/sports'
import { openSettings } from '../../lib/nav'
import { Icon, type IconName } from '../icons'
import { Button, Callout, Field, Sheet, StepProgress, Toggle } from '../ui'

type AddMode = 'auto' | 'ask' | 'off'

const ADD_MODES: { id: AddMode; label: string; icon: IconName; blurb: string }[] = [
  {
    id: 'auto',
    label: 'Clip and publish automatically (hands-off)',
    icon: 'zap',
    blurb: 'New videos are clipped and posted on your schedule, with nobody at the PC.'
  },
  {
    id: 'ask',
    label: 'Clip, then ask me before publishing',
    icon: 'bell',
    blurb: 'Clips are made for you to look over. Nothing is posted until you say so.'
  },
  { id: 'off', label: 'Only clip', icon: 'scissors', blurb: 'Clips land in the Clip Editor. Publishing stays off.' }
]

const PLATFORMS: { id: WatchPlatform; label: string; icon: IconName }[] = [
  { id: 'youtube', label: 'YouTube', icon: 'youtube' },
  { id: 'twitch', label: 'Twitch', icon: 'twitch' },
  { id: 'kick', label: 'Kick', icon: 'kick' }
]

const PLACEHOLDER: Record<WatchPlatform, string> = {
  youtube: 'https://www.youtube.com/@channel or @handle',
  twitch: 'https://www.twitch.tv/channel or channel name',
  kick: 'https://kick.com/channel or channel name'
}

/** "+ Watch a channel": the add form as a stepped sheet. Same state, same
 *  fields and the same api.addWatch call the page's form always made; only
 *  the layout changed. The settings stay as they were after an add (only the
 *  channel is cleared), so adding several similar channels is quick. */
export default function AddChannelSheet({
  open,
  onClose,
  onAdded
}: {
  open: boolean
  onClose: () => void
  onAdded: (watchId: number) => void
}): JSX.Element {
  const [step, setStep] = useState(0)
  const [platform, setPlatform] = useState<WatchPlatform>('youtube')
  const [channel, setChannel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const woop = useWoopAccounts()
  const [addMode, setAddMode] = useState<AddMode | null>(null)
  const [addPlatforms, setAddPlatforms] = useState<string[] | null>(null)
  // How its clips go out, chosen before Add like in the Publish dialog.
  const [addSchedule, setAddSchedule] = useState<ScheduleValue>({
    max_posts: 0,
    spread: true,
    per_day: 5,
    gap_hours: 1,
    day_start: ''
  })
  // How its clips are made: the Generate bar's own settings to start with,
  // which is what "my settings" means everywhere else in the app.
  const [addClip, setAddClip] = useState<JobOptions>(() => seedOptions())
  // The sports the engine offers; the Sports switch shows only when it has one.
  const sports = useSports()
  const offeredSports = sports ?? []
  // A remembered sport the engine no longer offers is fixed or dropped here,
  // not sent and refused.
  useEffect(() => {
    if (!sports) return
    setAddClip((prev) => {
      if (!prev.sport) return prev
      const fit = fitSport(prev.sport, sports)
      if (JSON.stringify(fit) === JSON.stringify(prev.sport)) return prev
      const next = { ...prev }
      if (fit) next.sport = fit
      else delete next.sport
      return next
    })
  }, [sports])
  const [addHashtags, setAddHashtags] = useState('')
  const [addOnlyMine, setAddOnlyMine] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  // Until touched, the add form follows what WoopSocial can do: hands-off with
  // every connected account when it is set up, asking first when it is not.
  const mode: AddMode = addMode ?? (woop?.ready ? 'auto' : 'ask')
  const connected = WOOPSOCIAL_PLATFORMS.filter((id) => woop?.connected.includes(id))
  const platforms = addPlatforms ?? connected

  const steps = [t('Channel'), t('When it posts'), t('Clips'), ...(mode !== 'off' ? [t('Schedule')] : [])]
  const last = steps.length - 1
  const current = Math.min(step, last)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setError(null)
    const id = setTimeout(() => urlRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [open])

  const add = async (): Promise<void> => {
    if (!channel.trim()) {
      setStep(0)
      return
    }
    setAdding(true)
    setError(null)
    try {
      const added = await api.addWatch(platform, channel.trim(), {
        mode,
        platforms,
        ...addSchedule,
        hashtags: addHashtags
          .split(/[\s,]+/)
          .map((h) => h.replace(/^#/, '').trim())
          .filter(Boolean),
        ai_hashtags: !addOnlyMine
      }, addClip)
      setChannel('')
      onAdded(added.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setAdding(false)
    }
  }

  const next = (): void => {
    if (current === 0 && !channel.trim()) {
      urlRef.current?.focus()
      return
    }
    if (current < last) setStep(current + 1)
    else void add()
  }

  const setClip = (key: string, checked: boolean): void => {
    const next = { ...addClip }
    if (key === 'captions') next.captions = checked
    else if (key === 'longform') next.longform = checked ? { mode: 'short_clips' } : null
    else if (key === 'sport') {
      const start = checked ? (next.sport ?? startingSport(offeredSports)) : null
      if (start) {
        next.sport = start
        // Scored as a match, not as a podcast or a game stream.
        delete next.podcast
        delete next.gaming
        delete next.gaming_scoring
      } else delete next.sport
      setAddClip(next)
      return
    } else (next as Record<string, unknown>)[key] = checked
    // Vertical Live keeps the live's own layout and Gaming splits webcam from
    // game, so neither goes with the other, Podcast (reframes) or Longform (16:9).
    if (checked && (key === 'vertical_live' || key === 'gaming')) {
      delete next.podcast
      next.longform = null
      delete next[key === 'gaming' ? 'vertical_live' : 'gaming']
    } else if (checked && (key === 'podcast' || key === 'longform')) {
      delete next.vertical_live
      delete next.gaming
    }
    if (checked && (key === 'podcast' || key === 'gaming')) delete next.sport
    setAddClip(next)
  }

  const clipSwitches: [string, string, boolean, IconName][] = [
    ['captions', 'Captions', addClip.captions !== false, 'note'],
    ['long_clips', '60s+', Boolean(addClip.long_clips), 'clock'],
    ['longform', 'Longform', Boolean(addClip.longform), 'maximize'],
    ['vertical_live', 'Vertical Live', Boolean(addClip.vertical_live), 'live'],
    ['podcast', 'Podcast', Boolean(addClip.podcast), 'chat'],
    ['gaming', 'Gaming / Reaction', Boolean(addClip.gaming), 'zap'],
    ...(offeredSports.length > 0 || addClip.sport
      ? ([['sport', 'Sports', Boolean(addClip.sport), 'trend-up']] as [string, string, boolean, IconName][])
      : [])
  ]

  const connectButton = (
    <Button size="sm" variant="subtle" icon="link" onClick={() => openSettings('publishing')}>
      {t('Connect a posting account')}
    </Button>
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Watch a channel')}
      width="560px"
      footer={
        <div className="flex items-center gap-2 w-full">
          {current > 0 ? (
            <Button variant="ghost" icon="arrow-left" onClick={() => setStep(current - 1)} disabled={adding}>
              {t('Back')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
          )}
          {current > 0 && current < last && (
            <Button variant="subtle" className="ml-auto" disabled={adding || !channel.trim()} onClick={() => void add()}>
              {t('Add now')}
            </Button>
          )}
          <Button
            variant={current === last ? 'gold' : 'accent'}
            className={current > 0 && current < last ? '' : 'ml-auto'}
            iconRight={current === last ? undefined : 'arrow-right'}
            icon={current === last ? 'radar' : undefined}
            loading={adding}
            disabled={current === 0 && !channel.trim()}
            onClick={next}
          >
            {current === last ? (adding ? t('Finding the channel…') : t('Add')) : t('Next')}
          </Button>
        </div>
      }
    >
      <div className="ops-addsheet space-y-5">
        <StepProgress steps={steps} current={current} />

        <div key={current} className="anim-rise space-y-4">
          {current === 0 && (
            <>
              <div className="ops-choice-row" role="radiogroup" aria-label={t('Platform')}>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={platform === p.id}
                    className="ops-choice ops-choice-sm"
                    data-platform={p.id}
                    onClick={() => setPlatform(p.id)}
                  >
                    <Icon name={p.icon} size={22} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              <Field label={t('Channel')} htmlFor="add-watch-channel">
                <input
                  id="add-watch-channel"
                  ref={urlRef}
                  className="input"
                  value={channel}
                  placeholder={PLACEHOLDER[platform]}
                  onChange={(e) => setChannel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') next()
                  }}
                  aria-label={t('Channel')}
                />
              </Field>
              {platform === 'kick' && (
                <Callout tone="warn">
                  {t(
                    'Kick has no official way to list a channel’s videos. Solaris Studio uses the same unofficial one its Kick downloads rely on, so it can stop working without notice.'
                  )}
                </Callout>
              )}
              <p className="text-xs text-muted">
                {t('Videos already on the channel are listed but not clipped. Only what it posts from now on is, unless you pick one yourself.')}
              </p>
            </>
          )}

          {current === 1 && (
            <>
              <div className="space-y-2" role="radiogroup" aria-label={t('When it posts')}>
                {ADD_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    className="ops-choice"
                    onClick={() => setAddMode(m.id)}
                  >
                    <span className="ops-choice-icon">
                      <Icon name={m.icon} size={18} />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block font-medium text-ink">{t(m.label)}</span>
                      <span className="block text-xs text-muted mt-0.5">{t(m.blurb)}</span>
                    </span>
                    <span className="ops-choice-check" aria-hidden>
                      <Icon name="check" size={14} />
                    </span>
                  </button>
                ))}
              </div>
              {mode !== 'off' && woop && !woop.ready && (
                <Callout tone="warn" title={t('Connect a posting account')}>
                  <p>{t('Publishing goes through WoopSocial. Add your WoopSocial API key in Settings first.')}</p>
                  <div className="mt-2">{connectButton}</div>
                </Callout>
              )}
              {mode !== 'off' && woop?.ready && (
                <div className="space-y-2">
                  <p className="label">{t('Publish to')}</p>
                  {connected.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted">
                        {t('No accounts are connected to WoopSocial yet. Connect them in Settings.')}
                      </p>
                      {connectButton}
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {connected.map((id) => {
                        const on = platforms.includes(id)
                        return (
                          <button
                            key={id}
                            type="button"
                            className="ops-pill"
                            aria-pressed={on}
                            onClick={() =>
                              setAddPlatforms(on ? platforms.filter((x) => x !== id) : [...platforms, id])
                            }
                          >
                            {on && <Icon name="check" size={12} />}
                            {platformLabel(id)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {current === 2 && (
            <>
              <div className="flex gap-2 flex-wrap" aria-label={t('Clips')} role="group">
                {clipSwitches.map(([key, label, on, icon]) => (
                  <button
                    key={key}
                    type="button"
                    className="ops-pill"
                    aria-pressed={on}
                    title={
                      key === 'vertical_live'
                        ? t('This channel streams vertically: keep each live’s own 9:16 layout, no face tracking. Videos with no vertical version are skipped.')
                        : key === 'gaming'
                          ? t('Game streams or reactions: the streamer’s webcam in the top half, the game or the video they’re reacting to in the bottom half.')
                          : key === 'sport'
                            ? t('Matches: goals, saves, cards and big chances from the crowd, the commentary and the scoreboard, and a 9:16 crop that follows the ball.')
                            : undefined
                    }
                    onClick={() => setClip(key, !on)}
                  >
                    <Icon name={on ? 'check' : icon} size={12} />
                    {t(label)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {t('Starts from your Generate settings. Caption style and more are in Clip settings after you add it.')}
              </p>
              {addClip.sport && offeredSports.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap ops-subfields">
                  <SportFields
                    value={addClip.sport}
                    sports={offeredSports}
                    onChange={(sport) => setAddClip({ ...addClip, sport })}
                  />
                </div>
              )}
              {addClip.vertical_live && (
                <div className="flex items-center gap-3 flex-wrap ops-subfields">
                  <span className="label shrink-0">{t('Vertical Live content')}</span>
                  <select
                    className="input !w-72"
                    value={verticalValue(addClip.sport) ?? (addClip.gaming_scoring ? 'gaming' : 'standard')}
                    onChange={(e) => {
                      const next = { ...addClip }
                      if (e.target.value.startsWith('sport:')) {
                        // A sport is the Sports switch's match scoring, for a match streamed 9:16.
                        const start = sportForVertical(e.target.value, next.sport, offeredSports)
                        if (start) next.sport = start
                        delete next.podcast
                        delete next.gaming
                        delete next.gaming_scoring
                      } else {
                        delete next.sport
                        if (e.target.value === 'gaming') next.gaming_scoring = true
                        else delete next.gaming_scoring
                      }
                      setAddClip(next)
                    }}
                    aria-label={t('Vertical Live content')}
                    title={t('Gaming / reaction: what you say counts as on any stream, and in-game moments (a kill streak, a boss going down, a goal) and the reactions to them add to it, from chat and your voice, even when you say little. Game characters and people in a video you watch aren’t taken for you.')}
                  >
                    <option value="standard">{t('Talking / IRL')}</option>
                    <option value="gaming">{t('Gaming / reaction')}</option>
                    {verticalSports(offeredSports).map((s) => (
                      <option key={s.value} value={s.value}>
                        {t(s.label)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {current === 3 && mode !== 'off' && (
            <>
              <WatchSchedule value={addSchedule} onChange={setAddSchedule} />
              <Field label={t('Hashtags on every post')} htmlFor="add-watch-tags">
                <input
                  id="add-watch-tags"
                  className="input"
                  value={addHashtags}
                  placeholder="#creatorname #twitch"
                  onChange={(e) => setAddHashtags(e.target.value)}
                />
              </Field>
              <Toggle
                size="sm"
                checked={addOnlyMine}
                onChange={setAddOnlyMine}
                label={t('Only use my hashtags')}
                description={t('(leave out the ones the AI picks)')}
              />
            </>
          )}

          {current === last && (
            <Callout tone="gold" icon="radar">
              {mode === 'auto'
                ? t(
                    'From now on, each new video is queued, clipped and published on the schedule above, with nobody at the PC. Videos already on the channel are listed but not clipped. Per-platform settings and caption text open after you add it.'
                  )
                : t(
                    'Videos already on the channel are listed but not clipped. Only what it posts from now on is, unless you pick one yourself.'
                  )}
            </Callout>
          )}

          {error && (
            <Callout tone="error" onDismiss={() => setError(null)}>
              {error}
            </Callout>
          )}
        </div>
      </div>
    </Sheet>
  )
}
