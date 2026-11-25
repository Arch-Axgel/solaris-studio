import { useEffect, useRef } from 'react'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { Button, Kbd, Tooltip } from '../ui'

/** The multi-select action bar (spec 4.6). It rises from the bottom of the
 *  clip grid when the first clip is ticked (@starting-style in
 *  b4-editor.css) and sinks away when the selection empties. */
export default function BulkBar({
  count,
  total,
  allExported,
  busy,
  onExport,
  onPublish,
  onMarkExported,
  onDelete,
  onSelectAll,
  onClear
}: {
  count: number
  total: number
  /** Every selected clip is already starred: the star button unmarks. */
  allExported: boolean
  busy: 'export' | 'mark' | 'delete' | null
  onExport: () => void
  /** Absent when no publishing account is set up. */
  onPublish?: () => void
  onMarkExported: () => void
  onDelete: () => void
  onSelectAll: () => void
  onClear: () => void
}): JSX.Element {
  const open = count > 0
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) (ref.current as HTMLElement & { inert: boolean }).inert = !open
  }, [open])
  const publishBtn = (
    <Button size="sm" variant="ghost" icon="send" onClick={onPublish} disabled={!onPublish || busy !== null}>
      {t('Publish')}
    </Button>
  )
  return (
    <div
      ref={ref}
      className="lib-bulkbar"
      data-open={open ? 'true' : 'false'}
      role="toolbar"
      aria-label={t('Selected clips')}
      aria-hidden={!open}
    >
      <div className="lib-bulkbar-count">
        <span className="lib-bulkbar-num tabular" key={count}>
          {count}
        </span>
        <span className="text-xs text-muted leading-tight whitespace-nowrap">
          {t('of')} <span className="tabular">{total}</span>
        </span>
      </div>
      <span className="lib-bulkbar-sep" aria-hidden />
      <Button size="sm" variant="accent" icon="download" onClick={onExport} loading={busy === 'export'} disabled={busy !== null}>
        {t('Export')}
      </Button>
      {onPublish ? publishBtn : (
        <Tooltip content={t('Connect a publishing account in Settings first')}>
          <span className="inline-flex" tabIndex={0}>
            {publishBtn}
          </span>
        </Tooltip>
      )}
      <Button size="sm" variant="ghost" icon="star" title={allExported ? t('Unmark as exported') : t('Mark as exported')} onClick={onMarkExported} loading={busy === 'mark'} disabled={busy !== null}>
        {allExported ? t('Unstar') : t('Star')}
      </Button>
      <Button size="sm" variant="danger" icon="trash" onClick={onDelete} loading={busy === 'delete'} disabled={busy !== null}>
        {t('Delete')}
      </Button>
      <span className="lib-bulkbar-sep" aria-hidden />
      {count < total && (
        <Tooltip content={t('Select every clip shown')}>
          <button type="button" className="lib-bulkbar-link" onClick={onSelectAll}>
            {t('All')} <Kbd keys={['Ctrl', 'A']} />
          </button>
        </Tooltip>
      )}
      <Tooltip content={t('Clear selection')}>
        <button type="button" className="lib-bulkbar-link" onClick={onClear} aria-label={t('Clear selection')}>
          <Icon name="x" size={14} /> <Kbd keys={['Esc']} />
        </button>
      </Tooltip>
    </div>
  )
}
