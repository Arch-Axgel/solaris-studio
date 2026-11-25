import { useCallback, useSyncExternalStore } from 'react'
import { Icon, type IconName } from '../icons'
import { Popover } from '../ui'
import { t } from '../../lib/i18n'
import type { JobOptions } from '../../lib/types'
import { PRESET_KEY, readKey, writeKey } from './homeUtil'

/** The five starting points for a video: Shorts, Vertical Live, Gaming,
 *  Podcast and Longform. Each one is an options bundle laid over the Generate
 *  bar's remembered settings (seedOptions()), and each chip explains itself in
 *  a "What changes" popover. Shared by Home, the Create page and the Create
 *  sheet (B2). */

export type PresetId = 'shorts' | 'vertical_live' | 'gaming' | 'podcast' | 'longform'

export interface Preset {
  id: PresetId
  label: string
  icon: IconName
  blurb: string
  changes: string[]
}

export const PRESETS: Preset[] = [
  {
    id: 'shorts',
    label: 'Shorts',
    icon: 'film',
    blurb: 'Vertical 9:16 clips for Shorts, Reels and TikTok.',
    changes: [
      'Finds the strongest moments and crops them to 9:16.',
      'Follows the speaker’s face so they stay in frame.',
      'Turns off Vertical Live, Gaming, Podcast and Longform.',
      'Captions, style and watermark stay as you last set them.'
    ]
  },
  {
    id: 'vertical_live',
    label: 'Vertical Live',
    icon: 'live',
    blurb: 'For a stream that was already filmed 9:16.',
    changes: [
      'Keeps the live’s own vertical layout instead of re-cropping it.',
      'Skips face tracking, which a vertical stream does not need.',
      'Turns off Gaming, Podcast and Longform.'
    ]
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: 'zap',
    blurb: 'Webcam over the game, or a reaction over the video.',
    changes: [
      'Splits the frame: the streamer’s webcam above the game.',
      'Scores in-game moments and the reactions to them, even when little is said.',
      'Turns off Vertical Live, Podcast, Longform and Sports.'
    ]
  },
  {
    id: 'podcast',
    label: 'Podcast',
    icon: 'chat',
    blurb: 'Several people talking, one or more cameras.',
    changes: [
      'Reframes to whoever is speaking as the conversation moves.',
      'Favours complete thoughts and good back-and-forth.',
      'Turns off Vertical Live, Gaming, Longform and Sports.'
    ]
  },
  {
    id: 'longform',
    label: 'Longform',
    icon: 'maximize',
    blurb: 'Horizontal 16:9 clips, highlights or an edited stream.',
    changes: [
      'Keeps the original 16:9 frame instead of cropping to vertical.',
      'Output type stays as you last chose it (Short Clips unless changed).',
      'Turns off Vertical Live, Gaming and Podcast.',
      'Not combined with Rate & understand, Suggest edits or a Pipeline.'
    ]
  }
]

const IDS = new Set<string>(PRESETS.map((p) => p.id))

/* ---------- the remembered choice (solaris.ui.home.preset) ---------- */

const listeners = new Set<() => void>()
let current: PresetId = (() => {
  const v = readKey(PRESET_KEY)
  return v && IDS.has(v) ? (v as PresetId) : 'shorts'
})()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getPreset(): PresetId {
  return current
}

export function setPreset(id: PresetId): void {
  if (!IDS.has(id) || id === current) return
  current = id
  writeKey(PRESET_KEY, id)
  listeners.forEach((l) => l())
}

/** The remembered preset, shared by every PresetChips on screen. */
export function usePreset(): [PresetId, (id: PresetId) => void] {
  const v = useSyncExternalStore(subscribe, () => current, () => current)
  return [v, setPreset]
}

/* ---------- what each preset does to a job's options ---------- */

/** `base` (normally seedOptions()) with the preset laid over it. Layout modes
 *  are mutually exclusive, so every preset first clears all of them, then
 *  switches its own on, following the same rules as the Generate bar. */
export function applyPreset(base: JobOptions, id: PresetId): JobOptions {
  const o: JobOptions = { ...base }
  const prevLongform = o.longform
  delete o.podcast
  delete o.vertical_live
  delete o.gaming_scoring
  delete o.gaming
  delete o.gaming_layout
  delete o.gaming_remember
  delete o.longform
  if (id === 'vertical_live') o.vertical_live = true
  else if (id === 'gaming') {
    o.gaming = true
    delete o.sport
  } else if (id === 'podcast') {
    o.podcast = true
    delete o.sport
  } else if (id === 'longform') {
    o.longform = prevLongform ? { ...prevLongform } : { mode: 'short_clips' }
    // Longform picks and writes its clips its own way.
    delete o.rate
    delete o.understand
    delete o.edit
    delete o.pipeline
  }
  return o
}

