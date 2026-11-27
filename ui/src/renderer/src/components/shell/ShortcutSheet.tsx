import { useEffect, useMemo, useState } from 'react'
import { SHORTCUTS } from '../../lib/hotkeys'
import { t } from '../../lib/i18n'
import { useLayer } from '../../lib/nav'
import { Icon, type IconName } from '../icons'
import { Dialog, Kbd } from '../ui'

/** Every keyboard shortcut (spec 4.17), from SHORTCUTS in lib/hotkeys.ts. */

const GROUPS: { id: (typeof SHORTCUTS)[number]['group']; label: string; icon: IconName; note?: string }[] = [
  { id: 'Global', label: 'Anywhere', icon: 'zap' },
  { id: 'Navigation', label: 'Getting around', icon: 'arrow-right' },
  { id: 'Pages', label: 'Jump to a page', icon: 'grid', note: 'Press G, let go, then the letter.' }
]

export default function ShortcutSheet(): JSX.Element | null {
  const { open, close } = useLayer('shortcuts')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (open) setFilter('')
  }, [open])

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return SHORTCUTS.filter((s) => !f || t(s.label).toLowerCase().includes(f) || s.keys.join(' ').toLowerCase().includes(f))
  }, [filter])

  return (
    <Dialog open={open} onClose={close} title={t('Keyboard shortcuts')} description={t('Work without the mouse.')} size="lg" className="lyr-keys" initialFocus=".lyr-keys-search input">
      <div className="lyr-keys-search">
        <Icon name="search" size={15} />
        <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Find a shortcut…')} aria-label={t('Find a shortcut')} />
      </div>
      <div className="lyr-keys-grid">
        {GROUPS.map((g) => {
          const rows = list.filter((s) => s.group === g.id)
          if (rows.length === 0) return null
          return (
            <section key={g.id} className="lyr-keys-group" data-group={g.id}>
              <h3 className="lyr-keys-h">
                <Icon name={g.icon} size={14} /> {t(g.label)}
              </h3>
              {g.note && <p className="text-xs text-muted -mt-1 mb-2">{t(g.note)}</p>}
              <ul className="stagger">
                {rows.map((s, i) => (
                  <li key={s.label} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
                    <span>{t(s.label)}</span>
                    <Kbd keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        {list.length === 0 && <p className="text-sm text-muted">{t('No shortcut matches that.')}</p>}
      </div>
      <p className="lyr-keys-foot text-xs text-muted">
        <Icon name="info" size={13} /> {t('Shortcuts pause while you type in a box, and while the full editor is open, except Ctrl+K and Esc.')}
      </p>
    </Dialog>
  )
}
