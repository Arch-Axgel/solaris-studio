/** The one shared SVG gradient: `stroke: url(#solaris-gold)` (.icon-gold,
 *  EmptyState art). Mounted once in the Shell. */
export default function GoldGradientDefs(): JSX.Element {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        <linearGradient id="solaris-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3dc9a" />
          <stop offset="45%" stopColor="#ecc87c" />
          <stop offset="70%" stopColor="#d8b263" />
          <stop offset="100%" stopColor="#a8743a" />
        </linearGradient>
        <linearGradient id="solaris-ember" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a92f55" />
          <stop offset="100%" stopColor="#5a1229" />
        </linearGradient>
      </defs>
    </svg>
  )
}
