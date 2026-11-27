import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import {
  DESCRIPTION_MAX,
  TAGS_BUDGET,
  TITLE_MAX,
  tagsCost,
  type Playlist,
  type VideoCategory
} from '../lib/youtube'

/** Everything the public YouTube API lets you set at upload time.
 *
 *  Anything YouTube Studio can do that is not here is not exposed by the API —
 *  end screens, cards, monetization, age restriction, comment settings. There
 *  is no control for those on purpose: a switch that silently does nothing is
 *  worse than not having one. The panel links to Studio for them instead.
 */

/** YouTube's standard assignable categories, the same in every region the
 *  app is used in. Offered when the live list cannot be fetched, so the
 *  picker never sits on "Loading…" and an upload can still go out. */
const FALLBACK_CATEGORIES: VideoCategory[] = [
  { id: '1', title: 'Film & Animation' },
  { id: '2', title: 'Autos & Vehicles' },
  { id: '10', title: 'Music' },
  { id: '15', title: 'Pets & Animals' },
  { id: '17', title: 'Sports' },
  { id: '19', title: 'Travel & Events' },
  { id: '20', title: 'Gaming' },
  { id: '22', title: 'People & Blogs' },
  { id: '23', title: 'Comedy' },
  { id: '24', title: 'Entertainment' },
  { id: '25', title: 'News & Politics' },
  { id: '26', title: 'Howto & Style' },
  { id: '27', title: 'Education' },
  { id: '28', title: 'Science & Technology' },
  { id: '29', title: 'Nonprofits & Activism' }
]

/** How long the live category list may take before the standard list is
 *  shown instead. */
const CATEGORY_TIMEOUT_MS = 8000

export interface Metadata {
  title: string
  description: string
  tags: string[]
  category_id: string
  default_language: string | null
  made_for_kids: boolean | null
  contains_synthetic_media: boolean
  license: string
  embeddable: boolean
  public_stats_viewable: boolean
  notify_subscribers: boolean
  playlist_id: string | null
}

interface Props {
  value: Metadata
  onChange: (patch: Partial<Metadata>) => void
  region: string
  playlistsAvailable: boolean
  disabled?: boolean
}

