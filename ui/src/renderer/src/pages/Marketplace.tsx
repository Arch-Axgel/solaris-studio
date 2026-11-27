import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, topLayer, useRoute } from '../lib/nav'
import { usePageActive } from '../lib/stores/useVisible'
import { Overlay } from '../components/ui/Overlay'
import { Button, Callout, EmptyState, PageHeader, SearchInput, Toggle } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import {
  CATEGORY_LABELS,
  DIRECTORY_KINDS,
  RELATIONSHIP_LABELS,
  basedOnLines,
  catalogBadges,
  checkLines,
  KIND_LABELS,
  categoryLabel,
  compatibilityText,
  confirmations,
  entryLink,
  groupBySection,
  metricLines,
  executionBadge,
  fetchedText,
  fitSummary,
  formatBytes,
  indexName,
  isOurList,
  listedInText,
  listingLinks,
  needLines,
  ONLINE_LIST,
  onlineText,
  rangeText,
  safeLink,
  slugLabel,
  sourceLine,
  stepBadge,
  stepLines,
  tierBadge,
  updateLines,
  type Badge,
  type BasedOn,
  type BuiltinPlugin,
  type CatalogEntry,
  type CatalogResponse,
  type Counting,
  type Hardware,
  type InstalledPlugin,
  type LinkItem,
  type Listing,
  type MarketplaceResponse,
  type ModelPlan,
  type ModelStatus,
  type ModelsOverview,
  type Metrics,
  type OnlineList,
  type PluginDetails,
  type PluginPlan,
  type PluginsResponse,
  type ProblemHere,
  type Requirements,
  type Tone
} from '../lib/marketplace'
import {
  OPEN_MARKETPLACE,
  PLUGINS_CHANGED,
  canManage,
  plugins,
  takeMarketplaceTab,
  type MarketplaceTab,
  type PluginSource
} from '../lib/plugins'
import TechnicalDetails from '../components/TechnicalDetails'
import MarketplaceDevelopers from './MarketplaceDevelopers'
import MarketplaceFeatured from '../components/marketplace/MarketplaceFeatured'

/** The Marketplace: find community pipelines in the registry indexes, see
 *  what each one does and needs before installing, and manage the ones
 *  installed. Every listing shows its trust tier, where it runs, what it
 *  needs and what it may do, and a pipeline that sends anything off this PC
 *  says so in a warning. Nothing here runs plugin code: installing copies
 *  files, and a pipeline runs only when a video is processed with it. */

type Tab = MarketplaceTab

const TONE: Record<Tone, string> = {
  ok: 'bg-success/15 text-success border border-success/30',
  info: 'bg-accent/20 text-gold-strong border border-gold/30',
  warn: 'bg-warn/15 text-warn border border-warn/30',
  danger: 'bg-error/15 text-error border border-error/30'
}

const FIT_MARK: Record<string, { className: string }> = {
  yes: { className: 'text-success' },
  no: { className: 'text-error' },
  unknown: { className: 'text-warn' }
}

/** Leading marks in the catalog's and the engine's words, drawn with the
 *  app's icon set instead of text glyphs (a ✓ or ★ renders in whatever font
 *  has it and never lines up with the icons beside it). */
const GLYPH_ICONS: Record<string, IconName> = { '✓': 'check', '✔': 'check', '★': 'star', '✕': 'x', '⚠': 'alert' }

/** A line that may open with ✓, ★, ✕ or ⚠: the mark becomes an icon. The
 *  text is already translated (the English key keeps its mark). */
function Marked({ text, size = 12 }: { text: string; size?: number }): JSX.Element {
  const m = /^\s*([✓✔★✕⚠])\uFE0F?\s*/u.exec(text)
  if (m) {
    return (
      <>
        <Icon name={GLYPH_ICONS[m[1]]} size={size} className="market-mark" />
        <Marked text={text.slice(m[0].length)} size={size} />
      </>
    )
  }
  // A mark inside a sentence ("… code. ✓ Compatible: …") becomes an icon too.
  const parts = text.split(/([✓✔★✕⚠])️?/u)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <Icon key={i} name={GLYPH_ICONS[p]} size={size} className="market-mark market-mark-inline" /> : p
      )}
    </>
  )
}

