import { Icon, type IconName } from '../icons'
import { PAGES } from '../../lib/nav'
import { usePageActive, usePageId } from '../../lib/stores/useVisible'

/** Page title block: an icon tile, gold eyebrow, display title, a foil rule
 *  that draws in, then an optional subtitle. The active page's <h1> carries
 *  the shared `page-title` view-transition name (pass vtName="page-title").
 *
 *  A page's own header (vtName="page-title") gets its rail icon when it names
 *  none, so the title sits at the same x on every page. The Clip Editor is the
 *  exception: its header names the open video in a narrow centre column.
 *  Pass icon={false} to leave the tile out. Actions line up with the title,
 *  not the subtitle (shell.css .ui-page-actions). */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  icon,
  vtName,
  className
}: {
  eyebrow?: string
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  icon?: IconName | false
  vtName?: string
  className?: string
}): JSX.Element {
  const active = usePageActive()
  const page = usePageId()
  const tile =
    icon === false
      ? null
      : (icon ?? (vtName === 'page-title' && page !== 'studio' ? PAGES.find((p) => p.id === page)?.icon : undefined))
  return (
    <header className={`ui-page-header ${className ?? ''}`}>
      <div className="flex items-start gap-4 min-w-0">
        {tile && (
          <span className="ui-page-icon" aria-hidden>
            <Icon name={tile} size={22} />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="t-micro ui-page-eyebrow">{eyebrow}</p>}
          <h1 className="t-xl text-ink" style={vtName && active ? { viewTransitionName: vtName } : undefined}>
            {title}
          </h1>
          <div className="gold-rule ui-rule-in mt-2.5" />
          {subtitle && <p className="mt-2.5 text-sm text-muted max-w-2xl leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}

/** A section title inside a page, with an optional count and actions. */
export function SectionHeader({
  title,
  hint,
  count,
  actions,
  id,
  className
}: {
  title: string
  hint?: React.ReactNode
  count?: number
  actions?: React.ReactNode
  id?: string
  className?: string
}): JSX.Element {
  return (
    <div className={`ui-section-header ${className ?? ''}`}>
      <div className="min-w-0">
        <h2 id={id} className="t-lg text-ink flex items-center gap-2">
          {title}
          {typeof count === 'number' && <span className="ui-count tabular">{count}</span>}
        </h2>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
