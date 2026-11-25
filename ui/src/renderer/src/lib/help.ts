import type { Page } from './nav'

/** Page-aware help and the glossary (spec 4.17). Owned by B2.
 *  English copy; render it through t(). Shell copy only: never write the
 *  word "plugin" here (say "add-on", or "pipeline" for the Marketplace). */

export interface PageHelp {
  purpose: string
  howTo: { q: string; steps: string[] }[]
  tryPrompts: string[]
}

/** Short definitions, shown by the Term primitive and the Help drawer. */
export const GLOSSARY: Record<string, string> = {
  Pipeline:
    'The way a video is turned into clips: what finds the moments, what rates them and what understands them. Solaris Studio has one built in, and the Marketplace has others.',
  'Vertical Live':
    'For streams that are already 9:16 (phone-shaped). Solaris keeps the whole frame and its layout instead of cropping a wide video.',
  'Minimum score':
    'Clips below this score are left out. Raise it for fewer, stronger clips; lower it to see more of what was found.',
  'Rate & understand':
    'Extra steps that run on the moments once they are found: one gives each moment a score, another describes what happens in it.',
  Branding:
    'Your watermark, caption style and colours. Set it once per creator and every new clip comes out looking like theirs.',
  'Auto-clipping':
    'Watched channels are checked on a timer. When one posts a new video it is queued, clipped and, if you choose, published without you.',
  'Add-on':
    'Something you install from the Marketplace that adds to what Solaris Studio can do, such as another way to find moments or suggest edits.',
  'Suggested edit':
    'A change an add-on proposes for a clip (a trim, a zoom, captions). Nothing is applied until you choose to use it.',
  Queue: 'Videos waiting their turn. One is processed at a time; the rest wait in order, and you can pause, reorder or retry them.',
  Score: 'How strong Solaris thinks a moment is, from 0 to 100, based on what was said, how it sounded and what was on screen.'
}

