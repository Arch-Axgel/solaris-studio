import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NoClipsExplanation from '../components/NoClipsExplanation'
import ClipDirectionNote from '../components/ClipDirectionNote'
import PluginStepsNote from '../components/PluginStepsNote'
import SportsNote from '../components/SportsNote'
import ClipEditor from '../components/ClipEditor'
import EditorView from '../components/EditorModal'
import ProcessingBar from '../components/ProcessingBar'
import PublishAllDialog from '../components/PublishAllDialog'
import ScheduleView from '../components/ScheduleView'
import { Icon } from '../components/icons'
import VideoRail, { ALL_CLIPS, creatorKeyOf, creatorLabelOf, matchesSearch } from '../components/library/VideoRail'
import ClipGrid, { collapseCard, type Density } from '../components/library/ClipGrid'
import BulkBar from '../components/library/BulkBar'
import { readPref, writePref } from '../components/library/prefs'
import {
  Button,
  CountUp,
  Disclosure,
  EmptyState,
  PageHeader,
  Segmented,
  Sheet,
  Tooltip,
  toast,
  useConfirm
} from '../components/ui'
import { api } from '../lib/api'
import type { Provider } from '../lib/uploadpost'
import { getExportFolder } from '../lib/exportFolder'
import { t } from '../lib/i18n'
import { useHotkey } from '../lib/hotkeys'
import { markClipTransition, useReducedMotion, withViewTransition } from '../lib/motion'
import { closeLayer, navigate, openCreate, topLayer, useBreadcrumbs } from '../lib/nav'
import { useStudioEvents } from '../lib/stores/eventBus'
import { invalidateLibrary, loadClipsFor } from '../lib/stores/library'
import { useVisible } from '../lib/stores/useVisible'
import { useJobWatch } from '../lib/useJobWatch'
import type { StudioTarget } from '../App'
import type { Clip, StudioEvent, Video } from '../lib/types'

type ClipType = 'all' | 'shorts' | 'longform'
type ClipSort = 'score' | 'newest' | 'time'

/** "All clips" looks at the newest videos only (spec 5: performance rules). */
const ALL_CLIPS_VIDEOS = 60

function useMediaQuery(q: string): boolean {
  const get = (): boolean => {
    try {
      return window.matchMedia(q).matches
    } catch {
      return false
    }
  }
  const [m, setM] = useState(get)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(q)
    } catch {
      return
    }
    const on = (): void => setM(mq.matches)
    mq.addEventListener('change', on)
    on()
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/** A callback whose identity never changes but always runs the latest code. */
function useStable<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...a: A) => ref.current(...a), [])
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const isLongform = (c: Clip): boolean => !!c.render_opts?.profile

/** Browse and edit the clips of processed videos: the video rail, the clip
 *  grid with multi-select, the inspector, and the full-screen Edit Bay.
 *  New videos are started from Create; clicking a clip anywhere navigates
 *  here with it selected (openInStudio). */
