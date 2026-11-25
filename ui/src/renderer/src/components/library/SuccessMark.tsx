/** A gold ring with a check that draws itself in (check-draw). */
export function SuccessMark({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg className="lib-success-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="17" className="lib-success-ring" />
      <path d="M12.5 20.5 17.5 25.5 28 14.5" className="lib-success-check" />
    </svg>
  )
}
