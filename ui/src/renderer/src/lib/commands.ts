import { useEffect, useRef } from 'react'
import type { IconName } from '../components/icons'
import { confirmDialog } from '../components/ui/Confirm'
import { toast } from '../components/ui/Toast'
import { api } from './api'
import { t } from './i18n'
import { PAGES, currentRoute, navigate, openAssistant, openCreate, openFeedback, openLayer, openSettings, type SettingsSection } from './nav'
import { canManage, openMarketplace, plugins } from './plugins'
import { getQueueSnapshot, refreshQueue } from './stores/queueStore'
import { usePageActive } from './stores/useVisible'
import { canConnectYoutube, getYoutubeStatus, hasYoutubeApi, openYoutubeConnect, youtubeAccount } from './stores/youtubeAccount'
import { getUiPrefs, setUiPrefs, toggleRail } from './uiPrefs'

/** Commands for the palette (spec 4.16).
 *
 *  Built-in commands (every page, every Settings section, the global
 *  actions) are produced fresh on each read so their labels follow the
 *  current language and state (Pause vs Resume). Pages add their own with
 *  useCommands() while they are the active page. */

export interface Command {
  id: string
  label: string
  group: 'Go to' | 'Actions' | 'Settings'
  icon: IconName
  keywords?: string[]
  shortcut?: string[]
  when?: () => boolean
  run: () => void | Promise<void>
  /** One line shown in the palette's preview pane. */
  hint?: string
  /** A sub-list: Enter opens these instead of running `run`. */
  sub?: () => Promise<Command[]>
  /** Marks the current choice in a sub-list. */
  current?: boolean
}

const registered = new Map<number, Command[]>()
let seq = 0

/** Add commands until the returned function is called. */
export function registerCommands(cmds: Command[]): () => void {
  const id = ++seq
  registered.set(id, cmds)
  return () => {
    registered.delete(id)
  }
}

