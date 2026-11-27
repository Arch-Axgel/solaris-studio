import type { FilterName } from '../lib/types'

/** CSS approximations of the FFmpeg color presets (video/filters.py is the
 *  source of truth for the real render). Used two ways:
 *  - tile previews in this picker (example gradient swatches)
 *  - live preview on the clip editor's <video> element */
export const FILTER_CSS: Record<FilterName, string> = {
  none: 'none',
  vibrant: 'saturate(1.35) contrast(1.08)',
  warm: 'sepia(0.22) saturate(1.2) hue-rotate(-8deg)',
  cool: 'saturate(1.05) hue-rotate(12deg)',
  cinematic: 'contrast(1.12) saturate(0.92) hue-rotate(-4deg)',
  vintage: 'sepia(0.38) contrast(0.95) saturate(0.85)',
  bw: 'grayscale(1) contrast(1.15)',
  fade: 'contrast(0.92) saturate(0.8) brightness(1.06)',
  golden: 'sepia(0.28) saturate(1.25) brightness(1.04) contrast(0.98) hue-rotate(-8deg)',
  tealorange: 'contrast(1.12) saturate(1.12) sepia(0.12) hue-rotate(-6deg)',
  cleangirl: 'brightness(1.08) contrast(0.92) saturate(0.9)',
  pinkglow: 'sepia(0.18) hue-rotate(-32deg) saturate(1.2) brightness(1.06) contrast(0.96)',
  peachy: 'sepia(0.22) hue-rotate(-16deg) saturate(1.25) brightness(1.04)',
  dreamy: 'brightness(1.06) contrast(0.84) saturate(0.85) sepia(0.08)',
  coast: 'hue-rotate(12deg) saturate(1.15) brightness(1.02) contrast(1.06)',
  glow: 'brightness(1.09) contrast(1.02) saturate(1.08)'
}

export const FILTER_NAMES = Object.keys(FILTER_CSS) as FilterName[]

const LABELS: Record<FilterName, string> = {
  none: 'None',
  vibrant: 'Vibrant',
  warm: 'Warm',
  cool: 'Cool',
  cinematic: 'Cinematic',
  vintage: 'Vintage',
  bw: 'B&W',
  fade: 'Fade',
  golden: 'Golden Hour',
  tealorange: 'Teal & Orange',
  cleangirl: 'Clean Girl',
  pinkglow: 'Pink Glow',
  peachy: 'Peachy',
  dreamy: 'Dreamy',
  coast: 'Gold Coast',
  glow: 'Soft Glow'
}

/** A sample every preset visibly transforms, in the app's own palette
 *  (shadow, burgundy, gold, highlight) rather than a rainbow: warm and
 *  cool shifts, fades and B&W all still read on it. */
const SWATCH_BG =
  'linear-gradient(135deg, var(--color-abyss) 0%, var(--color-velvet) 22%, var(--color-accent-strong) 48%, var(--color-gold) 76%, var(--color-ink) 100%)'

export default function FilterPicker({
  value,
  onChange
}: {
  value: FilterName
  onChange: (f: FilterName) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Color filter">
      {FILTER_NAMES.map((name) => (
        <button
          key={name}
          role="radio"
          aria-checked={value === name}
          onClick={() => onChange(name)}
          className={`rounded-lg overflow-hidden border text-left transition-colors ${
            value === name
              ? 'border-gold/60 bg-accent/20 ring-1 ring-gold/40'
              : 'border-line/60 bg-raised/40 hover:border-gold/40'
          }`}
        >
          <div
            className="h-10 w-full"
            style={{ background: SWATCH_BG, filter: FILTER_CSS[name] }}
            aria-hidden
          />
          <p className={`px-2 py-1 text-xs ${value === name ? 'text-gold-strong font-medium' : 'text-muted'}`}>
            {LABELS[name]}
          </p>
        </button>
      ))}
    </div>
  )
}
