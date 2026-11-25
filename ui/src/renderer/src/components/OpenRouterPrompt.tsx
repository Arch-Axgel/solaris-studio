import { openAISetup } from '../lib/aiSetup'
import { t } from '../lib/i18n'
import { Icon } from './icons'

/** A suggestion to use OpenRouter where it solves the problem in front of the
 *  user: a PC too slow for local AI, a small always-on machine, a local model
 *  that failed. Only ever shown while the AI runs locally.
 *
 *  It opens Settings → AI with OpenRouter's setup showing, and that is all:
 *  nothing is switched on and nothing is sent until the user pastes their own
 *  key and picks a model there. */
export default function OpenRouterPrompt({
  title,
  body,
  prominent = false,
  onSetup,
  className = ''
}: {
  title: string
  body: string
  prominent?: boolean
  /** Before opening Settings, e.g. closing the setup wizard. */
  onSetup?: () => void
  className?: string
}): JSX.Element {
  return (
    <div className={`ops-orp ${prominent ? 'ops-orp-prominent' : ''} ${className}`}>
      <span className="ops-orp-icon" aria-hidden>
        <Icon name="orbit" size={prominent ? 18 : 14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-relaxed">
          <span className="font-semibold text-ink">{title}</span> <span className="text-muted">{body}</span>
        </p>
        <button
          type="button"
          className="ops-orp-cta nudge"
          onClick={() => {
            onSetup?.()
            openAISetup('openrouter')
          }}
        >
          {t('Set up OpenRouter')}
          <Icon name="arrow-right" size={13} />
        </button>
      </div>
    </div>
  )
}