/** Page-scoped registration: the commands exist while the page is active. */
export function useCommands(cmds: Command[], deps: unknown[]): void {
  const active = usePageActive()
  const latest = useRef(cmds)
  latest.current = cmds
  useEffect(() => {
    if (!active) return
    return registerCommands(latest.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}

/** Every command whose `when` allows it right now. */
export function allCommands(): Command[] {
  const list = [...builtinCommands()]
  for (const cmds of registered.values()) list.push(...cmds)
  const seen = new Set<string>()
  return list.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    try {
      return c.when ? c.when() : true
    } catch {
      return false
    }
  })
}

/* ---------- context the built-ins read (refreshed when the palette opens) ---------- */

let automationEnabled: boolean | null = null

/** Re-read the bits of state that decide which built-ins show. Cheap; called
 *  by the palette each time it opens. */
export function refreshCommandContext(): void {
  refreshQueue(0)
  void youtubeAccount.refreshStatus()
  api
    .automation()
    .then((a) => {
      automationEnabled = a.enabled
    })
    .catch(() => {
      automationEnabled = null
    })
}

/* ---------- helpers ---------- */

function message(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  // engine wording from older routes may name internals; keep shell copy clean
  return /plugin/i.test(s) ? t('The engine refused the request.') : s.slice(0, 200)
}

function fail(title: string): (e: unknown) => void {
  return (e) => {
    toast({ tone: 'error', title, body: message(e) })
  }
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

const SECTION_LABEL: Record<SettingsSection, string> = {
  general: 'General',
  appearance: 'Appearance',
  notifications: 'Notifications',
  ai: 'AI',
  publishing: 'Publishing',
  downloads: 'Downloads',
  storage: 'Storage',
  branding: 'Branding',
  updates: 'Updates',
  advanced: 'Advanced'
}

const SECTION_KEYWORDS: Record<SettingsSection, string[]> = {
  general: ['language', 'preferences'],
  appearance: ['theme', 'motion', 'effects', 'density', 'scale', 'animation'],
  notifications: ['alerts', 'sound', 'toast'],
  ai: ['provider', 'openrouter', 'model', 'key', 'cloud', 'transcription'],
  publishing: ['youtube', 'tiktok', 'instagram', 'woopsocial', 'upload-post', 'accounts', 'connect'],
  downloads: ['folder', 'export', 'save'],
  storage: ['disk', 'space', 'cleanup'],
  branding: ['watermark', 'logo', 'captions', 'style'],
  updates: ['version', 'store', 'upgrade'],
  advanced: ['remote', 'render', 'debug', 'developer']
}

/* ---------- built-ins ---------- */

function builtinCommands(): Command[] {
  const snap = getQueueSnapshot()
  const prefs = getUiPrefs()
  const cmds: Command[] = []

  for (const p of PAGES) {
    cmds.push({
      id: `go:${p.id}`,
      label: t(p.label),
      group: 'Go to',
      icon: p.icon,
      keywords: [t(p.caption), p.id === 'studio' ? 'library clips edit export' : '', p.id === 'dashboard' ? 'new generate make' : ''].filter(
        Boolean
      ),
      shortcut: p.chord.split(' '),
      hint: t(p.caption),
      run: () => navigate({ page: p.id })
    })
  }
  for (const s of Object.keys(SECTION_LABEL) as SettingsSection[]) {
    cmds.push({
      id: `settings:${s}`,
      label: `${t('Settings')} › ${t(SECTION_LABEL[s])}`,
      group: 'Settings',
      icon: 'gear',
      keywords: SECTION_KEYWORDS[s],
      run: () => openSettings(s)
    })
  }

  cmds.push(
    {
      id: 'act:new-clips',
      label: t('New clips…'),
      group: 'Actions',
      icon: 'plus',
      keywords: ['create', 'generate', 'paste', 'link', 'video'],
      shortcut: ['Ctrl', 'N'],
      hint: t('Paste links or drop files, then generate.'),
      run: () => openCreate()
    },
    {
      id: 'act:pause-queue',
      label: t('Pause queue'),
      group: 'Actions',
      icon: 'pause',
      keywords: ['stop', 'hold'],
      when: () => snap?.paused !== true,
      hint: t('The running video finishes; nothing new starts.'),
      run: () =>
        api
          .pauseQueue()
          .then(() => {
            refreshQueue(0)
            toast({ tone: 'info', icon: 'pause', title: t('Queue paused') })
          })
          .catch(fail(t('Couldn’t pause the queue')))
    },
    {
      id: 'act:resume-queue',
      label: t('Resume queue'),
      group: 'Actions',
      icon: 'play',
      keywords: ['start', 'continue', 'unpause'],
      when: () => snap?.paused !== false,
      run: () =>
        api
          .resumeQueue()
          .then(() => {
            refreshQueue(0)
            toast({ tone: 'success', icon: 'play', title: t('Queue resumed') })
          })
          .catch(fail(t('Couldn’t resume the queue')))
    },
    {
      id: 'act:clear-completed',
      label: t('Clear completed'),
      group: 'Actions',
      icon: 'check',
      keywords: ['queue', 'done', 'finished', 'remove'],
      when: () => !snap || snap.completed.length > 0,
      hint: t('Removes finished rows from the queue. Your clips stay.'),
      run: async () => {
        const ok = await confirmDialog({
          title: t('Clear completed videos from the queue?'),
          body: t('Only the queue rows go. Every clip stays in the Clip Editor.'),
          confirmLabel: t('Clear completed')
        })
        if (!ok) return
        await api
          .clearQueue('completed')
          .then((r) => {
            refreshQueue(0)
            toast({ tone: 'success', title: t('Cleared'), body: `${r.deleted} ${t('rows removed')}` })
          })
          .catch(fail(t('Couldn’t clear the queue')))
      }
    },
    {
      id: 'act:clear-failed',
      label: t('Clear failed'),
      group: 'Actions',
      icon: 'trash',
      keywords: ['queue', 'errors', 'remove'],
      when: () => !snap || snap.failed.length > 0,
      run: async () => {
        const ok = await confirmDialog({
          title: t('Clear failed videos from the queue?'),
          body: t('They won’t be retried. You can add the links again later.'),
          confirmLabel: t('Clear failed'),
          tone: 'danger'
        })
        if (!ok) return
        await api
          .clearQueue('failed')
          .then((r) => {
            refreshQueue(0)
            toast({ tone: 'success', title: t('Cleared'), body: `${r.deleted} ${t('rows removed')}` })
          })
          .catch(fail(t('Couldn’t clear the queue')))
      }
    },
    {
      id: 'act:check-watches',
      label: t('Check all watched channels now'),
      group: 'Actions',
      icon: 'radar',
      keywords: ['watch', 'poll', 'refresh', 'channels', 'new videos'],
      run: async () => {
        try {
          const list = (await api.watches()).filter((w) => w.enabled)
          if (list.length === 0) {
            toast({ tone: 'info', title: t('No channels are being watched'), action: { label: t('Add one'), run: () => navigate({ page: 'watch' }) } })
            return
          }
          await Promise.allSettled(list.map((w) => api.checkWatch(w.id)))
          toast({ tone: 'success', icon: 'radar', title: t('Checking your channels'), body: `${list.length} ${list.length === 1 ? t('channel') : t('channels')}` })
        } catch (e) {
          fail(t('Couldn’t check the channels'))(e)
        }
      }
    },
    {
      id: 'act:auto-on',
      label: t('Turn auto-clipping on'),
      group: 'Actions',
      icon: 'zap',
      keywords: ['automation', 'watch', 'enable'],
      when: () => automationEnabled !== true,
      run: () =>
        api
          .setAutomation({ enabled: true })
          .then(() => {
            automationEnabled = true
            toast({ tone: 'success', icon: 'zap', title: t('Auto-clipping is on') })
          })
          .catch(fail(t('Couldn’t change auto-clipping')))
    },
    {
      id: 'act:auto-off',
      label: t('Turn auto-clipping off'),
      group: 'Actions',
      icon: 'ban',
      keywords: ['automation', 'watch', 'disable', 'stop'],
      when: () => automationEnabled !== false,
      run: () =>
        api
          .setAutomation({ enabled: false })
          .then(() => {
            automationEnabled = false
            toast({ tone: 'info', icon: 'ban', title: t('Auto-clipping is off') })
          })
          .catch(fail(t('Couldn’t change auto-clipping')))
    },
    {
      id: 'act:switch-model',
      label: t('Switch local model'),
      group: 'Actions',
      icon: 'cpu',
      keywords: ['ollama', 'llm', 'ai', 'gemma', 'qwen'],
      hint: t('Choose which downloaded model picks your clips.'),
      run: () => navigate({ page: 'models' }),
      sub: async () => {
        const info = await api.models()
        return info.installed.map((m) => ({
          id: `model:${m.name}`,
          label: m.name,
          group: 'Actions' as const,
          icon: 'cpu' as IconName,
          current: m.name === info.active,
          hint: `${m.size_gb.toFixed(1)} GB${m.name === info.active ? ` · ${t('Active')}` : ''}`,
          run: () =>
            api
              .activateModel(m.name)
              .then(() => {
                toast({ tone: 'success', icon: 'cpu', title: t('Model switched'), body: m.name })
              })
              .catch(fail(t('Couldn’t switch the model')))
        }))
      }
    },
    {
      id: 'act:switch-ai',
      label: t('Switch AI provider'),
      group: 'Actions',
      icon: 'sparkle',
      keywords: ['cloud', 'openrouter', 'local', 'provider', 'key'],
      hint: t('This PC or a connected cloud provider.'),
      run: () => openSettings('ai'),
      sub: async () => {
        const ai = await api.ai()
        return ai.providers
          .filter((p) => p.local || p.has_key)
          .map((p) => ({
            id: `ai:${p.id}`,
            label: p.label,
            group: 'Actions' as const,
            icon: (p.local ? 'cpu' : 'sparkle') as IconName,
            current: ai.active.provider === p.id,
            hint: p.tagline,
            run: () =>
              api
                .activateAI(p.id)
                .then(() => {
                toast({ tone: 'success', icon: 'sparkle', title: t('AI provider switched'), body: p.label })
              })
                .catch(fail(t('Couldn’t switch the provider')))
          }))
      }
    },
    {
      id: 'act:cleanup',
      label: t('Clean up storage'),
      group: 'Actions',
      icon: 'hard-drive',
      keywords: ['disk', 'space', 'free', 'delete', 'temporary'],
      hint: t('Removes leftover downloads and temporary files. Clips are kept.'),
      run: () =>
        api
          .storageCleanup()
          .then((r) => {
            toast({
              tone: 'success',
              icon: 'hard-drive',
              title: r.bytes_freed > 0 ? `${t('Freed')} ${formatSize(r.bytes_freed)}` : t('Nothing to clean up'),
              body: r.files_removed > 0 ? `${r.files_removed} ${t('files removed')}` : undefined
            })
          })
          .catch(fail(t('Couldn’t clean up')))
    },
    {
      id: 'act:refresh-marketplace',
      label: t('Refresh Marketplace'),
      group: 'Actions',
      icon: 'refresh',
      keywords: ['add-ons', 'pipelines', 'listings', 'update'],
      run: async () => {
        if (!(await canManage())) {
          toast({ tone: 'warn', title: t('Refreshing the Marketplace needs the desktop app.') })
          return
        }
        await plugins
          .refresh(false)
          .then(() => {
                toast({ tone: 'success', icon: 'store', title: t('Marketplace refreshed') })
              })
          .catch(fail(t('Couldn’t refresh the Marketplace')))
      }
    },
    {
      id: 'act:woop-refresh',
      label: t('Check stuck social posts'),
      group: 'Actions',
      icon: 'send',
      keywords: ['woopsocial', 'processing', 'publish', 'scheduled', 'social'],
      run: async () => {
        try {
          const s = await api.woopSocialStatus()
          if (!s.enabled && !s.has_key) {
            toast({ tone: 'info', title: t('WoopSocial isn’t connected'), action: { label: t('Connect'), run: () => openSettings('publishing') } })
            return
          }
          const r = await api.woopSocialRefresh()
          toast({
            tone: r.failed > 0 ? 'warn' : 'success',
            icon: 'send',
            title: `${t('Checked')} ${r.checked}`,
            body: `${r.updated} ${t('updated')} · ${r.still_waiting} ${t('still waiting')}${r.failed ? ` · ${r.failed} ${t('failed')}` : ''}`
          })
        } catch (e) {
          fail(t('Couldn’t check the posts'))(e)
        }
      }
    },
    {
      id: 'act:installed-addons',
      label: t('Installed add-ons'),
      group: 'Actions',
      icon: 'store',
      keywords: ['marketplace', 'pipelines', 'installed'],
      run: () => openMarketplace('installed')
    },
    {
      id: 'act:ask',
      label: t('Ask Solaris Studio…'),
      group: 'Actions',
      icon: 'sparkle',
      keywords: ['assistant', 'chat', 'ai', 'help'],
      shortcut: ['Ctrl', 'J'],
      run: () => openAssistant()
    },
    {
      id: 'act:activity',
      label: t('Open activity'),
      group: 'Actions',
      icon: 'bell',
      keywords: ['notifications', 'log', 'history', 'events'],
      shortcut: ['Ctrl', 'Shift', 'A'],
      run: () => openLayer('activity')
    },
    {
      id: 'act:help',
      label: t('Help for this page'),
      group: 'Actions',
      icon: 'help',
      keywords: ['how', 'guide', 'glossary'],
      shortcut: ['F1'],
      run: () => openLayer('help', { page: currentRoute().page })
    },
    {
      id: 'act:feedback',
      label: t('Report a problem'),
      group: 'Actions',
      icon: 'bug',
      keywords: ['bug', 'feedback', 'issue', 'support'],
      run: () => openFeedback()
    },
    {
      id: 'act:setup',
      label: t('Re-run setup'),
      group: 'Actions',
      icon: 'wand',
      keywords: ['wizard', 'install', 'ollama', 'first run'],
      run: () => {
        window.dispatchEvent(new Event('open-setup-wizard'))
      }
    },
    {
      id: 'act:shortcuts',
      label: t('Show keyboard shortcuts'),
      group: 'Actions',
      icon: 'keyboard',
      keywords: ['keys', 'hotkeys'],
      shortcut: ['?'],
      run: () => openLayer('shortcuts')
    },
    {
      id: 'act:rail',
      label: prefs.railPinned ? t('Collapse the sidebar') : t('Expand the sidebar'),
      group: 'Actions',
      icon: 'panel-right',
      keywords: ['rail', 'navigation', 'toggle'],
      shortcut: ['Ctrl', 'B'],
      run: () => toggleRail()
    },
    {
      id: 'act:motion',
      label: prefs.motion === 'on' ? t('Stop reducing motion') : t('Reduce motion'),
      group: 'Actions',
      icon: 'orbit',
      keywords: ['animation', 'accessibility', 'calm'],
      run: () => {
        const on = getUiPrefs().motion !== 'on'
        setUiPrefs({ motion: on ? 'on' : 'system' })
        toast({ tone: 'info', icon: 'orbit', title: on ? t('Motion reduced') : t('Motion follows your system setting') })
      }
    },
    {
      id: 'act:effects',
      label: prefs.effects === 'reduced' ? t('Use full visual effects') : t('Reduce visual effects'),
      group: 'Actions',
      icon: 'sun',
      keywords: ['blur', 'grain', 'performance', 'glass'],
      run: () => {
        const reduce = getUiPrefs().effects !== 'reduced'
        setUiPrefs({ effects: reduce ? 'reduced' : 'full' })
        toast({ tone: 'info', icon: 'sun', title: reduce ? t('Visual effects reduced') : t('Full visual effects') })
      }
    },
    {
      id: 'act:whatsnew',
      label: t('What’s new'),
      group: 'Actions',
      icon: 'sparkle',
      keywords: ['changes', 'redesign', 'release'],
      run: () => openLayer('whatsnew')
    },
    {
      id: 'act:tour',
      label: t('Take the tour'),
      group: 'Actions',
      icon: 'orbit',
      keywords: ['intro', 'guide', 'walkthrough'],
      run: () => openLayer('tour')
    },
    // Burner YouTube account for downloads. Only offered where the desktop
    // app can actually do it; show/refresh also need the browser running.
    {
      id: 'act:yt-signin',
      label: t('Sign in to YouTube for downloads'),
      group: 'Actions',
      icon: 'youtube',
      keywords: ['burner', 'account', 'bot', 'cookies', 'download', 'google'],
      hint: t('Fixes “confirm you’re not a bot” download errors with a throwaway account.'),
      // Hidden while signed in: the prompt would only offer to sign in again
      // (switching accounts lives in Settings).
      when: () => canConnectYoutube() && getYoutubeStatus()?.browser !== null && getYoutubeStatus()?.signedIn !== true,
      run: () => openYoutubeConnect()
    },
    {
      id: 'act:yt-show',
      label: t('Show YouTube browser'),
      group: 'Actions',
      icon: 'youtube',
      keywords: ['burner', 'account', 'download', 'window'],
      when: () => hasYoutubeApi() && getYoutubeStatus()?.running === true,
      run: () =>
        youtubeAccount
          .show()
          .then(() => undefined)
          .catch(fail(t('Couldn’t show the YouTube browser')))
    },
    {
      id: 'act:yt-refresh',
      label: t('Refresh YouTube session'),
      group: 'Actions',
      icon: 'refresh',
      keywords: ['burner', 'account', 'cookies', 'download', 'reload'],
      when: () => hasYoutubeApi() && getYoutubeStatus()?.running === true,
      run: () =>
        youtubeAccount
          .refresh()
          .then(() => {
            toast({ tone: 'success', icon: 'youtube', title: t('YouTube page refreshed.') })
          })
          .catch(fail(t('Couldn’t refresh the YouTube session')))
    }
  )
  return cmds
}
