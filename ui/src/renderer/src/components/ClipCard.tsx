import type { Clip } from '../lib/types'
import { sportMoment } from '../lib/sports'
import { hasNewSuggestion } from '../lib/editSuggestions'
import { t } from '../lib/i18n'
import ScoreBadge from './ScoreBadge'
import { Icon, Star, Trash } from './icons'
import { ClipPoster } from './library/HoverPreview'
import { confirmDialog } from './ui'

const PROFILE_BADGE: Record<string, string> = {
  short_clips: '▭ 16:9',
  clips_140: '▭ 16:9',
  highlights: '▭ Highlights',
  edited_stream: '▭ Edited stream'
}

/** m:ss for the duration chip. */
function clock(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

export default function ClipCard({
  clip,
  selected,
  onClick,
  onDelete,
  onToggleExported,
  onPublish,
  onOpen,
  posterRef,
  checked,
  onCheck,
  selecting
}: {
  clip: Clip
  selected: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Cull this clip straight from the grid, without opening it. */
  onDelete?: () => void
  /** Star or unstar the clip as exported, without opening it. */
  onToggleExported?: () => void
  /** Publish this one clip, without opening the editor first. */
  onPublish?: () => void
  /** Double-click / Enter: open the full editor. */
  onOpen?: () => void
  /** The poster box, for the card→editor morph. */
  posterRef?: React.Ref<HTMLDivElement>
  /** Multi-select: whether this card is in the selection. */
  checked?: boolean
  /** Multi-select checkbox pressed (shift for a range). */
  onCheck?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** A selection is in progress: the checkbox shows on every card. */
  selecting?: boolean
}): JSX.Element {
  const duration = Math.round(clip.end_s - clip.start_s)
  const name = clip.title || clip.hook || 'Untitled clip'
  const profile = clip.render_opts?.profile
  const badge = profile ? (PROFILE_BADGE[profile] ?? '▭ 16:9') : null
  const exported = !!clip.exported_at
  // A Sports job's clip: the moment it is ("Goal · 18' · HOM").
  const moment = sportMoment(clip.scores)
  // A Marketplace plugin suggested an edit the creator hasn't used or hidden yet.
  const suggested = hasNewSuggestion(clip.scores?.plugin_edits)

  // The poster is a frame image plus ONE shared hover video for the whole app
  // (library/HoverPreview): a grid of 100+ <video> elements pointed at the
  // local server starved Chromium's ~6-connection pool, so thumbnails stayed
  // blank and the editor's own video could not play. Posters load only once
  // the card nears the viewport.
  // Wrapper (not a button): the card is a button, and the trash must be a
  // SEPARATE button, not nested inside it — nested buttons are invalid and
  // the inner click would be swallowed.
  return (
    <div
      className="lib-card group"
      data-clip-id={clip.id}
      data-selected={selected ? '' : undefined}
      data-checked={checked ? '' : undefined}
      data-selecting={selecting ? '' : undefined}
      data-exported={exported ? '' : undefined}
      data-best={clip.score >= 80 ? '' : undefined}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.lib-card-tool')) return
        onOpen?.()
      }}
    >
      <button
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onOpen) {
            e.preventDefault()
            onOpen()
          }
        }}
        aria-label={`${name}${moment ? `, ${moment}` : ''}, ${duration} seconds, score ${clip.score}${
          badge ? ', horizontal longform' : ', vertical Short'
        }${suggested ? ', suggested edit' : ''}${exported ? ', exported' : ''}${selected ? ', selected' : ''}`}
        aria-pressed={selected}
        className="lib-card-main"
      >
        <ClipPoster
          clipId={clip.id}
          durationS={clip.end_s - clip.start_s}
          fit={badge ? 'contain' : 'cover'}
          boxRef={posterRef}
          className="lib-card-poster"
        >
          <span className="lib-card-scrim" aria-hidden />
          <span className="lib-card-score">
            <ScoreBadge score={clip.score} />
          </span>
          {/* Above the duration: the top right belongs to the star and trash. */}
          {badge && <span className="lib-chip lib-chip-gold lib-card-profile">{badge}</span>}
          {/* Under the score badge: Publish takes the bottom left on hover. */}
          {suggested && (
            <span
              className="lib-chip lib-chip-accent lib-chip-pulse absolute top-9 left-2 z-[3]"
              title="A Marketplace plugin suggested an edit for this clip. Open it in the editor to see it."
            >
              Suggested edit
            </span>
          )}
          <span className="lib-card-duration t-mono absolute bottom-2 right-2 z-[3]">
            {clock(duration)}
          </span>
          {/* Not while picking clips: a click there checks the card, so the
              hint would promise the wrong thing. */}
          {onOpen && !selecting && (
            <span className="lib-card-open" aria-hidden>
              <Icon name="scissors" size={14} /> {t('Double-click to edit')}
            </span>
          )}
        </ClipPoster>
        <div className="lib-card-body">
          <p className="lib-card-title">
            {clip.title || clip.hook || 'Untitled clip'}
          </p>
          {moment && (
            <p className="text-xs text-gold mt-1 truncate" title={clip.scores.sport_why}>
              {moment}
            </p>
          )}
        </div>
      </button>
      {onCheck && (
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(checked)}
          aria-label={checked ? `${t('Deselect')} ${name}` : `${t('Select')} ${name}`}
          title={t('Select (Shift-click for a range)')}
          onClick={(e) => {
            e.stopPropagation()
            onCheck(e)
          }}
          className="lib-card-tool lib-card-check"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {onToggleExported && (
        <button
          aria-label={exported ? `Unstar ${name} (not exported)` : `Star ${name} as exported`}
          aria-pressed={exported}
          title={
            exported
              ? 'Exported. Click to unstar.'
              : 'Star as exported. Export all skips starred clips.'
          }
          onClick={(e) => {
            e.stopPropagation()
            onToggleExported()
          }}
          // Starred, the star sits in the corner on its own. On hover the trash
          // takes the corner, so the star steps in beside it. Unstarred, the
          // star only appears then, in that same spot beside the trash.
          className={`lib-card-tool lib-card-star absolute top-2 z-10 ${
            exported
              ? `lib-card-star-on ${
                  onDelete ? 'right-2 group-hover:right-10 group-focus-within:right-10' : 'right-2'
                }`
              : `opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                  onDelete ? 'right-10' : 'right-2'
                }`
          }`}
        >
          <Star className={exported ? 'fill-current' : ''} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label={`Delete ${name}`}
          title="Delete this clip and its file. The video and other clips stay."
          onClick={(e) => {
            e.stopPropagation()
            void confirmDialog({
              title: t('Delete this clip and its file?'),
              body: (
                <>
                  <span className="block text-ink mb-1.5">“{name}”</span>
                  {t('Only this clip is removed — the video and your other clips stay. Can’t be undone.')}
                </>
              ),
              confirmLabel: t('Delete clip'),
              tone: 'danger'
            }).then((ok) => {
              if (ok) onDelete()
            })
          }}
          className="lib-card-tool lib-card-trash absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <Trash />
        </button>
      )}
      {/* Publishing one clip meant opening the editor and finding the Publish
          tab, three steps in. Bottom left: the score badge owns the top left,
          the star and trash the top right, and the duration the bottom right,
          so this is the one free corner. */}
      {onPublish && (
        <button
          aria-label={`Publish ${name}`}
          title="Publish just this clip"
          onClick={(e) => {
            e.stopPropagation()
            onPublish()
          }}
          className="lib-card-tool lib-card-publish absolute left-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          Publish ↗
        </button>
      )}
    </div>
  )
}

