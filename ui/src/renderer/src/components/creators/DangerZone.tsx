import { api } from '../../lib/api'
import type { CreatorDetail } from '../../lib/types'
import { t } from '../../lib/i18n'
import { Icon } from '../icons'
import { Button, useConfirm } from '../ui'

/** The two irreversible actions for a creator, in a red-bordered card at the
 *  end of the Overview. Both ask first. Videos and clips are only unlinked,
 *  never deleted, and the prompt says how many, so tidying can't feel risky. */
export default function DangerZone({
  detail,
  videos,
  busy,
  act,
  onDeleted
}: {
  detail: CreatorDetail
  /** Videos attributed to this creator (from the list's summary). */
  videos: number
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
  onDeleted: () => void
}): JSX.Element {
  const ask = useConfirm()

  const wipe = async (): Promise<void> => {
    const ok = await ask({
      title: `${t('Wipe everything learned about')} ${detail.display_name}?`,
      body: t(
        'Knowledge, storylines and feedback history are removed from this computer. The profile, videos and clips stay. This can’t be undone.'
      ),
      confirmLabel: t('Wipe learned memory'),
      tone: 'danger'
    })
    if (ok) void act(() => api.wipeCreatorMemory(detail.creator_id))
  }

  const remove = async (): Promise<void> => {
    const ok = await ask({
      title: `${t('Delete the profile for')} ${detail.display_name}?`,
      body: (
        <div className="space-y-2">
          <p>{t('Its channels, learned knowledge, storylines and protected words are removed. No video or clip is deleted.')}</p>
          {videos > 0 && (
            <p>
              {videos} {t('video(s) stay in your library — they just won’t be attributed to anyone.')}
            </p>
          )}
        </div>
      ),
      confirmLabel: t('Delete this creator'),
      tone: 'danger'
    })
    if (ok)
      void act(async () => {
        await api.deleteCreator(detail.creator_id)
        onDeleted()
      })
  }

  return (
    <section className="ops-danger" aria-label={t('Danger zone')}>
      <div className="flex items-center gap-2">
        <Icon name="alert" size={16} className="text-error" />
        <h4 className="t-micro text-error">{t('Danger zone')}</h4>
      </div>
      <div className="ops-danger-row">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('Wipe learned memory for this creator')}</p>
          <p className="text-xs text-muted">{t('Forget knowledge, storylines and feedback. The profile stays.')}</p>
        </div>
        <Button variant="danger" size="sm" icon="rotate" disabled={busy} onClick={() => void wipe()}>
          {t('Wipe memory')}
        </Button>
      </div>
      <div className="ops-danger-row">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t('Delete this creator')}</p>
          <p className="text-xs text-muted">{t('Removes the profile. Videos and clips are kept.')}</p>
        </div>
        <Button variant="danger" size="sm" icon="trash" disabled={busy} onClick={() => void remove()}>
          {t('Delete')}
        </Button>
      </div>
    </section>
  )
}
