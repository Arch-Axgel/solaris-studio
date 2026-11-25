import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { back, forward, openLayer, toggleLayer, useNavState, useOpenLayers, useRoute } from '../../lib/nav'
import { useActivity } from '../../lib/stores/activity'
import { Icon } from '../icons'
import { IconButton, Kbd } from '../ui'
import Breadcrumbs from './Breadcrumbs'
import JobsPill from './JobsPill'

/** The top bar (spec 3.6): history, breadcrumbs, the command search, the
 *  jobs pill, activity, help and the assistant. Turns solid once the page
 *  under it scrolls. */
export default function TopBar(): JSX.Element {
  const { canBack, canForward } = useNavState()
  const { unread } = useActivity()
  const route = useRoute()
  const layers = useOpenLayers()
  const ref = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)

  // The page scrolls inside its own keep-alive section, not the window.
  useEffect(() => {
    const content = ref.current?.parentElement?.querySelector('.shell-content')
    if (!content) return
    let frame = 0
    const check = (): void => {
      frame = 0
      const active = content.querySelector<HTMLElement>('.keep-page.page-active')
      setScrolled(Boolean(active && active.scrollTop > 6))
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    content.addEventListener('scroll', onScroll, true)
    check()
    return () => {
      content.removeEventListener('scroll', onScroll, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [route.page])

  return (
    <header ref={ref} className="topbar" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="topbar-left">
        <IconButton label={`${t('Back')} (Alt+←)`} icon="arrow-left" size="sm" disabled={!canBack} onClick={back} />
        <IconButton label={`${t('Forward')} (Alt+→)`} icon="arrow-right" size="sm" disabled={!canForward} onClick={forward} />
        <Breadcrumbs />
      </div>

      <button
        type="button"
        className="topbar-search"
        data-tour="palette"
        onClick={() => openLayer('palette')}
        aria-label={t('Search or run a command…')}
        aria-keyshortcuts="Control+K"
      >
        <Icon name="search" size={16} />
        <span className="topbar-search-text">{t('Search or run a command…')}</span>
        <Kbd keys={['Ctrl', 'K']} className="topbar-search-kbd" />
      </button>

      <div className="topbar-right">
        <JobsPill />
        <IconButton
          label={`${t('Activity')} (Ctrl+Shift+A)`}
          icon="bell"
          badge={unread > 0 ? unread : null}
          active={layers.includes('activity')}
          onClick={() => toggleLayer('activity')}
          data-tour="activity"
        />
        <IconButton
          label={`${t('Help')} (F1)`}
          icon="help"
          active={layers.includes('help')}
          onClick={() => toggleLayer('help', { page: route.page })}
        />
        <IconButton
          label={`${t('Ask Solaris Studio')} (Ctrl+J)`}
          icon="sparkle"
          active={layers.includes('assistant')}
          onClick={() => toggleLayer('assistant')}
          className="topbar-assistant"
        />
      </div>
    </header>
  )
}
