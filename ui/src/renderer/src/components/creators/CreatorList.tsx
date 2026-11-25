import { useMemo, useState } from 'react'
import type { CreatorSummary } from '../../lib/types'
import { t } from '../../lib/i18n'
import { Icon, type IconName } from '../icons'
import { Avatar, Badge, IconButton, Meter, SearchInput, Segmented } from '../ui'
import Leaderboard from './Leaderboard'

export const PLATFORM_ICON: Record<string, IconName> = { youtube: 'youtube', twitch: 'twitch', kick: 'kick' }

export function PlatformBadge({ platform }: { platform: string }): JSX.Element {
  return (
    <span className="ops-platform" data-platform={platform}>
      <Icon name={PLATFORM_ICON[platform] ?? 'link'} size={11} />
      {platform}
    </span>
  )
}

type Sort = 'clips' | 'score' | 'name'
type View = 'list' | 'board'

function load<T extends string>(key: string, fallback: T, allowed: T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function save(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: just not remembered */
  }
}

/** The left column: search, sort, List / Leaderboard, and the rows. */
export default function CreatorList({
  creators,
  selected,
  flash,
  busy,
  onSelect,
  onDelete
}: {
  creators: CreatorSummary[]
  selected: number | null
  /** Briefly highlighted (arrived from a watched channel). */
  flash: number | null
  busy: boolean
  onSelect: (id: number | null) => void
  onDelete: (c: CreatorSummary) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSortState] = useState<Sort>(() => load('solaris.ui.creators.sort', 'clips', ['clips', 'score', 'name']))
  const [view, setViewState] = useState<View>(() => load('solaris.ui.creators.view', 'list', ['list', 'board']))
  const setSort = (s: Sort): void => {
    setSortState(s)
    save('solaris.ui.creators.sort', s)
  }
  const setView = (v: View): void => {
    setViewState(v)
    save('solaris.ui.creators.view', v)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? creators.filter((c) =>
          [c.display_name, ...c.aliases, ...c.accounts.map((a) => a.username)].some((s) => s?.toLowerCase().includes(q))
        )
      : creators.slice()
    list.sort((a, b) =>
      sort === 'name'
        ? a.display_name.localeCompare(b.display_name)
        : sort === 'score'
          ? (b.avg_score ?? -1) - (a.avg_score ?? -1)
          : b.clips - a.clips
    )
    return list
  }, [creators, query, sort])

  return (
    <div className="ops-clist">
      <div className="ops-clist-tools">
        <SearchInput value={query} onChange={setQuery} placeholder={t('Search creators')} ariaLabel={t('Search creators')} hotkey />
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            size="sm"
            ariaLabel={t('Sort by')}
            value={sort}
            onChange={(id) => setSort(id as Sort)}
            items={[
              { id: 'clips', label: t('Clips') },
              { id: 'score', label: t('Avg score') },
              { id: 'name', label: t('Name') }
            ]}
          />
          <Segmented
            size="sm"
            ariaLabel={t('View')}
            value={view}
            onChange={(id) => setView(id as View)}
            items={[
              { id: 'list', label: t('List'), icon: 'list' },
              { id: 'board', label: t('Leaderboard'), icon: 'trend-up' }
            ]}
          />
        </div>
      </div>

      {shown.length === 0 && creators.length > 0 && (
        <p className="text-sm text-muted px-1 py-4 text-center">{t('No creator matches that.')}</p>
      )}

      {view === 'board' ? (
        <Leaderboard creators={shown} selected={selected} onSelect={(id) => onSelect(id)} />
      ) : (
        <div className="ops-clist-rows stagger" role="list">
          {shown.map((c, i) => (
            // relative wrapper, not a nested button: the row is itself a
            // button, and a delete control inside it would be invalid markup
            // and swallow the row's own click.
            <div
              key={c.creator_id}
              role="listitem"
              className={`ops-crow-wrap group ${flash === c.creator_id ? 'anim-flash' : ''}`}
              data-creator={c.creator_id}
              style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            >
              <button
                type="button"
                className="ops-crow"
                aria-current={selected === c.creator_id ? 'true' : undefined}
                onClick={() => onSelect(c.creator_id === selected ? null : c.creator_id)}
              >
                <Avatar seed={c.creator_id} name={c.display_name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-ink truncate">{c.display_name}</span>
                    {c.watched && (
                      <Badge tone="success" size="xs" icon="radar" title={t('A watched channel learns into this profile')}>
                        {t('Watched')}
                      </Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-1 flex-wrap mt-1">
                    {c.accounts.map((a) => (
                      <PlatformBadge key={a.account_id} platform={a.platform} />
                    ))}
                  </span>
                  <span className="text-xs text-muted mt-1.5 block tabular">
                    {c.videos} {t(c.videos === 1 ? 'video' : 'videos')} · {c.clips} {t(c.clips === 1 ? 'clip' : 'clips')}
                    {c.avg_score != null && ` · ${t('avg score')} ${c.avg_score}`}
                  </span>
                  {c.avg_score != null && (
                    <Meter
                      value={c.avg_score / 100}
                      label={`${t('Average score')} ${c.avg_score}`}
                      tone={c.avg_score >= 80 ? 'success' : c.avg_score >= 65 ? 'gold' : 'muted'}
                      className="mt-1.5"
                    />
                  )}
                </span>
              </button>
              <IconButton
                size="sm"
                icon="trash"
                tone="error"
                className="ops-crow-del"
                disabled={busy}
                label={
                  c.videos
                    ? `${t('Delete this profile. Its')} ${c.videos} ${t('video(s) stay — they just lose their creator.')}`
                    : t('Delete this empty profile')
                }
                aria-label={`${t('Delete')} ${c.display_name}`}
                onClick={() => onDelete(c)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