export default function ClipStudio({
  target,
  onTargetConsumed,
  active = true,
  creatorFilter = null
}: {
  target: StudioTarget | null
  onTargetConsumed: () => void
  active?: boolean
  creatorFilter?: number | null
}): JSX.Element {
  const visible = useVisible(active)
  const askConfirm = useConfirm()
  const reduced = useReducedMotion()
  const narrow = useMediaQuery('(max-width: 1279px)')

  const [videos, setVideos] = useState<Video[]>([])
  const [videosLoaded, setVideosLoaded] = useState(false)
  const [activeVideo, setActiveVideo] = useState<string | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [clipsLoaded, setClipsLoaded] = useState(false)
  const [selectedClip, setSelectedClip] = useState<number | null>(null)
  // Publish one clip, the selection, or everything shown: the same dialog,
  // handed a list, so the platform picker and the daily budget do not need a
  // second implementation.
  const [publishList, setPublishList] = useState<Clip[] | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [editingClipId, setEditingClipId] = useState<number | null>(null)
  const [morphId, setMorphId] = useState<number | null>(null)
  const [videoSearch, setVideoSearch] = useState('')
  const [creator, setCreator] = useState<string | null>(null)
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => readPref<boolean>('railCollapsed', false))
  // A connected native YouTube account or a configured social-posting
  // provider makes bulk publishing available.
  const [publishReady, setPublishReady] = useState(false)
  // Which provider a batch goes through. WoopSocial when it is set up.
  const [publishProvider, setPublishProvider] = useState<Provider | 'youtube'>('youtube')
  const [clipType, setClipType] = useState<ClipType>('all')
  const [sort, setSortState] = useState<ClipSort>(() => readPref<ClipSort>('clipSort', 'score'))
  const [density, setDensityState] = useState<Density>(() => readPref<Density>('density', 'm'))
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState<'export' | 'mark' | 'delete' | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [flashId, setFlashId] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const posters = useRef(new Map<number, HTMLDivElement>())
  const anchor = useRef<number | null>(null)
  const pendingClip = useRef<number | null>(null)
  const pendingCreatorPick = useRef<string | null>(null)
  const lastEventAt = useRef(Date.now())
  const stale = useRef(false)
  const loadSeq = useRef(0)
  const activeRef = useRef(activeVideo)
  activeRef.current = activeVideo
  const videosRef = useRef(videos)
  videosRef.current = videos
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const editingRef = useRef(editingClipId)
  editingRef.current = editingClipId
  const filterRef = useRef({ search: videoSearch, creator })
  filterRef.current = { search: videoSearch, creator }

  const setSort = (s: ClipSort): void => {
    setSortState(s)
    writePref('clipSort', s)
  }
  const setDensity = (d: Density): void => {
    setDensityState(d)
    writePref('density', d)
  }
  const toggleRail = (): void => {
    setRailCollapsed((c) => {
      writePref('railCollapsed', !c)
      return !c
    })
  }

  // Only while something is in flight, so an idle page never polls.
  const busy = videos.some((v) => v.status !== 'done' && v.status !== 'failed')

  /* ---------------- data ---------------- */

  const refreshVideos = async (): Promise<void> => {
    try {
      const v = await api.videos()
      setVideos(v)
      if (!activeRef.current && !target && v.length > 0) setActiveVideo(v[0].video_id)
    } catch {
      /* backend starting up */
    } finally {
      setVideosLoaded(true)
    }
  }

  /** The videos "All clips" covers: those the rail shows, newest first. */
  const allScope = (): string[] => {
    const { search, creator: who } = filterRef.current
    const q = search.trim().toLowerCase()
    return [...videosRef.current]
      .filter((v) => v.clip_count > 0 && matchesSearch(v, q) && (!who || creatorKeyOf(v) === who))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, ALL_CLIPS_VIDEOS)
      .map((v) => v.video_id)
  }

  const refreshClips = async (videoId: string): Promise<void> => {
    const seq = ++loadSeq.current
    let list: Clip[]
    try {
      if (videoId === ALL_CLIPS) {
        const ids = allScope()
        const byVideo = await loadClipsFor(ids)
        list = ids.flatMap((id) => byVideo[id] ?? [])
      } else {
        list = await api.clips(videoId)
      }
    } catch {
      list = []
    }
    if (seq !== loadSeq.current) return
    setClips(list)
    setClipsLoaded(true)
    if (pendingClip.current !== null) {
      const id = pendingClip.current
      pendingClip.current = null
      const found = list.find((x) => x.id === id)
      if (found) {
        setSelectedClip(id)
        setFlashId(id)
        if (narrow) setInspectorOpen(true)
        // A filter that hides the clip asked for would look like a dead link.
        setClipType((ct) =>
          ct === 'all' || (ct === 'longform') === isLongform(found) ? ct : 'all'
        )
      }
    }
  }
  const refreshActive = (): void => {
    if (activeRef.current) void refreshClips(activeRef.current)
  }

  // Our own changes: refresh the shared library (rail badges, Home) too.
  const touched = (videoIds: Iterable<string>): void => {
    const seen = new Set(videoIds)
    seen.forEach((id) => invalidateLibrary(id))
  }

  useEffect(() => {
    Promise.allSettled([api.youtubeStatus(), api.woopSocialStatus(), api.uploadPostStatus()]).then(
      ([youtube, woop, up]) => {
        const youtubeReady =
          youtube.status === 'fulfilled' &&
          Boolean(youtube.value.enabled && youtube.value.connected)
        const wsReady =
          woop.status === 'fulfilled' && Boolean(woop.value.enabled && woop.value.has_key)
        const upReady =
          up.status === 'fulfilled' && Boolean(up.value.enabled && up.value.has_key)
        setPublishReady(youtubeReady || wsReady || upReady)
        setPublishProvider(
          youtubeReady ? 'youtube' : wsReady ? 'woopsocial' : 'uploadpost'
        )
      }
    )
  }, [])

  useEffect(() => {
    void refreshVideos()
  }, [])

  // Another page changed the library (deleted a video, finished a render).
  useEffect(() => {
    const on = (): void => {
      if (!visibleRef.current) {
        stale.current = true
        return
      }
      void refreshVideos()
      if (activeRef.current === ALL_CLIPS) void refreshClips(ALL_CLIPS)
    }
    window.addEventListener('library-changed', on)
    return () => window.removeEventListener('library-changed', on)
  }, [])

  // Came back to the page after missing updates while hidden.
  useEffect(() => {
    if (!visible || !stale.current) return
    stale.current = false
    void refreshVideos()
    refreshActive()
  }, [visible])

  // Navigated here with a video (and clip): jump to it. Also when this page
  // is already mounted and showing that very video, which is why this can't
  // just set the active video and wait for its effect.
  useEffect(() => {
    if (!target) return
    const { videoId, clipId } = target
    setEditingClipId(null)
    setMorphId(null)
    setChecked(new Set())
    const known = videosRef.current.find((v) => v.video_id === videoId)
    if (!known) void refreshVideos()
    // A search or creator chip that would hide it from the rail goes.
    if (known && !matchesSearch(known, videoSearch.trim().toLowerCase())) setVideoSearch('')
    if (known && creator && creatorKeyOf(known) !== creator) setCreator(null)
    if (activeRef.current === videoId) {
      if (clipId !== undefined) {
        pendingClip.current = clipId
        void refreshClips(videoId)
      }
    } else {
      pendingClip.current = clipId ?? null
      setActiveVideo(videoId)
    }
    onTargetConsumed()
  }, [target])

  // "See their clips" (Creators): that creator's chip, and their newest video.
  useEffect(() => {
    if (creatorFilter == null) return
    const key = `creator:${creatorFilter}`
    setCreator(key)
    setVideoSearch('')
    pendingCreatorPick.current = key
  }, [creatorFilter])
  useEffect(() => {
    const key = pendingCreatorPick.current
    if (!key || !videosLoaded) return
    pendingCreatorPick.current = null
    const cur = videos.find((v) => v.video_id === activeVideo)
    if (activeVideo === ALL_CLIPS || (cur && creatorKeyOf(cur) === key)) return
    const first = [...videos]
      .filter((v) => creatorKeyOf(v) === key)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    if (first) setActiveVideo(first.video_id)
  }, [videos, videosLoaded, creatorFilter])

  useEffect(() => {
    setClips([])
    setClipsLoaded(false)
    if (activeVideo) void refreshClips(activeVideo)
    if (pendingClip.current === null) setSelectedClip(null)
    setExportNotice(null)
    setChecked(new Set())
    anchor.current = null
    mainRef.current?.querySelector('.lib-grid-scroll')?.scrollTo({ top: 0 })
  }, [activeVideo])

  // "All clips" follows the rail's filters.
  const scopeKey = activeVideo === ALL_CLIPS ? `${creator ?? ''}|${videoSearch.trim().toLowerCase()}|${videos.length}` : ''
  useEffect(() => {
    if (activeVideo !== ALL_CLIPS) return
    const id = setTimeout(() => void refreshClips(ALL_CLIPS), 250)
    return () => clearTimeout(id)
  }, [scopeKey])

  useStudioEvents((e: StudioEvent) => {
    lastEventAt.current = Date.now()
    const relevant =
      (e.type === 'progress' && (e.stage === 'render' || e.stage === 'done') && e.video_id) ||
      (e.type === 'job' && e.status === 'done')
    if (!relevant) return
    if (!visibleRef.current) {
      stale.current = true
      return
    }
    const av = activeRef.current
    if (e.type === 'progress' && e.video_id) {
      void refreshVideos()
      if (av === e.video_id || !av) {
        if (!av) setActiveVideo(e.video_id)
        void refreshClips(e.video_id)
      }
    }
    if (e.type === 'job' && e.status === 'done' && av) void refreshClips(av)
  })

  // Same reason as the Dashboard: the terminal event can be dropped for a
  // client that falls behind, and this page would then keep showing the clip
  // list from before the render.
  useJobWatch({
    active: busy && visible,
    lastEventAt,
    onSettled: () => {
      void refreshVideos()
      refreshActive()
    }
  })

  /* ---------------- derived ---------------- */

  const current = useMemo(() => clips.find((c) => c.id === selectedClip) ?? null, [clips, selectedClip])
  const activeInfo = videos.find((v) => v.video_id === activeVideo) ?? null
  // The direction given with this video's job, and what came of it.
  const activeDirection = activeInfo?.outcome?.intent ?? null
  // A Sports job: what the match gave.
  const activeMatch = activeInfo?.outcome?.sport ?? null
  // Rate & understand: what the Marketplace plugins chosen for it did.
  const activeOutcome = activeInfo?.outcome ?? null
  const editingClip = useMemo(
    () => clips.find((c) => c.id === editingClipId) ?? null,
    [clips, editingClipId]
  )

  const counts = useMemo(() => {
    const long = clips.filter(isLongform).length
    return { all: clips.length, longform: long, shorts: clips.length - long }
  }, [clips])

  const shownClips = useMemo(() => {
    const list = clips.filter((c) =>
      clipType === 'all' ? true : clipType === 'longform' ? isLongform(c) : !isLongform(c)
    )
    if (sort === 'score') list.sort((a, b) => b.score - a.score || a.id - b.id)
    else if (sort === 'newest')
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || b.id - a.id)
    else list.sort((a, b) => a.video_id.localeCompare(b.video_id) || a.start_s - b.start_s)
    return list
  }, [clips, clipType, sort])
  const toExport = useMemo(() => shownClips.filter((c) => !c.exported_at), [shownClips])
  const selectedClips = useMemo(() => shownClips.filter((c) => checked.has(c.id)), [shownClips, checked])
  const selecting = selectMode || checked.size > 0

  const stats = useMemo(() => {
    if (!shownClips.length) return null
    const best = Math.max(...shownClips.map((c) => c.score))
    const secs = shownClips.reduce((n, c) => n + Math.max(0, c.end_s - c.start_s), 0)
    return { best, avg: Math.round(secs / shownClips.length), exported: shownClips.length - toExport.length }
  }, [shownClips, toExport])

  // Drop ticks for clips that are no longer shown (filter, delete).
  useEffect(() => {
    setChecked((c) => {
      if (c.size === 0) return c
      const ids = new Set(shownClips.map((x) => x.id))
      const next = new Set([...c].filter((id) => ids.has(id)))
      return next.size === c.size ? c : next
    })
  }, [shownClips])

  // Scroll a clip that was asked for into view, and flash it.
  useEffect(() => {
    if (flashId === null) return
    const id = requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`.lib-grid-item[data-clip-id="${flashId}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      el.classList.remove('lib-flash')
      void el.offsetWidth
      el.classList.add('lib-flash')
      setTimeout(() => el.classList.remove('lib-flash'), 2600)
      setFlashId(null)
    })
    return () => cancelAnimationFrame(id)
  }, [flashId, shownClips])

  const activeTitle =
    activeVideo === ALL_CLIPS ? t('All clips') : activeInfo ? activeInfo.title || activeInfo.video_id : ''

  /* ---------------- editor (Edit Bay) ---------------- */

  const registerPoster = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) posters.current.set(id, el)
    else posters.current.delete(id)
  }, [])

  // The card's poster morphs into the Edit Bay stage (view transition).
  const openEditor = useStable((clip: Clip) => {
    const poster = posters.current.get(clip.id) ?? null
    markClipTransition(poster, clip.id)
    setInspectorOpen(false)
    void withViewTransition(() => {
      // The old snapshot is taken: hand the name over to the stage.
      if (poster) poster.style.viewTransitionName = ''
      setSelectedClip(clip.id)
      setMorphId(reduced ? null : clip.id)
      setEditingClipId(clip.id)
    })
  })

  // And back: the stage shrinks into the card it came from.
  const closeEditor = useStable(() => {
    const id = editingRef.current
    const frame = rootRef.current?.querySelector<HTMLElement>('.edit-bay-frame') ?? null
    const poster = id !== null ? (posters.current.get(id) ?? null) : null
    if (id === null || !frame || !poster || reduced) {
      setEditingClipId(null)
      setMorphId(null)
      return
    }
    frame.style.viewTransitionName = `clip-${id}`
    void withViewTransition(() => {
      setEditingClipId(null)
      setMorphId(null)
      poster.style.viewTransitionName = `clip-${id}`
    }).then(() => {
      poster.style.viewTransitionName = ''
      setFlashId(id)
    })
  })

  useBreadcrumbs(
    editingClip
      ? [
          { label: activeTitle || t('Clips'), onClick: closeEditor },
          { label: editingClip.title || editingClip.hook || t('Untitled clip') }
        ]
      : activeTitle
        ? [{ label: activeTitle }]
        : []
  )

  /* ---------------- single-clip actions ---------------- */

  const deleteClip = useStable(async (clip: Clip): Promise<void> => {
    const root = rootRef.current
    const anim = root ? collapseCard(root, clip.id, reduced) : Promise.resolve()
    try {
      await api.deleteClip(clip.id)
    } catch (e) {
      root
        ?.querySelector<HTMLElement>(`.lib-grid-item[data-clip-id="${clip.id}"]`)
        ?.getAnimations()
        .forEach((a) => a.cancel())
      toast({ tone: 'error', title: t('Could not delete'), body: errText(e) })
      return
    }
    await anim
    if (selectedClip === clip.id) setSelectedClip(null)
    setClips((cur) => cur.filter((c) => c.id !== clip.id)) // drop it immediately
    touched([clip.video_id])
    toast({ tone: 'success', title: t('Clip deleted'), duration: 2500 })
  })

  // The star on a card: mark or unmark a clip as exported by hand.
  const toggleExported = useStable(async (clip: Clip): Promise<void> => {
    try {
      const updated = await api.patchClip(clip.id, { exported: !clip.exported_at })
      setClips((cur) => cur.map((c) => (c.id === updated.id ? updated : c)))
      touched([clip.video_id])
    } catch (e) {
      toast({ tone: 'error', title: t('Could not update'), body: errText(e) })
    }
  })

  const publishOne = useStable((clip: Clip) => setPublishList([clip]))

  /* ---------------- selection ---------------- */

  const rangeIds = (from: number, to: number): number[] => {
    const ids = shownClips.map((c) => c.id)
    const a = ids.indexOf(from)
    const b = ids.indexOf(to)
    if (a < 0 || b < 0) return [to]
    const [lo, hi] = a < b ? [a, b] : [b, a]
    return ids.slice(lo, hi + 1)
  }

  const toggleCheck = (clip: Clip, range: boolean): void => {
    setChecked((cur) => {
      const next = new Set(cur)
      if (range && anchor.current !== null) {
        for (const id of rangeIds(anchor.current, clip.id)) next.add(id)
      } else if (next.has(clip.id)) next.delete(clip.id)
      else next.add(clip.id)
      return next
    })
    anchor.current = clip.id
  }
  const onCheck = useStable((clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => toggleCheck(clip, e.shiftKey))

  const onCardClick = useStable((clip: Clip, e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey && (selecting || anchor.current !== null)) {
      toggleCheck(clip, true)
      return
    }
    if (e.ctrlKey || e.metaKey || selecting) {
      toggleCheck(clip, false)
      return
    }
    anchor.current = clip.id
    setSelectedClip(clip.id)
    if (narrow) setInspectorOpen(true)
  })

  const clearSelection = (): void => {
    setChecked(new Set())
    setSelectMode(false)
    anchor.current = null
  }
  const selectAll = (): void => setChecked(new Set(shownClips.map((c) => c.id)))

  useHotkey('ctrl+a', selectAll, { when: active && editingClipId === null && shownClips.length > 0 })
  useHotkey(
    'escape',
    () => {
      // Registered handlers run before the shell's own Esc, so do its job
      // first: a modal dialog closes itself, a shell layer closes on top.
      if (document.querySelector('dialog[open]:modal')) return
      if (topLayer()) {
        closeLayer()
        return
      }
      if (inspectorOpen && narrow) {
        setInspectorOpen(false)
        return
      }
      clearSelection()
    },
    { when: active && editingClipId === null && (checked.size > 0 || selectMode || (narrow && inspectorOpen)) }
  )

  /* ---------------- batch actions ---------------- */

  // Every clip under the current format filter that isn't starred yet, into
  // the same folder single exports use. Exporting stars them.
  const exportAll = async (): Promise<void> => {
    if (toExport.length === 0) return
    const folder = await getExportFolder()
    const skipped = shownClips.length - toExport.length
    setExportingAll(true)
    setExportNotice(null)
    try {
      const res = await api.exportBatch(
        toExport.map((c) => c.id),
        folder
      )
      const n = res.exported.length
      const missing = toExport.length - n
      const msg =
        `Exported ${n} clip${n === 1 ? '' : 's'} to ${folder}.` +
        (skipped > 0 ? ` Skipped ${skipped} already starred as exported.` : '') +
        (missing > 0 ? ` ${missing} had no video file to copy.` : '')
      setExportNotice(msg)
      toast({ tone: missing > 0 ? 'warn' : 'success', title: t('Export finished'), body: msg })
      touched(toExport.map((c) => c.video_id))
      refreshActive()
    } catch (e) {
      const msg = `Export failed: ${errText(e)}`
      setExportNotice(msg)
      toast({ tone: 'error', title: t('Export failed'), body: errText(e) })
    } finally {
      setExportingAll(false)
    }
  }

  const exportSelected = async (): Promise<void> => {
    if (!selectedClips.length) return
    const folder = await getExportFolder()
    setBulkBusy('export')
    try {
      const res = await api.exportBatch(
        selectedClips.map((c) => c.id),
        folder
      )
      const n = res.exported.length
      const missing = selectedClips.length - n
      toast({
        tone: missing > 0 ? 'warn' : 'success',
        title: `${t('Exported')} ${n} ${n === 1 ? t('clip') : t('clips')}`,
        body: `${folder}${missing > 0 ? ` · ${missing} ${t('had no video file to copy.')}` : ''}`
      })
      touched(selectedClips.map((c) => c.video_id))
      refreshActive()
      clearSelection()
    } catch (e) {
      toast({ tone: 'error', title: t('Export failed'), body: errText(e) })
    } finally {
      setBulkBusy(null)
    }
  }

  const allSelectedExported = selectedClips.length > 0 && selectedClips.every((c) => !!c.exported_at)
  const markSelected = async (): Promise<void> => {
    if (!selectedClips.length) return
    const mark = !allSelectedExported
    setBulkBusy('mark')
    const updated: Clip[] = []
    let failed = 0
    const list = [...selectedClips]
    const worker = async (): Promise<void> => {
      while (list.length) {
        const c = list.shift()!
        try {
          updated.push(await api.patchClip(c.id, { exported: mark }))
        } catch {
          failed++
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker))
    const byId = new Map(updated.map((u) => [u.id, u]))
    setClips((cur) => cur.map((c) => byId.get(c.id) ?? c))
    touched(selectedClips.map((c) => c.video_id))
    setBulkBusy(null)
    if (failed) toast({ tone: 'error', title: t('Some clips could not be updated'), body: `${failed}` })
    else
      toast({
        tone: 'success',
        title: mark ? t('Marked as exported') : t('Unmarked'),
        body: `${updated.length} ${updated.length === 1 ? t('clip') : t('clips')}`,
        duration: 2500
      })
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selectedClips.length) return
    const n = selectedClips.length
    const ok = await askConfirm({
      title: `${t('Delete')} ${n} ${n === 1 ? t('clip') : t('clips')}?`,
      body: t('Each clip and its file are removed. The videos and your other clips stay. This can’t be undone.'),
      confirmLabel: `${t('Delete')} ${n}`,
      tone: 'danger'
    })
    if (!ok) return
    setBulkBusy('delete')
    const root = rootRef.current
    const doomed = [...selectedClips]
    const gone: number[] = []
    const list = [...doomed]
    const worker = async (): Promise<void> => {
      while (list.length) {
        const c = list.shift()!
        try {
          await api.deleteClip(c.id)
          gone.push(c.id)
          if (root) void collapseCard(root, c.id, reduced)
        } catch {
          /* counted below */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker))
    await new Promise((r) => setTimeout(r, reduced ? 0 : 430))
    const goneSet = new Set(gone)
    setClips((cur) => cur.filter((c) => !goneSet.has(c.id)))
    if (selectedClip !== null && goneSet.has(selectedClip)) setSelectedClip(null)
    touched(doomed.map((c) => c.video_id))
    setBulkBusy(null)
    clearSelection()
    const failed = n - gone.length
    toast({
      tone: failed ? 'warn' : 'success',
      title: `${t('Deleted')} ${gone.length} ${gone.length === 1 ? t('clip') : t('clips')}`,
      body: failed ? `${failed} ${t('could not be deleted.')}` : undefined
    })
  }

  /* ---------------- videos ---------------- */

  const deleteVideo = async (v: Video): Promise<void> => {
    const label = v.title || v.video_id
    const ok = await askConfirm({
      title: t('Delete this video and all its clips?'),
      body: (
        <>
          <span className="block text-ink mb-1.5">“{label}”</span>
          {t('This removes the files from disk too.')}
        </>
      ),
      confirmLabel: t('Delete video'),
      tone: 'danger'
    })
    if (!ok) return
    try {
      await api.deleteVideo(v.video_id)
    } catch (e) {
      toast({ tone: 'error', title: t('Could not delete'), body: errText(e) })
      return
    }
    const rest = videosRef.current.filter((x) => x.video_id !== v.video_id)
    setVideos(rest)
    if (activeRef.current === v.video_id) setActiveVideo(rest[0]?.video_id ?? null)
    invalidateLibrary(v.video_id)
    toast({ tone: 'success', title: t('Video deleted'), body: label, duration: 3000 })
  }

  const selectVideo = (id: string): void => {
    if (id === activeVideo && id === ALL_CLIPS) void refreshClips(ALL_CLIPS)
    setActiveVideo(id)
  }

  /* ---------------- render ---------------- */

  const notes: React.ReactNode[] = []
  if (exportNotice) notes.push(<p key="export" className="text-sm text-gold">{exportNotice}</p>)
  if (activeVideo !== ALL_CLIPS) {
    if (activeMatch) notes.push(<SportsNote key="sport" report={activeMatch} />)
    if (activeDirection) notes.push(<ClipDirectionNote key="dir" direction={activeDirection} />)
    if (activeOutcome?.steps?.length) notes.push(<PluginStepsNote key="steps" outcome={activeOutcome} />)
  }
  const notesUrgent = Boolean(activeDirection?.not_found?.length)

  const typeItems = [
    { id: 'all', label: t('All'), badge: counts.all },
    { id: 'shorts', label: t('Shorts'), icon: 'film' as const, badge: counts.shorts },
    { id: 'longform', label: t('Longform'), icon: 'maximize' as const, badge: counts.longform }
  ]

  const eyebrow =
    activeVideo === ALL_CLIPS
      ? t('Clip Editor')
      : activeInfo
        ? `${t('Clip Editor')} · ${creatorLabelOf(activeInfo)}`
        : t('Clip Editor')

  const inspector = current ? (
    <div className="lib-inspector-inner anim-fade" key={current.id}>
      <ClipEditor
        clip={current}
        onChanged={() => {
          touched([current.video_id])
          refreshActive()
        }}
        onOpenEditor={() => openEditor(current)}
        onPublish={publishReady ? () => setPublishList([current]) : undefined}
      />
    </div>
  ) : (
    <div className="lib-inspector-empty">
      <span className="lib-inspector-empty-icon" aria-hidden>
        <Icon name="scissors" size={22} />
      </span>
      <p className="text-sm text-ink font-medium">{t('Select a clip to preview and edit it.')}</p>
      <p className="text-xs text-muted leading-relaxed">
        {t('Double-click a clip, or press Enter on it, to open the full editor.')}
      </p>
    </div>
  )

  const gridBody = (): JSX.Element => {
    if (!videosLoaded || (activeVideo && !clipsLoaded)) {
      return (
        <div className={`lib-grid lib-grid-${density}`} aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="lib-skel-card">
              <span className="skeleton block aspect-[9/16] w-full" />
              <span className="skeleton block h-3 w-4/5 mt-2.5" />
              <span className="skeleton block h-2.5 w-1/2 mt-1.5" />
            </div>
          ))}
        </div>
      )
    }
    if (videos.length === 0) {
      return (
        <EmptyState
          illustration="film"
          title={t('Make your first clips')}
          body={t('Paste a link or add a video file, and Solaris Studio finds the best moments and cuts them into clips.')}
          action={
            <Button
              variant="gold"
              icon="plus"
              onClick={(e) => openCreate({ originRect: e.currentTarget.getBoundingClientRect() })}
            >
              {t('Make your first clips')}
            </Button>
          }
        />
      )
    }
    if (clips.length === 0) {
      if (activeVideo === ALL_CLIPS) {
        return (
          <EmptyState
            compact
            illustration="search"
            title={t('No clips here yet')}
            body={t('None of the videos in this view has clips.')}
          />
        )
      }
      return (
        <div className="lib-noclips anim-rise">
          <span className="lib-noclips-icon" aria-hidden>
            <Icon name="film" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <NoClipsExplanation outcome={activeInfo?.outcome} />
          </div>
        </div>
      )
    }
    if (shownClips.length === 0) {
      return (
        <EmptyState
          compact
          illustration="search"
          title={t('No clips match this filter')}
          action={
            <Button size="sm" variant="ghost" onClick={() => setClipType('all')}>
              {t('Show all clips')}
            </Button>
          }
        />
      )
    }
    return (
      <ClipGrid
        clips={shownClips}
        density={density}
        selectedClip={selectedClip}
        checked={checked}
        selecting={selecting}
        canPublish={publishReady}
        onCardClick={onCardClick}
        onCheck={onCheck}
        onOpen={openEditor}
        onDelete={deleteClip}
        onToggleExported={toggleExported}
        onPublish={publishOne}
        registerPoster={registerPoster}
      />
    )
  }

  return (
    <div ref={rootRef} className="lib-page" data-editing={editingClip ? '' : undefined}>
      <div
        ref={(el) => {
          mainRef.current = el
          if (el) (el as HTMLElement & { inert: boolean }).inert = Boolean(editingClip)
        }}
        className={`lib-layout ${railCollapsed ? 'lib-layout-railless' : ''} ${narrow ? 'lib-layout-narrow' : ''}`}
        aria-hidden={editingClip ? true : undefined}
      >
        <VideoRail
          videos={videos}
          loaded={videosLoaded}
          activeVideo={activeVideo}
          onSelect={selectVideo}
          onDelete={(v) => void deleteVideo(v)}
          search={videoSearch}
          onSearch={setVideoSearch}
          creator={creator}
          onCreator={setCreator}
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRail}
        />

        <main className="lib-center" aria-label={t('Clips')}>
          <div className="lib-grid-scroll">
            <div className="lib-center-inner">
              <PageHeader
                eyebrow={eyebrow}
                title={activeTitle || t('Clip Editor')}
                vtName="page-title"
                subtitle={
                  activeVideo && clips.length > 0 && stats ? (
                    <span className="lib-stats">
                      <span className="lib-stat">
                        <CountUp value={shownClips.length} className="text-ink font-semibold" />{' '}
                        {shownClips.length === 1 ? t('clip') : t('clips')}
                      </span>
                      <span className="lib-stat">
                        <Icon name="flame" size={13} className="text-gold" /> {t('best')}{' '}
                        <b className="text-gold-strong tabular">{stats.best}</b>
                      </span>
                      <span className="lib-stat">
                        <Icon name="clock" size={13} /> {t('avg')} <b className="text-ink tabular">{stats.avg}s</b>
                      </span>
                      <span className="lib-stat">
                        <Icon name="star" size={13} /> <b className="text-ink tabular">{stats.exported}</b>{' '}
                        {t('exported')}
                      </span>
                      {activeInfo && activeInfo.status !== 'done' && activeInfo.status !== 'failed' && (
                        <span className="lib-stat lib-stat-live">
                          <span className="lib-status-dot" aria-hidden /> {t('Still processing')}
                        </span>
                      )}
                    </span>
                  ) : undefined
                }
              />

              <ProcessingBar variant="slim" />

              {videos.length > 0 && activeVideo && (
                <div className="lib-toolbar" role="toolbar" aria-label={t('Clip tools')}>
                  <Segmented
                    size="sm"
                    ariaLabel="Filter clips by format"
                    items={typeItems}
                    value={clipType}
                    onChange={(v) => setClipType(v as ClipType)}
                  />
                  <label className="sr-only" htmlFor="lib-clip-sort">
                    {t('Sort clips')}
                  </label>
                  <select
                    id="lib-clip-sort"
                    className="input lib-select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as ClipSort)}
                  >
                    <option value="score">{t('Best score')}</option>
                    <option value="newest">{t('Newest')}</option>
                    <option value="time">{t('Time in video')}</option>
                  </select>
                  <Segmented
                    size="sm"
                    ariaLabel={t('Card size')}
                    items={[
                      { id: 's', label: 'S' },
                      { id: 'm', label: 'M' },
                      { id: 'l', label: 'L' }
                    ]}
                    value={density}
                    onChange={(v) => setDensity(v as Density)}
                  />
                  <Tooltip content={t('Pick several clips (Shift-click for a range, Ctrl+A for all)')}>
                    <button
                      type="button"
                      className="lib-tool-btn"
                      aria-pressed={selecting}
                      onClick={() => (selecting ? clearSelection() : setSelectMode(true))}
                    >
                      <Icon name="check" size={14} /> {t('Select')}
                    </button>
                  </Tooltip>

                  <span className="lib-toolbar-gap" />

                  <button
                    className="btn-accent lib-tool-main"
                    onClick={() => void exportAll()}
                    disabled={exportingAll || toExport.length === 0}
                    title={
                      toExport.length === 0
                        ? 'Every clip here is already starred as exported'
                        : `Export the ${toExport.length} clip${toExport.length === 1 ? '' : 's'} here that are not starred yet`
                    }
                  >
                    <Icon name="download" size={14} />
                    {exportingAll ? 'Exporting…' : `Export all (${toExport.length})`}
                  </button>
                  {/* Deliberately not styled as a twin of Export beside it.
                      Export writes files you can delete; this posts publicly and
                      cannot be undone, so it is quieter to look at and opens a
                      confirm rather than acting on the click. */}
                  {publishReady && (
                    <>
                      <button
                        className="btn-ghost lib-tool-main"
                        onClick={() => setPublishList(shownClips)}
                        disabled={shownClips.length === 0}
                        title={`Publish the ${shownClips.length} clip${shownClips.length === 1 ? '' : 's'} shown here to your social accounts`}
                      >
                        {`Publish all (${shownClips.length}) ↗`}
                      </button>
                      <button
                        className="btn-ghost lib-tool-main"
                        onClick={() => setShowSchedule(true)}
                        title="When each scheduled post is due, and what actually posted"
                      >
                        Schedule
                      </button>
                    </>
                  )}
                  <Tooltip content={t('Open calendar')}>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={t('Open calendar')}
                      onClick={() => navigate({ page: 'calendar' })}
                    >
                      <Icon name="calendar" size={16} />
                    </button>
                  </Tooltip>
                </div>
              )}

              {notes.length > 0 && (
                <Disclosure
                  key={activeVideo ?? ''}
                  defaultOpen={notesUrgent}
                  className="lib-notes"
                  summary={
                    <span className="inline-flex items-center gap-2">
                      <Icon name="note" size={15} className="text-gold" />
                      <span className="font-medium text-ink">{t('Notes for this video')}</span>
                      <span className="lib-chip tabular">{notes.length}</span>
                      {notesUrgent && <span className="lib-chip lib-chip-warn">{t('needs a look')}</span>}
                    </span>
                  }
                >
                  <div className="space-y-2.5">{notes}</div>
                </Disclosure>
              )}

              <div className="lib-grid-area">{gridBody()}</div>
            </div>
          </div>
          <BulkBar
            count={selectedClips.length}
            total={shownClips.length}
            allExported={allSelectedExported}
            busy={bulkBusy}
            onExport={() => void exportSelected()}
            onPublish={publishReady ? () => setPublishList(selectedClips) : undefined}
            onMarkExported={() => void markSelected()}
            onDelete={() => void deleteSelected()}
            onSelectAll={selectAll}
            onClear={clearSelection}
          />
        </main>

        {!narrow && (
          <aside className="lib-inspector" aria-label={t('Clip details')}>
            {inspector}
          </aside>
        )}
      </div>

      {narrow && (
        <Sheet
          open={inspectorOpen && current !== null && !editingClip}
          onClose={() => setInspectorOpen(false)}
          title={current ? current.title || current.hook || t('Untitled clip') : t('Clip details')}
          width="440px"
        >
          {inspector}
        </Sheet>
      )}

      {editingClip && (
        <div className="lib-bay-host">
          <EditorView
            clip={editingClip}
            onClose={closeEditor}
            onChanged={() => {
              touched([editingClip.video_id])
              refreshActive()
            }}
            vtName={morphId === editingClip.id ? `clip-${editingClip.id}` : undefined}
          />
        </div>
      )}

      {showSchedule && <ScheduleView onClose={() => setShowSchedule(false)} />}

      {publishList && (
        <PublishAllDialog
          clips={publishList}
          provider={publishProvider}
          onClose={() => {
            setPublishList(null)
            clearSelection()
            refreshActive()
          }}
        />
      )}
    </div>
  )
}
