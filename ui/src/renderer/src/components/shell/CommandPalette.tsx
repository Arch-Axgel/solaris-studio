import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { allCommands, refreshCommandContext, type Command } from '../../lib/commands'
import { scoreAll } from '../../lib/fuzzy'
import { t } from '../../lib/i18n'
import { flyTo } from '../../lib/motion'
import { navigate, openAssistant, openCreate, PAGES, useLayer } from '../../lib/nav'
import { creatorName, findItem, useSearchIndex, type SearchItem } from '../../lib/searchIndex'
import { getQueueSnapshot, refreshQueue } from '../../lib/stores/queueStore'
import { Icon, type IconName } from '../icons'
import { seedOptions } from '../queue/AddVideos'
import { Avatar, Dialog, EmptyState, Kbd, toast } from '../ui'

/** The command palette (spec 4.16): Ctrl+K reaches every page, every
 *  Settings section, the global actions and the whole library.
 *
 *  Combobox pattern: the input is role="combobox" and owns a role="listbox"
 *  through aria-controls/aria-activedescendant; rows are role="option".
 *  Scope prefixes: `>` commands, `@` creators, `#` clips, `!` channels. */

type RowKind = 'command' | 'special' | SearchItem['kind']

interface Row {
  key: string
  group: string
  icon: IconName
  label: string
  hits: number[]
  sub?: string
  shortcut?: string[]
  kind: RowKind
  score: number
  cmd?: Command
  item?: SearchItem
  /** remembered in Recent */
  recent?: boolean
  run: () => void | Promise<void>
}

type Entry = { type: 'head'; group: string; count: number } | { type: 'row'; row: Row; index: number }

const RECENT_KEY = 'solaris.ui.palette.recent'
const MAX_RECENT = 8
const ROW_H = 44
const HEAD_H = 30
const VIRTUAL_AFTER = 200

const GROUP_ORDER = ['Link', 'Ask', 'Recent', 'Go to', 'Actions', 'Clips', 'Videos', 'Creators', 'Watched channels', 'Add-ons']
const GROUP_LABEL: Record<string, string> = {
  Link: 'This link',
  Ask: 'Ask',
  Recent: 'Recent',
  'Go to': 'Go to',
  Actions: 'Actions',
  Clips: 'Clips',
  Videos: 'Videos',
  Creators: 'Creators',
  'Watched channels': 'Watched channels',
  'Add-ons': 'Add-ons'
}
const GROUP_LIMIT: Record<string, number> = {
  'Go to': 7,
  Actions: 8,
  Clips: 8,
  Videos: 5,
  Creators: 5,
  'Watched channels': 5,
  'Add-ons': 5
}
const KIND_GROUP: Record<SearchItem['kind'], string> = {
  clip: 'Clips',
  video: 'Videos',
  creator: 'Creators',
  watch: 'Watched channels',
  addon: 'Add-ons'
}

const SCOPES: Record<string, { label: string; icon: IconName; kinds: RowKind[] }> = {
  '>': { label: 'Commands', icon: 'command', kinds: ['command'] },
  '@': { label: 'Creators', icon: 'users', kinds: ['creator'] },
  '#': { label: 'Clips', icon: 'scissors', kinds: ['clip', 'video'] },
  '!': { label: 'Channels', icon: 'radar', kinds: ['watch'] }
}

const URL_RE = /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|twitch\.tv|kick\.com|[\w-]+\.[a-z]{2,})(\/\S*)?$/i

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function writeRecent(keys: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys.slice(0, MAX_RECENT)))
  } catch {
    /* storage blocked: Recent lasts this session */
  }
}

function cmdRow(c: Command, score: number, hits: number[], group?: string): Row {
  return {
    key: `cmd:${c.id}`,
    group: group ?? (c.group === 'Settings' ? 'Go to' : c.group),
    icon: c.icon,
    label: c.label,
    hits,
    sub: c.sub ? `${t('Choose')}…` : undefined,
    shortcut: c.shortcut,
    kind: 'command',
    score,
    cmd: c,
    recent: !c.id.startsWith('model:') && !c.id.startsWith('ai:'),
    run: c.run
  }
}

function itemRow(it: SearchItem, score: number, hits: number[], group?: string): Row {
  return {
    key: it.key,
    group: group ?? KIND_GROUP[it.kind],
    icon: it.icon,
    label: it.label,
    hits,
    sub: it.sub,
    kind: it.kind,
    score,
    item: it,
    recent: true,
    run: it.run
  }
}

