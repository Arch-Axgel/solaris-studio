import { t } from '../lib/i18n'
import { stepRunText } from '../lib/steps'
import type { RunOutcome } from '../lib/types'

/** What the Marketplace plugins chosen under Rate & understand did with this
 *  video's moments (the outcome's `steps`, plugins/steps.py), one line per
 *  run. A plugin that couldn't run is named with the reason in plain words:
 *  the clips were made without it. Above the clips, beside the clip direction. */
export default function PluginStepsNote({
  outcome
}: {
  outcome: Pick<RunOutcome, 'steps' | 'min_score'>
}): JSX.Element | null {
  const runs = outcome.steps ?? []
  if (runs.length === 0) return null
  return (
    <div className="bg-raised/30 border border-line/60 rounded-lg p-3 space-y-1.5 text-sm">
      <p className="font-medium text-ink">{t('Marketplace plugins on this video')}</p>
      {runs.map((run, i) => (
        <p key={`${run.plugin}-${i}`} className={`text-xs ${run.ok ? 'text-muted' : 'text-warn'}`}>
          {stepRunText(run, outcome.min_score, t)}
        </p>
      ))}
    </div>
  )
}
