import { useEffect } from 'react'
import { t } from '../../lib/i18n'
import { useHotkey, installHotkeys } from '../../lib/hotkeys'
import { PAGES, back, forward, navigate, openLayer, toggleLayer, useRoute } from '../../lib/nav'
import { startActivityFeed } from '../../lib/stores/activity'
import { useAutoEffects, useUiPrefs } from '../../lib/uiPrefs'
import { useQueueNotifications } from '../../lib/queueNotifications'
import UpdateBanner from '../UpdateBanner'
import { Toaster } from '../ui'
import GoldGradientDefs from './GoldGradientDefs'
import { ShellBoundary } from './KeepAlive'
import Rail from './Rail'
import TopBar from './TopBar'
import TransportDock from './TransportDock'
import {
  ActivityDrawer,
  AssistantDrawer,
  CommandPalette,
  CreateSheet,
  HelpDrawer,
  ShortcutSheet,
  Tour,
  WhatsNew
} from './layers'

/** Registers the global keyboard map (spec 3.9). G-chords come from PAGES. */
function GlobalKeys(): JSX.Element {
  const route = useRoute()
  useHotkey('ctrl+k', () => toggleLayer('palette'), { allowInInputs: true })
  useHotkey('ctrl+n', () => openLayer('create'))
  useHotkey('ctrl+j', () => toggleLayer('assistant'))
  useHotkey('ctrl+shift+a', () => toggleLayer('activity'))
  useHotkey('?', () => toggleLayer('shortcuts'))
  useHotkey('f1', () => openLayer('help', { page: route.page }))
  useHotkey('alt+arrowleft', () => back())
  useHotkey('alt+arrowright', () => forward())
  return (
    <>
      {PAGES.map((p) => (
        <Chord key={p.id} chord={p.chord} page={p.id} />
      ))}
    </>
  )
}

function Chord({ chord, page }: { chord: string; page: (typeof PAGES)[number]['id'] }): null {
  useHotkey(chord.toLowerCase(), () => navigate({ page }))
  return null
}

/** The app frame (spec 3.2): rail, top bar, banner, keep-alive content and
 *  the transport dock, plus every global layer and the toast stack. The
 *  locale key remounts only the content, so route state survives a language
 *  switch. */
export default function Shell({
  contentKey,
  children,
  overlay
}: {
  contentKey: string
  children: React.ReactNode
  overlay?: React.ReactNode
}): JSX.Element {
  const [prefs] = useUiPrefs()
  useEffect(() => installHotkeys(), [])
  useEffect(() => startActivityFeed(), [])
  // Mounted at the shell, not on the queue page: the point of a notification
  // is to reach someone who is NOT looking at the queue.
  useQueueNotifications()
  useAutoEffects()

  return (
    <div className="shell" data-rail={prefs.railPinned ? 'expanded' : 'collapsed'}>
      <GoldGradientDefs />
      <GlobalKeys />
      <button
        type="button"
        className="skip-link"
        onClick={() => document.querySelector<HTMLElement>('.keep-page.page-active')?.focus()}
      >
        {t('Skip to content')}
      </button>
      <Rail />
      <div className="shell-main">
        <TopBar />
        <UpdateBanner />
        <main id="main-content" key={contentKey} className="shell-content">
          {children}
        </main>
        <TransportDock />
      </div>
      <ShellBoundary name="Layers">
        <CommandPalette />
        <CreateSheet />
        <ActivityDrawer />
        <AssistantDrawer />
        <HelpDrawer />
        <ShortcutSheet />
        <WhatsNew />
        <Tour />
      </ShellBoundary>
      <Toaster />
      {overlay}
    </div>
  )
}