function looksLikeUrl(q: string): boolean {
  const s = q.trim()
  if (!s || /\s/.test(s)) return false
  return /^https?:\/\//i.test(s) || URL_RE.test(s)
}

/** Paint matched characters gold. */
function Highlight({ text, hits }: { text: string; hits: number[] }): JSX.Element {
  if (hits.length === 0) return <>{text}</>
  const set = new Set(hits)
  const out: React.ReactNode[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i)
    if (h !== on && buf) {
      out.push(on ? <mark key={i} className="lyr-hit">{buf}</mark> : buf)
      buf = ''
    }
    on = h
    buf += text[i]
  }
  if (buf) out.push(on ? <mark key="end" className="lyr-hit">{buf}</mark> : buf)
  return <>{out}</>
}

async function generateFromLink(link: string, from: Element | null): Promise<void> {
  const url = /^https?:\/\//i.test(link) ? link : `https://${link}`
  try {
    const res = await api.createJobsBatch([{ url, ...seedOptions() }])
    if (res.created.length > 0) {
      const snap = getQueueSnapshot()
      if (!snap || (snap.processing.length === 0 && !snap.paused)) await api.resumeQueue().catch(() => {})
      refreshQueue(0)
      if (from) flyTo(from, null)
      toast({
        tone: 'success',
        icon: 'zap',
        title: t('Started'),
        body: url,
        action: { label: t('View queue'), run: () => window.dispatchEvent(new Event('open-queue')) }
      })
      return
    }
    const skip = res.skipped[0]
    if (skip?.video_id) {
      const videoId = skip.video_id
      toast({
        tone: 'info',
        title: t('Already clipped'),
        body: t('This video has clips already.'),
        action: { label: t('Open in Clip Editor'), run: () => navigate({ page: 'studio', params: { videoId } }) },
        secondary: { label: t('Open with options…'), run: () => openCreate({ link: url }) }
      })
    } else {
      toast({
        tone: 'warn',
        title: t('Couldn’t start that link'),
        body: skip?.detail || skip?.reason || undefined,
        action: { label: t('Open with options…'), run: () => openCreate({ link: url }) }
      })
    }
  } catch (e) {
    toast({
      tone: 'error',
      title: t('Couldn’t start that link'),
      body: e instanceof Error ? e.message.slice(0, 200) : undefined,
      action: { label: t('Open with options…'), run: () => openCreate({ link: url }) }
    })
  }
}