function Pill({ badge }: { badge: Badge }): JSX.Element {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1 ${TONE[badge.tone]}`}
      title={badge.title}
    >
      <Marked text={badge.label} />
    </span>
  )
}

/** What a plugin does with a video's moments (details.steps, the engine's
 *  words), beside where it runs: Finds moments, Understands moments, Rates
 *  moments. Each pill's title says where it is chosen. */
function StepPills({ steps }: { steps: string[] | undefined }): JSX.Element {
  return (
    <>
      {(steps ?? []).map((words) => {
        const badge = stepBadge(words)
        return <Pill key={words} badge={{ ...badge, label: t(badge.label), title: t(badge.title) }} />
      })}
    </>
  )
}

/** What this PC has, for the requirement lines. Null until the engine answers. */
function useHardware(): Hardware | null {
  const [hw, setHw] = useState<Hardware | null>(null)
  useEffect(() => {
    let live = true
    api
      .systemStats()
      .then((s) => {
        if (!live) return
        setHw({
          gpu: s.gpu ? { name: s.gpu.name, vram_total: s.gpu.vram_total } : null,
          disk_free_bytes: typeof s.disk_free_bytes === 'number' ? s.disk_free_bytes : null,
          platform: window.studio?.platform && window.studio.platform !== 'browser' ? window.studio.platform : null
        })
      })
      .catch(() => undefined) // shown as "can't tell" until it answers
    return () => {
      live = false
    }
  }, [])
  return hw
}

/** A developer's links. Each opens in the browser only after a dialog that
 *  shows the full address; without the desktop app they are plain text. */
function Links({ links }: { links: LinkItem[] }): JSX.Element | null {
  if (links.length === 0) return null
  const open = window.studio?.openPluginLink
  return (
    <div className="space-y-1">
      <p className="label">{t('Links from the developer')}</p>
      <ul className="text-sm space-y-0.5">
        {links.map((l) => (
          <li key={l.url} className="flex items-center gap-2 min-w-0">
            {open ? (
              <button className="text-gold hover:underline text-left" onClick={() => void open(l.url)} title={l.url}>
                {t(l.label)} <Icon name="external-link" size={11} className="align-middle -mt-0.5" />
              </button>
            ) : (
              <span>{t(l.label)}</span>
            )}
            <span className="text-xs text-muted truncate select-all">{l.url}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A link to a project's own page, through the same dialog as a developer's
 *  links; plain text without the desktop app. */
function OutLink({ url, children }: { url: string | null; children: ReactNode }): JSX.Element {
  const open = window.studio?.openPluginLink
  if (!url) return <span>{children}</span>
  return open ? (
    <button className="text-gold hover:underline text-left" onClick={() => void open(url)} title={url}>
      {children} <Icon name="external-link" size={11} className="align-middle -mt-0.5" />
    </button>
  ) : (
    <span title={url}>{children}</span>
  )
}

/** A link from an Awesome Solaris Studio entry. It opens in the browser only
 *  after a dialog that shows the full address and says whether the link is in
 *  Solaris Studio's own list; plain text without the desktop app. */
function CatalogLink({
  url,
  ours,
  className,
  children
}: {
  url: string
  ours: boolean
  className: string
  children: ReactNode
}): JSX.Element {
  const open = window.studio?.openCatalogLink
  if (!open) return <span title={url}>{children}</span>
  return (
    <button className={className} onClick={() => void open(url, ours)} title={url}>
      {children} <Icon name="external-link" size={11} className="align-middle -mt-0.5" />
    </button>
  )
}

/** "owner/name" for a listing's code on GitHub (every list's listings have
 *  one, plugins/registry.py), or "" for anything else. */
function githubName(url: string | undefined): string {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url ?? '')
  return m ? `${m[1]}/${m[2]}` : ''
}

/** The page's own scroller (the keep-alive section), or null outside the app shell. */
function pageScroller(el: Element | null): HTMLElement | null {
  return (el?.closest('.keep-page') as HTMLElement | null) ?? null
}

/** An engine timestamp ("2026-10-13T18:17:01Z") as the reader's local date and time. */
function whenText(stamp: string): string {
  const d = new Date(stamp)
  return Number.isNaN(d.getTime()) ? stamp : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/** The projects a plugin builds on, with their licences: the credit their
 *  licences ask for, and what a user should know about where it comes from. */
function BuiltOn({ items }: { items: BasedOn[] | undefined }): JSX.Element | null {
  const lines = basedOnLines(items)
  if (lines.length === 0) return null
  return (
    <div className="text-sm">
      <p className="label mb-1">{t('Built on')}</p>
      <ul className="space-y-0.5">
        {lines.map((b) => (
          <li key={b.name}>
            <OutLink url={b.url}>{b.name}</OutLink> <span className="text-muted">· {t(b.text)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted mt-1">
        {t('Each of these keeps its own licence. The developer says how the pipeline uses them.')}
      </p>
    </div>
  )
}

/** Each number from its own source, never added together, and where comments live. */
function Numbers({
  metrics,
  discussions,
  at
}: {
  metrics: Metrics | undefined
  discussions?: string
  at?: string | null
}): JSX.Element | null {
  const lines = metricLines(metrics)
  const comments = safeLink(discussions)
  if (lines.length === 0 && !comments) return null
  return (
    <div className="text-sm">
      <p className="label mb-1">{t('Numbers')}</p>
      <ul className="space-y-0.5">
        {lines.map((l) => (
          <li key={l.text} className={l.tone === 'warn' ? 'text-warn' : ''}>
            <Marked text={t(l.text)} />
          </li>
        ))}
        {comments && (
          <li>
            <OutLink url={comments}>{t('Comments and ideas (opens GitHub’s website)')}</OutLink>
          </li>
        )}
      </ul>
      <p className="text-xs text-muted mt-1">
        {t('Each number comes from its own source and is read for the catalog, not by this app.')}
        {at ? ` ${t('Read on')} ${at}.` : ''}
      </p>
    </div>
  )
}

/** Everything the engine says a plugin will do, in its words. Shown on a
 *  listing's page, before an install and on an installed plugin. */
function DetailsBlock({
  details,
  requirements,
  hardware,
  problems,
  brief = false
}: {
  details: PluginDetails
  requirements?: Requirements
  hardware: Hardware | null
  /** What the engine found missing here; null when it wasn't asked. */
  problems: ProblemHere[] | null | undefined
  /** Under an installed card, whose header already shows the warning, the badges and the data warnings. */
  brief?: boolean
}): JSX.Element {
  const fit = needLines(requirements, hardware, details, problems)
  const exec = executionBadge(details.execution, details.execution_text)
  return (
    <div className="space-y-3 text-sm">
      {!brief && details.notice && (
        <p className="text-warn flex items-start gap-1.5">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{t(details.notice)}</span>
        </p>
      )}
      {!brief && (
        <div className="flex flex-wrap gap-2 items-center">
          <Pill badge={tierBadge(details)} />
          <Pill badge={exec} />
          <StepPills steps={details.steps} />
        </div>
      )}
      {details.execution_text && <p className="text-muted">{details.execution_text}</p>}
      {stepLines(details).map((line) => (
        <p key={line} className="text-muted">
          {t(line)}
        </p>
      ))}

      {!brief && details.data_warnings.length > 0 && (
        <ul className="space-y-1">
          {details.data_warnings.map((w) => (
            <li key={w} className="text-warn font-medium">
              {w}
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="label mb-1">{t('What it may do')}</p>
        {details.permissions.length === 0 ? (
          <p className="text-muted">{t('Asks for no permissions.')}</p>
        ) : (
          <ul className="space-y-0.5">
            {details.permissions.map((p) => (
              <li key={p.id}>
                {p.label} <span className="text-xs text-muted">({t(p.enforcement)})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted mt-1">
          {t(
            '“Solaris Studio hands this over”: Solaris Studio decides what the pipeline is given. “The developer says so”: a promise only. Nothing stops a pipeline doing more, because it can do anything you can do on this PC.'
          )}
        </p>
      </div>

      <div>
        <p className="label mb-1">{t('What it needs')}</p>
        {fit.length === 0 ? (
          <p className="text-muted">{t('Nothing stated by the developer.')}</p>
        ) : (
          <ul className="space-y-0.5">
            {fit.map((f) => (
              <li key={f.text} className="market-check">
                <span className={`market-fit ${FIT_MARK[f.fit].className}`} aria-label={f.fit}>
                  <Icon name={f.fit === 'yes' ? 'check' : f.fit === 'no' ? 'x' : 'help'} size={12} />
                </span>
                <span>{t(f.text)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {details.models.length > 0 && (
        <div>
          <p className="label mb-1">{t('Models it uses')}</p>
          <ul className="space-y-0.5">
            {details.models.map((m, i) => (
              <li key={`${m.name ?? m.id}-${i}`}>
                {m.name ?? m.id}
                {m.source && <span className="text-muted"> · {m.source}</span>}
                {m.id && m.name && <span className="text-muted"> · {m.id}</span>}
                {m.revision && <span className="text-muted"> @ {m.revision.slice(0, 10)}</span>}
                {m.license && <span className="text-muted"> · {t('licence')} {m.license}</span>}
                {m.size_bytes ? <span className="text-muted"> · {formatBytes(m.size_bytes)}</span> : null}
                {m.gated && <span className="text-warn"> · {t('needs an account with the model’s host')}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-1">
            {t('Once it is installed, its AI models from Hugging Face and the web are downloaded under Marketplace › Installed, into one folder every pipeline shares. Models that run in Ollama are added on the Models page.')}
          </p>
        </div>
      )}

      {details.service && (
        <div>
          <p className="label mb-1">{t('Online service')}</p>
          <p>
            {details.service.name}
            {details.service.pricing && <span className="text-muted"> · {details.service.pricing}</span>}
            {details.service.required ? (
              <span className="text-warn"> · {t('required')}</span>
            ) : (
              <span className="text-muted"> · {t('optional')}</span>
            )}
          </p>
          <p className="text-xs text-muted">
            {t('Any payment is between you and the developer. Solaris Studio takes no part in it.')}
          </p>
        </div>
      )}

      {details.secrets_notice && <p className="text-xs text-warn">{details.secrets_notice}</p>}
      {details.python_packages && <p className="text-xs text-warn">{details.python_packages}</p>}
    </div>
  )
}

/** At a glance, on every card: what it needs and what it asks for, each
 *  permission marked enforced or only declared, and the reminder that it is
 *  code running with the user's rights. */
function Summary({
  details,
  needs,
  firstParty = false
}: {
  details: PluginDetails
  needs: string[]
  /** Solaris Studio's own modes: there is no outside developer to state anything. */
  firstParty?: boolean
}): JSX.Element {
  return (
    <>
      <p className="text-xs">
        <span className="text-muted">{t('Needs')}: </span>
        {needs.length ? needs.map((n) => t(n)).join(' · ') : firstParty ? t('nothing extra') : t('nothing stated by the developer')}
      </p>
      {/* A plugin runs with the user's rights, so none of this is a limit on its own. */}
      <p className="text-xs">
        <span className="text-muted">{t('Asks for')}: </span>
        {details.permissions.length
          ? details.permissions.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                {p.label} <span className="text-muted">({t(p.enforcement)})</span>
              </span>
            ))
          : t('no permissions')}
      </p>
      {details.notice && (
        <p className="text-xs text-warn flex items-start gap-1.5">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          <span>{t(details.notice)}</span>
        </p>
      )}
    </>
  )
}

/** One listing in the results: what it is and, at a glance, its tier, where
 *  it runs, what it needs and what it may do. */
function ListingCard({
  listing,
  hardware,
  onOpen,
  onTag
}: {
  listing: Listing
  hardware: Hardware | null
  onOpen: () => void
  onTag: (tag: string) => void
}): JSX.Element {
  const d = listing.details
  const needs = needLines(listing.requirements, hardware, d, listing.problems_here)
  const fit = fitSummary(needs)
  const tags = listing.tags ?? []
  return (
    <div className="card market-card lift space-y-2.5 flex flex-col" data-category={listing.category}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <button className="market-card-title" onClick={onOpen}>
            {listing.name}
          </button>
          <p className="text-xs text-muted truncate">
            {listing.publisher} · {listing.latest}
          </p>
        </div>
        {listing.installed &&
          (listing.update_available ? (
            <Pill badge={{ label: `${t('Update')} ${listing.installed} → ${listing.latest}`, tone: 'info', title: '' }} />
          ) : (
            <Pill badge={{ label: `${t('Installed')} ${listing.installed}`, tone: 'ok', title: '' }} />
          ))}
      </div>
      {/* At a glance: who stands behind it, one list badge and whether it runs here. Where it runs,
          its steps and its licence are on its page (Details). */}
      <div className="flex flex-wrap gap-1.5">
        <Pill badge={tierBadge(d)} />
        {catalogBadges(listing.badges, true)
          .slice(0, 1)
          .map((b) => (
            <Pill key={b.label} badge={b} />
          ))}
        {fit && <Pill badge={{ ...fit, title: '' }} />}
      </div>
      {listing.unofficial && <p className="text-xs text-muted">{listing.unofficial}</p>}
      <p className="text-sm text-muted line-clamp-3" title={listing.description}>
        {listing.description}
      </p>
      {metricLines(listing.metrics).length > 0 && (
        <p className="text-xs text-muted">
          {metricLines(listing.metrics)
            .slice(0, 2)
            .map((l, i) => (
              <span key={l.text}>
                {i > 0 && ' · '}
                <Marked text={t(l.text)} />
              </span>
            ))}
        </p>
      )}
      {listing.events && listing.events.length > 0 && (
        <p className="text-xs">
          <span className="text-muted">{t('Finds')}: </span>
          {listing.events.slice(0, 6).map(slugLabel).join(' · ')}
          {listing.events.length > 6 ? ' …' : ''}
        </p>
      )}
      {d.data_warnings.map((w) => (
        <p key={w} className="text-xs text-warn font-medium">
          {w}
        </p>
      ))}
      <Summary details={d} needs={needs.map((n) => n.text)} />
      <div className="market-card-foot">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {listing.category && <span className="market-cat">{t(categoryLabel(listing.category))}</span>}
          {tags.slice(0, 4).map((tag) => (
            <button key={tag} className="market-tag" onClick={() => onTag(tag)} title={t('Show listings with this tag')}>
              #{tag}
            </button>
          ))}
          {tags.length > 4 && <span className="text-xs text-muted px-1">+{tags.length - 4}</span>}
        </div>
        <Button variant="ghost" size="sm" iconRight="arrow-right" className="shrink-0" onClick={onOpen}>
          {t('Details')}
        </Button>
      </div>
    </div>
  )
}

/** A listing's own page: everything, every version, and Install. */
/** Esc steps back out of a sub-view (a listing, For developers) when nothing
 *  else claims the key: no shell layer, modal, popover or floating rail on top,
 *  and focus not in a text field. */
function useEscapeBack(enabled: boolean, back: () => void): void {
  // Pages stay mounted behind others (KeepAlive): only the visible one listens.
  const active = usePageActive() && enabled
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || topLayer()) return
      if (document.querySelector('dialog[open], [aria-modal="true"], .ui-pop:popover-open, .rail-scrim')) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      backRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

function ListingPage({
  listing,
  hardware,
  manage,
  online,
  onBack,
  onInstall,
  onTag
}: {
  listing: Listing
  hardware: Hardware | null
  manage: boolean
  /** Solaris Studio's online list, for how fresh a listing from it is. */
  online: OnlineList | undefined
  onBack: () => void
  onInstall: (source: PluginSource) => void
  onTag: (tag: string) => void
}): JSX.Element {
  useEscapeBack(true, onBack)
  const [version, setVersion] = useState(listing.latest)
  const chosen = listing.versions.find((v) => v.version === version) ?? listing.versions[0]
  const latest = listing.versions.find((v) => v.version === listing.latest)
  const samePermissions = (a?: string[], b?: string[]): boolean =>
    JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort())
  const settings = Object.entries(listing.settings ?? {})
  const checks = checkLines(listing.checks)
  const official = listing.details?.tier === 'listed-official'
  const code = githubName(listing.repository)
  const works = rangeText(chosen?.requires?.solaris_studio)
  const testedWith = chosen?.tested_with
  // A list from elsewhere can give anything here, so a bad item reads oddly rather than breaking the page.
  const tested = Array.isArray(testedWith)
    ? testedWith.map((g) => [g?.game && slugLabel(String(g.game)), g?.version].filter(Boolean).join(' ')).join(', ')
    : testedWith
  const action =
    listing.installed === version
      ? t('Install again')
      : listing.installed
        ? `${t('Install')} ${version} (${t('installed')}: ${listing.installed})`
        : `${t('Install')} ${version}`
  return (
    <div className="space-y-4">
      <Button variant="subtle" size="sm" icon="arrow-left" className="market-back" onClick={onBack}>
        {t('Back to results')}
      </Button>
      <div className="market-listing">
      <section className="card market-listing-main space-y-4">
        <div>
          <h3 className="t-xl text-ink">{listing.name}</h3>
          <p className="text-sm text-muted">
            {/* The id alone: its publisher part is what the list build checked. The author's name is
                the developer's own words, shown only under "Where it comes from" as theirs. */}
            {listing.id}
            {listing.license ? ` · ${t('licence')} ${listing.license}` : ''}
            {listing.category ? ` · ${categoryLabel(listing.category)}` : ''}
          </p>
          {listing.unofficial && <p className="text-sm text-muted mt-1">{listing.unofficial}</p>}
          {/* Official/Community is the tier, shown once in the details block below. */}
          {catalogBadges(listing.badges, true).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {catalogBadges(listing.badges, true).map((b) => (
                <Pill key={b.label} badge={b} />
              ))}
            </div>
          )}
          {listing.featured && (
            <p className="text-xs text-muted mt-2 flex items-center gap-1.5">
              <Icon name="star" size={12} className="text-gold" />
              {t('Featured')}: {listing.featured.reason}
            </p>
          )}
        </div>
        <p className="text-ink/90 leading-relaxed">{listing.description}</p>
        {listing.events && listing.events.length > 0 && (
          <div>
            <p className="label mb-1.5">{t('What it finds')}</p>
            <ul className="market-finds">
              {listing.events.map((e) => (
                <li key={e}>
                  <Icon name="check" size={12} className="text-gold shrink-0" />
                  {slugLabel(e)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {listing.games && listing.games.length > 0 && (
          <p className="text-sm">
            <span className="text-muted">{t('For')}: </span>
            {listing.games.map(slugLabel).join(', ')}
          </p>
        )}
        {listing.tags && listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {listing.tags.map((tag) => (
              <button
                key={tag}
                className="market-tag market-tag-boxed"
                onClick={() => onTag(tag)}
                title={t('Show listings with this tag')}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <DetailsBlock
          details={listing.details}
          requirements={listing.requirements}
          hardware={hardware}
          problems={listing.problems_here}
        />

        {settings.length > 0 && (
          <div className="text-sm">
            <p className="label mb-1">{t('Settings you can change')}</p>
            <ul className="space-y-0.5">
              {settings.map(([name, s]) => (
                <li key={name}>
                  {s.title ?? name}
                  {s.type === 'secret' && <span className="text-muted"> · {t('a key you enter once')}</span>}
                  {s.description && <span className="text-muted"> · {s.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <BuiltOn items={listing.based_on} />
        <Numbers metrics={listing.metrics} discussions={listing.discussions_url} />
        <Links links={listingLinks(listing)} />

        <div className="text-sm">
          <p className="label mb-1">{t('Where it comes from')}</p>
          {/* The code's address is what the list build checked (the developer owns it, the version is on
              its branch); the author's name is the developer's own words, checked only for length. */}
          <p>
            {code && `${t('Its code is on GitHub at')} ${code}. `}
            {t(listedInText(listing.index, online, Date.now()))}
          </p>
          {listing.author?.name && (
            <p>
              {t('Its developer gives their name as')} {listing.author.name}.
            </p>
          )}
          {/* An Official listing's code is the Solaris Studio project's own, so the "nobody at Solaris Studio
              has read it" line is left out there. A Community listing always says something about
              checks, even none, because the Browse footer sends people here to read them. */}
          {checks.length > 0 && (
            <ul className="text-xs text-muted mt-1">
              <li>
                {isOurList(listing.index)
                  ? t('Checks run when Solaris Studio’s list was built:')
                  : `${t('Checks this list reports')} (${indexName(listing.index)}):`}
              </li>
              {checks.map((c) => (
                <li key={c.text} className={`market-check ${c.ok ? '' : 'text-error'}`}>
                  <Icon name={c.ok ? 'check' : 'x'} size={12} className={c.ok ? 'text-success' : ''} />
                  <span>
                    {t(c.text)}
                    {!c.ok && ` (${t('not passed')})`}
                  </span>
                </li>
              ))}
              {!official && (
                <li>{t('These checks are automatic. Nobody at Solaris Studio has read this pipeline’s code.')}</li>
              )}
            </ul>
          )}
          {checks.length === 0 && !official && (
            <p className="text-xs text-muted mt-1">
              {t(
                'This list doesn’t report any automatic checks that Solaris Studio knows about. Nobody at Solaris Studio has read this pipeline’s code.'
              )}
            </p>
          )}
          <TechnicalDetails
            rows={[
              ['Repository', listing.repository],
              ['Folder', listing.path && listing.path !== '.' ? listing.path : null],
              ['Commit', chosen?.commit],
              ['Tag', chosen?.tag],
              ['requires.solaris_studio', chosen?.requires?.solaris_studio],
              ['List', isOurList(listing.index) ? null : listing.index]
            ]}
          />
        </div>

      </section>

      {/* The install box: beside the details on a wide window (sticky while
          they scroll), straight under the back button on a narrow one. */}
      <aside className="card market-listing-aside space-y-3" aria-label={t('Install')}>
          <div className="space-y-3">
            <label className="text-sm flex flex-col gap-1.5">
              <span className="label">{t('Version')}</span>
              <select className="input" value={version} onChange={(e) => setVersion(e.target.value)}>
                {listing.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.date ? ` · ${v.date}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="accent"
              icon="download"
              className="w-full"
              disabled={!manage || Boolean(chosen?.problem_here)}
              title={manage ? '' : t('Installing pipelines needs the Solaris Studio desktop app.')}
              onClick={() => onInstall({ kind: 'index', id: listing.id, version })}
            >
              {action}
            </Button>
            {!manage && <p className="text-xs text-muted">{t('Installing pipelines needs the Solaris Studio desktop app.')}</p>}
          </div>
          {chosen?.problem_here && (
            <p className="text-sm text-error flex items-start gap-1.5">
              <Icon name="x" size={14} className="mt-0.5 shrink-0" />
              <span>
                {t('This version can’t run here')}: {chosen.problem_here}
              </span>
            </p>
          )}
          {chosen && compatibilityText(chosen.compatibility) && (
            <p className={`text-sm ${compatibilityText(chosen.compatibility)?.tone === 'ok' ? 'text-success' : 'text-warn'}`}>
              <Marked text={t(compatibilityText(chosen.compatibility)?.text ?? '')} />
            </p>
          )}
          {chosen && latest && chosen.version !== latest.version && !samePermissions(chosen.permissions, latest.permissions) && (
            <p className="text-sm text-warn flex items-start gap-1.5">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>
                {t(
                  'This version asks for different permissions from the one described above. Install lists exactly what it asks for before anything is installed.'
                )}
              </span>
            </p>
          )}
          {(works || tested) && (
            <p className="text-xs text-muted">
              {works ? `${t('Works with Solaris Studio')} ${t(works)}.` : ''}
              {works && tested ? ' ' : ''}
              {tested ? `${t('Tested with')} ${tested}.` : ''}
            </p>
          )}
          <p className="text-xs text-muted border-t border-line/50 pt-3">
            {t('Install shows you exactly what will be installed first. Nothing from the pipeline runs until you process a video with it.')}
          </p>
      </aside>
      </div>
    </div>
  )
}

