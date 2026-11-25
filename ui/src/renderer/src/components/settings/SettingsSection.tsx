import type { SettingsSection as SectionId } from '../../lib/nav'
import { SectionHeader } from '../ui'

/** One Settings section: `<section id="settings-{id}" data-section={id}>`
 *  with its header (spec 4.12). Hidden, not unmounted, when the filter
 *  leaves nothing in it, so the cards keep their state. */
export function SettingsSectionBlock({
  id,
  title,
  hint,
  hidden,
  children
}: {
  id: SectionId
  title: string
  hint?: string
  hidden?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <section id={`settings-${id}`} data-section={id} className="sys-ssection" hidden={hidden} aria-labelledby={`settings-${id}-h`}>
      <SectionHeader id={`settings-${id}-h`} title={title} hint={hint} />
      <div className="sys-ssection-body">{children}</div>
    </section>
  )
}

/** One card slot inside a section, hidden when the filter doesn't match it. */
export function SettingsItem({ id, hidden, children }: { id: string; hidden?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <div id={`settings-card-${id}`} className="sys-sitem" data-card={id} hidden={hidden}>
      {children}
    </div>
  )
}
