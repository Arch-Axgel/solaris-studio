import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { flyTo } from '../../lib/motion'
import { openCreate, useLayer } from '../../lib/nav'
import { useQueueSnapshot } from '../../lib/stores/queueStore'
import { Icon } from '../icons'
import AddVideos from '../queue/AddVideos'
import PresetChips, { presetFromGenerateBar, setPreset, type PresetId } from '../home/PresetChips'
import { Kbd, Segmented, Sheet, toast } from '../ui'

/** "New clips" (spec 4.3): the Generate bar in a wide sheet, reachable from
 *  anywhere (the orb, Ctrl+N, the palette, Home, Queue, `open-create`).
 *
 *  The Generate now / Add to queue switch decides what the button does:
 *  Generate now starts the queue (or lines up behind a running batch), Add
 *  to queue only adds, and the videos wait there until Start. */

interface CreatePayload {
  link?: string
  mode?: 'now' | 'queue'
  originRect?: DOMRect | null
}

/** A film clapper whose striped slate swings shut once when the sheet opens. */
function Clapper(): JSX.Element {
  return (
    <svg className="lyr-clapper" width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lyr-clap-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3dc9a" />
          <stop offset="1" stopColor="#a8743a" />
        </linearGradient>
      </defs>
      <rect x="4" y="13" width="24" height="15" rx="2.5" stroke="url(#lyr-clap-g)" strokeWidth="1.75" />
      <path d="M4 18h24" stroke="url(#lyr-clap-g)" strokeWidth="1.25" opacity=".6" />
      <g className="lyr-clapper-slate">
        <rect x="4" y="7" width="24" height="5.5" rx="1.5" stroke="url(#lyr-clap-g)" strokeWidth="1.75" />
        <path d="M9 7.2l-2.6 5.1M15 7.2l-2.6 5.1M21 7.2l-2.6 5.1M27 7.2l-2.6 5.1" stroke="url(#lyr-clap-g)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function CreateSheet(): JSX.Element | null {
  const { open, payload, close } = useLayer<CreatePayload>('create')
  const { processing, queued } = useQueueSnapshot()
  const busy = processing + queued > 0
  const [mode, setMode] = useState<'now' | 'queue'>('now')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [barPreset, setBarPreset] = useState<PresetId>(presetFromGenerateBar)
  const [presetKey, setPresetKey] = useState(0)
  // A fresh AddVideos per opening, so a handed-in link always seeds it. Its
  // rows survive anyway: AddVideos keeps its own draft.
  const session = useRef(0)
  const seen = useRef<{ open: boolean; payload: unknown }>({ open: false, payload: undefined })
  if (open && (!seen.current.open || seen.current.payload !== payload)) session.current++
  seen.current = { open, payload }

  useEffect(() => {
    if (!open) return
    setMode(payload?.mode ?? (busy ? 'queue' : 'now'))
    setBarPreset(presetFromGenerateBar())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload])

  const done = (): void => {
    const body = bodyRef.current
    const badge = document.querySelector('[data-fly-target="queue"]')
    if (body) flyTo(body, badge)
    toast({
      tone: 'success',
      icon: 'layers',
      title: t('Added to queue'),
      body: t('Solaris will tell you when the clips are ready.'),
      action: { label: t('View queue'), run: () => window.dispatchEvent(new Event('open-queue')) },
      secondary: { label: t('Keep adding'), run: () => openCreate() }
    })
    close()
  }

  const hint =
    mode === 'now'
      ? busy
        ? t('A video is already running, so these line up right behind it.')
        : t('The first video starts right away; any others wait their turn.')
      : busy
        ? t('Line up as many videos as you like. They run one after another, even while you edit.')
        : t('They wait in the queue until you press Start there, so you can line up a whole batch first.')

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('New clips')}
      width="min(1320px, 100vw)"
      originRect={payload?.originRect ?? null}
      className="lyr-create"
      header={
        <div className="lyr-create-head">
          <Clapper />
          <div className="min-w-0">
            <p className="t-micro text-muted">{t('Make')}</p>
            <p className="t-lg text-ink lyr-create-title" aria-hidden>{t('New clips')}</p>
          </div>
          <Segmented
            size="sm"
            ariaLabel={t('How to start')}
            value={mode}
            onChange={(v) => setMode(v as 'now' | 'queue')}
            items={[
              { id: 'now', label: t('Generate now'), icon: 'zap' },
              { id: 'queue', label: t('Add to queue'), icon: 'layers' }
            ]}
            className="lyr-create-seg"
          />
        </div>
      }
      footer={
        <div className="lyr-create-foot">
          <span className="lyr-create-tip">
            <Icon name="bulb" size={14} />
            {t('Tip: paste several links, or drop video files from your PC onto the list.')}
          </span>
          <span className="lyr-create-keys">
            <Kbd keys={['Ctrl', 'N']} /> {t('opens this from anywhere')}
          </span>
        </div>
      }
    >
      <div ref={bodyRef} className="lyr-create-body">
        <p className="lyr-create-hint" key={mode} aria-live="polite">
          <Icon name={mode === 'now' ? 'zap' : 'layers'} size={14} />
          {hint}
        </p>
        <div className="lyr-create-presets">
          <p className="t-micro shrink-0">{t('Start from')}</p>
          <PresetChips
            size="sm"
            value={barPreset}
            onChange={(id) => {
              setBarPreset(id)
              setPreset(id)
            }}
            applyToGenerateBar
            onApplied={() => setPresetKey((k) => k + 1)}
          />
        </div>
        <p className="lyr-create-explain">
          {t('A preset sets how new videos in the list start. Videos already listed keep their own settings, and every switch below can still be changed.')}
        </p>
        <div className="lyr-create-surface card">
          {session.current > 0 && (
            <AddVideos
              key={`${session.current}-${presetKey}`}
              onAdded={done}
              initialLink={payload?.link}
              start={mode === 'now'}
            />
          )}
        </div>
      </div>
    </Sheet>
  )
}
