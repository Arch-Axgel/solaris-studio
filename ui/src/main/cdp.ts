// A small Chrome DevTools Protocol client for the dedicated YouTube browser
// (youtubeBrowser.ts). Electron 31 runs Node 20, which has no global
// WebSocket, and pulling in a websocket package for a handful of local
// messages isn't worth a dependency — so this speaks just enough RFC 6455
// over node:http to talk to a browser on 127.0.0.1.
//
// It imports nothing from Electron on purpose: a plain Node script can load
// it and drive a real Edge with it, which is how it was checked.
//
// Cookie VALUES never leave this file: readSessionCookies() only reports how
// many there are and whether a sign-in cookie is among them.

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import type { Socket } from 'node:net'
import { join } from 'node:path'

// CDP results are loosely shaped JSON; the helpers below narrow what they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CdpResult = any

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** One client-side websocket. Text frames only (CDP never sends binary),
 *  with fragmentation, ping/pong and close handled. */
class WsConn {
  private socket: Socket
  private buffer: Buffer = Buffer.alloc(0)
  private fragments: Buffer[] = []
  private closed = false
  onMessage: (text: string) => void = () => undefined
  onClose: () => void = () => undefined

  constructor(socket: Socket, head: Buffer) {
    this.socket = socket
    socket.setNoDelay(true)
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('close', () => this.finish())
    socket.on('error', () => this.finish())
    if (head.length) this.onData(head)
  }

  get isOpen(): boolean {
    return !this.closed
  }

  send(text: string): void {
    if (!this.closed) this.sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  close(): void {
    if (this.closed) return
    try {
      this.sendFrame(0x8, Buffer.alloc(0))
    } catch {
      // the socket is going away anyway
    }
    this.socket.end()
    // A browser that is shutting down may never answer the close frame.
    setTimeout(() => this.socket.destroy(), 500).unref()
    this.finish()
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    // Clients must mask every frame (RFC 6455 5.3); the browser drops the
    // connection otherwise.
    const mask = randomBytes(4)
    const len = payload.length
    let header: Buffer
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    for (;;) {
      const buf = this.buffer
      if (buf.length < 2) return
      const fin = (buf[0] & 0x80) !== 0
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f
      let offset = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        offset = 10
      }
      const maskLen = masked ? 4 : 0
      if (buf.length < offset + maskLen + len) return
      let payload = buf.subarray(offset + maskLen, offset + maskLen + len)
      if (masked) {
        const mask = buf.subarray(offset, offset + 4)
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      }
      this.buffer = buf.subarray(offset + maskLen + len)
      this.onFrame(opcode, fin, payload)
    }
  }

  private onFrame(opcode: number, fin: boolean, payload: Buffer): void {
    if (opcode === 0x8) {
      this.close()
    } else if (opcode === 0x9) {
      if (!this.closed) this.sendFrame(0xa, payload)
    } else if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      this.fragments.push(payload)
      if (fin) {
        const whole = Buffer.concat(this.fragments)
        this.fragments = []
        this.onMessage(whole.toString('utf8'))
      }
    }
    // 0xA (pong) and anything else: nothing to do.
  }
}

function openWebSocket(url: string, timeoutMs: number): Promise<WsConn> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const key = randomBytes(16).toString('base64')
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.destroy()
      reject(error)
    }
    // No Origin header: Chromium 111+ refuses websocket clients that send
    // one unless the browser was started with --remote-allow-origins, and a
    // local Node client has no origin to claim.
    const req = request({
      host: target.hostname,
      port: Number(target.port),
      path: target.pathname + target.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    })
    const timer = setTimeout(() => fail(new Error('timed out connecting to the browser')), timeoutMs)
    req.on('error', (error) => fail(error))
    req.on('response', (res) => {
      res.resume()
      fail(new Error(`the browser refused the connection (HTTP ${res.statusCode})`))
    })
    req.on('upgrade', (res, socket: Socket, head: Buffer) => {
      if (settled) {
        socket.destroy()
        return
      }
      const expected = createHash('sha1').update(key + WS_GUID).digest('base64')
      if (res.headers['sec-websocket-accept'] !== expected) {
        socket.destroy()
        fail(new Error('the browser answered with a bad websocket handshake'))
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(new WsConn(socket, head))
    })
    req.end()
  })
}

