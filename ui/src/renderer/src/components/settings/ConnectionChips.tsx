import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { motionReduced } from '../../lib/motion'
import { Icon, type IconName } from '../icons'

type State = 'loading' | 'connected' | 'on' | 'off'

interface Chip {
  id: 'youtube' | 'woopsocial' | 'uploadpost'
  label: string
  icon: IconName
  state: State
}

/** One row saying which publishing accounts are ready (spec 4.12), from
 *  the three status calls. Each chip jumps to its card. */
export default function ConnectionChips({ active }: { active: boolean }): JSX.Element {
  const [chips, setChips] = useState<Chip[]>([
    { id: 'youtube', label: 'YouTube', icon: 'youtube', state: 'loading' },
    { id: 'woopsocial', label: 'WoopSocial', icon: 'send', state: 'loading' },
    { id: 'uploadpost', label: 'Upload-Post', icon: 'upload', state: 'loading' }
  ])

  const load = useCallback(() => {
    void Promise.all([
      api.youtubeStatus().catch(() => null),
      api.woopSocialStatus().catch(() => null),
      api.uploadPostStatus().catch(() => null)
    ]).then(([yt, woop, up]) => {
      const pick = (enabled?: boolean, ready?: boolean): State => (enabled ? (ready ? 'connected' : 'on') : 'off')
      setChips((c) =>
        c.map((chip) =>
          chip.id === 'youtube'
            ? { ...chip, state: pick(yt?.enabled, yt?.connected) }
            : chip.id === 'woopsocial'
              ? { ...chip, state: pick(woop?.enabled, woop?.has_key) }
              : { ...chip, state: pick(up?.enabled, up?.has_key) }
        )
      )
    })
  }, [])

  useEffect(() => {
    if (!active) return
    load()
    const again = (): void => load()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [active, load])

  const jump = (id: string): void => {
    const el = document.getElementById(`settings-card-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
    el.classList.remove('anim-flash')
    void el.offsetWidth
    el.classList.add('anim-flash')
    setTimeout(load, 400)
  }

  const word = (s: State): string =>
    s === 'loading' ? t('Checking…') : s === 'connected' ? t('Connected') : s === 'on' ? t('Needs a key or sign-in') : t('Not set up')

  return (
    <div className="sys-conn stagger" role="list" aria-label={t('Publishing accounts')}>
      {chips.map((c) => (
        <button key={c.id} type="button" role="listitem" className="sys-conn-chip press" data-state={c.state} onClick={() => jump(c.id)}>
          <span className="sys-conn-icon" aria-hidden>
            <Icon name={c.icon} size={16} />
          </span>
          <span className="min-w-0 text-left">
            <span className="block text-sm text-ink font-medium">{c.label}</span>
            <span className="sys-conn-state">
              <Icon name={c.state === 'connected' ? 'check' : c.state === 'loading' ? 'clock' : c.state === 'on' ? 'alert' : 'x'} size={11} />
              {word(c.state)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
