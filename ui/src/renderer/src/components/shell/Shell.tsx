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

/** True while a full-window <Overlay> (layout editor, setup wizard, install
 *  plan...) is open. Global keys stand down then: a palette or drawer opened
 *  over it steals Esc from it, and a G-chord or Alt+Arrow that switches page
 *  hides the page that holds the overlay while its modal dialog keeps the
 *  whole app inert (nothing clickable, nothing visible to close). */
const overlayOpen = (): boolean => document.documentElement.dataset.overlay !== undefined
const guard =
  (fn: () => void): (() => void) =>
  () => {
    if (!overlayOpen()) fn()
  }

/** A file or link dropped anywhere that isn't a drop zone must not replace
 *  the app with that file (Electron's main process blocks the navigation too).
 *  Runs on window in the bubble phase, after the drop zones (QuickPaste,
 *  AddVideos...) had their turn: whatever they accepted is already
 *  defaultPrevented and left alone. Text fields keep their native text drop,
 *  but not a file drop: a text box doesn't take files, so Chromium would
 *  open the file in the window. File inputs keep their native file drop. */
function installDropGuard(): () => void {
  const native = (e: DragEvent): boolean => {
    const target = e.target
    if (!(target instanceof Element)) return false
    if (target.closest('input[type="file"]')) return true
    const files = Array.from(e.dataTransfer?.types ?? []).includes('Files')
    return !files && !!target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
  }
  const onDragOver = (e: DragEvent): void => {
    if (e.defaultPrevented || native(e)) return
    e.preventDefault()
    // "Can't drop here" cursor instead of the copy/link one.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  }
  const onDrop = (e: DragEvent): void => {
    if (e.defaultPrevented || native(e)) return
    e.preventDefault()
  }
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  return () => {
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('drop', onDrop)
  }
}

/** Registers the global keyboard map (spec 3.9). G-chords come from PAGES. */
function GlobalKeys(): JSX.Element {
  const route = useRoute()
  useHotkey('ctrl+k', guard(() => toggleLayer('palette')), { allowInInputs: true })
  useHotkey('ctrl+n', guard(() => openLayer('create')))
  useHotkey('ctrl+j', guard(() => toggleLayer('assistant')))
  useHotkey('ctrl+shift+a', guard(() => toggleLayer('activity')))
  useHotkey('?', guard(() => toggleLayer('shortcuts')))
  useHotkey('f1', guard(() => openLayer('help', { page: route.page })))
  useHotkey('alt+arrowleft', guard(() => back()))
  useHotkey('alt+arrowright', guard(() => forward()))
  return (
    <>
      {PAGES.map((p) => (
        <Chord key={p.id} chord={p.chord} page={p.id} />
      ))}
    </>
  )
}

function Chord({ chord, page }: { chord: string; page: (typeof PAGES)[number]['id'] }): null {
  useHotkey(chord.toLowerCase(), guard(() => navigate({ page })))
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
  useEffect(() => installDropGuard(), [])
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
