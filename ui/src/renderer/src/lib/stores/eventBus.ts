import { useEffect, useRef } from 'react'
import type { StudioEvent } from '../types'

/** One shared WebSocket for the shell stores.
 *
 *  `useEvents` opens a socket per caller, which is fine for a page but not for
 *  six stores that live for the whole session. This bus opens one socket on
 *  the first subscriber, reconnects like useEvents does, and closes when the
 *  last subscriber leaves. */

const WS_URL = 'ws://127.0.0.1:8765/ws'

type Listener = (e: StudioEvent) => void
const listeners = new Set<Listener>()
let socket: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let connectedAt = 0
const reconnectListeners = new Set<() => void>()

function connect(): void {
  if (socket || listeners.size === 0) return
  try {
    socket = new WebSocket(WS_URL)
  } catch {
    socket = null
    retry = setTimeout(connect, 2000)
    return
  }
  socket.onopen = () => {
    // A reconnect may have missed events: let stores re-read the truth.
    if (connectedAt) reconnectListeners.forEach((l) => l())
    connectedAt = Date.now()
  }
  socket.onmessage = (msg) => {
    let event: StudioEvent
    try {
      event = JSON.parse(msg.data as string) as StudioEvent
    } catch {
      return
    }
    listeners.forEach((l) => {
      try {
        l(event)
      } catch (err) {
        console.error('event listener failed', err)
      }
    })
  }
  socket.onclose = () => {
    socket = null
    if (listeners.size > 0) retry = setTimeout(connect, 2000)
  }
}

/** Subscribe to backend events. Returns the unsubscribe. */
export function subscribeEvents(fn: Listener): () => void {
  listeners.add(fn)
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  connect()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && !closeTimer) {
      closeTimer = setTimeout(() => {
        closeTimer = null
        if (listeners.size > 0) return
        if (retry) clearTimeout(retry)
        retry = null
        const s = socket
        socket = null
        s?.close()
      }, 5000)
    }
  }
}

/** Called after the socket reconnects (events may have been missed). */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn)
  return () => {
    reconnectListeners.delete(fn)
  }
}

/** Hook form: the latest handler always runs, the subscription is stable. */
export function useStudioEvents(fn: Listener): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => subscribeEvents((e) => ref.current(e)), [])
}
