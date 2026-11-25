import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/** JS motion helpers (spec 2.7). Every effect here checks motionReduced()
 *  first, so "Reduce motion" (system or Settings) turns all of it off. */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function html(): HTMLElement {
  return document.documentElement
}

/** System preference or the Settings override. `data-motion="full"` is the
 *  explicit "Reduce motion: Off" choice, which wins over the system. */
export function motionReduced(): boolean {
  const m = html().dataset.motion
  if (m === 'reduced') return true
  if (m === 'full') return false
  try {
    return window.matchMedia(REDUCE_QUERY).matches
  } catch {
    return false
  }
}

export function effectsReduced(): boolean {
  return html().dataset.effects === 'reduced'
}

function subscribeMotion(cb: () => void): () => void {
  let mq: MediaQueryList | null = null
  try {
    mq = window.matchMedia(REDUCE_QUERY)
    mq.addEventListener('change', cb)
  } catch {
    mq = null
  }
  const mo = new MutationObserver(cb)
  mo.observe(html(), { attributes: true, attributeFilter: ['data-motion', 'data-effects'] })
  return () => {
    mq?.removeEventListener('change', cb)
    mo.disconnect()
  }
}

/** Reactive motionReduced(). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionReduced, () => false)
}

/** Reactive effectsReduced(). */
export function useEffectsReduced(): boolean {
  return useSyncExternalStore(subscribeMotion, effectsReduced, () => false)
}

function centreOf(from?: Element | DOMRect | null): { x: number; y: number } {
  if (!from) return { x: window.innerWidth / 2, y: window.innerHeight / 3 }
  const r = from instanceof Element ? from.getBoundingClientRect() : from
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

const CONFETTI = ['#8f2445', '#a92f55', '#d8b263', '#ecc87c', '#f3dc9a', '#fff3f5']

/** A gold-and-burgundy burst from an element (or the top third of the
 *  window). Canvas, ~60 particles with gravity, removed after ~900ms. */
export function celebrate(from?: Element | DOMRect | null, opts?: { count?: number }): void {
  if (motionReduced()) return
  const { x, y } = centreOf(from)
  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '2147483000'
  } as Partial<CSSStyleDeclaration>)
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }
  ctx.scale(dpr, dpr)
  const count = opts?.count ?? 60
  const parts = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
    const speed = 4 + Math.random() * 7
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      size: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: CONFETTI[i % CONFETTI.length],
      shape: i % 3
    }
  })
  const start = performance.now()
  const DURATION = 900
  const frame = (now: number): void => {
    const t = (now - start) / DURATION
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (t >= 1) {
      canvas.remove()
      return
    }
    ctx.globalAlpha = Math.max(0, 1 - t * t)
    for (const p of parts) {
      p.vy += 0.32
      p.vx *= 0.985
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.shape === 0) {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (p.shape === 1) {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      } else {
        // a little four-point star, the sparkle in the logo
        const s = p.size * 0.8
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.lineTo(s * 0.25, -s * 0.25)
        ctx.lineTo(s, 0)
        ctx.lineTo(s * 0.25, s * 0.25)
        ctx.lineTo(0, s)
        ctx.lineTo(-s * 0.25, s * 0.25)
        ctx.lineTo(-s, 0)
        ctx.lineTo(-s * 0.25, -s * 0.25)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function bounce(target: Element): void {
  target.classList.remove('anim-bounce')
  // restart the animation even if it just ran
  void (target as HTMLElement).offsetWidth
  target.classList.add('anim-bounce')
  const done = (): void => {
    target.classList.remove('anim-bounce')
    target.removeEventListener('animationend', done)
  }
  target.addEventListener('animationend', done)
}

/** A ghost of `source` flies into `target` (default: the Queue badge), then
 *  the target bounces. Large sources fly as a glowing card instead of a full
 *  clone, so a whole hero bar never gets duplicated. */
export function flyTo(source: Element, target: Element | null, opts?: { onDone?: () => void }): void {
  const to = target ?? document.querySelector('[data-fly-target="queue"]')
  if (motionReduced() || !to || !source.isConnected) {
    if (to && !motionReduced()) bounce(to)
    opts?.onDone?.()
    return
  }
  const a = source.getBoundingClientRect()
  const b = to.getBoundingClientRect()
  if (a.width === 0 || b.width === 0) {
    opts?.onDone?.()
    return
  }
  let ghost: HTMLElement
  if (a.width * a.height > 90000) {
    ghost = document.createElement('div')
    Object.assign(ghost.style, {
      borderRadius: '24px',
      background: 'linear-gradient(135deg, rgb(143 36 69 / .9), rgb(216 178 99 / .85))',
      boxShadow: '0 0 0 1px rgb(216 178 99 / .5), 0 0 40px -6px rgb(216 178 99 / .7)'
    } as Partial<CSSStyleDeclaration>)
  } else {
    ghost = source.cloneNode(true) as HTMLElement
    ghost.querySelectorAll('video, iframe, [id]').forEach((n) => {
      if (n.tagName === 'VIDEO' || n.tagName === 'IFRAME') n.remove()
      else n.removeAttribute('id')
    })
  }
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483000',
    transformOrigin: 'center center',
    willChange: 'transform, opacity'
  } as Partial<CSSStyleDeclaration>)
  document.body.appendChild(ghost)
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  const scale = Math.max(0.04, Math.min(b.width / a.width, b.height / a.height))
  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'blur(0)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(${(1 + scale) / 2.2})`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.2, filter: 'blur(1px)' }
    ],
    { duration: 600, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' }
  )
  const finish = (): void => {
    ghost.remove()
    bounce(to)
    opts?.onDone?.()
  }
  anim.onfinish = finish
  anim.oncancel = finish
}

