import { Icon } from '../icons'
import SystemStats from '../SystemStats'
import { Button, Card } from '../ui'
import { t } from '../../lib/i18n'
import { navigate } from '../../lib/nav'
import { useVisible } from '../../lib/stores/useVisible'

/** Engine: CPU, GPU, VRAM and storage rings from the shared stats poll. */
export default function EngineTile({ active, className }: { active: boolean; className?: string }): JSX.Element {
  const visible = useVisible(active)
  return (
    <Card className={`home-engine ${className ?? ''}`} aria-labelledby="home-engine-title">
      <div className="flex items-center justify-between">
        <p className="t-micro" id="home-engine-title">
          {t('Engine')}
        </p>
        <Icon name="cpu" size={16} className="text-muted" />
      </div>
      <SystemStats active={visible} />
      <Button variant="ghost" size="sm" iconRight="arrow-right" className="nudge w-full mt-auto" onClick={() => navigate({ page: 'storage' })}>
        {t('Storage & health')}
      </Button>
    </Card>
  )
}
