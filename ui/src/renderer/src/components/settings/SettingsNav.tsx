import { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import type { SettingsSection } from '../../lib/nav'
import { Icon, type IconName } from '../icons'
import { SearchInput } from '../ui'

export interface NavSection {
  id: SettingsSection
  label: string
  icon: IconName
  /** Cards in it that match the filter (undefined = no filter). */
  matches?: number
}

/** The sticky left column of Settings: a filter box and the section list,
 *  with a gold indicator that slides to the section in view. */
export default function SettingsNav({
  sections,
  current,
  query,
  onQuery,
  onPick
}: {
  sections: NavSection[]
  current: SettingsSection
  query: string
  onQuery: (q: string) => void
  onPick: (id: SettingsSection) => void
}): JSX.Element {
  const list = useRef<HTMLUListElement>(null)
  const [bar, setBar] = useState<{ y: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-nav="${current}"]`)
    if (!el || el.offsetParent === null) {
      setBar(null)
      return
    }
    setBar({ y: el.offsetTop, h: el.offsetHeight })
  }, [current, sections, query])

  return (
    <nav className="sys-snav" aria-label={t('Settings sections')}>
      <SearchInput value={query} onChange={onQuery} placeholder={t('Find a setting')} hotkey ariaLabel={t('Find a setting')} />
      <ul ref={list} className="sys-snav-list">
        {bar && <span className="sys-snav-bar" style={{ transform: `translateY(${bar.y}px)`, height: bar.h }} aria-hidden />}
        {sections.map((s) => {
          const dim = s.matches === 0
          return (
            <li key={s.id} hidden={dim}>
              <button
                type="button"
                data-nav={s.id}
                className="sys-snav-item"
                aria-current={current === s.id ? 'true' : undefined}
                onClick={() => onPick(s.id)}
              >
                <Icon name={s.icon} size={16} />
                <span className="flex-1 truncate text-left">{s.label}</span>
                {s.matches !== undefined && s.matches > 0 && <span className="sys-snav-count tabular">{s.matches}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