/** Count a number up in an element's text. Reduced motion: final value. */
export function countUp(el: HTMLElement, from: number, to: number, format?: (n: number) => string): void {
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString())
  if (motionReduced() || from === to) {
    el.textContent = fmt(to)
    return
  }
  const duration = Math.min(800, 250 + Math.abs(to - from) * 8)
  const start = performance.now()
  const prev = (el as HTMLElement & { __countUp?: number }).__countUp
  if (prev) cancelAnimationFrame(prev)
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    el.textContent = fmt(from + (to - from) * eased)
    if (t < 1) (el as HTMLElement & { __countUp?: number }).__countUp = requestAnimationFrame(step)
  }
  ;(el as HTMLElement & { __countUp?: number }).__countUp = requestAnimationFrame(step)
}

/* ---------- view transitions ---------- */

const marked = new Set<HTMLElement>()

/** Give a clip poster the shared `clip-<id>` name just before a transition,
 *  so it morphs into the editor stage. Cleared when the transition ends. */
export function markClipTransition(el: HTMLElement | null, clipId: number): void {
  if (!el || motionReduced()) return
  el.style.viewTransitionName = `clip-${clipId}`
  marked.add(el)
}

function clearMarks(): void {
  marked.forEach((el) => {
    el.style.viewTransitionName = ''
  })
  marked.clear()
}

let running: ViewTransition | null = null

/** Run `update` inside a view transition when supported and motion is on.
 *  The update is flushed synchronously so the new DOM is what gets captured. */
export function withViewTransition(update: () => void): Promise<void> {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransition }
  if (!doc.startViewTransition || motionReduced() || document.hidden) {
    update()
    clearMarks()
    return Promise.resolve()
  }
  try {
    const vt = doc.startViewTransition(() => {
      flushSync(update)
    })
    running = vt
    vt.ready.catch(() => {})
    vt.updateCallbackDone.catch(() => {})
    return vt.finished
      .catch(() => {})
      .finally(() => {
        if (running === vt) running = null
        clearMarks()
      })
  } catch {
    update()
    clearMarks()
    return Promise.resolve()
  }
}

/** True while a view transition is animating (used to avoid stacking them). */
export function transitionRunning(): boolean {
  return running !== null
}

/* ---------- tilt ---------- */

/** Pointer-follow tilt for `.tilt` elements: writes --mx/--my in [-1, 1],
 *  rAF-throttled. Returns the cleanup. */
export function attachTilt(el: HTMLElement): () => void {
  if (motionReduced() || effectsReduced()) return () => {}
  let frame = 0
  let px = 0
  let py = 0
  const apply = (): void => {
    frame = 0
    el.style.setProperty('--mx', px.toFixed(3))
    el.style.setProperty('--my', py.toFixed(3))
  }
  const move = (e: PointerEvent): void => {
    const r = el.getBoundingClientRect()
    px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
    py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
    if (!frame) frame = requestAnimationFrame(apply)
  }
  const leave = (): void => {
    px = 0
    py = 0
    if (!frame) frame = requestAnimationFrame(apply)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerleave', leave)
  return () => {
    if (frame) cancelAnimationFrame(frame)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerleave', leave)
    el.style.removeProperty('--mx')
    el.style.removeProperty('--my')
  }
}

/* ---------- in view ---------- */

/** True once the element has scrolled into view (sticky: it stays true), for
 *  lazy loading. Falls back to true where IntersectionObserver is missing. */
export function useInView<T extends Element>(opts?: IntersectionObserverInit): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  const { root, rootMargin, threshold } = opts ?? {}
  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { root, rootMargin: rootMargin ?? '120px', threshold }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, root, rootMargin, threshold])
  return [ref, seen]
}
