import { useEffect, useId, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'
import { t } from '../../lib/i18n'
import { cx } from './position'

/** Shimmering placeholder. `lines` renders a paragraph of bars. */
export function Skeleton({
  w,
  h,
  radius,
  lines,
  className
}: {
  w?: number | string
  h?: number | string
  radius?: number | string
  lines?: number
  className?: string
}): JSX.Element {
  if (lines && lines > 1) {
    return (
      <div className={cx('space-y-2', className)} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: h ?? 12, width: i === lines - 1 ? '62%' : (w ?? '100%'), borderRadius: radius }}
          />
        ))}
      </div>
    )
  }
  return <div className={cx('skeleton', className)} style={{ width: w ?? '100%', height: h ?? 14, borderRadius: radius }} aria-hidden />
}

type Illustration = 'film' | 'radar' | 'calendar' | 'queue' | 'creators' | 'search' | 'sun' | 'storage'

/** Line-art illustrations: gold hairlines that draw themselves on enter. */
function Art({ kind }: { kind: Illustration }): JSX.Element {
  const d = (path: string, i: number, extra?: React.SVGProps<SVGPathElement>): JSX.Element => (
    <path
      key={i}
      d={path}
      pathLength={100}
      className="draw"
      style={{ '--len': 100, '--delay': `${i * 90}ms` } as React.CSSProperties}
      {...extra}
    />
  )
  const paths: Record<Illustration, string[]> = {
    film: [
      'M28 22h64a6 6 0 0 1 6 6v64a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z',
      'M38 22v76M82 22v76',
      'M22 40h16M22 60h16M22 80h16M82 40h16M82 60h16M82 80h16',
      'M53 50v20l15-10-15-10Z'
    ],
    radar: [
      'M60 18a42 42 0 1 1 0 84 42 42 0 0 1 0-84Z',
      'M60 38a22 22 0 1 1 0 44 22 22 0 0 1 0-44Z',
      'M60 60 89 31',
      'M84 72a3 3 0 1 1 0 .1M40 44a2.5 2.5 0 1 1 0 .1'
    ],
    calendar: [
      'M24 30h72a4 4 0 0 1 4 4v58a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V34a4 4 0 0 1 4-4Z',
      'M20 46h80M40 20v18M80 20v18',
      'M36 60h10M55 60h10M74 60h10M36 76h10M55 76h10',
      'M74 72l5 5 9-10'
    ],
    queue: [
      'M60 18 100 38 60 58 20 38 60 18Z',
      'M20 56 60 76 100 56',
      'M20 74 60 94 100 74',
      'M92 18v12M86 24h12'
    ],
    creators: [
      'M46 52a14 14 0 1 0 0-28 14 14 0 0 0 0 28Z',
      'M20 94a26 26 0 0 1 52 0',
      'M78 30a12 12 0 0 1 0 22M86 64a22 22 0 0 1 14 22',
      'M94 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z'
    ],
    search: [
      'M54 24a28 28 0 1 1 0 56 28 28 0 0 1 0-56Z',
      'M74 74 96 96',
      'M42 52h24M54 40v24',
      'M88 22l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z'
    ],
    sun: [
      'M60 40a20 20 0 1 1 0 40 20 20 0 0 1 0-40Z',
      'M60 14v10M60 96v10M14 60h10M96 60h10',
      'M27 27l7 7M86 86l7 7M27 93l7-7M86 34l7-7',
      'M16 104h88'
    ],
    storage: [
      'M24 64h72',
      'M32 34 24 64v22a6 6 0 0 0 6 6h60a6 6 0 0 0 6-6V64l-8-30a6 6 0 0 0-6-4H38a6 6 0 0 0-6 4Z',
      'M36 78h.5M48 78h.5',
      'M70 78h16'
    ]
  }
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      stroke="url(#solaris-gold)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="ui-empty-art"
    >
      <circle cx="60" cy="60" r="56" stroke="rgb(216 178 99 / .08)" strokeWidth="1" />
      {paths[kind].map((p, i) => d(p, i))}
    </svg>
  )
}

/** Empty state with an illustration, a line of copy and one action. */
export function EmptyState({
  illustration = 'film',
  title,
  body,
  action,
  compact,
  className
}: {
  illustration?: Illustration
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  compact?: boolean
  className?: string
}): JSX.Element {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty-compact', className)}>
      <div className="ui-empty-halo">
        <Art kind={illustration} />
      </div>
      <h3 className={cx('text-ink', compact ? 't-md' : 't-lg')}>{title}</h3>
      {body && <div className="text-sm text-muted max-w-md leading-relaxed">{body}</div>}
      {action && <div className="mt-2 flex flex-wrap gap-2 justify-center">{action}</div>}
    </div>
  )
}

const CALLOUT_ICON: Record<string, IconName> = {
  info: 'info',
  gold: 'sparkle',
  warn: 'alert',
  error: 'alert',
  success: 'check'
}

/** An inline message box with an optional dismiss. */
export function Callout({
  tone = 'info',
  title,
  icon,
  onDismiss,
  children,
  className
}: {
  tone?: 'info' | 'gold' | 'warn' | 'error' | 'success'
  title?: string
  icon?: IconName
  onDismiss?: () => void
  children: React.ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={cx('ui-callout', `ui-callout-${tone}`, className)} role={tone === 'error' ? 'alert' : undefined}>
      <span className="ui-callout-icon" aria-hidden>
        <Icon name={icon ?? CALLOUT_ICON[tone]} size={18} />
      </span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title && <p className="font-semibold text-ink mb-0.5">{title}</p>}
        <div className="text-muted">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" className="btn-icon ui-icon-sm shrink-0 -mr-1 -mt-1" aria-label={t('Dismiss')} onClick={onDismiss}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}

/** Show/hide with the grid-rows collapse (no height measuring). Controlled
 *  (open/onOpenChange) or uncontrolled (defaultOpen). */
export function Disclosure({
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  id,
  children,
  className
}: {
  summary: React.ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (o: boolean) => void
  id?: string
  children: React.ReactNode
  className?: string
}): JSX.Element {
  const auto = useId()
  const panelId = id ?? `disc-${auto}`
  const [inner, setInner] = useState(defaultOpen)
  const isOpen = open ?? inner
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // React 18 doesn't know `inert`: keep a closed panel out of the tab order.
    if (panel.current) (panel.current as HTMLElement & { inert: boolean }).inert = !isOpen
  }, [isOpen])
  const toggle = (): void => {
    const next = !isOpen
    if (open === undefined) setInner(next)
    onOpenChange?.(next)
  }
  return (
    <div className={cx('ui-disclosure', className)} data-open={isOpen ? 'true' : 'false'}>
      <button type="button" className="ui-disclosure-btn" aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <Icon name="chevron-right" size={16} className="ui-disclosure-chev" />
        <span className="min-w-0 flex-1 text-left">{summary}</span>
      </button>
      <div className="collapse" data-open={isOpen ? 'true' : 'false'}>
        <div ref={panel} id={panelId} role="region" aria-hidden={!isOpen}>
          <div className="ui-disclosure-panel">{children}</div>
        </div>
      </div>
    </div>
  )
}
