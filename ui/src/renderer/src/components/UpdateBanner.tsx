import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { Icon, type IconName } from './icons'
import { Button, ProgressBar } from './ui'

/** "813 MB" or "6.2 GB": update downloads span both. */
function size(n?: number): string {
  if (!n) return ''
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`
}

/** Strips HTML tags from release notes, which arrive as markup from the
 *  update feed and are shown here as plain text.
 *
 *  A single `.replace(/<[^>]+>/g, '')` is not enough: removing one layer of
 *  tags can reveal another that the first pass stepped over, so
 *  `<<script>script>` comes out as `<script>`. Repeating until the string
 *  stops changing is the fix.
 *
 *  React escapes text children, so this was never an injection route on its
 *  own — nothing here is passed to dangerouslySetInnerHTML. It is a display
 *  cleanup, and it should still be a correct one. The iteration cap stops a
 *  pathological string turning it into a long loop. */
function stripTags(html: string): string {
  let out = html
  for (let i = 0; i < 20; i++) {
    const next = out.replace(/<[^>]*>/g, '')
    if (next === out) return out
    out = next
  }
  return out.replace(/[<>]/g, '')
}

/** Release notes arrive as HTML; keep their structure as plain lines before
 *  the tags go (list items become bullets, block ends become line breaks),
 *  so "<li>Faster</li><li>New</li>" doesn't read "FasterNew". */
function notesText(html: string): string {
  const lined = html
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|li|ul|ol|div|h[1-6])\s*>/gi, '\n')
  return stripTags(lined)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    // The strip's button already says "What's new"; a heading repeating it goes.
    .replace(/^what[’']s new:?\s*\n/i, '')
}

/** "{v}" placeholders in a translated sentence. */
function fill(s: string, vars: Record<string, string | number | undefined>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** The strip's shared frame: an icon tile, the words, and the actions, which
 *  drop to their own row on a narrow window instead of squeezing the text. */
function Strip({
  icon,
  tone = 'accent',
  title,
  sub,
  actions,
  children
}: {
  icon: IconName
  tone?: 'accent' | 'gold'
  title: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className="update-banner lyr-upd anim-fade" data-tone={tone} role="status">
      <div className="lyr-upd-row">
        <span className="lyr-upd-icon" aria-hidden>
          <Icon name={icon} size={16} />
        </span>
        <div className="lyr-upd-text">
          <p className="lyr-upd-title">{title}</p>
          {sub && <p className="lyr-upd-sub">{sub}</p>}
        </div>
        {actions && <div className="lyr-upd-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** Tells the user a new version exists, and installs it when they say so.
 *
 *  Deliberately a strip at the top rather than a modal: an update is never
 *  more urgent than the render someone is in the middle of. Nothing
 *  downloads or installs without being asked — the payload is gigabytes, and
 *  a surprise restart mid-render loses work. */
export default function UpdateBanner(): JSX.Element | null {
  const [s, setS] = useState<UpdateState | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  // The preload is only rebuilt when the window is recreated, while the
  // renderer hot-reloads on every save — so during development this can run
  // against a preload that predates window.studio.update. Throwing here
  // would unmount the entire app and leave a blank window, which is a
  // catastrophic result for a feature that is only ever a notification.
  useEffect(() => {
    const updater = window.studio?.update
    if (!updater) return
    return updater.onState(setS)
  }, [])

  // Nothing to say when there's no update, we're mid-check or we're in dev.
  if (!s || s.state === 'none' || s.state === 'checking' || s.state === 'dev') return null
  // A failed background check is not the user's problem; Settings shows it.
  if (s.state === 'error') return null

  const skip = (
    <Button variant="subtle" size="sm" onClick={() => void window.studio.update.skip(s.version ?? '')}>
      {t('Skip this version')}
    </Button>
  )

  // A Store copy: the Store installs updates, on its own schedule. When it has
  // a newer version than this one, say so and offer the way there. Nothing is
  // downloaded here.
  if (s.state === 'store') {
    if (!s.behind || s.skipped) return null
    return (
      <Strip
        icon="store"
        title={fill(t('Version {v} is in the Microsoft Store.'), { v: s.version })}
        sub={fill(t('This copy is {v}.'), { v: s.current })}
        actions={
          <>
            {skip}
            <Button variant="accent" size="sm" iconRight="external-link" onClick={() => void window.studio.update.openStore()}>
              {t('Open the Microsoft Store')}
            </Button>
          </>
        }
      />
    )
  }

  if (s.state === 'downloading') {
    // Two downloads: the small setup, then the app files. Between them the
    // updater is briefly silent, and a bar parked at 100% reads as frozen, so
    // that gap gets its own words instead of a finished-looking number.
    const packagePhase = s.phase === 'package'
    const pct = s.percent ?? 0
    const betweenDownloads = !packagePhase && pct >= 100
    const label = packagePhase
      ? t('Downloading the app files…')
      : betweenDownloads
        ? t('Preparing the app files download…')
        : t('Downloading update…')
    const detail = betweenDownloads
      ? t('This can take a while')
      : packagePhase && !s.total
        ? `${size(s.transferred)} ${t('downloaded')}`
        : `${pct}%${s.total ? ` · ${size(s.transferred)} / ${size(s.total)}` : ''}`
    return (
      <Strip
        icon="download"
        title={label}
        actions={
          <div className="lyr-upd-progress">
            <ProgressBar
              value={betweenDownloads ? null : Math.max(0.02, pct / 100)}
              label={label}
              tone="gold"
              size="sm"
              className="flex-1"
            />
            <span className="text-xs text-muted tabular-nums shrink-0">{detail}</span>
          </div>
        }
      />
    )
  }

  if (s.state === 'ready') {
    return (
      <Strip
        icon="sparkle"
        tone="gold"
        title={fill(t('Version {v} is ready to install.'), { v: s.version })}
        sub={t("Solaris Studio will close and reopen. Finish anything that's rendering first.")}
        actions={
          <Button variant="gold" size="sm" icon="restore" onClick={() => void window.studio.update.install()}>
            {t('Restart & install')}
          </Button>
        }
      />
    )
  }

  // state === 'available'
  const notes = s.notes ? notesText(s.notes) : ''
  return (
    <Strip
      icon="download"
      title={fill(t('Version {v} is available.'), { v: s.version })}
      sub={
        notes ? (
          <button
            type="button"
            className="lyr-upd-link"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((v) => !v)}
          >
            {notesOpen ? t("Hide what's new") : t("What's new")}
            <Icon name="chevron-down" size={13} className={notesOpen ? 'rotate-180' : ''} />
          </button>
        ) : undefined
      }
      actions={
        <>
          {skip}
          <Button variant="accent" size="sm" icon="download" onClick={() => void window.studio.update.download()}>
            {t('Download')}
          </Button>
        </>
      }
    >
      {notesOpen && notes && <div className="lyr-upd-notes anim-rise">{notes}</div>}
    </Strip>
  )
}