function useWide(): boolean {
  const q = '(min-width: 1100px)'
  const [wide, setWide] = useState(() => (typeof matchMedia === 'function' ? matchMedia(q).matches : true))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const on = (): void => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export default function CommandPalette(): JSX.Element | null {
  const { open, payload, close } = useLayer<{ query?: string }>('palette')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [sub, setSub] = useState<{ cmd: Command; items: Command[] | null; error?: string } | null>(null)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [previewOn, setPreviewOn] = useState(true)
  const [scrollTop, setScrollTop] = useState(0)
  const [ctxTick, setCtxTick] = useState(0)
  const wide = useWide()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optId = useId()
  const index = useSearchIndex(open)
  const deferred = useDeferredValue(query)

  // Fresh state every time it opens.
  useEffect(() => {
    if (!open) return
    setQuery(payload?.query ?? '')
    setActive(0)
    setSub(null)
    setRecent(readRecent())
    setScrollTop(0)
    refreshCommandContext()
    // the automation flag arrives a moment later: recompute once
    const id = setTimeout(() => setCtxTick((n) => n + 1), 500)
    return () => clearTimeout(id)
  }, [open, payload])

  // Parse scope prefix.
  const scopeKey = Object.keys(SCOPES).find((k) => deferred.startsWith(k)) ?? null
  const scope = scopeKey ? SCOPES[scopeKey] : null
  const q = (scopeKey ? deferred.slice(1) : deferred).trim()

  const rows = useMemo<Row[]>(() => {
    // Sub-list (Switch local model → …)
    if (sub) {
      if (!sub.items) return []
      const list = sub.items
        .map((c): Row | null => {
          const r = scoreAll(q, c.label, c.keywords)
          return r ? { ...cmdRow(c, r.score, r.hits, sub.cmd.label), sub: c.hint, icon: c.current ? ('check' as IconName) : c.icon } : null
        })
        .filter((x): x is Row => x !== null)
      if (q) list.sort((a, b) => b.score - a.score)
      return list
    }

    const cmds = allCommands()
    const out: Row[] = []
    const allow = (k: RowKind): boolean => !scope || scope.kinds.includes(k)

    if (!q) {
      if (!scope) {
        // Recent
        const byKey = new Map(cmds.map((c) => [`cmd:${c.id}`, c]))
        for (const key of recent) {
          const c = byKey.get(key)
          if (c) out.push(cmdRow(c, 0, [], 'Recent'))
          else {
            const it = findItem(key)
            if (it) out.push(itemRow(it, 0, [], 'Recent'))
          }
        }
        const recentKeys = new Set(out.map((r) => r.key))
        for (const c of cmds) if (c.group === 'Go to' && !recentKeys.has(`cmd:${c.id}`)) out.push(cmdRow(c, 0, []))
        for (const c of cmds) if (c.group === 'Actions' && !recentKeys.has(`cmd:${c.id}`)) out.push(cmdRow(c, 0, []))
        const clips = index.items
          .filter((i) => i.kind === 'clip')
          .sort((a, b) => b.at - a.at)
          .slice(0, 6)
        for (const c of clips) if (!recentKeys.has(c.key)) out.push(itemRow(c, 0, [], 'Clips'))
        return out
      }
      // scope only: everything in that scope, newest/biggest first
      if (allow('command')) for (const c of cmds) out.push(cmdRow(c, 0, []))
      const its = index.items.filter((i) => allow(i.kind)).sort((a, b) => b.at - a.at)
      for (const it of its) out.push(itemRow(it, 0, []))
      return out
    }

    // Special rows first
    if (!scope && looksLikeUrl(q)) {
      const link = q
      out.push({
        key: 'special:generate',
        group: 'Link',
        icon: 'zap',
        label: t('Generate clips from this link'),
        hits: [],
        sub: link,
        kind: 'special',
        score: 1e6,
        run: () => generateFromLink(link, listRef.current?.querySelector('[aria-selected="true"]') ?? null)
      })
      out.push({
        key: 'special:options',
        group: 'Link',
        icon: 'gear',
        label: t('Open with options…'),
        hits: [],
        sub: t('Choose captions, style and pipeline first'),
        kind: 'special',
        score: 1e6 - 1,
        run: () => openCreate({ link: /^https?:\/\//i.test(link) ? link : `https://${link}` })
      })
    }
    if (!scope && q.endsWith('?')) {
      const question = q
      out.push({
        key: 'special:ask',
        group: 'Ask',
        icon: 'sparkle',
        label: t('Ask Solaris Studio'),
        hits: [],
        sub: question,
        kind: 'special',
        score: 1e6 - 2,
        run: () => openAssistant(question)
      })
    }

    const recentBoost = new Map(recent.map((k, i) => [k, 4 - i * 0.4]))
    if (allow('command')) {
      for (const c of cmds) {
        const r = scoreAll(q, c.label, c.keywords)
        if (r) out.push(cmdRow(c, r.score + (recentBoost.get(`cmd:${c.id}`) ?? 0), r.hits))
      }
    }
    for (const it of index.items) {
      if (!allow(it.kind)) continue
      const r = scoreAll(q, it.label, it.keywords)
      if (r) out.push(itemRow(it, r.score + (recentBoost.get(it.key) ?? 0) + (it.kind === 'clip' ? (it.score ?? 0) / 100 : 0), r.hits))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, sub, recent, index.version, ctxTick, open])

  // Group, order and limit.
  const entries = useMemo<{ list: Entry[]; flat: Row[] }>(() => {
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const g = groups.get(r.group) ?? []
      g.push(r)
      groups.set(r.group, g)
    }
    const names = [...groups.keys()]
    if (q && !sub) {
      for (const g of groups.values()) g.sort((a, b) => b.score - a.score)
      names.sort((a, b) => {
        const fixed = (n: string): number => (n === 'Link' ? 0 : n === 'Ask' ? 1 : 2)
        if (fixed(a) !== fixed(b)) return fixed(a) - fixed(b)
        return (groups.get(b)?.[0]?.score ?? 0) - (groups.get(a)?.[0]?.score ?? 0)
      })
    } else {
      names.sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a)
        const ib = GROUP_ORDER.indexOf(b)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      })
    }
    const list: Entry[] = []
    const flat: Row[] = []
    for (const n of names) {
      const all = groups.get(n) ?? []
      const limit = q && !scope && !sub ? (GROUP_LIMIT[n] ?? 50) : Infinity
      const shown = all.slice(0, limit)
      list.push({ type: 'head', group: n, count: all.length })
      for (const r of shown) {
        list.push({ type: 'row', row: r, index: flat.length })
        flat.push(r)
      }
    }
    return { list, flat }
  }, [rows, q, scope, sub])

  const flat = entries.flat
  const current = flat[Math.min(active, flat.length - 1)] ?? null

  useEffect(() => {
    setActive(0)
    if (listRef.current) listRef.current.scrollTop = 0
    setScrollTop(0)
  }, [deferred, sub?.cmd.id])

  /* ---------- virtual window ---------- */
  const virtual = flat.length > VIRTUAL_AFTER
  const offsets = useMemo(() => {
    const o: number[] = []
    let y = 0
    for (const e of entries.list) {
      o.push(y)
      y += e.type === 'head' ? HEAD_H : ROW_H
    }
    o.push(y)
    return o
  }, [entries.list])

  const ensureVisible = useCallback(
    (i: number): void => {
      const el = listRef.current
      if (!el) return
      const ei = entries.list.findIndex((e) => e.type === 'row' && e.index === i)
      if (ei < 0) return
      let top = offsets[ei]
      const bottom = top + ROW_H
      // keep the group's header visible for the first row of a group
      if (ei > 0 && entries.list[ei - 1].type === 'head') top -= HEAD_H
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    },
    [entries.list, offsets]
  )

  useLayoutEffect(() => {
    if (open) ensureVisible(active)
  }, [active, open, ensureVisible])

  /* ---------- running ---------- */
  const pushRecent = (row: Row): void => {
    if (!row.recent) return
    const next = [row.key, ...recent.filter((k) => k !== row.key)].slice(0, MAX_RECENT)
    setRecent(next)
    writeRecent(next)
  }

  const openSub = (cmd: Command): void => {
    setSub({ cmd, items: null })
    setQuery('')
    cmd
      .sub?.()
      .then((items) => setSub((s) => (s && s.cmd.id === cmd.id ? { ...s, items } : s)))
      .catch((e) => setSub((s) => (s && s.cmd.id === cmd.id ? { ...s, items: [], error: e instanceof Error ? e.message : String(e) } : s)))
    inputRef.current?.focus()
  }

  const runRow = async (row: Row | null, keepOpen: boolean): Promise<void> => {
    if (!row) return
    if (row.cmd?.sub && !sub) {
      pushRecent(row)
      openSub(row.cmd)
      return
    }
    pushRecent(row)
    if (!keepOpen) close()
    try {
      await row.run()
    } catch (e) {
      toast({ tone: 'error', title: t('That didn’t work'), body: e instanceof Error ? e.message.slice(0, 200) : undefined })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const n = flat.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (n) setActive((a) => (a + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (n) setActive((a) => (a - 1 + n) % n)
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      if (n) setActive((a) => Math.min(n - 1, a + 8))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      if (n) setActive((a) => Math.max(0, a - 8))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void runRow(current, e.ctrlKey || e.metaKey)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setPreviewOn((p) => !p)
    } else if (e.key === 'Backspace' && query === '' && sub) {
      e.preventDefault()
      setSub(null)
    } else if (e.key === 'Escape' && sub) {
      // first Esc leaves the sub-list; the next closes the palette
      e.preventDefault()
      setSub(null)
      setQuery('')
    }
  }

  const showPreview = wide && previewOn
  const activeId = current ? `${optId}-${flat.indexOf(current)}` : undefined

  /* ---------- render ---------- */
  const renderRow = (row: Row, i: number, style?: React.CSSProperties): JSX.Element => {
    const sel = i === active
    return (
      <div
        key={row.key + i}
        id={`${optId}-${i}`}
        role="option"
        aria-selected={sel}
        className="lyr-pal-row"
        data-kind={row.kind}
        style={style}
        onMouseMove={() => {
          if (!sel) setActive(i)
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => void runRow(row, e.ctrlKey || e.metaKey)}
      >
        <span className="lyr-pal-icon" aria-hidden>
          <Icon name={row.icon} size={16} />
        </span>
        <span className="lyr-pal-text">
          <span className="lyr-pal-label">
            <Highlight text={row.label} hits={row.hits} />
          </span>
          {row.sub && <span className="lyr-pal-sub">{row.sub}</span>}
        </span>
        {row.cmd?.current && <span className="lyr-pal-tag">{t('Active')}</span>}
        {row.cmd?.sub && !sub && <Icon name="chevron-right" size={14} className="lyr-pal-chev" />}
        {row.shortcut && <Kbd keys={row.shortcut} className="lyr-pal-kbd" />}
        {sel && (
          <span className="lyr-pal-enter" aria-hidden>
            ↵
          </span>
        )}
      </div>
    )
  }

  const renderList = (): React.ReactNode => {
    if (sub && !sub.items) {
      return (
        <div className="lyr-pal-loading" role="status">
          <span className="lyr-spinner" aria-hidden />
          {t('Loading…')}
        </div>
      )
    }
    if (flat.length === 0) {
      return (
        <div className="lyr-pal-empty">
          <EmptyState
            compact
            illustration="search"
            title={sub?.error ? t('Couldn’t load the list') : q ? `${t('Nothing matches')} “${q}”` : t('Nothing here yet')}
            body={sub?.error ? sub.error.slice(0, 160) : index.loading ? t('Still indexing your library…') : t('Try fewer letters, or ask in plain words.')}
            action={
              q && !sub ? (
                <button
                  type="button"
                  className="btn-ghost lyr-pal-ask"
                  onClick={() => {
                    close()
                    openAssistant(q)
                  }}
                >
                  <Icon name="sparkle" size={15} /> {t('Ask Solaris Studio')}
                </button>
              ) : undefined
            }
          />
        </div>
      )
    }
    if (!virtual) {
      let rowN = 0
      return entries.list.map((e) =>
        e.type === 'head' ? (
          <div key={`h-${e.group}`} className="lyr-pal-head" role="presentation">
            <span>{t(GROUP_LABEL[e.group] ?? e.group)}</span>
            {e.count > 1 && <span className="lyr-pal-count tabular">{e.count}</span>}
          </div>
        ) : (
          renderRow(e.row, e.index, { '--i': Math.min(rowN++, 12) } as React.CSSProperties)
        )
      )
    }
    // windowed
    const viewH = listRef.current?.clientHeight ?? 440
    const from = scrollTop - 300
    const to = scrollTop + viewH + 300
    const out: React.ReactNode[] = []
    for (let k = 0; k < entries.list.length; k++) {
      const y = offsets[k]
      if (y + ROW_H < from) continue
      if (y > to) break
      const e = entries.list[k]
      const style: React.CSSProperties = { position: 'absolute', top: y, left: 0, right: 0 }
      out.push(
        e.type === 'head' ? (
          <div key={`h-${e.group}`} className="lyr-pal-head" role="presentation" style={style}>
            <span>{t(GROUP_LABEL[e.group] ?? e.group)}</span>
            <span className="lyr-pal-count tabular">{e.count}</span>
          </div>
        ) : (
          renderRow(e.row, e.index, style)
        )
      )
    }
    return <div style={{ position: 'relative', height: offsets[offsets.length - 1] }}>{out}</div>
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('Search and commands')}
      hideTitle
      size="lg"
      initialFocus=".lyr-pal-input"
      className="lyr-palette"
    >
      <div className="lyr-pal" data-preview={showPreview ? 'true' : 'false'}>
        <div className="lyr-pal-main">
          <div className="lyr-pal-bar">
            <Icon name="search" size={18} className="lyr-pal-glass" />
            {sub && (
              <button type="button" className="lyr-pal-scope" onClick={() => setSub(null)} title={t('Back')}>
                <Icon name="chevron-left" size={13} />
                {sub.cmd.label}
              </button>
            )}
            {!sub && scope && (
              <span className="lyr-pal-scope" aria-hidden>
                <Icon name={scope.icon} size={13} />
                {t(scope.label)}
              </span>
            )}
            <input
              ref={inputRef}
              className="lyr-pal-input"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={t('Search or run a command…')}
              autoComplete="off"
              spellCheck={false}
              placeholder={sub ? t('Filter…') : t('Search clips, pages and actions, or paste a link…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {index.loading && open && (
              <span className="lyr-pal-indexing" title={t('Indexing your library…')}>
                <span className="lyr-spinner" aria-hidden />
                <span className="sr-only">{t('Indexing your library…')}</span>
              </span>
            )}
            <Kbd keys={['Esc']} className="lyr-pal-esc" />
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('Results')}
            className="lyr-pal-list"
            onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
          >
            <div className={virtual ? undefined : 'lyr-pal-rows'} key={`${sub?.cmd.id ?? ''}|${scopeKey ?? ''}`}>
              {renderList()}
            </div>
          </div>

          <div className="lyr-pal-foot" aria-hidden>
            <span>
              <Kbd keys={['↑', '↓']} /> {t('move')}
            </span>
            <span>
              <Kbd keys={['↵']} /> {t('open')}
            </span>
            <span>
              <Kbd keys={['Ctrl', '↵']} /> {t('keep open')}
            </span>
            {wide && (
              <span>
                <Kbd keys={['Tab']} /> {t('preview')}
              </span>
            )}
            <span className="lyr-pal-prefixes">
              {Object.entries(SCOPES).map(([k, s]) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={-1}
                  className="lyr-pal-prefix"
                  data-on={scopeKey === k ? 'true' : 'false'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSub(null)
                    setQuery(scopeKey === k ? q : k + q)
                    inputRef.current?.focus()
                  }}
                  title={t(s.label)}
                >
                  <b>{k}</b> {t(s.label)}
                </button>
              ))}
            </span>
          </div>
        </div>

        {showPreview && (
          <aside className="lyr-pal-preview" aria-live="polite">
            <Preview row={current} />
          </aside>
        )}
      </div>
    </Dialog>
  )
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