/** One app, model, workflow, integration or tool. They aren't installed
 *  from here: each has one button to its download page or home, and one
 *  that runs inside Solaris Studio through a listed pipeline links to that. */
function EntryCard({
  entry,
  onOpenListing
}: {
  entry: CatalogEntry
  onOpenListing: (id: string) => void
}): JSX.Element {
  const link = entryLink(entry)
  const ours = isOurList(entry.index)
  const numbers = metricLines(entry.metrics)
  const discussions = safeLink(entry.discussions_url)
  return (
    <div className="card space-y-2 flex flex-col">
      <div>
        <span className="font-semibold">{entry.name}</span>
        <p className="text-xs text-muted">
          {t(RELATIONSHIP_LABELS[entry.relationship] ?? entry.relationship)}
          {entry.uses ? ` · ${t(entry.uses === 'both' ? 'uses the API and the SDK' : entry.uses === 'sdk' ? 'uses the SDK' : 'uses the local API')}` : ''}
          {entry.runs ? ` · ${t(entry.runs === 'local' ? 'runs locally' : entry.runs === 'cloud' ? 'runs online' : 'local or online')}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {catalogBadges(entry.badges).map((b) => (
          <Pill key={b.label} badge={b} />
        ))}
        <Pill badge={{ label: `${t('Licence')} ${entry.license}`, tone: 'info', title: t('The licence its authors chose') }} />
        {!entry.checked && (
          <Pill badge={{ label: t('Not yet checked'), tone: 'warn', title: t('Added by its authors; a maintainer hasn’t checked it against the criteria yet.') }} />
        )}
      </div>
      {entry.unofficial && <p className="text-xs text-muted">{entry.unofficial}</p>}
      <p className="text-sm">{entry.description}</p>
      {entry.license_note && <p className="text-xs text-muted">{t('Licence note')}: {entry.license_note}</p>}
      {entry.warning && (
        <p className="text-xs text-warn font-medium flex items-start gap-1.5">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          <span>{entry.warning}</span>
        </p>
      )}
      {numbers.length > 0 && (
        <ul className="text-xs text-muted space-y-0.5">
          {numbers.map((l) => (
            <li key={l.text} className={l.tone === 'warn' ? 'text-warn' : ''}>
              <Marked text={t(l.text)} />
            </li>
          ))}
        </ul>
      )}
      {entry.featured && (
        <p className="text-xs text-muted flex items-center gap-1.5">
          <Icon name="star" size={12} className="text-gold shrink-0" />
          {entry.featured.reason}
        </p>
      )}
      <div className="mt-auto pt-1 space-y-2">
        {entry.setup === 'technical' && (
          <p className="text-xs text-warn">{t('Needs technical setup (command line or Python)')}</p>
        )}
        {link && (
          <div className="space-y-1">
            <CatalogLink url={link.url} ours={ours} className="btn-ghost !py-1.5">
              {t(link.label)}
              {link.host ? ` ${link.host}` : ''}
            </CatalogLink>
            <p className="text-xs text-muted">{t('Not installed by Solaris Studio · opens a website')}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          {entry.adapter &&
            (entry.adapter_listed ? (
              <button className="btn-ghost !py-1.5" onClick={() => onOpenListing(entry.adapter ?? '')}>
                {t('Use it in Solaris Studio')} →
              </button>
            ) : (
              <span className="text-xs text-muted">
                {t('Runs in Solaris Studio through')} {entry.adapter}
              </span>
            ))}
          {discussions && (
            <CatalogLink url={discussions} ours={ours} className="text-xs text-gold hover:underline text-left">
              {t('Discussions')}
            </CatalogLink>
          )}
          {Array.isArray(entry.platforms) && entry.platforms.length > 0 && (
            <span className="text-xs text-muted">{entry.platforms.map(slugLabel).join(', ')}</span>
          )}
          {entry.index && entry.index !== 'bundled' && (
            <span className="text-xs text-muted">
              {t('From')} {indexName(entry.index)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Awesome Solaris Studio's other kinds, by section: apps, models, workflows,
 *  integrations and tools around Solaris Studio. */
function CatalogBrowse({
  kind,
  q,
  stamp,
  onOpenListing
}: {
  kind: string
  q: string
  /** Changes when the lists may have changed (a check for new pipelines), so the entries load again. */
  stamp: number
  onOpenListing: (id: string) => void
}): JSX.Element {
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Another kind's entries would land under this kind's sections until the new answer comes.
  useEffect(() => setData(null), [kind])
  useEffect(() => {
    let live = true
    const timer = setTimeout(
      () => {
        plugins
          .catalog({ q: q.trim(), kind })
          .then((r) => {
            if (!live) return
            setData(r)
            setError(null)
          })
          .catch((e: Error) => live && setError(e.message))
      },
      q ? 250 : 0
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [kind, q, stamp])
  if (error) return <div className="card text-error text-sm">{error}</div>
  if (!data) return <p className="text-muted">{t('Loading…')}</p>
  const groups = groupBySection(data.entries, data.sections[kind]?.sections)
  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <div className="card text-sm">
          {q.trim()
            ? t('Nothing in Awesome Solaris Studio matches that.')
            : t('Nothing of this kind is in Awesome Solaris Studio yet.')}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.id || 'other'} className="space-y-2">
          <div>
            <h3 className="font-semibold">{t(g.title)}</h3>
            {g.description && <p className="text-xs text-muted">{t(g.description)}</p>}
          </div>
          <div className="market-grid grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
            {g.entries.map((e) => (
              <EntryCard key={e.id} entry={e} onOpenListing={onOpenListing} />
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-muted border-t border-line/50 pt-3">
        {t('From Awesome Solaris Studio, a curated list; an entry from another list you added says where it came from. Built with Solaris Studio: a separate app or tool that uses Solaris Studio. Each project keeps its own licence.')}
        {data.metrics_at ? ` ${t('Numbers read on')} ${data.metrics_at}.` : ''}
      </p>
    </div>
  )
}

/** Whether installs are counted, and the switch. */
function CountingNote({ manage }: { manage: boolean }): JSX.Element | null {
  const [state, setState] = useState<Counting | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    plugins.counting().then(setState).catch(() => setState(null))
  }, [])
  if (!state) return null
  const toggle = (on: boolean): void => {
    setProblem(null)
    plugins
      .setCounting(on)
      .then(setState)
      .catch((e: Error) => setProblem(e.message))
  }
  return (
    <div className="space-y-1">
      <Toggle
        checked={state.enabled}
        disabled={!manage || state.locked_off}
        onChange={toggle}
        label={t('Count my installs')}
        description={
          <>
            {t(state.text)}
            {/* plugins.count_installs is in this Windows account's own settings.yaml (core/paths.py), not the whole PC's. */}
            {state.locked_off && ` ${t('Switched off in your Solaris Studio settings file.')}`}
            {!state.active && ` ${t('Nothing is counted yet: Solaris Studio’s list doesn’t count installs yet.')}`}
          </>
        }
      />
      {state.locked_off && (
        <TechnicalDetails rows={[['Setting', 'plugins.count_installs: false in settings.yaml']]} />
      )}
      {problem && <p className="text-error">{problem}</p>}
    </div>
  )
}

/** Whether the Marketplace checks Solaris Studio's online list by itself, and the switch. */
function OnlineListNote({ manage, online }: { manage: boolean; online: OnlineList | undefined }): JSX.Element | null {
  const [state, setState] = useState<OnlineList | undefined>(online)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => setState(online), [online])
  if (!state) return null
  const toggle = (on: boolean): void => {
    setProblem(null)
    plugins
      .setOnline(on)
      .then(setState)
      .catch((e: Error) => setProblem(e.message))
  }
  return (
    <div className="space-y-1">
      <Toggle
        checked={state.automatic}
        disabled={!manage}
        onChange={toggle}
        label={t('Check Solaris Studio’s online list once a day for new pipelines, and for warnings about pipelines you have.')}
        description={t('It is one file from GitHub; nothing about you or what you browse is sent.')}
      />
      {problem && <p className="text-error">{problem}</p>}
    </div>
  )
}

/** Search and browse the registry indexes. */
function Browse({
  hardware,
  manage,
  onInstall,
  onDevelopers
}: {
  hardware: Hardware | null
  manage: boolean
  onInstall: (source: PluginSource) => void
  /** Opens For developers (installing from a folder or a link). */
  onDevelopers: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const kind = 'pipeline'
  /** "pipeline", or one of the directory's other kinds (DIRECTORY_KINDS). */
  const [view, setView] = useState('pipeline')
  /** A listing opened from an app's card, kept open until the full list has loaded. */
  const opening = useRef<string | null>(null)
  const [data, setData] = useState<MarketplaceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [stamp, setStamp] = useState(0)
  // Opening a listing starts at its top; Back returns to where Browse was.
  const root = useRef<HTMLDivElement>(null)
  const browseScroll = useRef(0)
  const openListing = (id: string | null): void => {
    const scroller = pageScroller(root.current)
    if (id && scroller) browseScroll.current = scroller.scrollTop
    setOpen(id)
  }
  useLayoutEffect(() => {
    const scroller = pageScroller(root.current)
    if (!scroller) return
    scroller.scrollTo({ top: open ? 0 : browseScroll.current })
  }, [open])
  // The other kinds that have something in them. One with nothing made for
  // Solaris Studio yet gets no tab, rather than a tab that opens on nothing.
  const [present, setPresent] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    plugins
      .catalog()
      .then((r) => live && setPresent(new Set(r.entries.map((e) => e.kind))))
      .catch(() => live && setPresent(new Set()))
    return () => {
      live = false
    }
  }, [stamp])
  useEffect(() => {
    if (view !== 'pipeline' && !present.has(view)) setView('pipeline')
  }, [present])

  useEffect(() => {
    let live = true
    const timer = setTimeout(
      () => {
        plugins
          .marketplace({ q: q.trim(), category, tag, kind })
          .then((r) => {
            if (!live) return
            if (!q.trim() && !category && !tag) opening.current = null
            setData(r)
            setError(null)
          })
          .catch((e: Error) => live && setError(e.message))
      },
      q ? 250 : 0
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, category, tag, stamp])

  useEffect(() => {
    const again = (): void => setStamp((n) => n + 1)
    window.addEventListener(PLUGINS_CHANGED, again)
    return () => window.removeEventListener(PLUGINS_CHANGED, again)
  }, [])

  // Opening the Marketplace checks Solaris Studio's online list when its copy is
  // a day old and the switch is on (the engine decides); new pipelines then
  // appear without waiting for an app update. Quiet: the footer says how it
  // went, and the button shows the check while it runs.
  useEffect(() => {
    if (!manage) return
    let live = true
    setRefreshing(true)
    plugins
      .refresh(true)
      .then((r) => live && r.checked && setStamp((n) => n + 1))
      .catch(() => undefined)
      .finally(() => live && setRefreshing(false))
    return () => {
      live = false
    }
  }, [manage])

  const refresh = (): void => {
    setRefreshing(true)
    setRefreshNote(null)
    plugins
      .refresh()
      .then((r) => {
        const failed = r.indexes.filter((i) => !i.ok)
        setRefreshNote(
          failed.length
            ? failed
                .map((i) =>
                  i.url === ONLINE_LIST
                    ? `${t('Couldn’t check Solaris Studio’s online list.')} ${t(i.error ?? '')}`.trim()
                    : `${indexName(i.url)}: ${t(i.error ?? 'could not be fetched')}`
                )
                .join(' · ')
            : t('Up to date.')
        )
        setStamp((n) => n + 1)
      })
      .catch((e: Error) => setRefreshNote(e.message))
      .finally(() => setRefreshing(false))
  }

  // A listing the current results no longer have is closed, so it can't
  // reopen by itself when a later search brings it back.
  useEffect(() => {
    if (open && data && !data.plugins.some((p) => p.id === open) && opening.current !== open) setOpen(null)
  }, [data, open])

  const listing = open ? data?.plugins.find((p) => p.id === open) : null
  if (listing)
    return (
      <div ref={root}>
      <ListingPage
        listing={listing}
        hardware={hardware}
        manage={manage}
        online={data?.online}
        onBack={() => {
          opening.current = null
          setOpen(null)
        }}
        onInstall={onInstall}
        onTag={(tg) => {
          setTag(tg)
          browseScroll.current = 0
          setOpen(null)
        }}
      />
      </div>
    )

  const others = (data?.indexes ?? []).filter((i) => i.kind === 'other')
  const onlineNever = !(data?.online?.fetched_at ?? null)
  /** Where new pipelines come from on this screen: the button, or (in a browser) the desktop app. */
  const getThem = manage
    ? t('Press Check for new pipelines below.')
    : t('The Solaris Studio desktop app checks for new pipelines.')
  const filtered = Boolean(q.trim() || category || tag)
  const clearFilters = (): void => {
    setQ('')
    setCategory('')
    setTag('')
  }
  return (
    <div className="space-y-4" ref={root}>
      <SearchInput
        className="market-search"
        value={q}
        onChange={setQ}
        hotkey
        placeholder={t('Search: a game, a sport, “podcast”, “captions”…')}
        ariaLabel={t('Search the Marketplace')}
      />

      <div className="market-typetabs" role="tablist" aria-label={t('Type')}>
        {[
          ['pipeline', KIND_LABELS.pipeline],
          ...Object.entries(DIRECTORY_KINDS).filter(([id]) => present.has(id))
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className="market-typetab"
            onClick={() => setView(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {view !== 'pipeline' && (
        <CatalogBrowse
          kind={view}
          q={q}
          stamp={stamp}
          onOpenListing={(id) => {
            opening.current = id
            setView('pipeline')
            setQ('')
            setCategory('')
            setTag('')
            openListing(id)
          }}
        />
      )}

      {view === 'pipeline' && (
      <>
      <div className="market-chips" role="group" aria-label={t('Category')}>
        <button className="market-chip" aria-pressed={!category} onClick={() => setCategory('')}>
          {t('All')}
        </button>
        {(data?.categories ?? Object.keys(CATEGORY_LABELS)).map((c) => (
          <button key={c} className="market-chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>
            {t(categoryLabel(c))}
          </button>
        ))}
        {tag && (
          <button className="market-chip" aria-pressed onClick={() => setTag('')} aria-label={`#${tag} · ${t('Clear')}`}>
            #{tag} <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {error && (
        <Callout tone="error" title={t('Couldn’t load the Marketplace')}>
          {error}
        </Callout>
      )}
      {!data && !error && <p className="text-muted">{t('Loading…')}</p>}

      {data && data.plugins.length === 0 && (
        <div className="card text-sm space-y-1">
          {filtered ? (
            <EmptyState
              compact
              illustration="search"
              title={t('Nothing listed matches that. Try fewer words, or another category.')}
              action={
                <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>
                  {t('Clear search')}
                </Button>
              }
            />
          ) : (
            <>
              <p>{t('No pipelines are listed yet.')}</p>
              <p className="text-muted">
                {onlineNever
                  ? `${t('Solaris Studio hasn’t got its online list yet.')} ${getThem}`
                  : others.some((i) => !i.cached)
                    ? `${t('Some lists added on this PC haven’t been checked yet.')} ${getThem}`
                    : `${t('None of Solaris Studio’s lists has a pipeline yet.')} ${t(
                        'Pipelines added to Solaris Studio’s list appear here after the next check for new pipelines.'
                      )}`}
              </p>
            </>
          )}
        </div>
      )}

      {data && data.plugins.length > 0 && (
        <div className="market-grid stagger grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
          {data.plugins.map((p) => (
            <ListingCard
              key={p.id}
              listing={p}
              hardware={hardware}
              onOpen={() => openListing(p.id)}
              onTag={(tg) => setTag(tg)}
            />
          ))}
        </div>
      )}

      {data && (
        <div className="market-foot text-xs text-muted space-y-2 border-t border-line/50 pt-4">
          {data.online?.error ? (
            <Callout tone="warn" className="text-xs">
              <p>{t(onlineText(data.online, Date.now(), manage))}</p>
              {manage && (
                <Button variant="ghost" size="sm" icon="refresh" className="mt-2" loading={refreshing} onClick={refresh}>
                  {t('Try again')}
                </Button>
              )}
            </Callout>
          ) : (
            <p>{t(onlineText(data.online, Date.now(), manage))}</p>
          )}
          {others.map((i) => (
            <p key={i.url}>
              {indexName(i.url)}: {i.plugins ?? 0} {i.plugins === 1 ? t('pipeline') : t('pipelines')}
              {` · ${t(fetchedText(i.fetched_at, Date.now()))}`}
            </p>
          ))}
          {manage && !data.online?.error && (
            <Button variant="ghost" size="sm" icon="refresh" loading={refreshing} onClick={refresh}>
              {refreshing ? t('Checking…') : t('Check for new pipelines')}
            </Button>
          )}
          {refreshNote && <p>{refreshNote}</p>}
          <p className="max-w-3xl">
            {t(
              'Pipelines made by other developers: some find a video’s moments their own way, and others rate the moments found or say what happens in them. Solaris Studio cuts, frames and captions the clips as usual. Free to list and free to install; Solaris Studio handles no payments.'
            )}
          </p>
          <p className="max-w-3xl">
            <Marked
              text={t(
                'Community: made by someone outside the Solaris Studio project. Its page says which automatic checks its list reports. Nobody at Solaris Studio has read its code. ✓ Compatible: Solaris Studio installed this version and ran it on a test video without errors. That is not a safety check. Browsing here tells nobody what you look at.'
              )}
            />
          </p>
          <div className="market-prefs">
            <OnlineListNote manage={manage} online={data.online} />
            <CountingNote manage={manage} />
          </div>
        </div>
      )}
      <button className="market-devlink text-xs text-muted hover:text-ink" onClick={onDevelopers}>
        <Icon name="keyboard" size={14} />
        {t('For developers: install a pipeline you’re writing')}
        <Icon name="arrow-right" size={12} />
      </button>
      </>
      )}
    </div>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  url: 'A file from the web',
  ollama: 'Ollama',
  bundled: 'Ships with Solaris Studio'
}

