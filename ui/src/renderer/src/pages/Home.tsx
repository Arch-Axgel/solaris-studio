import { Icon, type IconName } from '../components/icons'
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui'
import ActivityLog from '../components/home/ActivityLog'
import EngineTile from '../components/home/EngineTile'
import FirstClipsQuest from '../components/home/FirstClipsQuest'
import KpiTiles from '../components/home/KpiTiles'
import NowProcessing, { QueueMini } from '../components/home/NowProcessing'
import PremiereTile from '../components/home/PremiereTile'
import QuickPaste from '../components/home/QuickPaste'
import RecentClips from '../components/home/RecentClips'
import UpNext from '../components/home/UpNext'
import WatchMini from '../components/home/WatchMini'
import { greeting, tf } from '../components/home/homeUtil'
import { t } from '../lib/i18n'
import { navigate, openCreate } from '../lib/nav'
import { useActiveJob } from '../lib/stores/activeJob'
import { useLibrary } from '../lib/stores/library'
import { useQueueSnapshot } from '../lib/stores/queueStore'

const span = (i: number): React.CSSProperties => ({ '--i': Math.min(i, 12) }) as React.CSSProperties

/** One line under the greeting that says what the studio is doing. */
function useStatusLine(): string {
  const job = useActiveJob()
  const { queued, failed } = useQueueSnapshot()
  const { unexported, videos } = useLibrary()
  if (job.running) {
    const pct = Math.round(job.fraction * 100)
    return job.title
      ? tf('Working on “{title}” · {pct}%', { title: job.title, pct })
      : tf('A video is processing · {pct}%', { pct })
  }
  if (failed > 0) return tf(failed === 1 ? '{n} video needs a look in the queue.' : '{n} videos need a look in the queue.', { n: failed })
  if (queued > 0) return tf(queued === 1 ? '{n} video is waiting in the queue.' : '{n} videos are waiting in the queue.', { n: queued })
  if (unexported > 0) return tf(unexported === 1 ? '{n} clip is ready for you to review.' : '{n} clips are ready for you to review.', { n: unexported })
  if (videos && videos.length === 0) return t('Paste a link to make your first clips.')
  return t('Your studio at a glance.')
}

const FIRST_STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'link', title: 'Paste', body: 'A YouTube, Twitch or Kick link, or a video file from this PC.' },
  { icon: 'sparkle', title: 'Clips', body: 'Solaris finds the best moments, crops them to 9:16 and writes captions.' },
  { icon: 'send', title: 'Publish', body: 'Polish in the Clip Editor, then export or schedule them to your channels.' }
]

/** "Your first take": what an empty library sees instead of the grid. */
function FirstTake(): JSX.Element {
  return (
    <Card variant="glass" className="home-first anim-rise">
      <EmptyState
        illustration="sun"
        title={t('Your first take')}
        body={t('Three steps from a long video to clips people finish watching. Everything runs on this computer.')}
      />
      <ol className="home-first-steps stagger">
        {FIRST_STEPS.map((s, i) => (
          <li key={s.title} className="home-first-step" style={span(i)}>
            <span className="home-first-num" aria-hidden>
              {i + 1}
            </span>
            <span className="home-first-icon" aria-hidden>
              <Icon name={s.icon} size={22} />
            </span>
            <p className="t-md text-ink">{t(s.title)}</p>
            <p className="text-sm text-muted">{t(s.body)}</p>
            {i < FIRST_STEPS.length - 1 && <span className="home-first-arrow" aria-hidden />}
          </li>
        ))}
      </ol>
      <div className="flex justify-center gap-2 mt-2">
        <Button variant="accent" icon="plus" onClick={(e) => openCreate({ originRect: e.currentTarget.getBoundingClientRect() })}>
          {t('Make your first clips')}
        </Button>
        <Button variant="ghost" icon="radar" onClick={() => navigate({ page: 'watch' })}>
          {t('Watch a channel instead')}
        </Button>
      </div>
    </Card>
  )
}

/** Home hub (spec 4.1): quick paste on top, then the live job, the newest
 *  clips, headline numbers and what's coming up. */
export default function Home({ active = true }: { active?: boolean } = {}): JSX.Element {
  const { videos } = useLibrary()
  const status = useStatusLine()
  const empty = videos !== null && videos.length === 0

  return (
    <div className="home">
      <PageHeader
        eyebrow={t('MAKE')}
        title={greeting()}
        icon="home"
        subtitle={<span className="home-status">{status}</span>}
        vtName="page-title"
        actions={
          <>
            {/* The paste bar below is Home's call to action (and the rail's
                orb opens every option), so the header keeps to the queue. */}
            <Button variant="ghost" icon="layers" onClick={() => navigate({ page: 'queue' })}>
              {t('Queue')}
            </Button>
          </>
        }
      />

      <section className="home-hero" aria-label={t('New clips')}>
        <QuickPaste />
      </section>

      {videos === null ? (
        <div className="home-grid" aria-busy="true">
          <Skeleton className="home-c8" h={220} radius={16} />
          <Skeleton className="home-c4" h={220} radius={16} />
          <Skeleton className="home-c12" h={300} radius={16} />
        </div>
      ) : empty ? (
        <div className="home-grid">
          <div className="home-c12">
            <FirstTake />
          </div>
          <FirstClipsQuest active={active} className="home-c12" />
          <NowProcessing active={active} className="home-c12" />
        </div>
      ) : (
        <div className="home-grid stagger">
          <FirstClipsQuest active={active} className="home-c12" />
          <NowProcessing active={active} className="home-c8" />
          <div className="home-c4 home-cell" style={span(1)}>
            <QueueMini />
          </div>
          <div className="home-c12 home-cell" style={span(2)}>
            <KpiTiles />
          </div>
          <div className="home-c8 home-cell home-recent-col" style={span(3)}>
            <RecentClips />
          </div>
          <div className="home-c4 home-cell home-premiere-col" style={span(4)}>
            <PremiereTile />
          </div>
          <div className="home-c6 home-cell" style={span(5)}>
            <UpNext active={active} />
          </div>
          <div className="home-c3 home-cell" style={span(6)}>
            <WatchMini active={active} />
          </div>
          <div className="home-c3 home-cell" style={span(7)}>
            <EngineTile active={active} />
          </div>
          <div className="home-c12 home-cell" style={span(8)}>
            <ActivityLog />
          </div>
        </div>
      )}
    </div>
  )
}