type Pending = { resolve: (v: CdpResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
type Listener = (method: string, params: CdpResult, sessionId: string | undefined) => void

/** A browser-level CDP connection. Page commands go through a flattened
 *  session (attachPage), so one socket drives every tab. */
export class CdpClient {
  private ws: WsConn
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<Listener>()

  private constructor(ws: WsConn) {
    this.ws = ws
    ws.onMessage = (text) => this.onMessage(text)
    ws.onClose = () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error('the browser closed the connection'))
      }
      this.pending.clear()
    }
  }

  static async connect(wsUrl: string, timeoutMs = 2000): Promise<CdpClient> {
    return new CdpClient(await openWebSocket(wsUrl, timeoutMs))
  }

  get isOpen(): boolean {
    return this.ws.isOpen
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 5000): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
      if (!this.ws.isOpen) {
        reject(new Error('the browser connection is closed'))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    })
  }

  /** Resolves with the event's params, or null when it doesn't come in time.
   *  Call it BEFORE sending the command that triggers the event. */
  waitForEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<CdpResult | null> {
    return new Promise((resolve) => {
      const listener: Listener = (m, params, sid) => {
        if (m !== method || sid !== sessionId) return
        cleanup()
        resolve(params ?? {})
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(null)
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.listeners.delete(listener)
      }
      this.listeners.add(listener)
    })
  }

  close(): void {
    this.ws.close()
  }

  private onMessage(text: string): void {
    let msg: CdpResult
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'DevTools error'))
      else p.resolve(msg.result ?? {})
    } else if (typeof msg.method === 'string') {
      for (const listener of [...this.listeners]) listener(msg.method, msg.params, msg.sessionId)
    }
  }
}

/** The browser-level websocket address Chromium wrote when it started with
 *  --remote-debugging-port=0, or null if there is no usable port file. The
 *  file can outlive a crashed browser, so a non-null answer only means
 *  "worth trying"; connectBrowser() is what says it is up. */
export function readDevToolsEndpoint(userDataDir: string): string | null {
  try {
    const lines = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
    const port = Number(lines[0])
    const path = (lines[1] ?? '').trim()
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !path.startsWith('/devtools/browser/')) return null
    return `ws://127.0.0.1:${port}${path}`
  } catch {
    return null
  }
}

/** A connection to the browser using that profile, or null if it isn't
 *  running (or isn't answering quickly). */
export async function connectBrowser(userDataDir: string, timeoutMs = 1500): Promise<CdpClient | null> {
  const endpoint = readDevToolsEndpoint(userDataDir)
  if (!endpoint) return null
  try {
    return await CdpClient.connect(endpoint, timeoutMs)
  } catch {
    return null
  }
}

export type PageTarget = { targetId: string; url: string }

/** Ordinary tabs, web pages first. Edge also reports a few of its own
 *  internal "pages" (side panels and the like) that have no window of
 *  their own, so an http(s) tab is always preferred. */
export async function listPages(cdp: CdpClient): Promise<PageTarget[]> {
  const { targetInfos } = await cdp.send('Target.getTargets')
  const pages: PageTarget[] = (targetInfos ?? [])
    .filter((t: CdpResult) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
    .map((t: CdpResult) => ({ targetId: String(t.targetId), url: String(t.url) }))
  const web = pages.filter((p) => /^https?:/.test(p.url))
  return [...web, ...pages.filter((p) => !/^https?:/.test(p.url))]
}

/** The first tab, opening one on `url` when the browser has none (it can
 *  keep running with every window closed). */
export async function firstPage(cdp: CdpClient, url: string): Promise<PageTarget> {
  const pages = await listPages(cdp)
  if (pages[0]) return pages[0]
  const { targetId } = await cdp.send('Target.createTarget', { url, newWindow: true })
  return { targetId: String(targetId), url }
}

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen'

export async function getWindowState(
  cdp: CdpClient,
  targetId: string
): Promise<{ windowId: number; state: WindowState }> {
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget', { targetId })
  return { windowId, state: (bounds?.windowState ?? 'normal') as WindowState }
}

/** Minimize, or bring back. A window can't change state and size in one
 *  call, so only windowState is sent. */
export async function setWindowState(cdp: CdpClient, targetId: string, state: 'normal' | 'minimized'): Promise<void> {
  const { windowId } = await getWindowState(cdp, targetId)
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: state } })
}