/** One model an installed plugin lists: whether it is on this PC, its
 *  licence and size, which other plugins share the same copy, and Download
 *  for the ones Solaris Studio fetches (Hugging Face and web files), after a
 *  look at what would be fetched. */
function ModelRow({
  plugin,
  name,
  status,
  manage
}: {
  plugin: InstalledPlugin
  name: string
  status: ModelStatus | undefined
  manage: boolean
}): JSX.Element {
  const [plan, setPlan] = useState<ModelPlan | null>(null)
  const [pickleOk, setPickleOk] = useState(false)
  const [busy, setBusy] = useState<'plan' | 'download' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const listed = plugin.details.models.find((m) => m.name === name)
  const source = status?.source ?? listed?.source ?? ''
  const fetchable = source === 'huggingface' || source === 'url'
  const others = (status?.used_by ?? []).filter((u) => u.plugin !== plugin.id)
  const look = (): void => {
    setBusy('plan')
    setNote(null)
    plugins
      .modelPlan(plugin.id, name)
      .then(setPlan)
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(null))
  }
  const download = (): void => {
    setBusy('download')
    setNote(null)
    plugins
      .downloadModel(plugin.id, name, pickleOk)
      .then(() => setPlan(null))
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(null))
  }
  const state =
    status?.installed === true
      ? { text: t('On this PC'), className: 'text-success', mark: 'check' as IconName }
      : status?.installed === false
        ? { text: t('Not on this PC'), className: 'text-warn', mark: 'x' as IconName }
        : { text: t('Can’t tell'), className: 'text-muted', mark: 'help' as IconName }
  const licence = status?.license ?? listed?.license
  return (
    <li className="space-y-1">
      <p>
        <span className="font-medium">{name}</span>
        <span className="text-muted">
          {' '}
          · {t(SOURCE_LABELS[source] ?? source)} · {status?.id ?? listed?.id}
          {(status?.revision ?? listed?.revision) && ` @ ${(status?.revision ?? listed?.revision ?? '').slice(0, 10)}`}
        </span>
      </p>
      <p className="text-xs">
        <span className={`${state.className} inline-flex items-center gap-1`}>
          <Icon name={state.mark} size={12} />
          {state.text}
        </span>
        {status?.link === 'copy' && (
          <span className="text-muted"> · {t('stored twice, so it uses twice the space (Windows didn’t let Solaris Studio share one copy)')}</span>
        )}
        {licence ? (
          <span className="text-muted">
            {' '}
            · {t('licence')} {licence}
          </span>
        ) : (
          <span className="text-warn"> · {t('no licence stated')}</span>
        )}
        {status?.size_bytes ? <span className="text-muted"> · {formatBytes(status.size_bytes)}</span> : null}
        {others.length > 0 && (
          <span className="text-muted">
            {' '}
            · {t('the same copy is used by')} {others.map((u) => u.plugin).join(', ')}
          </span>
        )}
      </p>
      {status?.note && <p className="text-xs text-muted">{t(status.note)}</p>}
      {(status?.pickle_files ?? []).length > 0 && (
        <p className="text-xs text-warn flex items-start gap-1.5">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          <span>
            {(status?.pickle_files ?? []).join(', ')}: {t('files of a kind that can run hidden programs when they’re opened.')}
          </span>
        </p>
      )}
      {fetchable && status?.installed === false && !plan && (
        <button className="btn-ghost !py-1 text-xs" disabled={!manage || busy !== null} onClick={look}>
          {busy === 'plan' ? t('Checking…') : t('Download…')}
        </button>
      )}
      {plan && (
        <div className="border border-line/60 rounded p-2 space-y-1.5 text-xs">
          <ul className="space-y-0.5">
            {plan.files.map((f) => (
              <li key={f.file}>
                {f.file}
                <span className="text-muted">
                  {' '}
                  ·{' '}
                  {f.installed
                    ? t('already here')
                    : f.already_here_as
                      ? t('already here for another model: linked, not downloaded')
                      : f.size !== null && f.size !== undefined
                        ? formatBytes(f.size)
                        : t('size unknown')}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {t('To download')}: {formatBytes(plan.download_bytes) || '0 KB'}
            {!plan.size_known && ` ${t('and some files of unknown size')}`}
            {plan.license ? ` · ${t('licence')} ${plan.license}` : ` · ${t('no licence stated')}`}
          </p>
          {plan.problem && <p className="text-error">{t(plan.problem)}</p>}
          {plan.pickle_files.length > 0 && !plan.problem && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="size-4 mt-0.5 accent-accent-strong"
                checked={pickleOk}
                onChange={(e) => setPickleOk(e.target.checked)}
              />
              {t('I trust this model. I understand its files can run programs on this PC when the pipeline opens them.')}
            </label>
          )}
          <div className="flex gap-2">
            {!plan.problem && (
              <button
                className="btn-accent !py-1 text-xs"
                disabled={!manage || busy !== null || (plan.pickle_files.length > 0 && !pickleOk)}
                onClick={download}
              >
                {busy === 'download' ? t('Downloading… keep Solaris Studio open') : t('Download')}
              </button>
            )}
            <button className="btn-ghost !py-1 text-xs" disabled={busy === 'download'} onClick={() => setPlan(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {note && <p className="text-xs text-error">{note}</p>}
    </li>
  )
}

/** The models section of an installed plugin's card. */
function PluginModels({
  plugin,
  overview,
  manage
}: {
  plugin: InstalledPlugin
  overview: ModelsOverview | null
  manage: boolean
}): JSX.Element | null {
  const names = plugin.details.models.map((m) => m.name ?? m.id ?? '').filter(Boolean)
  if (names.length === 0) return null
  const statusOf = (name: string): ModelStatus | undefined =>
    overview?.models.find((m) => m.used_by.some((u) => u.plugin === plugin.id && u.name === name))
  return (
    <div className="space-y-1 text-sm">
      <p className="label">{t('Models')}</p>
      <ul className="space-y-2">
        {names.map((n) => (
          <ModelRow key={n} plugin={plugin} name={n} status={statusOf(n)} manage={manage} />
        ))}
      </ul>
      <p className="text-xs text-muted">
        {t(
          'Downloaded models go in one folder shared by every pipeline, so a file two pipelines use is stored once. Solaris Studio checks each download is complete and unchanged, and never opens a pipeline’s model itself.'
        )}
      </p>
    </div>
  )
}

/** Keys (secret settings) for one installed plugin. Values are never read back. */
function Keys({ plugin }: { plugin: InstalledPlugin }): JSX.Element | null {
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)
  if (plugin.details.secrets.length === 0) return null
  const save = (name: string, value: string | null): void => {
    setNote(null)
    plugins
      .setSecrets(plugin.id, { [name]: value })
      .then(() => {
        setValues((v) => ({ ...v, [name]: '' }))
        setNote(value ? t('Saved.') : t('Removed.'))
      })
      .catch((e: Error) => setNote(e.message))
  }
  return (
    <div className="space-y-2">
      <p className="label">{t('Keys')}</p>
      {plugin.details.secrets.map((name) => {
        const spec = plugin.settings[name]
        const set = plugin.secrets_set.includes(name)
        return (
          <div key={name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40 shrink-0" title={spec?.description}>
              {spec?.title ?? name}
            </span>
            <input
              type="password"
              className="input !w-64"
              placeholder={set ? t('saved (enter a new one to replace it)') : t('not set')}
              value={values[name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              autoComplete="off"
            />
            <button className="btn-ghost !py-1.5" disabled={!values[name]} onClick={() => save(name, values[name])}>
              {t('Save')}
            </button>
            {set && (
              <button className="btn-ghost !py-1.5" onClick={() => save(name, null)}>
                {t('Remove')}
              </button>
            )}
          </div>
        )
      })}
      {plugin.details.secrets_notice && <p className="text-xs text-warn">{plugin.details.secrets_notice}</p>}
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

function InstalledCard({
  plugin,
  update,
  hardware,
  manage,
  onInstall,
  onRemoved,
  models
}: {
  plugin: InstalledPlugin
  update: Listing | undefined
  hardware: Hardware | null
  manage: boolean
  /** Every installed plugin's models and where they are (GET /plugin-models). */
  models: ModelsOverview | null
  onInstall: (source: PluginSource) => void
  /** Told before the list reloads without this card, so its message outlives it. */
  onRemoved: (message: string) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const run = (what: () => Promise<unknown>, done?: string): void => {
    setBusy(true)
    setNote(null)
    what()
      .then(() => done && setNote(done))
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(false))
  }
  const blocked = plugin.flag?.severity === 'blocked'
  const missingKeys = plugin.details.secrets
    .filter((name) => !plugin.secrets_set.includes(name))
    .map((name) => plugin.settings[name]?.title ?? name)
  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold">
            {plugin.name} <span className="text-muted font-normal">{plugin.version}</span>
          </p>
          <p className="text-xs text-muted truncate">
            {plugin.id}
            {sourceLine(plugin.source) ? ` · ${t(sourceLine(plugin.source))}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm shrink-0">
          <span className={plugin.enabled ? 'text-ink' : 'text-muted'} aria-hidden>
            {plugin.enabled ? t('On') : t('Off')}
          </span>
          <Toggle
            hideLabel
            label={`${plugin.name}: ${plugin.enabled ? t('On') : t('Off')}`}
            checked={plugin.enabled}
            disabled={busy || !manage || (blocked && !plugin.enabled)}
            onChange={(v) => run(() => plugins.setEnabled(plugin.id, v))}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill badge={tierBadge(plugin.details)} />
        <Pill badge={executionBadge(plugin.details.execution, plugin.details.execution_text)} />
        <StepPills steps={plugin.details.steps} />
        {plugin.pinned && (
          <Pill badge={{ label: t('Kept at this version'), tone: 'info', title: t('Updates are not offered.') }} />
        )}
      </div>
      {plugin.flag && (
        <Callout tone={blocked ? 'error' : 'warn'}>
          {blocked
            ? `${t('Blocked')}: ${plugin.flag.reason ?? t('a list Solaris Studio uses has blocked this version')}. ${t('It can’t run. Remove it.')}`
            : `${t('No longer listed')}: ${plugin.flag.reason ?? t('a list Solaris Studio uses has taken it off')}. ${t('It still runs.')}`}
        </Callout>
      )}
      {plugin.problem && (
        <Callout tone="error">{plugin.problem.charAt(0).toUpperCase() + plugin.problem.slice(1)}</Callout>
      )}
      {(plugin.problems_here ?? []).map((p) => (
        <p key={p.text} className="text-sm text-error">
          {t(p.text)}
        </p>
      ))}
      {plugin.details.data_warnings.map((w) => (
        <p key={w} className="text-sm text-warn font-medium">
          {w}
        </p>
      ))}
      <Summary
        details={plugin.details}
        needs={needLines(plugin.requirements, hardware, plugin.details, plugin.problems_here ?? []).map((n) => n.text)}
      />
      {missingKeys.length > 0 && (
        <p className="text-sm text-warn">
          {t('Needs a key before it can run')}: {missingKeys.join(', ')}
        </p>
      )}
      <Keys plugin={plugin} />
      <PluginModels plugin={plugin} overview={models} manage={manage} />
      <div className="flex flex-wrap gap-2">
        {update && !plugin.pinned && (
          <Button
            variant="accent"
            size="sm"
            icon="download"
            disabled={busy || !manage}
            onClick={() => onInstall({ kind: 'index', id: plugin.id, version: update.latest })}
          >
            {t('Update to')} {update.latest}
          </Button>
        )}
        {plugin.previous && (
          <Button
            size="sm"
            icon="undo"
            disabled={busy || !manage}
            onClick={() => run(() => plugins.rollback(plugin.id), `${t('Went back to')} ${plugin.previous}.`)}
          >
            {t('Go back to')} {plugin.previous}
          </Button>
        )}
        <Button
          size="sm"
          icon="pin"
          disabled={busy || !manage}
          title={t('A pipeline kept at its version is not offered updates. Installing a version yourself still works.')}
          onClick={() => run(() => plugins.setPinned(plugin.id, !plugin.pinned))}
        >
          {plugin.pinned ? t('Offer updates again') : t('Keep this version (no update offers)')}
        </Button>
        <Button
          size="sm"
          variant="subtle"
          iconRight={expanded ? 'chevron-up' : 'chevron-down'}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {t('Details')}
        </Button>
        {confirmRemove ? (
          <>
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              disabled={busy || !manage}
              onClick={() =>
                run(() =>
                  plugins.remove(plugin.id).then((r) =>
                    onRemoved(
                      r.files_left
                        ? `${t('Removed')} ${plugin.name}. ${t('Some of its files were in use and are still in Solaris Studio’s “plugins” folder; delete them once Solaris Studio is closed.')}`
                        : `${t('Removed')} ${plugin.name}.`
                    )
                  )
                )
              }
            >
              {t('Remove it and its keys')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setConfirmRemove(false)}>
              {t('Cancel')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="subtle" icon="trash" disabled={busy || !manage} onClick={() => setConfirmRemove(true)}>
            {t('Remove')}
          </Button>
        )}
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      {expanded && (
        <div className="border-t border-line/50 pt-3 space-y-3">
          {plugin.description && <p className="text-sm">{plugin.description}</p>}
          <DetailsBlock
            details={plugin.details}
            requirements={plugin.requirements}
            hardware={hardware}
            problems={plugin.problems_here ?? []}
            brief
          />
          <BuiltOn items={plugin.based_on} />
          <Links links={listingLinks(plugin)} />
          <p className="text-xs text-muted">
            {t('Versions kept')}: {plugin.versions.join(', ')}
            {plugin.installed_at ? ` · ${t('installed')} ${whenText(plugin.installed_at)}` : ''}
          </p>
          <TechnicalDetails rows={[['Source', plugin.source_text]]} />
        </div>
      )}
    </div>
  )
}

/** Which of the user's AI settings send data off this PC ("AI: OpenAI,
 *  transcription: …"), or '' when everything runs here. Solaris Studio's own
 *  modes use them, so "Runs on this PC" is only true of those modes without. */
function useCloudAI(): string {
  const [cloud, setCloud] = useState('')
  useEffect(() => {
    let live = true
    api
      .ai()
      .then((s) => {
        const label = (id: string): string => s.providers.find((p) => p.id === id)?.label ?? id
        const parts: string[] = []
        if (!s.active.local) parts.push(`${t('AI')}: ${label(s.active.provider)}`)
        if (s.transcription.backend !== 'local') parts.push(`${t('transcription')}: ${label(s.transcription.backend)}`)
        if (live) setCloud(parts.join(', '))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return cloud
}

function BuiltinCard({ plugin, cloudAI }: { plugin: BuiltinPlugin; cloudAI: string }): JSX.Element {
  // The engine words a mode's AI need for the local model; with a cloud AI chosen that is not what runs.
  const needs = plugin.details.requirements.map((n) =>
    cloudAI && /local AI model/i.test(n) ? 'Uses the AI chosen in Settings › AI' : n
  )
  return (
    <div className="market-builtin">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="font-medium text-ink">{plugin.name}</p>
        <p className="text-xs text-muted">{plugin.description}</p>
        {cloudAI && (
          <p className="text-xs text-warn flex items-start gap-1.5">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            <span>
              {t('Sends your video’s transcript or audio to the services in your AI settings')} ({cloudAI})
            </span>
          </p>
        )}
        <details className="market-builtin-more">
          <summary className="sys-tech-summary text-xs text-muted cursor-pointer">{t('What it needs and asks for')}</summary>
          <div className="mt-1 space-y-0.5">
            <Summary details={plugin.details} needs={needs} firstParty />
          </div>
        </details>
      </div>
      <Pill badge={tierBadge(plugin.details)} />
      {cloudAI ? (
        <Pill
          badge={{
            label: t('This PC + your cloud AI'),
            tone: 'warn',
            title: t('Runs on this PC, and uses the cloud services chosen in Settings → AI.')
          }}
        />
      ) : (
        <Pill badge={executionBadge(plugin.details.execution, plugin.details.execution_text)} />
      )}
    </div>
  )
}

function Installed({
  hardware,
  manage,
  onInstall
}: {
  hardware: Hardware | null
  manage: boolean
  onInstall: (source: PluginSource) => void
}): JSX.Element {
  const [data, setData] = useState<PluginsResponse | null>(null)
  const [updates, setUpdates] = useState<Record<string, Listing>>({})
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  const [models, setModels] = useState<ModelsOverview | null>(null)
  const cloudAI = useCloudAI()
  const load = useCallback(() => {
    plugins
      .list()
      .then((r) => {
        setData(r)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
    plugins
      .marketplace()
      .then((m) => setUpdates(Object.fromEntries(m.plugins.filter((p) => p.update_available).map((p) => [p.id, p]))))
      .catch(() => setUpdates({}))
    plugins
      .models()
      .then(setModels)
      .catch(() => setModels(null))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(PLUGINS_CHANGED, load)
    return () => window.removeEventListener(PLUGINS_CHANGED, load)
  }, [load])
  if (error) return <div className="card text-error text-sm">{error}</div>
  if (!data) return <p className="text-muted">{t('Loading…')}</p>
  return (
    <div className="space-y-4">
      {removed && (
        <Callout tone="success" onDismiss={() => setRemoved(null)}>
          {removed}
        </Callout>
      )}
      {data.plugins.length === 0 ? (
        <div className="card">
          <EmptyState compact illustration="search" title={t('No community pipelines installed. Find one under Browse.')} />
        </div>
      ) : (
        data.plugins.map((p) => (
          <InstalledCard
            key={p.id}
            plugin={p}
            update={updates[p.id]}
            hardware={hardware}
            manage={manage}
            onInstall={onInstall}
            onRemoved={setRemoved}
            models={models}
          />
        ))
      )}
      <section className="card space-y-1">
        <h3 className="t-md text-ink">{t('Built into Solaris Studio')}</h3>
        <p className="text-xs text-muted pb-1">{t('Always available from the Generate bar’s switches.')}</p>
        {data.builtin.map((b) => (
          <BuiltinCard key={b.id} plugin={b} cloudAI={cloudAI} />
        ))}
      </section>
    </div>
  )
}

/** What installing would do, from the engine's plan, and the Install button. */
function InstallDialog({
  plan,
  planning,
  error,
  hardware,
  onClose
}: {
  plan: PluginPlan | null
  planning: boolean
  error: string | null
  hardware: Hardware | null
  onClose: () => void
}): JSX.Element {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<InstalledPlugin | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [counting, setCounting] = useState<Counting | null>(null)
  /** Where the installed pipeline's models are, to tell whether it is ready. */
  const [models, setModels] = useState<ModelsOverview | null>(null)
  useEffect(() => {
    plugins.counting().then(setCounting).catch(() => setCounting(null))
  }, [])
  useEffect(() => {
    if (done && done.details.models.length > 0) plugins.models().then(setModels).catch(() => setModels(null))
  }, [done])
  const needs = plan ? confirmations(plan) : []
  // Only the bundled index can count installs (plugins/registry.py), and only a first install.
  const counted =
    Boolean(counting?.enabled && counting.active && plan?.source.listed_in === 'bundled' && !plan.update) &&
    (plan?.details.tier === 'listed' || plan?.details.tier === 'listed-official')
  const ready = Boolean(plan?.ok && plan.plan_id) && needs.every((c) => ticked[c]) && !busy
  const install = (): void => {
    if (!plan?.plan_id) return
    setBusy(true)
    setFailed(null)
    plugins
      .install(plan.plan_id)
      .then(setDone)
      .catch((e: Error) => setFailed(e.message))
      .finally(() => setBusy(false))
  }
  const name = plan?.plugin.name ?? plan?.plugin.id ?? t('this pipeline')
  // What still stands between the installed pipeline and a video. "Ready"
  // only when nothing does; a model whose state isn't known yet counts.
  const missing: string[] = []
  if (done) {
    if (done.problem) missing.push(done.problem)
    for (const p of done.problems_here ?? []) missing.push(t(p.text))
    if (done.details.secrets.some((s) => !done.secrets_set.includes(s)))
      missing.push(t('It needs a key. Add it under Installed.'))
    const own = models?.models.filter((m) => m.used_by.some((u) => u.plugin === done.id))
    if (done.details.models.length > 0 && (!own || own.some((m) => m.installed !== true)))
      missing.push(
        t('Some of its AI models may not be on this PC yet. Installed shows which ones, and whether Solaris Studio can download them.')
      )
  }
  // An update or reinstall keeps the creator's Off switch (plugins/manager.py),
  // and the Generate bar offers only pipelines that are on. A missing field is on.
  const switchedOff = done?.enabled === false
  return (
    // Top-layer modal (see components/ui/Overlay): the rail and top bar are
    // dimmed and inert, so nobody navigates away mid-install.
    <Overlay
      onClose={onClose}
      escCloses={!busy}
      backdropCloses={!busy}
      label={t('Install a pipeline')}
      className="p-6"
    >
      <div className="card !rounded-2xl !p-6 w-full max-w-2xl space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        {planning && <p className="text-muted">{t('Getting the files and checking them…')}</p>}
        {error && (
          <>
            <h3 className="font-semibold text-lg">{t('Couldn’t look at this pipeline')}</h3>
            <p className="text-sm text-error">{error}</p>
          </>
        )}
        {plan && !done && (
          <>
            <div>
              <h3 className="font-semibold text-lg">
                {plan.update?.direction === 'update' ? t('Update') : t('Install')} {name} {plan.plugin.version ?? ''}
              </h3>
              <p className="text-xs text-muted">
                {plan.plugin.id}
                {sourceLine(plan.source) ? ` · ${t(sourceLine(plan.source))}` : ''}
                {plan.plugin.license ? ` · ${t('licence')} ${plan.plugin.license}` : ''}
              </p>
            </div>
            {plan.plugin.description && <p className="text-sm">{plan.plugin.description}</p>}
            {plan.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-error">{t('It can’t be installed:')}</p>
                <ul className="text-sm text-error list-disc pl-5">
                  {plan.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.warnings.length > 0 && (
              <ul className="text-sm text-warn list-disc pl-5">
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {updateLines(plan).map((l) => (
              <p key={l.text} className={`text-sm ${l.tone === 'danger' ? 'text-error font-medium' : l.tone === 'warn' ? 'text-warn' : 'text-muted'}`}>
                {l.text}
              </p>
            ))}
            <DetailsBlock
              details={plan.details}
              requirements={plan.plugin.requirements}
              hardware={hardware}
              problems={null}
            />
            <BuiltOn items={plan.plugin.based_on} />
            <Links links={listingLinks(plan.plugin)} />
            <TechnicalDetails
              rows={[
                ['Source', plan.source_text],
                ['Warnings', plan.technical]
              ]}
            />
            {plan.ok && counted && (
              <p className="text-xs text-muted">
                {t('Installing adds 1 to this pipeline’s public install count. GitHub, the website that holds Solaris Studio’s code, keeps the count. Solaris Studio sends no account, no ID and nothing about your videos. You can switch counting off at the bottom of Browse.')}
              </p>
            )}
            {plan.ok && needs.length > 0 && (
              <div className="space-y-2 border-t border-line/50 pt-3">
                {needs.map((c) => (
                  <label key={c} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="size-4 mt-0.5 accent-accent-strong"
                      checked={Boolean(ticked[c])}
                      onChange={(e) => setTicked((v) => ({ ...v, [c]: e.target.checked }))}
                    />
                    {t(c)}
                  </label>
                ))}
              </div>
            )}
            {failed && <p className="text-sm text-error">{failed}</p>}
          </>
        )}
        {done && (
          <div className="space-y-2 text-sm">
            <p className="text-success flex items-center gap-1.5">
              <Icon name="check" size={14} className="shrink-0" />
              <span>
                {done.name} {done.version} {t('is installed.')}
              </span>
            </p>
            {switchedOff && (
              <p className="text-warn">{t('It is switched off, so the Generate bar doesn’t offer it. Switch it on under Installed.')}</p>
            )}
            {missing.length === 0 && !switchedOff && (
              <p>
                {/* One that only rates or understands moments isn't offered
                    under Pipeline (usablePipelines), only under Rate & understand. */}
                {(done.outputs ?? ['ranges']).includes('ranges')
                  ? t('Ready. Add a video in the Generate bar, tick Pipeline and choose')
                  : t('Ready. Add a video in the Generate bar, tick Rate & understand and choose')}{' '}
                {done.name}. {t('It runs only for the videos you choose it for.')}
              </p>
            )}
            {missing.map((m) => (
              <p key={m} className="text-warn">
                {m}
              </p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {plan && plan.ok && !done && (
            <button className="btn-accent" disabled={!ready} onClick={install}>
              {busy ? t('Installing…') : t('Install')}
            </button>
          )}
          <button className="btn-ghost" disabled={busy} onClick={onClose}>
            {done ? t('Done') : t('Cancel')}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

export default function Marketplace(_props: { active?: boolean } = {}): JSX.Element {
  const route = useRoute()
  const routeTab = route.page === 'marketplace' ? route.params?.tab : undefined
  const [tab, setTabState] = useState<Tab>(() => takeMarketplaceTab() ?? routeTab ?? 'browse')
  const rootRef = useRef<HTMLDivElement>(null)
  // The tab is in the address (#/marketplace?tab=installed), both ways.
  const setTab = useCallback((next: Tab): void => {
    setTabState(next)
    navigate({ page: 'marketplace', params: next === 'browse' ? undefined : { tab: next } }, { replace: true, instant: true })
  }, [])
  useEffect(() => {
    if (routeTab) setTabState(routeTab)
  }, [routeTab])
  // A new view starts at its top, not at Browse's scroll position.
  const firstView = useRef(true)
  useLayoutEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    pageScroller(rootRef.current)?.scrollTo({ top: 0 })
  }, [tab])
  const hardware = useHardware()
  const [manage, setManage] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [plan, setPlan] = useState<PluginPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  // Asked for again while the page is open (a "Marketplace" link elsewhere).
  useEffect(() => {
    const show = (): void => {
      const wanted = takeMarketplaceTab()
      if (wanted) setTab(wanted)
    }
    window.addEventListener(OPEN_MARKETPLACE, show)
    return () => window.removeEventListener(OPEN_MARKETPLACE, show)
  }, [setTab])

  useEffect(() => {
    void canManage().then(setManage)
  }, [])

  // Only the latest request's answer is shown: one for a plugin the dialog
  // was closed on, or that another Install replaced, arrives too late to count.
  const planRequest = useRef(0)
  const startInstall = (source: PluginSource): void => {
    const request = ++planRequest.current
    setDialog(true)
    setPlan(null)
    setPlanError(null)
    setPlanning(true)
    plugins
      .plan(source)
      .then((p) => request === planRequest.current && setPlan(p))
      .catch((e: Error) => request === planRequest.current && setPlanError(e.message))
      .finally(() => request === planRequest.current && setPlanning(false))
  }
  const closeDialog = (): void => {
    planRequest.current++
    setDialog(false)
    setPlanning(false)
  }

  // Browse and Installed. For developers opens from a quiet link at the bottom
  // of Browse; while it is open it shows as its own lit tab, so the tab row
  // says where you are instead of pointing at Browse.
  const TABS: { id: Tab; label: string }[] = [
    { id: 'browse', label: 'Browse' },
    { id: 'installed', label: 'Installed' }
  ]
  const shownTabs: { id: Tab; label: string }[] =
    tab === 'developers' ? [...TABS, { id: 'developers', label: 'For developers' }] : TABS
  const lit: Tab = tab
  useEscapeBack(tab === 'developers' && !dialog, () => setTab('browse'))

  return (
    <div ref={rootRef} className="market sys-page p-6 space-y-5 max-w-[1200px] mx-auto">
      <PageHeader
        eyebrow={t('DISCOVER')}
        title={t('Marketplace')}
        icon="store"
        vtName="page-title"
        subtitle={t('Pipelines from other developers that find, rate and understand a video’s moments. Free to list and free to install.')}
      />
      {tab === 'browse' && <MarketplaceFeatured onBrowse={() => setTab('browse')} />}
      <div className="market-tabs" role="tablist" aria-label={t('Marketplace')}>
        {shownTabs.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={lit === tb.id}
            className={`market-tab ${lit === tb.id ? 'market-tab-on' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
      {tab === 'browse' && (
        <Browse hardware={hardware} manage={manage} onInstall={startInstall} onDevelopers={() => setTab('developers')} />
      )}
      {tab === 'installed' && <Installed hardware={hardware} manage={manage} onInstall={startInstall} />}
      {tab === 'developers' && (
        <MarketplaceDevelopers manage={manage} onInstall={startInstall} onBack={() => setTab('browse')} />
      )}
      {dialog && (
        <InstallDialog
          key={plan?.plan_id ?? (planning ? 'planning' : 'closed')}
          plan={plan}
          planning={planning}
          error={planError}
          hardware={hardware}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
