import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { categoryLabel, type Listing } from '../../lib/marketplace'
import { PLUGINS_CHANGED, plugins } from '../../lib/plugins'
import { motionReduced } from '../../lib/motion'
import { Icon } from '../icons'

/** The storefront row above the Marketplace tabs (spec 4.10): up to three
 *  large gradient cards for Solaris Studio's own listed pipelines. A
 *  listing can't be opened from outside Browse, so a card switches to
 *  Browse, types its name into the search box and focuses it. Copy follows
 *  the Marketplace word rules: "pipeline", never the developers' words. */

const HUES = ['ember', 'solar', 'velvet'] as const

/** Set a React-controlled input's value so its onChange runs. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function MarketplaceFeatured({ onBrowse }: { onBrowse: () => void }): JSX.Element | null {
  const [items, setItems] = useState<Listing[] | null>(null)
  const [stamp, setStamp] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    plugins
      .marketplace({ kind: 'pipeline' })
      .then((r) => {
        if (!live) return
        setItems(r.plugins.filter((p) => p.details?.tier === 'listed-official').slice(0, 3))
      })
      .catch(() => live && setItems([]))
    return () => {
      live = false
    }
  }, [stamp])

  useEffect(() => {
    const again = (): void => setStamp((n) => n + 1)
    window.addEventListener(PLUGINS_CHANGED, again)
    return () => window.removeEventListener(PLUGINS_CHANGED, again)
  }, [])

  if (!items || items.length === 0) return null

  const find = (name: string): void => {
    onBrowse()
    const market = root.current?.closest('.market')
    let tries = 0
    const attempt = (): void => {
      const input = market?.querySelector<HTMLInputElement>('input.input[placeholder]')
      if (!input) {
        if (tries++ < 10) setTimeout(attempt, 40)
        return
      }
      typeInto(input, name)
      input.focus()
      input.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'center' })
      input.classList.remove('anim-flash')
      void input.offsetWidth
      input.classList.add('anim-flash')
    }
    setTimeout(attempt, 40)
  }

  return (
    <div ref={root} className="market-featured" aria-label={t('Featured pipelines')} role="region">
      {items.map((l, i) => (
        <article key={l.id} className="market-feature anim-rise" data-hue={HUES[i % HUES.length]} style={{ animationDelay: `${i * 80}ms` }}>
          <div className="market-feature-glow" aria-hidden />
          <div className="relative flex items-center gap-2">
            <span className="market-feature-badge">
              <Icon name="sparkle" size={12} /> {t('From Solaris Studio')}
            </span>
            {l.category && <span className="t-micro text-ink/70">{t(categoryLabel(l.category))}</span>}
            {l.installed && (
              <span className="market-feature-badge market-feature-installed">
                <Icon name="check" size={12} /> {t('Installed')}
              </span>
            )}
          </div>
          <h3 className="relative t-lg text-ink mt-3">{l.name}</h3>
          {l.description && <p className="relative text-sm text-ink/80 mt-1.5 line-clamp-3">{l.description}</p>}
          <button type="button" className="market-feature-cta nudge" onClick={() => find(l.name)}>
            {t('Find it in Browse')}
            <Icon name="arrow-right" size={14} />
          </button>
        </article>
      ))}
    </div>
  )
}