/** Make the preset the Generate bar's remembered starting point: the same
 *  switches it remembers when you tick them yourself, so a freshly opened bar
 *  (or its next empty row) starts from this preset. Videos already in the
 *  list keep their own settings. */
export function applyPresetToGenerateBar(id: PresetId): void {
  const set = (key: string, on: boolean): void => {
    try {
      localStorage.setItem(key, String(on))
    } catch {
      /* not remembered; the chip still applies on Home */
    }
  }
  set('generate-podcast', id === 'podcast')
  set('generate-vertical-live', id === 'vertical_live')
  set('generate-gaming', id === 'gaming')
  set('generate-longform', id === 'longform')
  if (id === 'gaming' || id === 'podcast') set('generate-sport', false)
  if (id === 'longform') {
    try {
      localStorage.removeItem('generate-edit')
    } catch {
      /* ignore */
    }
  }
}

/** Which preset the Generate bar's remembered switches currently match. */
export function presetFromGenerateBar(): PresetId {
  const on = (key: string): boolean => {
    try {
      return localStorage.getItem(key) === 'true'
    } catch {
      return false
    }
  }
  if (on('generate-podcast')) return 'podcast'
  if (on('generate-longform')) return 'longform'
  if (on('generate-vertical-live')) return 'vertical_live'
  if (on('generate-gaming')) return 'gaming'
  return 'shorts'
}

/* ---------- the chips ---------- */

/** A row of preset chips. Uncontrolled by default (the shared remembered
 *  choice); pass value/onChange to control it. `applyToGenerateBar` also
 *  writes the Generate bar's remembered switches on every pick, and
 *  `onApplied` runs after, so a host can remount its AddVideos. */
export default function PresetChips({
  value,
  onChange,
  applyToGenerateBar = false,
  onApplied,
  size = 'md',
  className
}: {
  value?: PresetId
  onChange?: (id: PresetId) => void
  applyToGenerateBar?: boolean
  onApplied?: (id: PresetId) => void
  size?: 'sm' | 'md'
  className?: string
}): JSX.Element {
  const [remembered, setRemembered] = usePreset()
  const selected = value ?? remembered

  const pick = useCallback(
    (id: PresetId): void => {
      if (onChange) onChange(id)
      else setRemembered(id)
      if (applyToGenerateBar) applyPresetToGenerateBar(id)
      onApplied?.(id)
    },
    [onChange, setRemembered, applyToGenerateBar, onApplied]
  )

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = PRESETS.findIndex((p) => p.id === selected)
    const next = PRESETS[(i + (e.key === 'ArrowRight' ? 1 : PRESETS.length - 1)) % PRESETS.length]
    e.preventDefault()
    pick(next.id)
    requestAnimationFrame(() => {
      const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>(`[data-preset="${next.id}"]`)
      el?.focus()
    })
  }

  return (
    <div
      className={`home-presets home-presets-${size} ${className ?? ''}`}
      role="radiogroup"
      aria-label={t('Preset')}
      onKeyDown={onKey}
    >
      {PRESETS.map((p) => {
        const on = p.id === selected
        return (
          <div key={p.id} className="home-preset" data-on={on ? 'true' : 'false'}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-preset={p.id}
              className="home-preset-main"
              onClick={() => pick(p.id)}
              title={t(p.blurb)}
            >
              <Icon name={p.icon} size={size === 'sm' ? 14 : 16} />
              <span>{t(p.label)}</span>
              {on && (
                <svg className="home-preset-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path className="draw" pathLength={24} d="m4.5 12.5 5 5L20 7" />
                </svg>
              )}
            </button>
            <Popover
              width={300}
              align="start"
              trigger={(tp) => (
                <button
                  ref={tp.ref}
                  type="button"
                  className="home-preset-info"
                  aria-expanded={tp['aria-expanded']}
                  aria-label={`${t('What changes')}: ${t(p.label)}`}
                  onClick={tp.onClick}
                >
                  <Icon name="info" size={13} />
                </button>
              )}
            >
              {(close) => (
                <div className="home-preset-pop">
                  <p className="t-micro">{t('What changes')}</p>
                  <p className="text-sm text-ink font-medium mt-1 flex items-center gap-2">
                    <Icon name={p.icon} size={16} className="text-gold" />
                    {t(p.label)}
                  </p>
                  <p className="text-xs text-muted mt-1">{t(p.blurb)}</p>
                  <ul className="home-preset-list">
                    {p.changes.map((c) => (
                      <li key={c}>
                        <Icon name="check" size={12} />
                        <span>{t(c)}</span>
                      </li>
                    ))}
                  </ul>
                  {!on && (
                    <button
                      type="button"
                      className="btn-ghost ui-btn ui-btn-sm mt-3 w-full"
                      onClick={() => {
                        pick(p.id)
                        close()
                      }}
                    >
                      {t('Use this preset')}
                    </button>
                  )}
                </div>
              )}
            </Popover>
          </div>
        )
      })}
    </div>
  )
}