/** Common caption/audio languages, matching the app's own language support. */
const LANGUAGES: [string, string][] = [
  ['', 'Not set'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['hi', 'Hindi'],
  ['id', 'Indonesian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ru', 'Russian'],
  ['tr', 'Turkish'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['ar', 'Arabic'],
  ['bn', 'Bengali'],
  ['ur', 'Urdu'],
  ['tl', 'Filipino'],
  ['zh', 'Chinese']
]

export default function YouTubeMetadataForm({
  value,
  onChange,
  region,
  playlistsAvailable,
  disabled
}: Props): JSX.Element {
  const [categories, setCategories] = useState<VideoCategory[]>([])
  const [categoryState, setCategoryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [categoryTry, setCategoryTry] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [tagText, setTagText] = useState(value.tags.join(', '))

  useEffect(() => {
    let alive = true
    setCategoryState('loading')
    // A request that never answers is treated like one that failed: the
    // standard list goes up, with a retry, instead of "Loading…" forever.
    const fail = (): void => {
      if (!alive) return
      alive = false
      setCategories(FALLBACK_CATEGORIES)
      setCategoryState('failed')
    }
    const timer = window.setTimeout(fail, CATEGORY_TIMEOUT_MS)
    api
      .youtubeCategories(region)
      .then((r) => {
        if (!alive) return
        if (!r.categories?.length) return fail()
        alive = false
        setCategories(r.categories)
        setCategoryState('ready')
      })
      .catch(fail)
      .finally(() => window.clearTimeout(timer))
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [region, categoryTry])

  // The clip's saved category stays pickable even when the list in hand
  // (the standard one, say) does not name it.
  const categoryOptions =
    categories.length && !categories.some((c) => c.id === value.category_id)
      ? [{ id: value.category_id, title: `${t('Category')} ${value.category_id}` }, ...categories]
      : categories

  useEffect(() => {
    if (!playlistsAvailable) return
    let alive = true
    api
      .youtubePlaylists()
      .then((r) => alive && setPlaylists(r.playlists))
      .catch(() => alive && setPlaylists([]))
    return () => {
      alive = false
    }
  }, [playlistsAvailable])

  const commitTags = (raw: string): void => {
    setTagText(raw)
    onChange({
      tags: raw
        .split(',')
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean)
    })
  }

  const tagChars = tagsCost(value.tags)
  const titleOver = value.title.length > TITLE_MAX
  const descOver = value.description.length > DESCRIPTION_MAX

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="yt-title">
            {t('Title')}
          </label>
          <span className={`text-[11px] tabular-nums ${titleOver ? 'text-error' : 'text-muted'}`}>
            {value.title.length}/{TITLE_MAX}
          </span>
        </div>
        <input
          id="yt-title"
          className="input"
          value={value.title}
          disabled={disabled}
          maxLength={TITLE_MAX}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t('What people see on YouTube')}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="yt-description">
            {t('Description')}
          </label>
          <span className={`text-[11px] tabular-nums ${descOver ? 'text-error' : 'text-muted'}`}>
            {value.description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
        <textarea
          id="yt-description"
          className="input min-h-[110px] resize-y"
          value={value.description}
          disabled={disabled}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p className="text-[11px] text-muted mt-1">
          {t('Timestamps here become chapters on YouTube.')}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="yt-tags">
            {t('Tags')}
          </label>
          <span
            className={`text-[11px] tabular-nums ${
              tagChars > TAGS_BUDGET ? 'text-error' : 'text-muted'
            }`}
          >
            {tagChars}/{TAGS_BUDGET}
          </span>
        </div>
        <input
          id="yt-tags"
          className="input"
          value={tagText}
          disabled={disabled}
          onChange={(e) => commitTags(e.target.value)}
          placeholder={t('gaming, speedrun, highlights')}
        />
        <p className="text-[11px] text-muted mt-1">
          {t('Separated by commas. YouTube allows 500 characters in total.')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="yt-category">
            {t('Category')}
          </label>
          <select
            id="yt-category"
            className="input"
            value={value.category_id}
            disabled={disabled}
            aria-busy={categoryState === 'loading' || undefined}
            onChange={(e) => onChange({ category_id: e.target.value })}
          >
            {categoryState === 'loading' && categories.length === 0 && (
              <option value={value.category_id}>{t('Loading…')}</option>
            )}
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {categoryState === 'loading' && categoryTry > 0 && (
            <p className="text-[11px] text-muted mt-1 min-h-6 flex items-center" role="status">
              {t('Trying YouTube’s list again…')}
            </p>
          )}
          {categoryState === 'failed' && (
            <p className="text-[11px] text-muted mt-1" role="status">
              {t("Couldn't load YouTube's list, so these are the standard categories.")}{' '}
              <button
                type="button"
                className="inline-flex min-h-6 items-center text-gold hover:text-gold-strong underline underline-offset-2"
                onClick={() => setCategoryTry((n) => n + 1)}
              >
                {t('Try again')}
              </button>
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="yt-language">
            {t('Language')}
          </label>
          <select
            id="yt-language"
            className="input"
            value={value.default_language ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ default_language: e.target.value || null })}
          >
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {t(name)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {playlistsAvailable && (
        <div>
          <label className="label" htmlFor="yt-playlist">
            {t('Playlist')}
          </label>
          <select
            id="yt-playlist"
            className="input"
            value={value.playlist_id ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ playlist_id: e.target.value || null })}
          >
            <option value="">{t('None')}</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.count})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* YouTube requires an explicit answer here and rejects the upload
          without one, so there is deliberately no pre-selected default. */}
      <fieldset className="border border-line/60 rounded-lg p-3 space-y-2">
        <legend className="label px-1">{t('Audience')}</legend>
        <p className="text-xs text-muted">{t('Is this video made for kids?')}</p>
        <div className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="yt-kids"
              checked={value.made_for_kids === true}
              disabled={disabled}
              onChange={() => onChange({ made_for_kids: true })}
            />
            {t('Yes, made for kids')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="yt-kids"
              checked={value.made_for_kids === false}
              disabled={disabled}
              onChange={() => onChange({ made_for_kids: false })}
            />
            {t('No, not made for kids')}
          </label>
        </div>
        {value.made_for_kids === null && (
          <p className="text-[11px] text-warn">
            {t('YouTube needs an answer before this can be uploaded.')}
          </p>
        )}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.contains_synthetic_media}
          disabled={disabled}
          onChange={(e) => onChange({ contains_synthetic_media: e.target.checked })}
        />
        <span>
          {t('Contains altered or synthetic content')}
          <span className="block text-[11px] text-muted">
            {t('Tick this if a real-looking person, place or event was digitally made or changed.')}
          </span>
        </span>
      </label>

      <details className="border border-line/60 rounded-lg">
        <summary className="px-3 py-2 text-xs cursor-pointer hover:bg-raised/40 rounded-lg">
          {t('More options')}
        </summary>
        <div className="p-3 pt-0 space-y-2 text-sm">
          <div>
            <label className="label" htmlFor="yt-license">
              {t('License')}
            </label>
            <select
              id="yt-license"
              className="input"
              value={value.license}
              disabled={disabled}
              onChange={(e) => onChange({ license: e.target.value })}
            >
              <option value="youtube">{t('Standard YouTube License')}</option>
              <option value="creativeCommon">{t('Creative Commons - Attribution')}</option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.embeddable}
              disabled={disabled}
              onChange={(e) => onChange({ embeddable: e.target.checked })}
            />
            {t('Allow embedding on other sites')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.public_stats_viewable}
              disabled={disabled}
              onChange={(e) => onChange({ public_stats_viewable: e.target.checked })}
            />
            {t('Show view count publicly')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.notify_subscribers}
              disabled={disabled}
              onChange={(e) => onChange({ notify_subscribers: e.target.checked })}
            />
            {t('Notify subscribers')}
          </label>
        </div>
      </details>
    </div>
  )
}
