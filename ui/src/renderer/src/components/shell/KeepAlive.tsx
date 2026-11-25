import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react'
import { PAGES, releasePage, useMountedPages, useRoute, type Page } from '../../lib/nav'
import { PageContext } from '../../lib/stores/useVisible'
import { t } from '../../lib/i18n'

/** Keep-alive page host (spec 3.8).
 *
 *  A page mounts on first visit and stays mounted (up to 6, LRU in nav.ts),
 *  so search, selection and scroll survive switching pages. Inactive pages
 *  are `hidden` + `inert` + content-visibility:hidden, so they are never
 *  painted or captured by a view transition, and their polls pause through
 *  `active` / useVisible. Sections render in rail order, never LRU order:
 *  moving a DOM node would restart any video inside it. */

const RELEASE_AFTER_MS = 5 * 60_000
const RELEASABLE = new Set<Page>(['studio', 'marketplace'])
const ORDER = new Map(PAGES.map((p, i) => [p.id, i]))

/** Isolates a crashing page (or shell layer) so the rest of the app lives. */
export class ShellBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed and was isolated:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-8">
        <div className="card max-w-xl space-y-3 anim-rise">
          <p className="t-micro">{this.props.name}</p>
          <h2 className="t-lg text-ink">{t('This page hit a problem')}</h2>
          <p className="text-sm text-muted leading-relaxed">
            {t('Your videos, clips and edits are safe. The rest of Solaris Studio still works.')}
          </p>
          <pre className="t-mono text-muted/80 bg-abyss rounded-lg p-3 whitespace-pre-wrap break-words">
            {String(this.state.error.message)}
          </pre>
          <button className="btn-ghost" onClick={() => this.setState({ error: null })}>
            {t('Try again')}
          </button>
        </div>
      </div>
    )
  }
}

function Section({ page, active, children }: { page: Page; active: boolean; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current as (HTMLElement & { inert: boolean }) | null
    if (el) el.inert = !active
  }, [active])

  // Heavy pages are let go after 5 idle minutes, unless a dialog is open in them.
  useEffect(() => {
    if (active || !RELEASABLE.has(page)) return
    let id: ReturnType<typeof setTimeout>
    const attempt = (): void => {
      if (ref.current?.querySelector('dialog[open]')) id = setTimeout(attempt, 60_000)
      else releasePage(page)
    }
    id = setTimeout(attempt, RELEASE_AFTER_MS)
    return () => clearTimeout(id)
  }, [active, page])

  return (
    <section
      ref={ref}
      data-page={page}
      tabIndex={-1}
      hidden={!active}
      aria-hidden={!active || undefined}
      className={active ? 'keep-page page-active' : 'keep-page'}
      style={{ contentVisibility: active ? 'visible' : 'hidden' }}
    >
      <PageContext.Provider value={{ page, active }}>{children}</PageContext.Provider>
    </section>
  )
}

export default function KeepAlive({ render }: { render: (page: Page, active: boolean) => ReactNode }): JSX.Element {
  const mounted = useMountedPages()
  const route = useRoute()
  const pages = [...mounted].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0))
  return (
    <>
      {pages.map((page) => {
        const active = page === route.page
        const label = PAGES.find((p) => p.id === page)?.label ?? page
        return (
          <Section key={page} page={page} active={active}>
            <ShellBoundary name={t(label)}>{render(page, active)}</ShellBoundary>
          </Section>
        )
      })}
    </>
  )
}
