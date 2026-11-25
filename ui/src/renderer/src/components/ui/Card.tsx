import { forwardRef } from 'react'
import { cx } from './position'

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'plain' | 'interactive' | 'glass' | 'hero' | 'glow' | 'sunken'
  as?: 'div' | 'section' | 'article' | 'button'
  padded?: boolean
}

/** The .card surface and its variants. `padded={false}` drops the padding
 *  for media-first cards (posters, previews). */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { variant = 'plain', as = 'div', padded = true, className, children, ...rest },
  ref
) {
  const Tag = as as 'div'
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cx(
        'card',
        variant !== 'plain' && `card-${variant}`,
        !padded && '!p-0 overflow-hidden',
        as === 'button' && 'text-left w-full',
        className
      )}
      {...(as === 'button' ? { type: 'button' } : {})}
      {...rest}
    >
      {children}
    </Tag>
  )
})
