import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_BASE } from '../../lib/api'
import { t } from '../../lib/i18n'
import { motionReduced } from '../../lib/motion'
import type { IconName } from '../icons'

/** Small helpers shared by the Home hub tiles (B3). */

/** t() with {name} placeholders filled in after translation. */
export function tf(s: string, vars: Record<string, string | number>): string {
  return t(s).replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

/* ---------- storage (every access guarded; keys start with solaris.ui.) ---------- */

export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage refused: it lasts this session only */
  }
}

export const QUEST_DISMISSED_KEY = 'solaris.ui.quest.dismissed'
export const QUEST_OPENED_EDITOR_KEY = 'solaris.ui.quest.openedEditor'
export const PRESET_KEY = 'solaris.ui.home.preset'
export const RECENT_FILTER_KEY = 'solaris.ui.home.recentFilter'

/* ---------- platforms ---------- */

export type Platform = 'youtube' | 'twitch' | 'kick'

export const PLATFORM_META: Record<Platform, { label: string; icon: IconName }> = {
  youtube: { label: 'YouTube', icon: 'youtube' },
  twitch: { label: 'Twitch', icon: 'twitch' },
  kick: { label: 'Kick', icon: 'kick' }
}

export function detectPlatform(text: string): Platform | null {
  if (/(youtube\.com|youtu\.be)/i.test(text)) return 'youtube'
  if (/twitch\.tv/i.test(text)) return 'twitch'
  if (/kick\.com/i.test(text)) return 'kick'
  return null
}

/** A pasted link, tidied: a bare "youtu.be/…" gets https:// in front. Null when
 *  it can't be a web address at all. */
export function normaliseLink(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/* ---------- formatting ---------- */

export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function duration(seconds: number): string {
  if (!seconds || seconds < 1) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second')
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  return rtf.format(Math.round(diff / 86_400_000), 'day')
}

export function parseTime(s: string | null | undefined): number {
  if (!s) return NaN
  // The engine writes "YYYY-MM-DD HH:MM:SS" (UTC) as well as ISO strings.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : NaN
}

/** Per-day buckets for the last `days` days (oldest first), summing `weight`. */
export function dailyBuckets<T>(items: T[], at: (x: T) => number, weight: (x: T) => number, days = 14): number[] {
  const out = new Array(days).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (days - 1) * 86_400_000
  for (const it of items) {
    const ms = at(it)
    if (!Number.isFinite(ms) || ms < start) continue
    const i = Math.floor((ms - start) / 86_400_000)
    if (i >= 0 && i < days) out[i] += weight(it)
  }
  return out
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return t('Burning the midnight oil')
  if (h < 12) return t('Good morning')
  if (h < 18) return t('Good afternoon')
  return t('Good evening')
}

/** The rendered clip (always there once a clip exists). The draft preview at
 *  /media/preview/{id} only exists after an editor preview, so it is opt-in. */
export function clipVideoUrl(clipId: number, src: 'media' | 'preview' = 'media'): string {
  return src === 'preview' ? `${API_BASE}/media/preview/${clipId}` : api.mediaUrl(clipId)
}

/* Hover preview: use useHoverPreview / ClipPoster from components/library/HoverPreview. */

/** Re-render every `ms` while `on` (for countdowns). */
export function useTicker(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return now
}
