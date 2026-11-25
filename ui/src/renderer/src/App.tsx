import { useCallback, useEffect, useMemo, useState } from 'react'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import ClipStudio from './pages/ClipStudio'
import Creators from './pages/Creators'
import Marketplace from './pages/Marketplace'
import Models from './pages/Models'
import Queue from './pages/Queue'
import Settings from './pages/Settings'
import Watch from './pages/Watch'
import Calendar from './pages/Calendar'
import Storage from './pages/Storage'
import SetupWizard, { setupDone } from './components/SetupWizard'
import YouTubeConnect from './components/YouTubeConnect'
import Shell from './components/shell/Shell'
import KeepAlive from './components/shell/KeepAlive'
import { ConfirmProvider, ToastProvider } from './components/ui'
import { activeLocale } from './lib/i18n'
import { installNavEvents, navigate, useRoute, type Page } from './lib/nav'
import { checkOnlineListAtStart } from './lib/plugins'

/** What the Clip Editor should open: a video, optionally a clip in it.
 *  Derived from the route (`#/studio?video=…&clip=…`). */
export interface StudioTarget {
  videoId: string
  clipId?: number
}

export default function App(): JSX.Element {
  const route = useRoute()

  // Every window-event door (open-queue, open-settings, open-models,
  // open-marketplace, open-create, open-assistant, open-palette, …) and the
  // mouse back/forward buttons live in lib/nav.ts.
  useEffect(() => installNavEvents(), [])

  // First run: walk the creator through what the installer can't bundle
  // (Ollama, a model) before they hit a video that fails for want of it.
  // Settings can re-open it, so this is not a one-shot.
  const [wizard, setWizard] = useState(!setupDone())
  useEffect(() => {
    const open = (): void => setWizard(true)
    window.addEventListener('open-setup-wizard', open)
    return () => window.removeEventListener('open-setup-wizard', open)
  }, [])

  // Installed pipelines hear about a blocked version without the Marketplace being opened.
  useEffect(() => checkOnlineListAtStart(), [])

  // Language switches re-render the content IN PLACE (no reload): route state
  // lives above the keyed content, so the user stays wherever they were.
  const [locale, setLocale] = useState(activeLocale())
  useEffect(() => {
    const onLang = (): void => setLocale(activeLocale())
    window.addEventListener('app-language-changed', onLang)
    return () => window.removeEventListener('app-language-changed', onLang)
  }, [])

  const openInStudio = useCallback((videoId: string, clipId?: number): void => {
    navigate({ page: 'studio', params: clipId === undefined ? { videoId } : { videoId, clipId } })
  }, [])

  // A watched channel's card opens its creator profile, already selected.
  const openCreator = useCallback((creatorId: number): void => {
    navigate({ page: 'creators', params: { creatorId } })
  }, [])

  // A NEW object whenever the params change, so ClipStudio's [target] effect
  // fires even when the page is already mounted.
  const studioVideo = route.page === 'studio' ? route.params?.videoId : undefined
  const studioClip = route.page === 'studio' ? route.params?.clipId : undefined
  const studioTarget = useMemo<StudioTarget | null>(
    () => (studioVideo ? { videoId: studioVideo, ...(studioClip !== undefined ? { clipId: studioClip } : {}) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studioVideo, studioClip, route]
  )
  const consumeStudio = useCallback((): void => {
    navigate({ page: 'studio' }, { replace: true, instant: true })
  }, [])

  const creatorTarget = route.page === 'creators' ? (route.params?.creatorId ?? null) : null
  const consumeCreator = useCallback((): void => {
    navigate({ page: 'creators' }, { replace: true, instant: true })
  }, [])

  // "See their clips": the Clip Editor preselects this creator.
  const studioCreator = route.page === 'studio' ? (route.params?.creatorId ?? null) : null

  const render = (page: Page, active: boolean): React.ReactNode => {
    switch (page) {
      case 'home':
        return <Home active={active} />
      case 'dashboard':
        return <Dashboard active={active} onOpenInStudio={openInStudio} />
      case 'queue':
        return <Queue active={active} onOpenInStudio={openInStudio} />
      case 'watch':
        return <Watch active={active} onOpenInStudio={openInStudio} onOpenCreator={openCreator} />
      case 'studio':
        return (
          <ClipStudio
            active={active}
            target={active ? studioTarget : null}
            onTargetConsumed={consumeStudio}
            creatorFilter={studioCreator}
          />
        )
      case 'creators':
        return (
          <Creators
            active={active}
            initialSelected={active ? creatorTarget : null}
            onTargetConsumed={consumeCreator}
            onOpenInStudio={openInStudio}
          />
        )
      case 'marketplace':
        return <Marketplace active={active} />
      case 'models':
        return <Models active={active} />
      case 'settings':
        return <Settings active={active} section={route.page === 'settings' ? (route.params?.section ?? null) : null} />
      case 'calendar':
        return <Calendar active={active} onOpenInStudio={openInStudio} />
      case 'storage':
        return <Storage active={active} />
    }
  }

  return (
    <ConfirmProvider>
      <ToastProvider>
        <Shell
          contentKey={locale}
          overlay={
            wizard && (
              <SetupWizard
                onClose={() => {
                  setWizard(false)
                  navigate({ page: 'home' })
                }}
              />
            )
          }
        >
          <KeepAlive render={render} />
        </Shell>
        <YouTubeConnect />
      </ToastProvider>
    </ConfirmProvider>
  )
}
