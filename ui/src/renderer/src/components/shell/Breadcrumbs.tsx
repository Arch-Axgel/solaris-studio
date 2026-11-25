import { t } from '../../lib/i18n'
import { navigate, pageMeta, useCrumbs, useRoute } from '../../lib/nav'
import { Icon } from '../icons'

/** The page label, then whatever context the page publishes through
 *  useBreadcrumbs (Clip Editor › video title › clip). */
export default function Breadcrumbs(): JSX.Element {
  const route = useRoute()
  const crumbs = useCrumbs(route.page)
  const meta = pageMeta(route.page)
  const last = crumbs.length
  return (
    <nav className="crumbs" aria-label={t('Breadcrumb')}>
      <ol>
        <li className="crumb crumb-page" data-last={last === 0 ? 'true' : undefined}>
          <Icon name={meta.icon} size={15} className="crumb-icon" />
          {last === 0 ? (
            <span aria-current="page" className="crumb-current" key={route.page}>
              {t(meta.label)}
            </span>
          ) : (
            <button type="button" className="crumb-link" onClick={() => navigate({ page: route.page })}>
              {t(meta.label)}
            </button>
          )}
        </li>
        {crumbs.map((c, i) => {
          const isLast = i === last - 1
          return (
            <li key={`${i}-${c.label}`} className="crumb" data-last={isLast ? 'true' : undefined}>
              <Icon name="chevron-right" size={13} className="crumb-sep" />
              {isLast || !c.onClick ? (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'crumb-current' : 'crumb-plain'} title={c.label}>
                  {c.label}
                </span>
              ) : (
                <button type="button" className="crumb-link" onClick={c.onClick} title={c.label}>
                  {c.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