/** The right-hand pane: a poster for clips, stats for creators. */
function Preview({ row }: { row: Row | null }): JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (!row) {
    return (
      <div className="lyr-prev-idle">
        <Icon name="command" size={28} />
        <p>{t('Everything in Solaris Studio, one search away.')}</p>
      </div>
    )
  }
  const it = row.item
  if (it && (it.kind === 'clip' || it.kind === 'video') && it.poster && broken !== it.poster) {
    return (
      <div className="lyr-prev lyr-prev-media" key={row.key}>
        <div className="lyr-prev-poster">
          <img src={it.poster} alt="" onError={() => setBroken(it.poster ?? null)} />
          {typeof it.score === 'number' && <span className="lyr-prev-score tabular">{Math.round(it.score)}</span>}
          {typeof it.duration === 'number' && <span className="lyr-prev-dur tabular">{fmtDur(it.duration)}</span>}
        </div>
        <p className="lyr-prev-title">{it.label}</p>
        {it.sub && <p className="lyr-prev-sub">{it.sub}</p>}
        {it.creatorId !== undefined && creatorName(it.creatorId) && <p className="lyr-prev-sub">{creatorName(it.creatorId)}</p>}
        <p className="lyr-prev-hint">
          <Kbd keys={['↵']} /> {t('Open in Clip Editor')}
        </p>
      </div>
    )
  }
  if (it && it.kind === 'creator' && it.stats) {
    const s = it.stats
    return (
      <div className="lyr-prev" key={row.key}>
        <Avatar seed={it.creatorId ?? it.label} name={it.label} size={72} className="lyr-prev-avatar" />
        <p className="lyr-prev-title">{it.label}</p>
        {s.accounts.length > 0 && <p className="lyr-prev-sub">{[...new Set(s.accounts)].join(' · ')}</p>}
        <div className="lyr-prev-stats">
          <div>
            <b className="tabular">{s.videos}</b>
            <span>{t('videos')}</span>
          </div>
          <div>
            <b className="tabular">{s.clips}</b>
            <span>{t('clips')}</span>
          </div>
          <div>
            <b className="tabular">{s.avgScore === null ? '–' : Math.round(s.avgScore)}</b>
            <span>{t('avg score')}</span>
          </div>
        </div>
        <p className="lyr-prev-hint">
          <Kbd keys={['↵']} /> {t('Open profile')}
        </p>
      </div>
    )
  }
  const page = row.cmd?.id.startsWith('go:') ? PAGES.find((p) => `go:${p.id}` === row.cmd?.id) : undefined
  return (
    <div className="lyr-prev" key={row.key}>
      <span className="lyr-prev-glyph" aria-hidden>
        <Icon name={row.icon} size={30} />
      </span>
      <p className="lyr-prev-title">{row.label}</p>
      {(row.cmd?.hint || (page && t(page.caption)) || row.sub) && (
        <p className="lyr-prev-sub">{row.cmd?.hint ?? (page ? t(page.caption) : row.sub)}</p>
      )}
      {row.shortcut && (
        <p className="lyr-prev-hint">
          <Kbd keys={row.shortcut} />
        </p>
      )}
      {row.cmd?.sub && <p className="lyr-prev-hint">{t('Press Enter to choose from a list.')}</p>}
    </div>
  )
}