/** Restore and raise the tab's window. Windows may only flash it in the
 *  taskbar when another app has focus; that is its rule, not ours. */
export async function bringToFront(cdp: CdpClient, targetId: string): Promise<void> {
  await setWindowState(cdp, targetId, 'normal').catch(() => undefined)
  await cdp.send('Target.activateTarget', { targetId }).catch(() => undefined)
  await withPage(cdp, targetId, (sid) => cdp.send('Page.bringToFront', {}, sid)).catch(() => undefined)
}

/** Runs `fn` on a flattened session attached to the tab, then detaches. */
export async function withPage<T>(cdp: CdpClient, targetId: string, fn: (sessionId: string) => Promise<T>): Promise<T> {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  try {
    return await fn(String(sessionId))
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

/** Navigates the tab to `url`, or reloads it when `url` is null. Resolves
 *  true once the load event fired, false if it didn't within `waitMs`
 *  (0 = don't wait). */
export async function loadPage(cdp: CdpClient, targetId: string, url: string | null, waitMs = 12000): Promise<boolean> {
  return withPage(cdp, targetId, async (sid) => {
    await cdp.send('Page.enable', {}, sid)
    const loaded = waitMs > 0 ? cdp.waitForEvent('Page.loadEventFired', sid, waitMs) : Promise.resolve(null)
    if (url) await cdp.send('Page.navigate', { url }, sid)
    else await cdp.send('Page.reload', { ignoreCache: false }, sid)
    return (await loaded) !== null
  })
}

/** Cookies that only exist while a Google account is signed in. */
const SESSION_COOKIES = new Set(['SAPISID', '__Secure-3PAPISID', 'LOGIN_INFO'])

function isGoogleDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase()
  return d === 'youtube.com' || d.endsWith('.youtube.com') || d === 'google.com' || d.endsWith('.google.com')
}

/** How many cookies the profile holds and whether it is signed in to
 *  Google. Storage.getCookies runs on the browser target itself, so no tab
 *  needs to be attached. Never returns or logs a value. */
export async function readSessionCookies(cdp: CdpClient): Promise<{ count: number; signedIn: boolean }> {
  const { cookies } = await cdp.send('Storage.getCookies')
  const list: CdpResult[] = Array.isArray(cookies) ? cookies : []
  const signedIn = list.some((c) => SESSION_COOKIES.has(String(c.name)) && isGoogleDomain(String(c.domain ?? '')))
  return { count: list.length, signedIn }
}

export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

/** Asks the browser to quit the normal way, which is what writes its cookie
 *  database to disk. Resolves true when the browser took the request: it
 *  replied, or the socket died with it. Only a timeout (or a connection
 *  already gone) is false. Once true, the browser finishes on its own; a
 *  real Edge acknowledges at once but its process lives ~6 s more while it
 *  shuts down, and killing it then could lose the latest cookies. */
export async function closeBrowser(cdp: CdpClient): Promise<boolean> {
  const taken = await cdp.send('Browser.close', {}, undefined, 1500).then(
    () => true,
    (error: Error) => error.message === 'the browser closed the connection'
  )
  cdp.close()
  return taken
}

/** The browser (main) process id, so a browser adopted from an earlier run,
 *  which this app has no child handle for, can still be waited on. */
export async function browserPid(cdp: CdpClient): Promise<number | null> {
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo', {}, undefined, 2000)
    const main = (Array.isArray(processInfo) ? processInfo : []).find((p: CdpResult) => p?.type === 'browser')
    return Number.isInteger(main?.id) && main.id > 0 ? main.id : null
  } catch {
    return null
  }
}

/** Whether a process id is still alive. Signal 0 only checks. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists but isn't ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
