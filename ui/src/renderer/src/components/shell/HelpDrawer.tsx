import { useEffect, useMemo, useRef, useState } from 'react'
import { GLOSSARY, helpFor } from '../../lib/help'
import { t } from '../../lib/i18n'
import { PAGES, navigate, openAssistant, openFeedback, openLayer, pageMeta, useLayer, useRoute, type Page } from '../../lib/nav'
import { Icon, type IconName } from '../icons'
import { Disclosure, Kbd, Sheet } from '../ui'

/** Help for the page you are on (spec 4.17): what it is for, how to do the
 *  common things, prompts to try with the assistant, and the glossary.
 *  Shell copy only. */

export default function HelpDrawer(): JSX.Element | null {
  const { open, payload, close } = useLayer<{ page?: Page }>('help')
  const route = useRoute()
  const [page, setPage] = useState<Page>(route.page)
  const [filter, setFilter] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  // The dialog would focus the first control, the page picker in the header,
  // and draw its ring on open. Start on the content instead (no ring on a
  // programmatic focus); Tab still reaches the picker.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      const el = bodyRef.current
      if (el && document.activeElement?.closest('.lyr-help-pick')) el.focus({ preventScroll: true })
    }, 30)
    return () => clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    setPage(payload?.page && PAGES.some((p) => p.id === payload.page) ? payload.page : route.page)
    setFilter('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload])

  const help = helpFor(page)
  const meta = pageMeta(page)

  const terms = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return Object.entries(GLOSSARY)
      .map(([k, v]) => [t(k), t(v)] as const)
      .filter(([k, v]) => !f || k.toLowerCase().includes(f) || v.toLowerCase().includes(f))
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [filter, open])

  const links: { label: string; icon: IconName; run: () => void }[] = [
    { label: t('Report a problem'), icon: 'bug', run: () => openFeedback() },
    { label: t('Re-run setup'), icon: 'wand', run: () => window.dispatchEvent(new Event('open-setup-wizard')) },
    { label: t('Take the tour'), icon: 'orbit', run: () => openLayer('tour') },
    { label: t('Keyboard shortcuts'), icon: 'keyboard', run: () => openLayer('shortcuts') }
  ]

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('Help')}
      width="440px"
      className="lyr-help-sheet"
      header={
        <div className="lyr-help-head">
          <span className="lyr-help-mark" aria-hidden>
            <Icon name="help" size={18} />
          </span>
          <div className="lyr-help-for min-w-0 flex-1">
            <p className="t-micro text-muted">{t('Help for')}</p>
            <label className="lyr-help-pick">
              <span className="sr-only">{t('Choose a page')}</span>
              <select value={page} onChange={(e) => setPage(e.target.value as Page)}>
                {PAGES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.label)}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={14} />
            </label>
          </div>
        </div>
      }
    >
      <div className="lyr-help" key={page} ref={bodyRef} tabIndex={-1}>
        {/* The page name is already the header's picker; the hero just says
            what the page is for. */}
        <section className="lyr-help-hero anim-rise" aria-label={t(meta.label)}>
          <span className="lyr-help-glyph" aria-hidden>
            <Icon name={meta.icon} size={24} />
          </span>
          <div className="min-w-0 self-center">
            <p className="text-sm text-ink leading-relaxed">{t(help.purpose)}</p>
            {page !== route.page && (
              <button
                type="button"
                className="lyr-help-go nudge"
                onClick={() => {
                  close()
                  navigate({ page })
                }}
              >
                {t('Go there')} <Icon name="arrow-right" size={13} />
              </button>
            )}
          </div>
        </section>

        {help.howTo.length > 0 && (
          <section className="lyr-help-sec">
            <h4 className="lyr-help-h t-micro">{t('How do I…')}</h4>
            <div className="lyr-help-qs stagger">
              {help.howTo.map((h, i) => (
                <div key={h.q} style={{ '--i': i } as React.CSSProperties} className="lyr-help-q">
                  <Disclosure summary={t(h.q)} defaultOpen={i === 0}>
                    <ol className="lyr-help-steps">
                      {h.steps.map((s, j) => (
                        <li key={j}>
                          <span className="lyr-help-n tabular" aria-hidden>
                            {j + 1}
                          </span>
                          <span>{t(s)}</span>
                        </li>
                      ))}
                    </ol>
                  </Disclosure>
                </div>
              ))}
            </div>
          </section>
        )}

        {help.tryPrompts.length > 0 && (
          <section className="lyr-help-sec">
            <h4 className="lyr-help-h t-micro">{t('Try asking')}</h4>
            <div className="lyr-help-chips">
              {help.tryPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="lyr-chip"
                  onClick={() => {
                    close()
                    openAssistant(t(p))
                  }}
                >
                  <Icon name="sparkle" size={12} />
                  {t(p).trim()}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="lyr-help-sec">
          <h4 className="lyr-help-h t-micro">{t('Glossary')}</h4>
          <div className="lyr-help-search">
            <Icon name="search" size={14} />
            <input
              className="input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Find a term…')}
              aria-label={t('Find a term')}
            />
          </div>
          {terms.length === 0 ? (
            <p className="text-sm text-muted mt-2">{t('No term matches that.')}</p>
          ) : (
            <dl className="lyr-help-terms">
              {terms.map(([k, v]) => (
                <div key={k} className="lyr-help-term">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="lyr-help-sec">
          <h4 className="lyr-help-h t-micro">{t('More help')}</h4>
          <div className="lyr-help-links">
            {links.map((l) => (
              <button
                key={l.label}
                type="button"
                className="lyr-help-link lift"
                onClick={() => {
                  close()
                  l.run()
                }}
              >
                <Icon name={l.icon} size={16} />
                <span>{l.label}</span>
                <Icon name="chevron-right" size={14} className="lyr-help-link-chev" />
              </button>
            ))}
          </div>
          <p className="lyr-help-keys text-xs text-muted">
            <Kbd keys={['F1']} /> {t('opens this panel')} · <Kbd keys={['?']} /> {t('lists every shortcut')}
          </p>
        </section>
      </div>
    </Sheet>
  )
}
