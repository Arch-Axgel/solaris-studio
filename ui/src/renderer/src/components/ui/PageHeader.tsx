import { Icon, type IconName } from '../icons'
import { usePageActive } from '../../lib/stores/useVisible'

/** Page title block: gold eyebrow, display title, a foil rule that draws in,
 *  then an optional subtitle. The active page's <h1> carries the shared
 *  `page-title` view-transition name (pass vtName="page-title"). */
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
  icon?: IconName
  vtName?: string
  className?: string
}): JSX.Element {
  const active = usePageActive()
  return (
    <header className={`ui-page-header ${className ?? ''}`}>
      <div className="flex items-start gap-4 min-w-0">
        {icon && (
          <span className="ui-page-icon" aria-hidden>
            <Icon name={icon} size={22} />
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
