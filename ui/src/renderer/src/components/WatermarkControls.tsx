import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { CAPTION_FONTS } from './CaptionStyleControls'
import { Folder, Rotate } from './icons'
import { toast } from './ui/Toast'
import type { WatermarkConfig } from '../lib/types'

const POSITIONS: {
  id: NonNullable<WatermarkConfig['position']>
  label: JSX.Element | string
  title: string
}[] = [
  { id: 'top_left', label: '↖', title: 'top left' },
  { id: 'top_right', label: '↗', title: 'top right' },
  { id: 'center', label: '⊙', title: 'center' },
  { id: 'bottom_left', label: '↙', title: 'bottom left' },
  { id: 'bottom_right', label: '↘', title: 'bottom right' },
  {
    id: 'moving',
    label: <Rotate />,
    title:
      'Moving — drifts in a small circle at one side edge, then jumps to the other. ' +
      'Hard to crop out, and it never crosses the middle of the shot.'
  }
]

/** Shown labels for the three watermark kinds; a function so t() runs at
 *  render, in the language chosen then. */
const TYPE_LABEL: Record<'text' | 'image' | 'both', () => string> = {
  text: () => t('Text'),
  image: () => t('Image'),
  both: () => t('Both')
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
  type: 'text',
  text: '@YourChannel',
  font: 'Arial Black',
  font_size: 42,
  color: '#FFFFFF',
  opacity: 0.85,
  position: 'bottom_right',
  padding: 0.04,
  scale: 0.18,
  rotation: 0,
  shadow: true
}

