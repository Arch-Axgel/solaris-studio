import { useId } from 'react'
import { cx } from './position'

/** An on/off switch: <button role="switch" aria-checked>, with the thumb
 *  springing across. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  size = 'md',
  hideLabel,
  className
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: React.ReactNode
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  hideLabel?: boolean
  className?: string
}): JSX.Element {
  const id = useId()
  const descId = useId()
  return (
    <div className={cx('ui-toggle-row', disabled && 'opacity-50', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-labelledby={hideLabel ? undefined : `${id}-l`}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        className={cx('ui-switch', `ui-switch-${size}`)}
        data-on={checked ? 'true' : 'false'}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch-thumb" aria-hidden />
      </button>
      {!hideLabel && (
        <div className="min-w-0">
          <label id={`${id}-l`} htmlFor={id} className={cx('text-ink cursor-pointer select-none', size === 'lg' ? 'text-base font-semibold' : 'text-sm font-medium')}>
            {label}
          </label>
          {description && (
            <p id={descId} className="text-xs text-muted mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}
      {hideLabel && description && (
        <span id={descId} className="sr-only">
          {description}
        </span>
      )}
    </div>
  )
}
