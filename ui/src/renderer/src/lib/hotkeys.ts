import { useEffect, useRef } from 'react'
import { closeLayer, topLayer } from './nav'

/** Global keyboard map (spec 3.9).
 *
 *  One keydown listener on window. Combos are written lowercase with `+`
 *  between modifiers and a space between chord steps: 'ctrl+k',
 *  'ctrl+shift+a', 'alt+arrowleft', '/', '?', 'f1', 'g h'.
 *
 *  - Ignored while typing in input/textarea/select/[contenteditable], except
 *    Ctrl+K, Esc, and handlers registered with allowInInputs.
 *  - While the Edit Bay is open (html[data-edit-bay]) only Ctrl+K and Esc run:
 *    TimelineEditor owns the editor keys, so no Space/J/K/L here.
 *  - Esc closes the topmost shell layer, unless a modal dialog is open (the
 *    dialog handles its own Esc natively). */

type Handler = (e: KeyboardEvent) => void
interface Entry {
  id: number
  handler: { current: Handler }
  when: boolean
  allowInInputs: boolean
}

const registry = new Map<string, Entry[]>()
let nextId = 1
let installed = false
let chord: { key: string; at: number } | null = null
const CHORD_MS = 1200

const ALWAYS = new Set(['ctrl+k', 'escape'])

function normalize(combo: string): string {
  return combo
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((step) => {
      const parts = step.split('+').map((p) => (p === 'esc' ? 'escape' : p === 'cmd' || p === 'meta' ? 'ctrl' : p))
      const key = parts.pop() ?? ''
      const mods = ['ctrl', 'alt', 'shift'].filter((m) => parts.includes(m))
      return [...mods, key].join('+')
    })
    .join(' ')
}

function stepOf(e: KeyboardEvent): string {
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === 'esc') key = 'escape'
  const printable = e.key.length === 1
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  // Shift is part of a printable character ('?' is shift+/), so it is only a
  // modifier for named keys and Ctrl/Alt combos.
  if (e.shiftKey && (!printable || mods.length > 0)) mods.push('shift')
  return [...mods, key].join('+')
}

function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function pick(combo: string): Entry | null {
  const list = registry.get(combo)
  if (!list) return null
  for (let i = list.length - 1; i >= 0; i--) if (list[i].when) return list[i]
  return null
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return
  if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) return
  const step = stepOf(e)
  const typing = inField(e.target)
  const editBay = document.documentElement.dataset.editBay !== undefined

  if (step === 'escape') {
    const entry = pick('escape')
    if (entry) {
      entry.handler.current(e)
      return
    }
    // A modal dialog is open: it closes itself through its own cancel event.
    if (document.querySelector('dialog[open]:modal')) return
    if (topLayer()) {
      e.preventDefault()
      closeLayer()
    }
    return
  }

  // Chord second step
  if (chord && Date.now() - chord.at <= CHORD_MS && !typing && !editBay) {
    const combo = `${chord.key} ${step}`
    chord = null
    const entry = pick(combo)
    if (entry) {
      e.preventDefault()
      entry.handler.current(e)
      return
    }
  } else chord = null

  const entry = pick(step)
  if (entry) {
    const always = ALWAYS.has(step)
    if (editBay && !always) return
    if (typing && !always && !entry.allowInInputs) return
    e.preventDefault()
    entry.handler.current(e)
    return
  }

  // Chord first step (only when some chord starts with it)
  if (!typing && !editBay && !e.ctrlKey && !e.altKey && !e.metaKey) {
    for (const k of registry.keys()) {
      if (k.startsWith(`${step} `) && registry.get(k)?.some((x) => x.when)) {
        chord = { key: step, at: Date.now() }
        return
      }
    }
  }
}

export function installHotkeys(): () => void {
  if (installed) return () => {}
  installed = true
  window.addEventListener('keydown', onKeyDown)
  return () => {
    installed = false
    window.removeEventListener('keydown', onKeyDown)
  }
}

/** Register a key while the component is mounted (and `when` is true). The
 *  most recently registered active handler for a combo wins. */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts?: { when?: boolean; allowInInputs?: boolean }
): void {
  const ref = useRef(handler)
  ref.current = handler
  const when = opts?.when ?? true
  const allow = opts?.allowInInputs ?? false
  const key = normalize(combo)
  useEffect(() => {
    if (!when) return
    const entry: Entry = { id: nextId++, handler: ref, when: true, allowInInputs: allow }
    const list = registry.get(key) ?? []
    list.push(entry)
    registry.set(key, list)
    return () => {
      const l = registry.get(key)?.filter((x) => x.id !== entry.id) ?? []
      if (l.length) registry.set(key, l)
      else registry.delete(key)
    }
  }, [key, when, allow])
}

export const SHORTCUTS: { keys: string[]; label: string; group: 'Global' | 'Navigation' | 'Pages' }[] = [
  { keys: ['Ctrl', 'K'], label: 'Search or run a command', group: 'Global' },
  { keys: ['Ctrl', 'N'], label: 'New clips', group: 'Global' },
  { keys: ['Ctrl', 'J'], label: 'Ask Solaris Studio', group: 'Global' },
  { keys: ['Ctrl', 'Shift', 'A'], label: 'Activity', group: 'Global' },
  { keys: ['?'], label: 'Keyboard shortcuts', group: 'Global' },
  { keys: ['F1'], label: 'Help for this page', group: 'Global' },
  { keys: ['Esc'], label: 'Close the top panel', group: 'Global' },
  { keys: ['Ctrl', 'B'], label: 'Collapse or expand the sidebar', group: 'Navigation' },
  { keys: ['Alt', '←'], label: 'Back', group: 'Navigation' },
  { keys: ['Alt', '→'], label: 'Forward', group: 'Navigation' },
  { keys: ['/'], label: 'Search this page', group: 'Navigation' },
  { keys: ['G', 'H'], label: 'Go to Home', group: 'Pages' },
  { keys: ['G', 'N'], label: 'Go to Create', group: 'Pages' },
  { keys: ['G', 'Q'], label: 'Go to Queue', group: 'Pages' },
  { keys: ['G', 'W'], label: 'Go to Watched channels', group: 'Pages' },
  { keys: ['G', 'E'], label: 'Go to Clip Editor', group: 'Pages' },
  { keys: ['G', 'L'], label: 'Go to Schedule', group: 'Pages' },
  { keys: ['G', 'C'], label: 'Go to Creators', group: 'Pages' },
  { keys: ['G', 'M'], label: 'Go to Marketplace', group: 'Pages' },
  { keys: ['G', 'A'], label: 'Go to AI models', group: 'Pages' },
  { keys: ['G', 'D'], label: 'Go to Storage & health', group: 'Pages' },
  { keys: ['G', 'S'], label: 'Go to Settings', group: 'Pages' }
]
