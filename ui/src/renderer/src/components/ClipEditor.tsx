import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getExportFolder, pickExportFolder, setExportFolder } from '../lib/exportFolder'
import { Download, Folder, Scissors } from './icons'
import type { Clip, PluginNote } from '../lib/types'
import { sportMoment } from '../lib/sports'
import { suggestionLine } from '../lib/editSuggestions'

const CHANNELS = ['text', 'audio', 'visual', 'reaction', 'engagement'] as const

/** 5:15.0 beside the raw seconds, so a start of 315 reads as a time. */
function tc(s: number): string {
  if (!Number.isFinite(s)) return ''
  const v = Math.max(0, s)
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const sec = (v % 60).toFixed(1).padStart(4, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** A clip's plugin notes, one line per plugin (and version), in the order they came. */
function pluginNotes(notes: PluginNote[] | undefined): { key: string; who: string; texts: string[] }[] {
  const out: { key: string; who: string; texts: string[] }[] = []
  for (const n of notes ?? []) {
    if (!n?.text) continue
    const key = `${n.plugin}@${n.version ?? ''}`
    const line = out.find((l) => l.key === key)
    if (line) line.texts.push(n.text)
    else out.push({ key, who: `${n.name || n.plugin}${n.version ? ` ${n.version}` : ''}`, texts: [n.text] })
  }
  return out
}

export default function ClipEditor({
  clip,
  onChanged,
  onOpenEditor,
  onPublish
}: {
  clip: Clip
  onChanged: () => void
  onOpenEditor: () => void
  /** Publish this one clip. Absent when no provider is set up, which hides
   *  the button rather than showing one that can only apologise. */
  onPublish?: () => void
}): JSX.Element {
  const [title, setTitle] = useState(clip.title)
  const [description, setDescription] = useState(clip.description)
  const [hashtags, setHashtags] = useState(clip.hashtags.join(' '))
  const [start, setStart] = useState(clip.start_s)
  const [end, setEnd] = useState(clip.end_s)
  const [folder, setFolder] = useState('')
  const fid = `clip-${clip.id}`

  // Default the export destination to the remembered folder / OS Downloads.
  useEffect(() => {
    getExportFolder().then(setFolder)
  }, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setTitle(clip.title)
    setDescription(clip.description)
    setHashtags(clip.hashtags.join(' '))
    setStart(clip.start_s)
    setEnd(clip.end_s)
    setNotice(null)
  }, [clip.id])

  const flash = (msg: string): void => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      flash(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const saveMetadata = (): Promise<void> =>
    run('save', async () => {
      await api.patchClip(clip.id, {
        title,
        description,
        hashtags: hashtags.split(/\s+/).filter(Boolean)
      })
      flash('Saved')
      onChanged()
    })

  const rerender = (): Promise<void> =>
    run('render', async () => {
      const range = start !== clip.start_s || end !== clip.end_s ? { start, end } : undefined
      await api.rerenderClip(clip.id, range)
      flash('Re-render queued — watch the Dashboard activity feed')
    })

  const exportOne = (): Promise<void> =>
    run('export', async () => {
      const res = await api.exportClip(clip.id, folder)
      flash(res.exported.length ? `Exported: ${res.exported[0]}` : 'Nothing exported')
      onChanged() // exporting stars the clip; show it on its card
    })

  return (
    <div className="lib-inspector-body space-y-4">
      <video
        key={clip.id}
        src={api.mediaUrl(clip.id)}
        controls
        aria-label={`Preview of clip: ${clip.title || clip.hook || 'untitled'}. Captions are burned into the video.`}
        className="lib-inspector-video"
      />

      <button
        onClick={onOpenEditor}
        className="btn-gold lib-edit-cta w-full"
        title="Open the editor: trim, cut, mute words, censor, color, captions, AI edit"
      >
        <span className="inline-flex items-center gap-2 justify-center">
          <Scissors size={16} /> Edit this clip
        </span>
      </button>

      <div className="lib-subscores">
        {CHANNELS.map((ch) => (
          <span key={ch} className="lib-subscore">
            {ch} <span className="text-ink font-semibold">{clip.scores[ch] ?? '–'}</span>
          </span>
        ))}
        {clip.scores.game != null && (
          // A match is scored with the same evidence a gaming stream gets.
          <span
            className="lib-subscore"
            title={clip.render_opts?.sport ? 'What the crowd and the whistle marked' : 'Scored as a gaming stream'}
          >
            {clip.render_opts?.sport ? 'match' : 'game'}{' '}
            <span className="text-ink font-semibold">{clip.scores.game}</span>
            {clip.scores.game_bonus ? <span className="text-gold"> +{clip.scores.game_bonus}</span> : null}
          </span>
        )}
        {clip.scores.sport_label && (
          <span className="lib-subscore lib-subscore-gold" title="The match moment this clip is">
            {sportMoment(clip.scores)}
            {clip.scores.sport_bonus ? <span className="text-gold-strong"> +{clip.scores.sport_bonus}</span> : null}
          </span>
        )}
      </div>
      {clip.scores.game_why && <p className="text-xs text-muted -mt-2">{clip.scores.game_why}</p>}
      {clip.scores.sport_why && (
        <p className="text-xs text-muted -mt-2" title="What marked this moment">
          {clip.scores.sport_why}
        </p>
      )}
      {clip.scores.plugin && (
        <p className="text-xs text-muted -mt-2" title="The Marketplace pipeline that found this moment, in its own words">
          Found by {clip.scores.plugin} {clip.scores.plugin_version}
          {clip.scores.plugin_label ? `: ${clip.scores.plugin_label}` : ''}
          {clip.scores.plugin_why ? ` · ${clip.scores.plugin_why}` : ''}
        </p>
      )}
      {/* Rate & understand (plugins/steps.py): each rating in the order it was
          applied (the last one counts), the score before any, and the notes. */}
      {(clip.scores.plugin_ratings ?? []).map((r, i) => (
        <p
          key={`rating-${i}`}
          className="text-xs text-muted -mt-2"
          title="A Marketplace plugin’s score for this moment, in its own words"
        >
          Rated {r.score} by {r.name || r.plugin}
          {r.version ? ` ${r.version}` : ''}
          {r.reason ? ` · ${r.reason}` : ''}
        </p>
      ))}
      {clip.scores.found_score != null && (
        <p className="text-xs text-muted -mt-2" title="The score this moment had before any plugin rated it">
          Score when found: {clip.scores.found_score}
        </p>
      )}
      {pluginNotes(clip.scores.plugin_notes).map((n) => (
        <p
          key={n.key}
          className="text-xs text-muted -mt-2"
          title="What a Marketplace plugin said happens in this moment. Solaris Studio gives notes like this to the AI when it writes a new clip’s title, description and hashtags."
        >
          Notes from {n.who}: {n.texts.join(' · ')}
        </p>
      ))}
      {/* Suggest edits (plugins/steps.py suggest_edits): what each plugin
          suggested, and what came of it. They are used in the editor. */}
      {(clip.scores.plugin_edits ?? [])
        .filter((e) => e && typeof e.id === 'string' && e.edit)
        .map((e) => (
          <p
            key={`edit-${e.id}`}
            className="text-xs text-muted -mt-2"
            title="An edit a Marketplace plugin suggested for this clip. Open the editor to use it or hide it."
          >
            {suggestionLine(e, { start: clip.start_s, end: clip.end_s })}
          </p>
        ))}
      {clip.scores.intent_why && (
        <p className="text-xs text-muted -mt-2" title="Points from the clip direction given with this video">
          Direction +{clip.scores.intent}: {clip.scores.intent_why}
          {clip.scores.required ? ` · kept as asked (${clip.scores.required})` : ''}
        </p>
      )}

      <div className="lib-inspector-fields space-y-3">
        <div>
          <label className="label" htmlFor={`${fid}-title`}>
            Title
          </label>
          {/* Grows with the text: a long title was cut off in a one-line input. */}
          <textarea
            id={`${fid}-title`}
            rows={1}
            className="input mt-1 lib-autogrow"
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-desc`}>
            Description
          </label>
          <textarea
            id={`${fid}-desc`}
            className="input mt-1 lib-autogrow lib-autogrow-tall"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-tags`}>
            Hashtags (space-separated)
          </label>
          <input
            id={`${fid}-tags`}
            className="input mt-1"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="label lib-time-label" htmlFor={`${fid}-start`}>
              Start (s) <span className="lib-time-tc t-mono">{tc(start)}</span>
            </label>
            <input
              id={`${fid}-start`}
              type="number"
              className="input mt-1 tabular"
              value={start}
              step={0.5}
              title={`${start} s`}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </div>
          <div className="min-w-0">
            <label className="label lib-time-label" htmlFor={`${fid}-end`}>
              End (s) <span className="lib-time-tc t-mono">{tc(end)}</span>
            </label>
            <input
              id={`${fid}-end`}
              type="number"
              className="input mt-1 tabular"
              value={end}
              step={0.5}
              title={`${end} s`}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="lib-inspector-actions">
        <button className="btn-accent" onClick={saveMetadata} disabled={busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save metadata'}
        </button>
        <button className="btn-ghost" onClick={rerender} disabled={busy !== null}>
          {busy === 'render' ? 'Queueing…' : 'Re-render'}
        </button>
      </div>

      {/* Export (to a folder) and Publish (to your accounts): the same one
          clip, to the two destinations, grouped with the folder they use. */}
      <div className="lib-export-box">
        <label className="label" htmlFor={`${fid}-folder`}>
          Export folder
        </label>
        <div className="lib-export-folder">
          <input
            id={`${fid}-folder`}
            className="input lib-folder-input"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value)
              setExportFolder(e.target.value)
            }}
            placeholder="export folder"
            title={folder}
          />
          <button
            className="btn-ghost lib-folder-pick"
            onClick={async () => {
              const chosen = await pickExportFolder()
              if (chosen) setFolder(chosen)
            }}
            title="Choose where exported clips are saved"
            aria-label="Choose export folder"
          >
            <Folder />
          </button>
        </div>
        <div className="lib-export-actions">
          <button className="btn-ghost" onClick={exportOne} disabled={busy !== null}>
            <Download size={15} /> {busy === 'export' ? 'Exporting…' : 'Export'}
          </button>
          {/* Beside Export rather than only on the card in the grid: Export
              writes this one clip to a folder, and Publish is the same scope
              for the other destination. Only shown once a provider is set up,
              so the row does not carry a button that can only explain itself.
              Posting is not undoable, so it opens the confirm dialog rather
              than acting on the click, exactly like Publish all. */}
          {onPublish && (
            <button className="btn-ghost" onClick={onPublish} disabled={busy !== null}>
              Publish ↗
            </button>
          )}
        </div>
      </div>
      {notice && <p className="lib-inspector-notice" role="status">{notice}</p>}
    </div>
  )
}
