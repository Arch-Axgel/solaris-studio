import { t } from '../../lib/i18n'
import { autoEffectsActive, useUiPrefs, type DensityPref, type EffectsPref, type MotionPref } from '../../lib/uiPrefs'
import { useReducedMotion } from '../../lib/motion'
import { Segmented, Toggle } from '../ui'
import { Icon } from '../icons'

/** Reduce motion, Visual effects, Density and Expand rail on hover
 *  (spec 4.12), stored by lib/uiPrefs.ts and applied to <html> at once.
 *  A small live preview shows what each choice does. */
export default function MotionEffectsCard(): JSX.Element {
  const [prefs, set] = useUiPrefs()
  const reduced = useReducedMotion()
  const autoOn = prefs.effects === 'auto' && autoEffectsActive()

  return (
    <div className="card space-y-5 sys-motion-card" aria-label={t('Motion and effects')}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{t('Motion & effects')}</h3>
          <p className="text-xs text-muted mt-0.5">
            {t('How much moves on screen, and how rich it looks. Changes apply at once.')}
          </p>
        </div>
        <div className="sys-motion-preview" data-reduced={reduced || undefined} aria-hidden>
          <span className="sys-motion-orbit">
            <span />
          </span>
          <span className="sys-motion-glass" />
        </div>
      </div>

      <div className="sys-pref-row">
        <div className="min-w-0">
          <p className="text-sm text-ink font-medium">{t('Reduce motion')}</p>
          <p className="text-xs text-muted">
            {t('System follows Windows. On stops page transitions, bursts and hover previews.')}
          </p>
        </div>
        <Segmented
          ariaLabel={t('Reduce motion')}
          size="sm"
          value={prefs.motion}
          onChange={(v) => set({ motion: v as MotionPref })}
          items={[
            { id: 'system', label: t('System') },
            { id: 'on', label: t('On') },
            { id: 'off', label: t('Off') }
          ]}
        />
      </div>

      <div className="sys-pref-row">
        <div className="min-w-0">
          <p className="text-sm text-ink font-medium">{t('Visual effects')}</p>
          <p className="text-xs text-muted">
            {t('Reduced drops blur, film grain and glowing borders. Auto reduces them while the graphics card is busy with a job.')}
            {autoOn && (
              <span className="text-gold ml-1">
                <Icon name="zap" size={11} className="inline -mt-0.5" /> {t('Reduced right now')}
              </span>
            )}
          </p>
        </div>
        <Segmented
          ariaLabel={t('Visual effects')}
          size="sm"
          value={prefs.effects}
          onChange={(v) => set({ effects: v as EffectsPref })}
          items={[
            { id: 'full', label: t('Full') },
            { id: 'reduced', label: t('Reduced') },
            { id: 'auto', label: t('Auto') }
          ]}
        />
      </div>

      <div className="sys-pref-row">
        <div className="min-w-0">
          <p className="text-sm text-ink font-medium">{t('Density')}</p>
          <p className="text-xs text-muted">{t('Compact fits more on screen with tighter spacing.')}</p>
        </div>
        <Segmented
          ariaLabel={t('Density')}
          size="sm"
          value={prefs.density}
          onChange={(v) => set({ density: v as DensityPref })}
          items={[
            { id: 'comfortable', label: t('Comfortable') },
            { id: 'compact', label: t('Compact') }
          ]}
        />
      </div>

      <Toggle
        checked={prefs.railHover}
        onChange={(v) => set({ railHover: v })}
        label={t('Expand rail on hover')}
        description={t('When the side rail is collapsed, resting the pointer on it opens it.')}
      />
    </div>
  )
}
