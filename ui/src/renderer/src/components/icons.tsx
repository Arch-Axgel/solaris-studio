/** Tiny inline SVG icon set — one visual language across the editor instead
 *  of mixed-weight emoji. Stroke-based, inherits currentColor, no external
 *  dependency (the CSP blocks remote assets anyway). */

export interface IconProps {
  size?: number
  className?: string
}

function base(
  props: IconProps,
  children: React.ReactNode,
  viewBox = '0 0 24 24',
  strokeWidth = 2
): JSX.Element {
  const { size = 14, className } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className ?? ''}`}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const Scissors = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M8.1 15.9 20 4M14.7 9.3l-2.6 2.6" />
    </>
  )

export const Undo = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </>
  )

export const Keyboard = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  )

export const TrimStart = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M4 4v16" />
      <path d="M20 12H9" />
      <path d="m13 8-4 4 4 4" />
    </>
  )

export const TrimEnd = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M20 4v16" />
      <path d="M4 12h11" />
      <path d="m11 8 4 4-4 4" />
    </>
  )

export const Trash = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  )

export const Star = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  )

export const Zap = (p: IconProps = {}): JSX.Element =>
  base(p, <path d="M13 2 3 14h7l-1 8 12-13h-8l1-7z" />)

export const Ban = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  )

export const Pencil = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  )

export const Badge = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4-4-8 8" />
    </>
  )

export const Rotate = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v5h-5" />
    </>
  )

export const Folder = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  )

export const Refresh = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  )

export const Palette = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3 3h-2.4a2.6 2.6 0 0 0-1.9 4.4c.4.4.6.9.6 1.4a1.9 1.9 0 0 1-2 1.9z" />
      <circle cx="7.5" cy="11.5" r=".5" />
      <circle cx="10.5" cy="7.5" r=".5" />
      <circle cx="15.5" cy="7.5" r=".5" />
    </>
  )

export const Sparkle = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M12 3v0l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z" />
    </>
  )

export const Note = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  )

export const Film = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
    </>
  )

export const Chat = (p: IconProps = {}): JSX.Element =>
  base(p, <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />)

export const Bug = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M9 6a3 3 0 0 1 6 0M3 13h5M16 13h5M4 7l4 2M20 7l-4 2M4 19l4-2M20 19l-4-2" />
    </>
  )

export const Bulb = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.5-1 2.5h-6c0-1-.3-1.9-1-2.5A6 6 0 0 1 12 3z" />
    </>
  )

export const TrendUp = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  )

export const Image = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5-11 11" />
    </>
  )

/** YouTube publishing. A play triangle in the platform's rounded rectangle,
 *  drawn in the same stroke language as the rest of the set rather than the
 *  filled brand mark, so it sits with its neighbours in the tab strip. */
export const YouTube = (p: IconProps = {}): JSX.Element =>
  base(
    p,
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="M10 9.2v5.6l4.8-2.8z" />
    </>
  )

/** Fullscreen: four corners pulled out, as on a video player. */
export const Maximize = (p: IconProps = {}): JSX.Element =>
  base(p, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />)

/** Out of fullscreen: the corners pushed back in. */
export const Restore = (p: IconProps = {}): JSX.Element =>
  base(p, <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />)

/** Minimise to a bar. */
export const Minimize = (p: IconProps = {}): JSX.Element => base(p, <path d="M5 18h14" />)

/* ---------------------------------------------------------------------------
   Solaris Cockpit set (redesign). 24-unit grid, 1.75 stroke, round caps and
   joins, inherits currentColor. Use <Icon name="…"/> or the named exports. */

const line = (p: IconProps, children: React.ReactNode): JSX.Element =>
  base({ size: 18, ...p }, children, '0 0 24 24', 1.75)

export const Home = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  )
export const Plus = (p: IconProps = {}): JSX.Element => line(p, <path d="M12 5v14M5 12h14" />)
export const Layers = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17.5 9 4.5 9-4.5" opacity=".55" />
    </>
  )
export const Radar = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" opacity=".6" />
      <path d="M12 12 18.4 5.6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  )
export const Calendar = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M8 14h2M14 14h2M8 17.5h2" />
    </>
  )
export const Users = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </>
  )
export const Store = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
      <path d="M3 4h18l-1.5 5a3 3 0 0 1-5.5.8 3 3 0 0 1-4 0A3 3 0 0 1 4.5 9L3 4Z" />
      <path d="M10 21v-5h4v5" />
    </>
  )
export const Cpu = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </>
  )
export const HardDrive = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M2.5 13h19" />
      <path d="M5.5 5.3 2.5 13v5a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-5l-3-7.7A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.3Z" />
      <path d="M6.5 16.5h.01M10 16.5h.01" />
    </>
  )
export const Gear = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  )
export const Bell = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  )
export const Command = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />)
export const Search = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  )
export const ChevronLeft = (p: IconProps = {}): JSX.Element => line(p, <path d="m15 18-6-6 6-6" />)
export const ChevronRight = (p: IconProps = {}): JSX.Element => line(p, <path d="m9 18 6-6-6-6" />)
export const ChevronDown = (p: IconProps = {}): JSX.Element => line(p, <path d="m6 9 6 6 6-6" />)
export const ChevronUp = (p: IconProps = {}): JSX.Element => line(p, <path d="m18 15-6-6-6 6" />)
export const ArrowLeft = (p: IconProps = {}): JSX.Element => line(p, <path d="M19 12H5M12 19l-7-7 7-7" />)
export const ArrowRight = (p: IconProps = {}): JSX.Element => line(p, <path d="M5 12h14M12 5l7 7-7 7" />)
export const ArrowUp = (p: IconProps = {}): JSX.Element => line(p, <path d="M12 19V5M5 12l7-7 7 7" />)
export const ArrowDown = (p: IconProps = {}): JSX.Element => line(p, <path d="M12 5v14M19 12l-7 7-7-7" />)
export const Play = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z" />)
export const Pause = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </>
  )
export const Stop = (p: IconProps = {}): JSX.Element => line(p, <rect x="5" y="5" width="14" height="14" rx="2" />)
export const Check = (p: IconProps = {}): JSX.Element => line(p, <path d="m4.5 12.5 5 5L20 7" />)
export const X = (p: IconProps = {}): JSX.Element => line(p, <path d="M18 6 6 18M6 6l12 12" />)
export const Info = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-5M12 8h.01" />
    </>
  )
export const Alert = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5M12 17h.01" />
    </>
  )
export const Grip = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth={3} />)
export const Retry = Refresh
export const Log = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  )
export const Filter = (p: IconProps = {}): JSX.Element => line(p, <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z" />)
export const Grid = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  )
export const List = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />)
export const Upload = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5M12 3v12" />
    </>
  )
export const Download = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </>
  )
export const Link = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  )
export const ExternalLink = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
      <path d="M15 3h6v6M10 14 21 3" />
    </>
  )
export const Clock = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  )
export const Flame = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M12 22c4 0 7-2.8 7-7 0-4.5-4-7-4.5-11-2.5 1.5-4 4-4 6.5C9 9 8 8 8 6.5 6 8.3 5 11 5 15c0 4.2 3 7 7 7Z" />)
export const Wand = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="m3 21 12-12M13 7l4 4" />
      <path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M10 3v1.5M9.25 3.75h1.5" />
    </>
  )
export const Live = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  )
export const Heart = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />)
export const Help = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </>
  )
export const Pin = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 3.5 3.5V17h-11v-4.5L10 9 9 3Z" />
    </>
  )
export const PanelRight = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M15 3v18" />
    </>
  )
export const Sun = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  )
export const Orbit = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
      <circle cx="20" cy="7.6" r="1" fill="currentColor" />
    </>
  )
export const Clapper = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z" />
      <path
        className="clapper-slate"
        d="m3.3 9.6-.6-3.2a1.6 1.6 0 0 1 1.3-1.9l13.9-2.5a1.6 1.6 0 0 1 1.9 1.3l.6 3.2Z"
      />
      <path d="m7.5 5 2.7 3.6M12.6 4.1l2.7 3.6" />
    </>
  )
export const Send = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </>
  )
export const Eye = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  )
export const Copy = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  )
export const MoreH = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />)
export const Twitch = (p: IconProps = {}): JSX.Element =>
  line(
    p,
    <>
      <path d="M4 3h17v11l-5 5h-4l-3 3v-3H4V3Z" />
      <path d="M11 8v4M16 8v4" />
    </>
  )
export const Kick = (p: IconProps = {}): JSX.Element =>
  line(p, <path d="M4 3h5v5h2V5.5h2.5V3H19v6h-2.5v2.5H14v1h2.5V15H19v6h-5.5v-2.5H11V16H9v5H4V3Z" />)

/* ---------- name registry ---------- */

export type IconName =
  | 'home'
  | 'plus'
  | 'layers'
  | 'radar'
  | 'calendar'
  | 'users'
  | 'store'
  | 'cpu'
  | 'hard-drive'
  | 'gear'
  | 'bell'
  | 'command'
  | 'search'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'play'
  | 'pause'
  | 'stop'
  | 'check'
  | 'x'
  | 'info'
  | 'alert'
  | 'grip'
  | 'retry'
  | 'log'
  | 'filter'
  | 'grid'
  | 'list'
  | 'upload'
  | 'download'
  | 'link'
  | 'external-link'
  | 'clock'
  | 'flame'
  | 'wand'
  | 'live'
  | 'heart'
  | 'help'
  | 'keyboard'
  | 'pin'
  | 'panel-right'
  | 'sun'
  | 'orbit'
  | 'clapper'
  | 'send'
  | 'eye'
  | 'copy'
  | 'more-h'
  | 'twitch'
  | 'kick'
  | 'folder'
  | 'film'
  | 'sparkle'
  | 'scissors'
  | 'youtube'
  | 'undo'
  | 'trim-start'
  | 'trim-end'
  | 'trash'
  | 'star'
  | 'zap'
  | 'ban'
  | 'pencil'
  | 'badge'
  | 'rotate'
  | 'refresh'
  | 'palette'
  | 'note'
  | 'chat'
  | 'bug'
  | 'bulb'
  | 'trend-up'
  | 'image'
  | 'maximize'
  | 'restore'
  | 'minimize'

export const ICONS: Record<IconName, (p?: IconProps) => JSX.Element> = {
  home: Home,
  plus: Plus,
  layers: Layers,
  radar: Radar,
  calendar: Calendar,
  users: Users,
  store: Store,
  cpu: Cpu,
  'hard-drive': HardDrive,
  gear: Gear,
  bell: Bell,
  command: Command,
  search: Search,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  play: Play,
  pause: Pause,
  stop: Stop,
  check: Check,
  x: X,
  info: Info,
  alert: Alert,
  grip: Grip,
  retry: Retry,
  log: Log,
  filter: Filter,
  grid: Grid,
  list: List,
  upload: Upload,
  download: Download,
  link: Link,
  'external-link': ExternalLink,
  clock: Clock,
  flame: Flame,
  wand: Wand,
  live: Live,
  heart: Heart,
  help: Help,
  keyboard: Keyboard,
  pin: Pin,
  'panel-right': PanelRight,
  sun: Sun,
  orbit: Orbit,
  clapper: Clapper,
  send: Send,
  eye: Eye,
  copy: Copy,
  'more-h': MoreH,
  twitch: Twitch,
  kick: Kick,
  folder: Folder,
  film: Film,
  sparkle: Sparkle,
  scissors: Scissors,
  youtube: YouTube,
  undo: Undo,
  'trim-start': TrimStart,
  'trim-end': TrimEnd,
  trash: Trash,
  star: Star,
  zap: Zap,
  ban: Ban,
  pencil: Pencil,
  badge: Badge,
  rotate: Rotate,
  refresh: Refresh,
  palette: Palette,
  note: Note,
  chat: Chat,
  bug: Bug,
  bulb: Bulb,
  'trend-up': TrendUp,
  image: Image,
  maximize: Maximize,
  restore: Restore,
  minimize: Minimize
}

/** Any icon by name. Defaults to 18px, the shell's size. */
export function Icon({ name, size = 18, className }: { name: IconName } & IconProps): JSX.Element {
  const Cmp = ICONS[name] ?? Info
  return Cmp({ size, className })
}
