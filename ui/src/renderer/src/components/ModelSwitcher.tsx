import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { openAISetup } from '../lib/aiSetup'
import { speedNote } from '../lib/modelSpeed'
import type { InstalledModel } from '../lib/types'
import { Popover, Tooltip } from './ui'

/** Two letters for the collapsed rail chip: "llama3.1:8b" → "L3", "qwen2.5" → "Q2". */
function initialsOf(name: string): string {
  const base = name.replace(/^.*\//, '').split(':')[0]
  const letter = base.match(/[a-z]/i)?.[0] ?? '?'
  const digit = base.match(/\d/)?.[0] ?? base.replace(/[^a-z]/gi, '')[1] ?? ''
  return (letter + digit).toUpperCase()
}

/** Always-visible model selector in the sidebar: switch the active LLM
 *  from anywhere in the app without opening the Models page. */
export default function ModelSwitcher({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const [installed, setInstalled] = useState<InstalledModel[]>([])
  const [active, setActive] = useState('')
  const [switching, setSwitching] = useState(false)
  const [vram, setVram] = useState<number | null>(null)
  // A cloud model on the user's own key, as "OpenRouter · model", or "".
  const [cloud, setCloud] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const status = await api.ai()
      const label = [...status.providers, ...(status.signin ?? [])].find(
        (p) => p.id === status.active.provider
      )?.label
      setCloud(status.active.local ? '' : `${label ?? status.active.provider} · ${status.active.model}`)
      // On a cloud provider the local list is never shown here, and asking
      // for it every 30 s only fills the engine log with "Ollama is not
      // reachable" 503s on a PC that has no Ollama at all.
      if (!status.active.local) return
    } catch {
      setCloud('')
    }
    try {
      const info = await api.models()
      setInstalled(info.installed)
      setActive(info.active.replace(/^ollama\//, ''))
    } catch {
      setInstalled([])
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [])

  // Read the card once, so the note can warn when a model will not fit it —
  // by far the biggest speed cliff there is. Best-effort: without a reading
  // the note still describes relative speed.
  useEffect(() => {
    api
      .systemStats()
      .then((s) => setVram(s.gpu?.vram_total ?? null))
      .catch(() => setVram(null))
  }, [])

  const onChange = async (tag: string): Promise<void> => {
    setSwitching(true)
    try {
      await api.activateModel(tag)
      setActive(tag)
    } catch {
      await refresh()
    } finally {
      setSwitching(false)
    }
  }

  if (cloud) {
    // Chosen in Settings → AI, so that is where it is changed. Picking a local
    // model from a dropdown here would quietly switch the user off their cloud
    // provider, which is exactly the kind of surprise this must not spring.
    const openAI = (): void => {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { section: 'ai' } }))
    }
    if (compact)
      return (
        <div className="model-chip-wrap">
          <Tooltip content={`${cloud} · Your own key · change in Settings`} side="right">
            <button type="button" className="model-chip model-chip-cloud" onClick={openAI} aria-label={`AI model: ${cloud}`}>
              {initialsOf(cloud.split(' · ').pop() ?? cloud)}
            </button>
          </Tooltip>
        </div>
      )
    return (
      <div className="model-switcher">
        <label className="label px-1">AI model</label>
        <button
          className="input mt-1 text-sm text-left truncate"
          title={cloud}
          onClick={openAI}
        >
          {cloud}
        </button>
        <p className="mt-1 px-1 text-[11px] leading-snug text-muted">Your own key · change in Settings</p>
      </div>
    )
  }

  if (installed.length === 0) return <></>

  const current = installed.find((m) => m.name === active)
  const note = current ? speedNote(current, installed, vram) : null

  const panel = (
    <div className={compact ? 'model-switcher model-switcher-pop' : 'model-switcher'}>
      <label className="label px-1">AI model</label>
      <select
        className="input mt-1 text-sm"
        value={active}
        disabled={switching}
        onChange={(e) => onChange(e.target.value)}
      >
        {installed.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} ({m.size_gb.toFixed(1)} GB)
          </option>
        ))}
      </select>
      {note && (
        <p
          className={`mt-1 px-1 text-[11px] leading-snug ${
            note.tone === 'warn'
              ? 'text-error'
              : note.tone === 'slow'
                ? 'text-warn'
                : 'text-muted'
          }`}
        >
          {note.tone !== 'ok' && <span aria-hidden="true">⚠ </span>}
          {note.text}
        </p>
      )}
      {/* Only when the chosen model will not fit the card: the one case where
          a cloud model on the user's own key is the plain answer. */}
      {note?.tone === 'warn' && (
        <button
          className="mt-0.5 px-1 text-[11px] text-gold hover:text-gold-strong hover:underline text-left"
          onClick={() => openAISetup('openrouter')}
        >
          Or run it in the cloud with OpenRouter →
        </button>
      )}
    </div>
  )

  if (!compact) return panel
  return (
    <div className="model-chip-wrap">
      <Popover
        side="top"
        align="start"
        width={260}
        trigger={(p) => (
          <button
            ref={p.ref}
            type="button"
            className={`model-chip${note && note.tone !== 'ok' ? ' model-chip-warn' : ''}`}
            aria-expanded={p['aria-expanded']}
            onClick={p.onClick}
            aria-label={`AI model: ${active || 'none'}`}
            title={active}
          >
            {switching ? <span className="ui-spinner" aria-hidden /> : initialsOf(active || '?')}
          </button>
        )}
      >
        {panel}
      </Popover>
    </div>
  )
}
