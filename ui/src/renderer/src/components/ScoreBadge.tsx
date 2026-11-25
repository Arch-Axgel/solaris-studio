/** Score badge: gold foil with a flame for the best clips (80+), gold text on
 *  smoked glass for good ones (65+), quiet for the rest. Opaque enough to read
 *  over a thumbnail. */
export default function ScoreBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }): JSX.Element {
  const tier = score >= 80 ? 'best' : score >= 65 ? 'good' : 'plain'
  return (
    <span className={`lib-score lib-score-${tier} ${size === 'sm' ? 'lib-score-sm' : ''}`} title={`Score ${score}`}>
      {tier === 'best' && (
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden className="lib-score-flame">
          <path
            d="M12 2c1 3.5 4.5 5.2 4.5 9.5A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.5c0-1.6.6-2.7 1.4-3.6.2 1.4 1 2.3 2 2.6C10.4 7.6 11 4.6 12 2Zm0 20a6 6 0 0 1-6-6c0-.5 0-.9.1-1.3A6 6 0 0 0 12 19a6 6 0 0 0 5.9-4.3c.1.4.1.8.1 1.3a6 6 0 0 1-6 6Z"
            fill="currentColor"
          />
        </svg>
      )}
      <span className="tabular">{score}</span>
    </span>
  )
}
