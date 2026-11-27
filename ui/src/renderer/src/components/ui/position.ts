/** Place a fixed-position floating panel next to an anchor rect, flipping to
 *  the opposite side when it would leave the viewport, then clamping. */
export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Align = 'start' | 'center' | 'end'

export function placeFloating(
  anchor: DOMRect,
  panel: HTMLElement,
  side: Side = 'bottom',
  align: Align = 'center',
  gap = 8
): Side {
  const pw = panel.offsetWidth
  const ph = panel.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const M = 8
  let s = side
  if (s === 'bottom' && anchor.bottom + gap + ph > vh - M && anchor.top - gap - ph > M) s = 'top'
  else if (s === 'top' && anchor.top - gap - ph < M && anchor.bottom + gap + ph < vh - M) s = 'bottom'
  else if (s === 'right' && anchor.right + gap + pw > vw - M && anchor.left - gap - pw > M) s = 'left'
  else if (s === 'left' && anchor.left - gap - pw < M && anchor.right + gap + pw < vw - M) s = 'right'

  let top: number
  let left: number
  if (s === 'top' || s === 'bottom') {
    top = s === 'bottom' ? anchor.bottom + gap : anchor.top - gap - ph
    left =
      align === 'start' ? anchor.left : align === 'end' ? anchor.right - pw : anchor.left + anchor.width / 2 - pw / 2
  } else {
    left = s === 'right' ? anchor.right + gap : anchor.left - gap - pw
    top =
      align === 'start' ? anchor.top : align === 'end' ? anchor.bottom - ph : anchor.top + anchor.height / 2 - ph / 2
  }
  left = Math.max(M, Math.min(left, vw - pw - M))
  top = Math.max(M, Math.min(top, vh - ph - M))
  Object.assign(panel.style, {
    position: 'fixed',
    inset: 'auto',
    margin: '0',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`
  })
  // origin for the enter animation: the side facing the anchor
  const ox = s === 'left' ? '100%' : s === 'right' ? '0%' : `${Math.round(anchor.left + anchor.width / 2 - left)}px`
  const oy = s === 'top' ? '100%' : s === 'bottom' ? '0%' : `${Math.round(anchor.top + anchor.height / 2 - top)}px`
  panel.style.transformOrigin = `${ox} ${oy}`
  panel.dataset.side = s
  return s
}

/** Show a [popover] element in the top layer when the API exists. */
export function showTop(el: HTMLElement, mode: 'auto' | 'manual'): void {
  const p = el as HTMLElement & { showPopover?: () => void; popover?: string | null }
  if (typeof p.showPopover === 'function') {
    if (el.getAttribute('popover') !== mode) el.setAttribute('popover', mode)
    try {
      if (!el.matches(':popover-open')) p.showPopover()
    } catch {
      /* already open or detached */
    }
  } else {
    el.style.display = 'block'
  }
}

export function hideTop(el: HTMLElement): void {
  const p = el as HTMLElement & { hidePopover?: () => void }
  if (typeof p.hidePopover === 'function') {
    try {
      if (el.matches(':popover-open')) p.hidePopover()
    } catch {
      /* not open */
    }
  } else {
    el.style.display = 'none'
  }
}

/** Where a floating layer (popover, tooltip, listbox) must be portaled so
 *  it stays interactive: inside the open <dialog> that contains its anchor
 *  (a modal dialog makes everything outside its own subtree inert), else
 *  <body>. The layer still renders in the top layer either way. */
export function layerHost(anchor: Element | null | undefined): HTMLElement {
  return (anchor?.closest('dialog[open]') as HTMLElement | null) ?? document.body
}

/** True when the last input was the keyboard (Tab, arrows…), so focus
 *  tooltips don't pop up on programmatic focus after a click or hotkey. */
let lastKeyNav = 0
let lastPointer = 0
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') lastKeyNav = Date.now()
    },
    true
  )
  window.addEventListener('pointerdown', () => (lastPointer = Date.now()), true)
}
export function focusFromKeyboard(): boolean {
  return lastKeyNav > lastPointer && Date.now() - lastKeyNav < 1500
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
