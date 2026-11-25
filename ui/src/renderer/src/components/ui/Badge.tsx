import { Icon, type IconName } from '../icons'
import { t } from '../../lib/i18n'
import { cx } from './position'

export type Tone = 'accent' | 'gold' | 'muted' | 'success' | 'warn' | 'error' | 'live'

export function Badge({
  tone = 'muted',
  icon,
  size = 'sm',
  children,
  title,
  className
}: {
  tone?: Tone
  icon?: IconName
  size?: 'xs' | 'sm'
  children: React.ReactNode
  title?: string
  className?: string
}): JSX.Element {
  return (
    <span className={cx('ui-badge', `ui-badge-${tone}`, `ui-badge-${size}`, className)} title={title}>
      {tone === 'live' && <span className="ui-live-dot" aria-hidden />}
      {icon && <Icon name={icon} size={size === 'xs' ? 11 : 13} />}
      {children}
    </span>
  )
}

type Status = 'running' | 'queued' | 'done' | 'failed' | 'paused' | 'stopping' | 'live' | 'idle' | 'scheduled' | 'posted'

const STATUS: Record<Status, { tone: Tone; icon: IconName; label: string }> = {
  running: { tone: 'gold', icon: 'play', label: 'Running' },
  queued: { tone: 'muted', icon: 'clock', label: 'Waiting' },
  done: { tone: 'success', icon: 'check', label: 'Done' },
  failed: { tone: 'error', icon: 'alert', label: 'Failed' },
  paused: { tone: 'warn', icon: 'pause', label: 'Paused' },
  stopping: { tone: 'warn', icon: 'stop', label: 'Stopping' },
  live: { tone: 'live', icon: 'live', label: 'Live' },
  idle: { tone: 'muted', icon: 'sun', label: 'Idle' },
  scheduled: { tone: 'accent', icon: 'calendar', label: 'Scheduled' },
  posted: { tone: 'success', icon: 'send', label: 'Posted' }
}

/** A status as an icon plus a word: never colour alone. */
export function StatusChip({ status, label, className }: { status: Status; label?: string; className?: string }): JSX.Element {
  const s = STATUS[status]
  return (
    <span className={cx('ui-badge ui-badge-sm ui-status', `ui-badge-${s.tone}`, className)} data-status={status}>
      {status === 'live' ? (
        <span className="ui-live-dot" aria-hidden />
      ) : status === 'running' ? (
        <span className="ui-status-pulse" aria-hidden />
      ) : (
        <Icon name={s.icon} size={12} />
      )}
      {label ?? t(s.label)}
    </span>
  )
}