export const HELP: Partial<Record<Page, PageHelp>> = {
  home: {
    purpose: 'Your studio at a glance: paste a link to start, see what is processing, and pick up your newest clips.',
    howTo: [
      {
        q: 'How do I make clips from a video?',
        steps: [
          'Paste a YouTube, Twitch or Kick link into the box at the top, or press Ctrl+N.',
          'Pick a preset such as Shorts, Gaming or Podcast.',
          'Press Generate. You can keep working while it runs; the jobs pill at the top shows progress.'
        ]
      },
      {
        q: 'Where do finished clips go?',
        steps: [
          'They appear under Fresh clips on Home and in the Clip Editor.',
          'A toast tells you when a video is done. Press Open in Clip Editor to review them.'
        ]
      }
    ],
    tryPrompts: ['Clip this stream: ', 'My best clips this week', 'What is processing right now?']
  },
  dashboard: {
    purpose: 'The full Create studio: paste links or drop files, choose settings for each video, and start them.',
    howTo: [
      {
        q: 'How do I add several videos at once?',
        steps: [
          'Add a row for each link or file.',
          'Open a row’s settings to change captions, style or the pipeline for that video only.',
          'Press Generate clips. The first starts now and the rest wait in the Queue.'
        ]
      },
      {
        q: 'Can I use a video file from my PC?',
        steps: ['Drop the file onto the Create box, or use the file button on a row.', 'Local files are processed exactly like links.']
      }
    ],
    tryPrompts: ['Clip this stream: ', 'Make clips from my last upload', 'Turn on captions for every new video']
  },
  queue: {
    purpose: 'Every video waiting, running, finished or failed. Pause, reorder, retry or clear them.',
    howTo: [
      {
        q: 'A video failed. What now?',
        steps: [
          'Open the failed row to read why.',
          'Press Retry to run it again. Use View log if you want the technical detail.',
          'Still stuck? Use Report a problem in Help and the log is attached for you.'
        ]
      },
      {
        q: 'How do I change the order?',
        steps: ['Drag a waiting video up or down, or use its move buttons.', 'The video at the top is processed next.']
      }
    ],
    tryPrompts: ['Retry everything that failed', 'How long until the queue is done?', 'Pause the queue']
  },
  watch: {
    purpose: 'Channels Solaris watches for you. New videos are clipped automatically, and published if you choose.',
    howTo: [
      {
        q: 'How do I watch a channel?',
        steps: [
          'Press Add channel and paste the channel link or name.',
          'Choose what happens to its clips: leave them, ask you first, or publish them.',
          'Turn on Auto-clipping with the switch at the top.'
        ]
      },
      {
        q: 'Why was a video skipped?',
        steps: ['Open the channel and look at its recent items.', 'Videos shorter than the channel’s minimum length, or from before you added it, are set aside. You can still clip them by hand.']
      }
    ],
    tryPrompts: ['Check all my channels now', 'Which channel made the most clips?', 'Turn auto-clipping off']
  },
  studio: {
    purpose: 'Review, edit and export your clips. Pick a video on the left, then a clip to edit it.',
    howTo: [
      {
        q: 'How do I edit a clip?',
        steps: [
          'Click a clip to open it in the inspector, or double-click to open the full editor.',
          'Trim, change the layout, captions and hook, then press Render to make the new version.'
        ]
      },
      {
        q: 'How do I post clips?',
        steps: [
          'Select clips with the checkbox on each card.',
          'Use Export to save files, or Publish all and Schedule to post them to your connected accounts.'
        ]
      }
    ],
    tryPrompts: ['My best clips this week', 'Publish all my clips, 5 a day', 'Give my newest clip a punchier title']
  },
  calendar: {
    purpose: 'What goes out when: every scheduled and posted clip on one calendar.',
    howTo: [
      {
        q: 'How do I schedule a clip?',
        steps: ['Open the clip in the Clip Editor and choose Schedule, or use Publish all.', 'Scheduled posts appear here on their day.']
      },
      {
        q: 'A post is stuck on processing.',
        steps: ['Press Check stuck posts. Solaris asks the service what became of it.']
      }
    ],
    tryPrompts: ['What is going out this week?', 'Publish all my clips, 5 a day', 'Spread my next posts over the weekend']
  },
  creators: {
    purpose: 'What Solaris has learned about each creator: their style, their accounts and their branding.',
    howTo: [
      {
        q: 'The same person shows up twice.',
        steps: ['Open one of them and use Merge.', 'Pick the profile to keep. Their videos and what was learned move over.']
      },
      {
        q: 'How do I give a creator their own look?',
        steps: ['Open the creator and go to Branding.', 'Set a watermark and caption style. New clips of theirs use it.']
      }
    ],
    tryPrompts: ['Who are my top creators?', 'See clips from my top creator', 'What has Solaris learned about this creator?']
  },
  marketplace: {
    purpose: 'Add-ons that find and rate moments, suggest edits and more. Install one and it appears in Create.',
    howTo: [
      {
        q: 'How do I install something?',
        steps: [
          'Open a listing to read what it does and what it needs.',
          'Press Install and review what it is allowed to do.',
          'Use it from the pipeline choice in Create.'
        ]
      },
      {
        q: 'How do I remove one?',
        steps: ['Open the Installed tab.', 'Open the add-on and choose Remove.']
      }
    ],
    tryPrompts: ['Which pipelines are good for gaming?', 'What have I installed?', 'Suggest edits for my clips']
  },
  models: {
    purpose: 'The AI that runs on this PC. Download the recommended model, switch between models or remove ones you no longer use.',
    howTo: [
      {
        q: 'Which model should I use?',
        steps: ['Use the one marked Recommended: it is picked for your graphics card.', 'Larger models are smarter but slower and need more memory.']
      },
      {
        q: 'Can I use a cloud AI instead?',
        steps: ['Open Settings, then AI.', 'Connect a provider with your own key or account.']
      }
    ],
    tryPrompts: ['Which model is active?', 'Is my graphics card being used?', 'Download the recommended model']
  },
  storage: {
    purpose: 'How much space Solaris uses, what can be cleaned up, and whether everything it needs is ready.',
    howTo: [
      {
        q: 'How do I free up space?',
        steps: ['Press Clean up. Leftover downloads and temporary files are removed; your clips are kept.', 'Delete whole videos you no longer need from the list.']
      },
      {
        q: 'Something is marked not ready.',
        steps: ['Read the fix written under it.', 'Most fixes are one button; Re-run setup walks you through the rest.']
      }
    ],
    tryPrompts: ['How much space can I free?', 'Is everything ready to make clips?', 'Clean up storage']
  },
  settings: {
    purpose: 'Every preference: language, appearance, notifications, AI, publishing accounts, downloads, branding and updates.',
    howTo: [
      {
        q: 'How do I connect YouTube or another account?',
        steps: ['Open Publishing.', 'Choose the account and follow its sign-in.']
      },
      {
        q: 'The app moves too much.',
        steps: ['Open Appearance.', 'Set Reduce motion to On, or Visual effects to Reduced.']
      }
    ],
    tryPrompts: ['Turn on captions by default', 'Connect my YouTube channel', 'Where are my clips saved?']
  }
}

/** Help for a page, with a generic fallback so the drawer is never empty. */
export function helpFor(page: Page): PageHelp {
  return (
    HELP[page] ?? {
      purpose: 'Solaris Studio turns long videos into short clips.',
      howTo: [],
      tryPrompts: ['Clip this stream: ', 'My best clips this week']
    }
  )
}
