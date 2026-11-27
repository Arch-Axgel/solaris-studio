import { useEffect, useId, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { IconButton } from '../ui'

/** How a watched channel's clips go out: how many of each video's clips, how
 *  many a day, how far apart, and when each day's first one goes. */
export interface ScheduleValue {
  /** Best clips of each video to post. 0 posts every clip it makes. */
  max_posts: number
  /** False: post each clip the moment it is made. */
  spread: boolean
  per_day: number
  gap_hours: number
  /** Local "HH:MM", or "" for as soon as the scheduler allows. */
  day_start: string
}

/** "Thu 09:00", for the preview. */
function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The posting schedule, shared by the Add form and each channel's settings so
 *  both offer the same controls. The preview comes from the engine, which uses
 *  the slotting the publish itself will, so it shows the real times. */
export default function WatchSchedule({
  value,
  onChange
}: {
  value: ScheduleValue
  onChange: (next: ScheduleValue) => void
}): JSX.Element {
  const firstPostId = useId()
  const [preview, setPreview] = useState<{ times: string[]; already: number } | string | null>(null)
  const set = (patch: Partial<ScheduleValue>): void => onChange({ ...value, ...patch })

  useEffect(() => {
    if (!value.spread) return
    let live = true
    const timer = setTimeout(() => {
      api
        .automationSlots(value.per_day, value.gap_hours, value.day_start, 3)
        .then((got) => live && setPreview({ times: got.times, already: got.already_scheduled }))
        .catch((e) => live && setPreview(errorText(e)))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [value.spread, value.per_day, value.gap_hours, value.day_start])

  return (
    <div className="space-y-2">
      <div className="ops-fields">
        <label className="ops-field">
          <span className="label block">{t('Clips to post from each video')}</span>
          <select
            className="input"
            value={value.max_posts}
            onChange={(e) => set({ max_posts: Number(e.target.value) })}
          >
            <option value={0}>{t('All of them')}</option>
            {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? t('The best one') : `${t('The best')} ${n}`}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-field">
          <span className="label block">{t('When')}</span>
          <select
            className="input"
            value={value.spread ? 'spread' : 'now'}
            onChange={(e) => set({ spread: e.target.value === 'spread' })}
          >
            <option value="spread">{t('Space them out')}</option>
            <option value="now">{t('Post right away')}</option>
          </select>
        </label>
        {value.spread && (
          <>
            <label className="ops-field">
              <span className="label block">{t('Posts per day')}</span>
              <input
                type="number"
                min={1}
                max={50}
                className="input"
                value={value.per_day}
                onChange={(e) =>
                  set({ per_day: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })
                }
              />
            </label>
            <label className="ops-field">
              <span className="label block">{t('Hours apart')}</span>
              <input
                type="number"
                min={0.25}
                max={24}
                step={0.25}
                className="input"
                value={value.gap_hours}
                onChange={(e) =>
                  set({ gap_hours: Math.max(0.25, Math.min(24, Number(e.target.value) || 1)) })
                }
              />
            </label>
            {/* No time set means "as soon as possible": said in words rather
                than as an empty --:-- picker. */}
            <div className="ops-field">
              <span className="label block" id={firstPostId}>
                {t('First post of the day')}
              </span>
              {value.day_start ? (
                <span className="flex items-center gap-1.5">
                  <input
                    type="time"
                    className="input min-w-0 flex-1"
                    aria-labelledby={firstPostId}
                    value={value.day_start}
                    onChange={(e) => set({ day_start: e.target.value })}
                  />
                  <IconButton
                    size="sm"
                    icon="x"
                    label={t('Start as soon as possible instead')}
                    onClick={() => set({ day_start: '' })}
                  />
                </span>
              ) : (
                <button
                  type="button"
                  className="input ops-time-any"
                  aria-describedby={firstPostId}
                  title={t('Pick a time for the first post')}
                  onClick={() => set({ day_start: '09:00' })}
                >
                  <Icon name="clock" size={14} />
                  <span className="truncate">{t('As soon as possible')}</span>
                </button>
              )}
            </div>

          </>
        )}
      </div>
      {!value.spread ? (
        /* Said plainly, as the Publish dialog does: it is the choice that gets
           accounts limited, not a matter of taste. */
        <p className="text-xs text-warn">
          {value.max_posts === 1
            ? t('The best clip of each video is posted the moment it is made.')
            : t(
                'Every clip goes the moment it is made. Platforms treat a burst of posts as spam, and each account has a daily limit, so posting fewer clips (the best one or two) is safer.'
              )}
        </p>
      ) : (
        <p className="text-xs text-muted">
          {typeof preview === 'string' ? (
            <span className="text-warn">{preview}</span>
          ) : preview && preview.times.length > 0 ? (
            <>
              {t('Next posts:')} {preview.times.map(slotLabel).join(', ')}
              {preview.already > 0 &&
                ` · ${t('after the')} ${preview.already} ${t('already scheduled')}`}
              {' · '}
            </>
          ) : null}
          {t(
            'Posts never go out all at once. WoopSocial allows about 5 YouTube posts a day on its free plan.'
          )}
        </p>
      )}
    </div>
  )
}
