import { motionReduced } from '../lib/motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../lib/api'
import type { BrandingProfile, CreatorDetail as Detail, CreatorSuggestion, CreatorSummary } from '../lib/types'
import { t } from '../lib/i18n'
import { navigate, openCreate, useBreadcrumbs } from '../lib/nav'
import { useVisible } from '../lib/stores/useVisible'
import CreatorList, { PlatformBadge } from '../components/creators/CreatorList'
import CreatorDetail from '../components/creators/CreatorDetail'
import { useWidth } from '../components/watch/useMedia'
import { Avatar, Button, Callout, EmptyState, PageHeader, Skeleton, useConfirm } from '../components/ui'

const DISMISSED_KEY = 'solaris.ui.creators.dismissedMatches'

function loadDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

const pairKey = (s: CreatorSuggestion): string => [s.creator_a.id, s.creator_b.id].sort((a, b) => a - b).join(':')

export default function Creators({
  initialSelected = null,
  onTargetConsumed,
  active = true
}: {
  /** Open with this profile selected: a watched channel's "Open in Creators". */
  initialSelected?: number | null
  onTargetConsumed?: () => void
  active?: boolean
  onOpenInStudio?: (videoId: string, clipId?: number) => void
} = {}): JSX.Element {
  const ask = useConfirm()
  const [creators, setCreators] = useState<CreatorSummary[] | null>(null)
  const [suggestions, setSuggestions] = useState<CreatorSuggestion[]>([])
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)
  const [selected, setSelected] = useState<number | null>(initialSelected)
  const [flash, setFlash] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [brandingProfiles, setBrandingProfiles] = useState<BrandingProfile[]>([])
  const visible = useVisible(active)
  // One column when the page can't fit the list (300px+) beside a readable
  // detail; measured on the page, so the rail is taken into account.
  const [pageRef, pageWidth] = useWidth<HTMLDivElement>()
  const oneCol = pageWidth < 960
  const detailRef = useRef<HTMLDivElement>(null)
  // Set when the user picks a row, so the detail is brought into view once
  // it has loaded (in one column it renders below the whole list).
  const reveal = useRef(false)

  const loadBranding = (): void => {
    api.branding().then(setBrandingProfiles).catch(() => setBrandingProfiles([]))
  }
  useEffect(loadBranding, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await api.creators()
      setCreators(data.creators)
      setSuggestions(data.suggestions)
      setError('')
    } catch (e) {
      // A failed first read leaves the list unknown (null), not empty: "No
      // creators yet" would claim the profiles are gone.
      setError(errorText(e))
    }
  }, [])

  // First load, and a fresh read whenever the page comes back.
  useEffect(() => {
    if (visible) void refresh()
  }, [visible, refresh])

  // Arriving from a watched channel: select that profile, bring its row into
  // view and flash it, then let the app forget the request. Under keep-alive
  // the page may already be mounted, so this runs on every new target.
  useEffect(() => {
    if (initialSelected === null || creators === null || creators.length === 0) return
    setSelected(initialSelected)
    setFlash(initialSelected)
    requestAnimationFrame(() =>
      document
        .querySelector(`.ops-clist [data-creator="${initialSelected}"]`)
        ?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'center' })
    )
    onTargetConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelected, creators?.length])

  useEffect(() => {
    if (flash === null) return
    const id = setTimeout(() => setFlash(null), 3000)
    return () => clearTimeout(id)
  }, [flash])

  useEffect(() => {
    if (selected === null) {
      setDetail(null)
      return
    }
    let live = true
    api
      .creatorDetail(selected)
      .then((d) => live && setDetail(d))
      .catch((e) => setError(errorText(e)))
    return () => {
      live = false
    }
  }, [selected])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
      if (selected !== null) setDetail(await api.creatorDetail(selected).catch(() => null))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!detail || !reveal.current) return
    reveal.current = false
    if (!oneCol) return
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
    )
  }, [detail, oneCol])

  const pick = (id: number | null): void => {
    reveal.current = id !== null
    setSelected(id)
  }

  const deleteCreator = async (c: CreatorSummary): Promise<void> => {
    const ok = await ask({
      title: `${t('Delete the profile for')} ${c.display_name}?`,
      body: (
        <div className="space-y-2">
          <p>{t('Its channels, learned knowledge, storylines and protected words are removed. No video or clip is deleted.')}</p>
          {c.videos > 0 && (
            <p>
              {c.videos} {t('video(s) stay in your library — they just won’t be attributed to anyone.')}
            </p>
          )}
        </div>
      ),
      confirmLabel: t('Delete this creator'),
      tone: 'danger'
    })
    if (!ok) return
    void act(async () => {
      await api.deleteCreator(c.creator_id)
      if (selected === c.creator_id) setSelected(null)
    })
  }

  const dismiss = (s: CreatorSuggestion): void => {
    const next = [...dismissed, pairKey(s)]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-200)))
    } catch {
      /* not remembered */
    }
  }

  useBreadcrumbs(detail ? [{ label: detail.display_name }] : [])

  const matches = suggestions.filter((s) => !dismissed.includes(pairKey(s)))
  const summary = creators?.find((c) => c.creator_id === detail?.creator_id)

  const firstLoadFailed = creators === null && error !== ''

  return (
    <div ref={pageRef} className="ops-page max-w-[1600px] mx-auto p-6 space-y-6 w-full">
      <PageHeader
        eyebrow={t('Discover')}
        icon="users"
        title={t('Creators')}
        vtName="page-title"
        subtitle={t(
          'The app learns each creator over time — their channels, topics, running jokes and storylines — to pick and title clips better. Everything stays on this computer.'
        )}
      />

      {error && !firstLoadFailed && (
        <Callout tone="error" title={t('Something went wrong')} onDismiss={() => setError('')}>
          {error}
        </Callout>
      )}

      {matches.length > 0 && (
        <div className="space-y-2">
          {matches.map((s) => (
            <Callout key={pairKey(s)} tone="gold" icon="link" title={t('Possible matches — are these the same creator?')} onDismiss={() => dismiss(s)}>
              <div className="ops-match">
                <span className="ops-match-side">
                  <Avatar seed={s.creator_a.id} name={s.creator_a.name} size={32} />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink truncate">{s.creator_a.name}</span>
                    <PlatformBadge platform={s.creator_a.platform} />
                  </span>
                </span>
                <span className="ops-match-link" aria-hidden>
                  <span />
                </span>
                <span className="ops-match-side">
                  <Avatar seed={s.creator_b.id} name={s.creator_b.name} size={32} />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink truncate">{s.creator_b.name}</span>
                    <PlatformBadge platform={s.creator_b.platform} />
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="accent"
                  icon="link"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => void act(() => api.mergeCreators(s.creator_b.id, s.creator_a.id))}
                >
                  {t('Link as same creator')}
                </Button>
              </div>
              <p className="text-xs text-muted mt-2">
                {s.reason ? `${s.reason} · ` : ''}
                {t('Linking combines their videos, stats and learned knowledge under one profile.')}
              </p>
            </Callout>
          ))}
        </div>
      )}

      {firstLoadFailed ? (
        <div className="card ops-empty anim-rise">
          <EmptyState
            illustration="sun"
            title={t('The engine isn’t answering')}
            body={t('If it was just starting, give it a moment. Your creators appear here as soon as it replies.')}
            action={
              <Button variant="ghost" icon="refresh" onClick={() => void refresh()}>
                {t('Try again')}
              </Button>
            }
          />
        </div>
      ) : creators === null ? (
        <div className="ops-creators" data-cols={oneCol ? '1' : '2'} aria-busy="true">
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} h={86} radius={14} />
            ))}
          </div>
          <Skeleton h={420} radius={16} />
        </div>
      ) : creators.length === 0 ? (
        <div className="card ops-empty">
          <EmptyState
            illustration="creators"
            title={t('No creators yet')}
            body={t('No creators yet — process a video and its channel will appear here automatically.')}
            action={
              <Button variant="gold" icon="plus" onClick={() => openCreate()}>
                {t('New clips')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="ops-creators" data-cols={oneCol ? '1' : '2'}>
          <CreatorList
            creators={creators}
            selected={selected}
            flash={flash}
            busy={busy}
            onSelect={pick}
            onDelete={(c) => void deleteCreator(c)}
          />
          <div className="ops-creators-detail" ref={detailRef}>
            {detail ? (
              <CreatorDetail
                detail={detail}
                summary={summary}
                busy={busy}
                act={act}
                brandingProfiles={brandingProfiles}
                onBrandingChanged={loadBranding}
                onDeleted={() => setSelected(null)}
                onSeeClips={() => navigate({ page: 'studio', params: { creatorId: detail.creator_id } })}
              />
            ) : selected !== null ? (
              <Skeleton h={420} radius={16} />
            ) : oneCol ? null : (

              <div className="card ops-empty">
                <EmptyState
                  compact
                  illustration="creators"
                  title={t('Pick a creator')}
                  body={t('Select a creator to see their channels and what the app has learned.')}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