/** Live 9:16 (or 16:9) preview showing where/how the watermark will burn in. */
function Preview({ config, landscape }: { config: WatermarkConfig; landscape?: boolean }): JSX.Element {
  const pos = config.position ?? 'bottom_right'
  const padPct = (config.padding ?? 0.04) * 100
  const moving = pos === 'moving'
  const place: React.CSSProperties = { position: 'absolute', opacity: config.opacity ?? 0.85 }
  if (moving) {
    // TELEPORTS between the LEFT and RIGHT edge-centres (not top/bottom —
    // the platform UI covers those), orbiting a small circle at each. The
    // side switch is steps(1) so it jumps rather than sweeping through the
    // middle; the orbit runs on the inner element, since both animate
    // transform and would otherwise fight.
    place.top = '50%'
    place.right = `${padPct}%`
    place.transform = 'translateY(-50%)'
    place.animation = 'wm-side 6.8s steps(1) infinite'
  } else if (pos === 'custom') {
    place.left = `${(config.x ?? 0.5) * 100}%`
    place.top = `${(config.y ?? 0.5) * 100}%`
    place.transform = 'translate(-50%, -50%)'
  } else {
    if (pos.includes('top')) place.top = `${padPct}%`
    if (pos.includes('bottom')) place.bottom = `${padPct}%`
    if (pos.includes('left')) place.left = `${padPct}%`
    if (pos.includes('right')) place.right = `${padPct}%`
    if (pos === 'center') {
      place.top = '50%'
      place.left = '50%'
      place.transform = 'translate(-50%, -50%)'
    }
  }
  const showImg = (config.type === 'image' || config.type === 'both') && config.image_asset
  const showTxt = (config.type === 'text' || config.type === 'both') && config.text

  return (
    <div
      className={`relative mx-auto rounded-lg overflow-hidden bg-linear-to-br from-raised to-base border border-line/60 ${
        landscape ? 'aspect-video w-full max-w-[220px]' : 'aspect-[9/16] w-[117px] max-h-52'
      }`}
      aria-label="Watermark preview"
    >
      {moving && (
        <style>{`@keyframes wm-side {
          0%   { top:50%; bottom:auto; left:auto; right:${padPct}%; transform:translateY(-50%); }
          50%  { top:50%; bottom:auto; left:${padPct}%; right:auto; transform:translateY(-50%); }
        }
        @keyframes wm-orbit {
          0%   { transform: translate(3px, 0); }
          25%  { transform: translate(0, 3px); }
          50%  { transform: translate(-3px, 0); }
          75%  { transform: translate(0, -3px); }
          100% { transform: translate(3px, 0); }
        }`}</style>
      )}
      <div style={place}>
        <div
          className="flex flex-col items-center gap-0.5 leading-none"
          style={moving ? { animation: 'wm-orbit 3.4s linear infinite' } : undefined}
        >
          {showImg && (
            <img
              src={api.brandingAssetUrl(config.image_asset!)}
              alt=""
              style={{ width: `${(config.scale ?? 0.18) * (landscape ? 220 : 117)}px` }}
              className="max-w-none"
            />
          )}
          {showTxt && (
            <span
              style={{
                color: config.color ?? '#FFFFFF',
                fontFamily: config.font,
                fontSize: `${Math.max(7, (config.font_size ?? 42) * 0.16)}px`,
                textShadow: config.shadow ? '0 1px 2px rgba(0,0,0,0.9)' : 'none',
                transform: config.rotation ? `rotate(${config.rotation}deg)` : undefined,
                fontWeight: 700
              }}
            >
              {config.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function WatermarkControls({
  config,
  onChange,
  landscape,
  preview = true
}: {
  config: WatermarkConfig
  onChange: (patch: Partial<WatermarkConfig>) => void
  landscape?: boolean
  /** The mock preview beside the controls. Off where the real video next
   *  to them already draws the watermark live (the Edit Bay). */
  preview?: boolean
}): JSX.Element {
  const withImage = config.type === 'image' || config.type === 'both'
  const withText = config.type === 'text' || config.type === 'both'

  const upload = async (): Promise<void> => {
    const path = await window.studio.pickImageFile()
    if (!path) return
    try {
      const { asset } = await api.uploadBrandingAsset(path)
      onChange({ image_asset: asset })
    } catch (e) {
      toast({
        tone: 'error',
        title: `${t("Couldn't add that image:")} ${e instanceof Error ? e.message : String(e)}`
      })
    }
  }

  return (
    <div className={`grid grid-cols-1 gap-4 items-start ${preview ? 'sm:grid-cols-[1fr_auto]' : ''}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="label">{t('Type')}</span>
          {(['text', 'image', 'both'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={config.type === kind}
              onClick={() => onChange({ type: kind })}
              className={`min-h-7 px-2.5 py-1 rounded-md border transition-colors ${
                config.type === kind
                  ? 'bg-accent/20 border-gold/60 text-gold-strong font-medium'
                  : 'bg-raised border-line/60 text-muted hover:text-ink hover:border-gold/40'
              }`}
            >
              {TYPE_LABEL[kind]()}
            </button>
          ))}
        </div>

        {withImage && (
          <div className="flex items-center gap-2 text-xs">
            <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={upload}>
              <Folder className="mr-1.5" />
              {config.image_asset ? t('Replace logo') : t('Upload logo (PNG)')}
            </button>
            {config.image_asset && <span className="text-muted truncate">{t('✓ logo added')}</span>}
          </div>
        )}

        {withText && (
          <div className="space-y-2">
            <input
              className="input !py-1.5 text-sm w-full min-w-0"
              value={config.text ?? ''}
              placeholder="@YourChannel"
              aria-label={t('Watermark text')}
              onChange={(e) => onChange({ text: e.target.value })}
            />
            <div className="flex gap-2 flex-wrap text-xs items-center">
              <select
                aria-label={t('Watermark font')}
                className="min-h-7 bg-raised text-ink border border-line/60 rounded-md px-1.5 py-1 outline-none focus:border-gold"
                value={config.font}
                onChange={(e) => onChange({ font: e.target.value })}
              >
                {CAPTION_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1">
                {t('Size')}
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={config.font_size ?? 42}
                  onChange={(e) => onChange({ font_size: Number(e.target.value) })}
                  className="bg-raised text-ink border border-line/60 rounded-md px-1 py-1 w-14 outline-none focus:border-gold"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('Colour')}
                <input
                  type="color"
                  value={config.color ?? '#FFFFFF'}
                  onChange={(e) => onChange({ color: e.target.value })}
                  className="h-7 w-9 bg-raised rounded-md cursor-pointer border border-line/60"
                />
              </label>
              {/* The label is the 28px hit target; the box stays small. */}
              <label className="flex items-center gap-1.5 min-h-7 px-1 cursor-pointer">
                <input
                  type="checkbox"
                  className="size-4 accent-accent-strong"
                  checked={config.shadow ?? true}
                  onChange={(e) => onChange({ shadow: e.target.checked })}
                />
                {t('Shadow')}
              </label>
            </div>
          </div>
        )}

        {/* position + sliders */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="label">{t('Position')}</span>
          {POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={t(p.title)}
              aria-pressed={config.position === p.id}
              onClick={() => onChange({ position: p.id })}
              className={`w-7 h-7 rounded-md text-sm border transition-colors ${
                config.position === p.id
                  ? 'bg-accent/20 border-gold/60 text-gold-strong'
                  : 'bg-raised border-line/60 text-muted hover:text-ink hover:border-gold/40'
              }`}
              title={t(p.title)}
            >
              {p.label}
            </button>
          ))}
          {config.position === 'moving' && (
            <span className="text-[11px] text-muted">
              {t('circles at one edge, then jumps to the other — never the middle')}
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          {t('Opacity')}
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round((config.opacity ?? 0.85) * 100)}
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
            className="flex-1 accent-accent-strong"
          />
          <span className="tabular-nums w-8">{Math.round((config.opacity ?? 0.85) * 100)}%</span>
        </label>
        {withImage && (
          <label className="flex items-center gap-2 text-xs">
            {t('Logo size')}
            <input
              type="range"
              min={6}
              max={45}
              value={Math.round((config.scale ?? 0.18) * 100)}
              onChange={(e) => onChange({ scale: Number(e.target.value) / 100 })}
              className="flex-1 accent-accent-strong"
            />
            <span className="tabular-nums w-8">{Math.round((config.scale ?? 0.18) * 100)}%</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs">
          {t('Edge padding')}
          <input
            type="range"
            min={0}
            max={12}
            value={Math.round((config.padding ?? 0.04) * 100)}
            onChange={(e) => onChange({ padding: Number(e.target.value) / 100 })}
            className="flex-1 accent-accent-strong"
          />
          <span className="tabular-nums w-8">{Math.round((config.padding ?? 0.04) * 100)}%</span>
        </label>
      </div>

      {preview && <Preview config={config} landscape={landscape} />}
    </div>
  )
}
