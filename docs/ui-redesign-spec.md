# Solaris Studio UI Redesign: Final Build Spec ("Solaris Cockpit, Noir finish")

Status: FINAL. Six parallel builders implement this spec. If something here conflicts with the codebase, **the test-pinned strings (section 4.0) win**, then this spec.

Synthesis:
- **Base concept: Solaris Cockpit.** It won 2 of 3 judges and the highest total (102 vs 100). It gives the shell, routing, keep-alive, the Create sheet, the Home hub, the Calendar and Storage pages, and the motion discipline.
- **Noir grafts**, the cinematic finish: TransportDock playhead, Edit Bay treatment, a single shared HoverPreview with frame scrubbing, a "Your clips are ready" toast, Queue drag-to-reorder, a static film grain, foil gradients, timecodes, a "Best this week" Premiere tile, more rail badges, and the `open-feedback` event.
- **Compass grafts:** First clips quest, Help drawer and glossary terms (shell copy only), preset "What changes" popovers, the shared `np-ring` view transition, CSS `@property` count-up, `content-visibility` on hidden pages, a `grid-template-rows` collapse, connection chips in Settings, and the "Where your AI runs" card.

User request: a *completely new experience*, more styled, easier to navigate, more features, full animations. Every existing feature stays reachable.

Repo paths in this doc are relative to `ui/src/renderer/src/` unless they start with `ui/`, `tests/` or `server/`.

---

## 0. Ground rules (every builder)

1. **No new npm dependencies.** Only React 18, Tailwind v4, CSS and Web APIs available in Chromium 126 (Electron 31).
2. **No remote assets** (the CSP blocks them). No new font files. Textures and illustrations are inline SVG or `data:` URIs.
3. **No changes to** `ui/src/preload/**`, `ui/src/main/**`, `index.html`, `env.d.ts` (except to add type-only declarations if strictly needed), `lib/browserShim.ts`, `locales/*.json`, or the Node-run lib files: `lib/marketplace.ts`, `lib/steps.ts`, `lib/editSuggestions.ts`, `lib/jobProgress.ts`, `lib/layerDrag.ts`, `lib/speakerTurns.ts`, `lib/gamingLayout.ts`, `lib/gamingLayouts.ts`.
4. **Use `window.studio` only for things that already exist**, and always guard optional members with `?.`.
5. **New strings go through `t()`.** They fall back to English, which is fine. **Never reword** an existing English string that a locale or test pins.
6. **Banned words in shell copy:** never write "plugin" in user-facing copy. Say "add-on", or "pipeline" in the Marketplace context. Never write "Made by" or "Nobody has read" in new copy.
7. **localStorage:** wrap every access in try/catch. Keys must start with `solaris.ui.`
8. **Keep the nav label `Clip Editor` exactly** (Microsoft Store reason). Never use "Clip Studio" or any older label as visible text.
9. **Keep `StudioTarget` exported from `App.tsx`.**
10. **Replace `window.confirm`/`alert` with `useConfirm()`/`toast()`** in the files you own. Do not do this in files you don't own.
11. **Only builders B1 and B6 may edit test-pinned files**, and only as listed in section 4.0. Everyone else wraps or styles them from outside.
12. **Run the acceptance commands (section 7) before declaring done.**

---

## 1. Vision and visual language

**Vision.** A dark, cinematic "cockpit" for clip creators. The loop **paste → clips → publish** is always one action away: the gold New Clips orb, `Ctrl+N`, and the Home quick-paste. Clips are the hero of every screen: 9:16 posters, hover scrubbing, previews that play on hover.
- The chrome is wine-black glass with gold hairlines and burgundy glows.
- Motion explains where things go: pages morph, a card grows into the editor, a job flies into the Queue badge, finished jobs burst in gold.

### 1.1 Tokens (B1 adds them to the `theme.css` `@theme` block; existing names are kept and keep their values unless noted)

```css
@theme {
  /* existing (unchanged values) */
  --color-base: #130a0d;
  --color-surface: #1e1115;
  --color-raised: #2e1a21;
  --color-line: #4a2a34;          /* keep: used as border colour with /opacity everywhere */
  --color-accent: #8f2445;
  --color-accent-strong: #a92f55;
  --color-on-accent: #fff3f5;
  --color-gold: #d8b263;
  --color-gold-strong: #ecc87c;
  --color-ink: #f6ede7;           /* body text; lib/appearance overrides it at runtime */
  --color-muted: #bba5a8;
  --color-success: #74d39b;
  --color-warn: #f2a65a;
  --color-error: #f27a84;

  /* new colours */
  --color-abyss: #0c0608;          /* behind rail, editor stage, input wells */
  --color-sunken: #0f080a;
  --color-velvet: #3a1220;         /* hero gradients */
  --color-hairline: rgb(216 178 99 / 0.16);
  --color-live: #e5484d;           /* on-air indicators only */

  --font-display: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif;
  --font-cine: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif; /* hero titles + KPI numbers only */
  --font-mono: 'Cascadia Mono', Consolas, ui-monospace, monospace;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
}

:root {
  --glass: rgb(38 18 24 / 0.62);
  --glass-strong: rgb(30 17 21 / 0.86);
  --glass-blur: blur(18px) saturate(1.2);
  --glow-accent: 0 0 0 1px rgb(143 36 69 / 0.5), 0 8px 32px -8px rgb(143 36 69 / 0.55);
  --glow-gold: 0 0 0 1px rgb(216 178 99 / 0.45), 0 0 24px -4px rgb(216 178 99 / 0.45);
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-2: 0 4px 12px -2px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-3: 0 24px 48px -12px rgb(0 0 0 / 0.7), 0 8px 16px -8px rgb(60 10 25 / 0.6);
  --inner-hi: inset 0 1px 0 rgb(255 255 255 / 0.045);
  --grad-solar: linear-gradient(135deg, #f0d08a, #d8b263 40%, #a8743a);
  --grad-foil: linear-gradient(105deg, #a8823c, #f3dc9a 45%, #d8b263 55%, #8a6a2e);
  --grad-ember: linear-gradient(135deg, #8f2445, #5a1229);
  --grad-velvet: radial-gradient(120% 100% at 0% 0%, #3a1220, #130a0d 70%);
  --tint-success: rgb(116 211 155 / 0.12);
  --tint-warn: rgb(242 166 90 / 0.12);
  --tint-error: rgb(242 122 132 / 0.12);
  --tint-gold: rgb(216 178 99 / 0.12);
  --tint-accent: rgb(143 36 69 / 0.22);
  --rail-w: 232px;
  --rail-w-collapsed: 68px;
  --topbar-h: 52px;
}
```

Contrast rules (WCAG AA, unchanged): accent is **fill only**, and text on it uses `on-accent`. Gold is for highlight text and focus. Glass panels must stay at least 62% opaque. Status is never shown by colour alone: always an icon plus a word.

### 1.2 Background and texture
- `body`: `--color-base`, two radial glows (burgundy top-left, faint gold bottom-right) that drift slowly via the `ambient-drift` keyframe, which only runs when `html:not([data-effects="reduced"])`.
- `body::after`: a fixed, static film grain. Use an SVG `feTurbulence` `data:` URI at 3% opacity with `pointer-events:none` and z-index above the background, below content. It is **not animated**. It is hidden under `[data-effects="reduced"]` and while the Edit Bay video is playing (`html[data-playing]`).

### 1.3 Typography scale (rem-based so appearance scaling works)

| Token class | Size / line | Use |
|---|---|---|
| `.t-micro` | 11px / 14, uppercase, 0.12em tracking, muted-gold | eyebrows, labels (`.label` restyled to this) |
| `.t-xs` | 12 / 16 | meta |
| `.t-sm` | 13 / 18 | dense UI |
| `.t-base` | 14 / 20 | body |
| `.t-md` | 16 / 24 | card titles |
| `.t-lg` | 20 / 28, display | section titles |
| `.t-xl` | 28 / 34, display, -0.01em | page titles |
| `.t-hero` | 40 / 44, `--font-cine` | Home hero, Edit Bay title |
| `.t-kpi` | 32 / 36, `--font-cine`, `tabular-nums` | KPI numbers |
| `.t-mono` | 12 / 16 mono | timecodes, logs |

Page title pattern (`PageHeader`): a gold small-caps eyebrow (group name, e.g. `MAKE`), then the title in `.t-xl`, then a 40px `.gold-rule` bar whose width animates from 0 to 40px on enter, then an optional subtitle in muted text.

### 1.4 Surfaces (restyle in place in theme.css; class names never change)
- `.card`: `--radius-lg`, `background: color-mix(in srgb, var(--color-surface) 88%, transparent)`, 1px `--color-hairline` border, `box-shadow: var(--inner-hi), var(--shadow-2)`, `padding: 1rem`.
- New variants (additive classes):
  - `.card-interactive`: hover lift plus glow.
  - `.card-glass`: `--glass` with `--glass-blur`.
  - `.card-hero`: rotating conic gradient border using `@property --angle`.
  - `.card-glow`: `--glow-accent`, for the active job.
  - `.card-sunken`: abyss fill, no shadow.
- `.btn-accent`: burgundy fill, an inner gold gloss, presses to scale .97, glows `--glow-accent` on hover.
- `.btn-gold`: `--grad-solar` with dark text (`--color-base`) and a one-shot `sheen` sweep on hover.
- `.btn-ghost`: transparent raised fill with a hairline border; border and text turn gold on hover.
- New: `.btn-subtle` (text-only with a hover tint), `.btn-danger` (error tint with error text), `.btn-icon` (32×32 square, radius md).
- `.input`: abyss fill, radius md, hairline border. On focus: gold border plus a `0 0 0 3px rgb(216 178 99/.18)` ring.
- `.gold-rule`: becomes a 40px wide, 2px tall `--grad-foil` bar, `border-radius: 2px`. Pages that use it as a full-width line still look fine.
- New utilities: `.sr-only`, `.glass`, `.hairline`, `.text-foil` (`background: var(--grad-foil); -webkit-background-clip: text; color: transparent`), `.tabular`, `.scrim-bottom` (a gradient for poster captions).

### 1.5 Iconography: `components/icons.tsx` (owned by B1)
- Keep every existing export and the `base()` helper, with the same `IconProps { size?: number; className?: string }`.
- Add icons on a 24-unit grid, `stroke="currentColor"`, `strokeWidth={1.75}`, round caps and joins, `fill="none"`, `aria-hidden`:

`Home, Plus, Layers (queue), Radar (watch), Calendar, Users, Store, Cpu, HardDrive, Gear, Bell, Command, Search, ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, ArrowRight, Play, Pause, Stop, Check, X, Info, Alert, Grip (drag handle), Retry (alias of Refresh ok), Log, Filter, Grid, List, Upload, Download, Link, ExternalLink, Clock, Flame, Wand, Live (dot+waves), Heart, Help, Keyboard (exists), Pin, PanelRight, Sun, Orbit, Clapper, Send, Eye, Copy, MoreH, Twitch, Kick, Folder (exists), Film (exists), Sparkle (exists), Scissors (exists), YouTube (exists)`.

- Also export:
  ```ts
  export type IconName = 'home' | 'plus' | ... // kebab-case of every icon above
  export const ICONS: Record<IconName, (p?: IconProps) => JSX.Element>
  export function Icon({ name, size = 18, className }: { name: IconName } & IconProps): JSX.Element
  ```
- Add one shared gradient def: `<GoldGradientDefs/>`, an SVG with `<linearGradient id="solaris-gold">`, mounted once in the Shell. An active rail icon uses `className="icon-gold"`, which sets `stroke: url(#solaris-gold)`.

---

## 2. Motion system

Files (B1): `styles/motion.css` (imported at the top of `theme.css` after tailwind) and `lib/motion.ts`.

### 2.1 Tokens

```css
:root {
  --dur-1: 120ms;   /* micro */
  --dur-2: 200ms;   /* hover / press */
  --dur-3: 320ms;   /* panels, sheets */
  --dur-4: 520ms;   /* page morph */
  --dur-5: 900ms;   /* celebration */
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-out-expo: cubic-bezier(.16, 1, .3, 1);
  --ease-in-out: cubic-bezier(.65, 0, .35, 1);
  --ease-spring: linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077 24.2%, 1.088, 1.068 30.2%, 1.006 41%, .995 47.5%, 1);
  --stagger: 40ms;
}
@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@property --p     { syntax: '<number>'; inherits: false; initial-value: 0; }      /* ring fill 0..1 */
@property --n     { syntax: '<integer>'; inherits: false; initial-value: 0; }     /* CSS count-up */
@property --sweep { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
```

### 2.2 Keyframes

```css
@keyframes fade-in   { from { opacity: 0 } to { opacity: 1 } }
@keyframes rise      { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes drop-out  { to { opacity: 0; transform: translateY(8px); filter: blur(4px) } }
@keyframes scale-in  { from { opacity: 0; transform: scale(.96) translateY(6px) } to { opacity: 1; transform: none } }
@keyframes slide-in-right { from { transform: translateX(100%) } to { transform: none } }
@keyframes shimmer   { from { background-position: -200% 0 } to { background-position: 200% 0 } }
@keyframes sheen     { from { background-position: -150% 0 } to { background-position: 250% 0 } }
@keyframes stripes   { to { background-position: 40px 0 } }
@keyframes spin      { to { transform: rotate(1turn) } }
@keyframes angle     { to { --angle: 1turn } }
@keyframes sweep     { to { --sweep: 1turn } }
@keyframes breathe   { 0%,100% { box-shadow: 0 0 0 0 rgb(216 178 99 / .0), 0 0 18px -6px rgb(216 178 99 / .35) }
                       50%     { box-shadow: 0 0 0 6px rgb(216 178 99 / .08), 0 0 32px -4px rgb(216 178 99 / .55) } }
@keyframes ping      { 75%,100% { transform: scale(2.2); opacity: 0 } }
@keyframes heartbeat { 0%,100% { transform: scale(1) } 15% { transform: scale(1.35) } 30% { transform: scale(1) } }
@keyframes check-draw{ from { stroke-dashoffset: var(--len, 24) } to { stroke-dashoffset: 0 } }
@keyframes shake     { 0%,100% { transform: none } 20%,60% { transform: translateX(-6px) } 40%,80% { transform: translateX(6px) } }
@keyframes flash-target { 0% { box-shadow: 0 0 0 0 rgb(216 178 99 / .0) } 30% { box-shadow: 0 0 0 3px rgb(216 178 99 / .8) } 100% { box-shadow: 0 0 0 0 rgb(216 178 99 / 0) } }
@keyframes bounce    { 0%,100% { transform: none } 30% { transform: scale(1.3) } 60% { transform: scale(.92) } }
@keyframes ambient-drift { from { background-position: 0% 0%, 100% 100% } to { background-position: 6% 4%, 94% 96% } }
@keyframes letterbox { from { clip-path: inset(50% 0 50% 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes rule-in   { from { width: 0 } to { width: 40px } }
```

### 2.3 Utility classes

```css
.anim-rise    { animation: rise var(--dur-4) var(--ease-out-expo) both }
.anim-fade    { animation: fade-in var(--dur-3) var(--ease-out) both }
.anim-scale   { animation: scale-in var(--dur-3) var(--ease-out-expo) both }
.anim-shake   { animation: shake 360ms var(--ease-in-out) 1 }
.anim-flash   { animation: flash-target 1.4s var(--ease-out) 2 }
.anim-bounce  { animation: bounce 520ms var(--ease-spring) 1 }
.anim-spin    { animation: spin 1s linear infinite }
.anim-breathe { animation: breathe 4s var(--ease-in-out) infinite }

/* list stagger: parent .stagger, child style={{'--i': index}} (cap at 12 in JS: Math.min(i, 12)) */
.stagger > * { animation: rise var(--dur-4) var(--ease-out-expo) both; animation-delay: calc(var(--i, 0) * var(--stagger)) }

/* hover / press micro-interactions */
.lift  { transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out), border-color var(--dur-2) }
.lift:hover { transform: translateY(-3px); box-shadow: var(--shadow-3), var(--glow-gold); border-color: rgb(216 178 99 / .4) }
.press:active, .btn-accent:active, .btn-gold:active, .btn-ghost:active, .btn-icon:active { transform: scale(.97) }
.btn-gold { background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / .45) 50%, transparent 70%), var(--grad-solar);
            background-size: 250% 100%, 100% 100%; background-position: -150% 0, 0 0 }
.btn-gold:hover { animation: sheen 900ms var(--ease-out) 1 }
.nudge:hover svg { transform: translateX(2px); transition: transform var(--dur-1) var(--ease-out) }
.tilt { transform: perspective(900px) rotateX(calc(var(--my, 0) * -4deg)) rotateY(calc(var(--mx, 0) * 4deg)); transition: transform var(--dur-2) var(--ease-out) }
.tilt::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
               background: radial-gradient(240px circle at calc(50% + var(--mx, 0) * 50%) calc(50% + var(--my, 0) * 50%), rgb(243 220 154 / .12), transparent 60%); opacity: 0; transition: opacity var(--dur-2) }
.tilt:hover::after { opacity: 1 }

/* skeleton */
.skeleton { border-radius: var(--radius-md);
  background: linear-gradient(90deg, var(--color-raised) 25%, color-mix(in srgb, var(--color-raised) 60%, var(--color-velvet)) 37%, var(--color-raised) 63%);
  background-size: 400% 100%; animation: shimmer 1.4s ease-in-out infinite }

/* progress */
.progress-track { height: 6px; border-radius: 999px; background: var(--color-abyss); overflow: hidden; position: relative }
.progress-fill  { height: 100%; border-radius: inherit; background: var(--grad-ember); transition: width var(--dur-3) var(--ease-out); position: relative }
.progress-fill::after { content: ''; position: absolute; right: 0; top: -2px; bottom: -2px; width: 12px; border-radius: 999px; background: var(--color-gold-strong); filter: blur(4px); opacity: .9 }
.progress-striped .progress-fill { background-image: repeating-linear-gradient(45deg, rgb(255 255 255 / .12) 0 10px, transparent 10px 20px), var(--grad-ember); animation: stripes .8s linear infinite }
.progress-indeterminate .progress-fill { width: 35% !important; animation: indet 1.3s var(--ease-in-out) infinite }
@keyframes indet { from { transform: translateX(-100%) } to { transform: translateX(300%) } }
.ring { --p: 0; transition: --p var(--dur-4) var(--ease-out);
  background: conic-gradient(var(--color-gold) calc(var(--p) * 1turn), var(--color-abyss) 0); border-radius: 50%;
  mask: radial-gradient(farthest-side, transparent calc(100% - var(--ring-w, 4px)), #000 calc(100% - var(--ring-w, 4px) + 1px)) }

/* rotating gradient border (orb, hero paste, card-hero) */
.border-orbit { position: relative; isolation: isolate }
.border-orbit::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; z-index: -1;
  background: conic-gradient(from var(--angle), transparent 0 60%, var(--color-gold-strong) 75%, var(--color-accent-strong) 90%, transparent);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); animation: angle 6s linear infinite }
.offscreen .border-orbit::before, [hidden] .border-orbit::before { animation-play-state: paused }

/* CSS-only count-up (integers). Component: CountUp (section 6.4) */
.count-up { transition: --n var(--dur-5) var(--ease-out); counter-reset: n var(--n) }
.count-up::after { content: counter(n) }

/* collapsible lane (interpolate-size is not in Chromium 126) */
.collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-3) var(--ease-out) }
.collapse[data-open="true"] { grid-template-rows: 1fr }
.collapse > * { overflow: hidden; min-height: 0 }

.radar-sweep { background: conic-gradient(from var(--sweep), rgb(216 178 99 / .35), transparent 25%); animation: sweep 3s linear infinite; border-radius: 50% }
.radar-off .radar-sweep { animation-play-state: paused; opacity: .25 }
```

### 2.4 Enter and exit with `@starting-style` (dialogs, sheets, popovers, toasts)

```css
dialog.ui-dialog, dialog.ui-sheet, [popover].ui-pop {
  transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-spring),
              overlay var(--dur-3) allow-discrete, display var(--dur-3) allow-discrete;
  opacity: 0; transform: scale(.96) translateY(6px);
}
dialog.ui-dialog[open], [popover].ui-pop:popover-open { opacity: 1; transform: none }
@starting-style { dialog.ui-dialog[open], [popover].ui-pop:popover-open { opacity: 0; transform: scale(.96) translateY(6px) } }

dialog.ui-sheet { transform: translateX(40px); transform-origin: var(--origin-x, 100%) var(--origin-y, 0) }
dialog.ui-sheet[open] { opacity: 1; transform: none }
@starting-style { dialog.ui-sheet[open] { opacity: 0; transform: translateX(40px) scale(.98) } }

dialog::backdrop { background: rgb(12 6 8 / 0); backdrop-filter: blur(0); transition: all var(--dur-3) allow-discrete }
dialog[open]::backdrop { background: rgb(12 6 8 / .7); backdrop-filter: blur(8px) }
@starting-style { dialog[open]::backdrop { background: rgb(12 6 8 / 0); backdrop-filter: blur(0) } }

.toast { transition: opacity var(--dur-3), transform var(--dur-3) var(--ease-spring) }
@starting-style { .toast { opacity: 0; transform: translateY(16px) scale(.98) } }
.toast[data-leaving] { opacity: 0; transform: translateX(24px) }
```

When the Create sheet emerges from the orb, `Sheet` sets `--origin-x`/`--origin-y` from the `originRect` prop: the opener's `getBoundingClientRect()`, relative to the sheet box.

### 2.5 Page transitions (View Transitions API)

In `lib/nav.ts` (B1):

```ts
import { flushSync } from 'react-dom'
type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }
function commit(next: RouteState, dir: 'forward' | 'back'): void {
  const apply = (): void => flushSync(() => setState(next))
  const doc = document as VTDoc
  // Skip when unsupported, reduced motion, or the target page is not yet mounted (cold heavy mount stutters)
  if (!doc.startViewTransition || motionReduced() || !isMounted(next.route.page)) { apply(); return }
  document.documentElement.dataset.navDir = dir
  doc.startViewTransition(apply).finished.finally(() => { delete document.documentElement.dataset.navDir })
}
```

```css
.page-active { view-transition-name: page }              /* only on the ACTIVE KeepAlive section */
.rail-indicator { view-transition-name: rail-indicator }
.page-title-active { view-transition-name: page-title }
::view-transition-old(page) { animation: drop-out var(--dur-3) var(--ease-in-out) both }
::view-transition-new(page) { animation: rise var(--dur-4) var(--ease-out-expo) both }
html[data-nav-dir="back"]::view-transition-new(page) { animation-name: rise-back }
@keyframes rise-back { from { opacity: 0; transform: translateX(-16px) } to { opacity: 1; transform: none } }
::view-transition-group(rail-indicator) { animation-duration: var(--dur-3); animation-timing-function: var(--ease-spring) }
::view-transition-group(*) { animation-duration: var(--dur-4); animation-timing-function: var(--ease-out-expo) }
```

Shared element names. Each is set **inline and only on the one visible element**, because a duplicate name aborts the transition:
- `rail-indicator`: the sliding pill in the Rail.
- `page-title`: the active page's `<h1>` in `PageHeader`, via the `vtName` prop that the active page passes.
- `np-ring`: the TopBar jobs-pill ring, and the Home "Now processing" spotlight ring when Home is active. Only one is rendered with the name: the TopBar pill omits it while Home is active.
- `clip-<id>`: set by `markClipTransition(el, id)` (lib/motion.ts) on the clicked ClipCard poster just before `startViewTransition`. The EditorView stage wrapper carries `clip-<id>` when it mounts. Name cleanup runs in `finished`.
- `listing-<id>`: a Marketplace card icon tile to its ListingPage header. Optional; B6 adds it only through wrapper elements.

Hidden keep-alive pages use the `hidden` attribute, so they are `display:none` and never captured.

### 2.6 Scroll-driven animation (guarded with `@supports (animation-timeline: view())`)

```css
@supports (animation-timeline: view()) {
  .reveal { animation: rise linear both; animation-timeline: view(); animation-range: entry 0% cover 22% }
  .topbar { animation: topbar-solid linear both; animation-timeline: scroll(nearest); animation-range: 0 64px }
  @keyframes topbar-solid { to { background: var(--glass-strong); border-bottom-color: var(--color-hairline) } }
}
```

### 2.7 JS motion helpers: `lib/motion.ts` (B1). Exact exports:

```ts
export function motionReduced(): boolean            // matchMedia('(prefers-reduced-motion: reduce)') || html[data-motion="reduced"]
export function useReducedMotion(): boolean         // reactive, with change listener + MutationObserver on html[data-motion]
export function effectsReduced(): boolean           // html[data-effects="reduced"]
export function celebrate(from?: Element | DOMRect | null, opts?: { count?: number }): void
  // canvas burst, ~60 particles burgundy/gold/foil, gravity, 900ms, canvas removed after; no-op when motionReduced()
export function flyTo(source: Element, target: Element | null, opts?: { onDone?: () => void }): void
  // clones source (FLIP), WAAPI transform+scale+opacity to target centre over 600ms var(--ease-out-expo); then adds .anim-bounce to target; no-op if reduced
export function countUp(el: HTMLElement, from: number, to: number, format?: (n: number) => string): void
  // rAF, ease-out, duration min(800, 250 + |to-from|*8) ms; reduced → sets final text
export function markClipTransition(el: HTMLElement | null, clipId: number): void
export function withViewTransition(update: () => void): Promise<void>   // generic wrapper used by nav and others
export function attachTilt(el: HTMLElement): () => void
  // pointermove → --mx/--my in [-1,1], rAF-throttled; returns cleanup; no-op if reduced or effects reduced
export function useInView<T extends Element>(opts?: IntersectionObserverInit): [React.RefObject<T>, boolean]
```

Celebration and success moments:
- A job finishes (`job` event, `status:'done'`, `job_type:'process'`): `celebrate(jobsPillEl)`, plus the "Your clips are ready" toast with 3 posters.
- Clips are added to the queue: `flyTo(slotEl, railQueueBadgeEl)` and the badge bounces.
- An export finishes: a check-draw SVG in the toast.
- First clips quest complete: `celebrate()` from the quest card.
- Deleting a clip: the card collapses (height and opacity) via WAAPI, then the grid reflows.
- An invalid URL: `.anim-shake` on the field.

### 2.8 Reduced motion and reduced effects
- Keep the existing global `@media (prefers-reduced-motion: reduce)` rule in theme.css **unchanged**.
- Add:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important }
  .reveal, .stagger > * { animation: none !important; opacity: 1 !important; transform: none !important }
}
html[data-motion="reduced"] *, html[data-motion="reduced"] *::before, html[data-motion="reduced"] *::after {
  animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important }
html[data-motion="reduced"] .reveal, html[data-motion="reduced"] .stagger > * { opacity: 1 !important; transform: none !important }
html[data-effects="reduced"] { --glass-blur: none }
html[data-effects="reduced"] body { animation: none; }
html[data-effects="reduced"] body::after { display: none }
html[data-effects="reduced"] .card-glass, html[data-effects="reduced"] .glass { backdrop-filter: none; background: var(--glass-strong) }
html[data-effects="reduced"] .border-orbit::before { animation: none }
```

- Every JS effect checks `motionReduced()`. That covers view transitions, `celebrate`, `flyTo`, `countUp`, tilt, hover-video autoplay and the Premiere tile autoplay.
- **Settings → Appearance (B6)** gains two controls stored by B1's `lib/uiPrefs.ts` (localStorage `solaris.ui.prefs`):
  - "Reduce motion": System / On / Off. It sets `html[data-motion="reduced"]`.
  - "Visual effects": Full / Reduced / Auto. Auto sets `data-effects="reduced"` when `/system/stats` `gpu.gpu_percent > 90` on 3 consecutive samples while a job is processing, and clears it 60s after the job ends. Sampling happens only while a job runs, every 8s, through the shared stats store.
- Also: a "Density" control with Comfortable and Compact, which sets `html[data-density]`.
- **Do not edit `lib/appearance.ts`.**

---

## 3. App shell and navigation (B1 unless noted)

### 3.1 Files

```
App.tsx                         (rewritten: providers + Shell; keeps StudioTarget export, openInStudio/openCreator)
lib/nav.ts                      (route store, history, hash mirror, events, navigate/back/forward, hooks)
lib/uiPrefs.ts                  (rail pinned, motion/effects/density prefs, seen flags)
lib/motion.ts
lib/hotkeys.ts                  (global key handler + chord support + useHotkey hook)
lib/stores/queueStore.ts        (useQueueSnapshot)
lib/stores/activeJob.ts         (useActiveJob)
lib/stores/library.ts           (useLibrary, useRecentClips, invalidateLibrary)
lib/stores/statsStore.ts        (useSystemStats(active) shared 8s poll)
lib/stores/activity.ts          (activity feed store + unread)
lib/stores/useVisible.ts        (usePageActive / useVisible)
styles/motion.css
styles/shell.css
styles/b2-layers.css  styles/b3-home.css  styles/b4-editor.css  styles/b5-ops.css  styles/b6-system.css   (empty files created by B1, imported from theme.css; each owned by the named builder)
components/shell/Shell.tsx
components/shell/Rail.tsx
components/shell/TopBar.tsx
components/shell/Breadcrumbs.tsx
components/shell/JobsPill.tsx
components/shell/TransportDock.tsx
components/shell/KeepAlive.tsx
components/shell/GoldGradientDefs.tsx
components/ui/*                 (section 6.4)
```

Global layers (owned by **B2**): `components/shell/CommandPalette.tsx`, `CreateSheet.tsx`, `ActivityDrawer.tsx`, `AssistantDrawer.tsx`, `HelpDrawer.tsx`, `ShortcutSheet.tsx`, `WhatsNew.tsx`, `Tour.tsx`, `lib/commands.ts`, `lib/searchIndex.ts`, `lib/fuzzy.ts`, `lib/help.ts`.

B1 mounts B2's layers in `Shell.tsx` through `components/shell/layers.ts`. **B1 creates this file first with stubs:**

```ts
// components/shell/layers.ts — B1 creates with stubs (each `export default function X(): null { return null }` in its own file);
// B2 replaces the component FILES, never this index.
export { default as CommandPalette } from './CommandPalette'
export { default as CreateSheet } from './CreateSheet'
export { default as ActivityDrawer } from './ActivityDrawer'
export { default as AssistantDrawer } from './AssistantDrawer'
export { default as HelpDrawer } from './HelpDrawer'
export { default as ShortcutSheet } from './ShortcutSheet'
export { default as WhatsNew } from './WhatsNew'
export { default as Tour } from './Tour'
```

Every layer takes **no props**. Layers read open state from `lib/nav.ts` layer state (`useLayer(name)`).

### 3.2 Component tree

```
<AppBoundary> (main.tsx, unchanged)
 └ App
    ├ <ConfirmProvider> <ToastProvider>            (components/ui)
    │  └ <Shell>  (CSS grid: [rail][main]; rows: [topbar][banner][content][dock])
    │     ├ <GoldGradientDefs/>
    │     ├ <Rail/>                                  logo · CreateOrb · nav groups · footer (FeedbackHub, ModelSwitcher, HealthDot)
    │     ├ <div class="shell-main">
    │     │   ├ <TopBar/>                            back/fwd · Breadcrumbs · search trigger · JobsPill · Bell · Help · Assistant
    │     │   ├ <UpdateBanner/>                      (unchanged component)
    │     │   └ <div key={locale} class="shell-content">   ← locale remount stays HERE; route state lives above
    │     │        └ <KeepAlive routes=…/>             mounts pages; hidden+inert+content-visibility when inactive
    │     ├ <TransportDock/>
    │     ├ layers: CommandPalette, CreateSheet, ActivityDrawer, AssistantDrawer, HelpDrawer, ShortcutSheet, WhatsNew, Tour
    │     ├ <Toaster/>
    │     └ {wizard && <SetupWizard onClose={() => { setWizard(false); navigate({ page: 'home' }) }}/>}
```

Shell-level duties that must be kept: `useQueueNotifications()`, `checkOnlineListAtStart()`, and the watching-count poll (30s plus automation events; move it into Rail). Keep the `app-language-changed` listener with the `key={locale}` remount. Keep every window event listener (section 3.4).

### 3.3 Routes (`lib/nav.ts`)

```ts
export type Page =
  | 'home'          // NEW landing
  | 'dashboard'     // KEPT id — now labelled "Create" (full-page generate studio)
  | 'queue' | 'watch' | 'studio' | 'creators' | 'marketplace' | 'models' | 'settings'
  | 'calendar'      // NEW
  | 'storage'       // NEW (Storage & health)

export type SettingsSection = 'general' | 'appearance' | 'notifications' | 'ai' | 'publishing'
  | 'downloads' | 'storage' | 'branding' | 'updates' | 'advanced'

export interface RouteParams {
  videoId?: string; clipId?: number            // studio
  creatorId?: number                           // creators (and studio filter)
  section?: SettingsSection                    // settings
  tab?: 'browse' | 'installed' | 'developers'  // marketplace (still also via takeMarketplaceTab)
  view?: string                                // page sub-view e.g. calendar 'week'|'month', queue lane
}
export interface Route { page: Page; params?: RouteParams }

export function navigate(to: Route, opts?: { replace?: boolean; instant?: boolean }): void
export function back(): void
export function forward(): void
export function useRoute(): Route
export function useNavState(): { canBack: boolean; canForward: boolean }
export function useMountedPages(): Page[]                    // KeepAlive LRU order
export function isMounted(page: Page): boolean

// layers
export type LayerName = 'palette' | 'create' | 'activity' | 'assistant' | 'help' | 'shortcuts' | 'whatsnew' | 'tour'
export function openLayer(name: LayerName, payload?: unknown): void
export function closeLayer(name?: LayerName): void           // no arg = close topmost
export function useLayer<T = unknown>(name: LayerName): { open: boolean; payload: T | undefined; close: () => void }

// page metadata for rail, palette, breadcrumbs
export interface PageMeta { id: Page; label: string; group: 'Make' | 'Discover' | 'System'; icon: IconName; caption: string; chord: string }
export const PAGES: PageMeta[]
```

`PAGES`, in rail order (labels go through `t()`):

| id | label | group | icon | caption (shown when the rail is expanded) | chord |
|---|---|---|---|---|---|
| home | Home | Make | home | Your studio at a glance | G H |
| dashboard | Create | Make | plus | Turn a video into clips | G N |
| queue | Queue | Make | layers | Line up many videos | G Q |
| watch | Watched channels | Make | radar | Clip new videos automatically | G W |
| studio | **Clip Editor** | Make | scissors | Review, edit and export | G E |
| calendar | Schedule | Make | calendar | What goes out when | G L |
| creators | Creators | Discover | users | What Solaris learned about each | G C |
| marketplace | Marketplace | Discover | store | Add-ons that find and rate moments | G M |
| models | AI models | System | cpu | Local AI downloads | G A |
| storage | Storage & health | System | hard-drive | Disk use and readiness | G D |
| settings | Settings | System | gear | Every preference | G S |

History:
- An in-memory stack capped at 50 entries.
- `back()` and `forward()` set `navDir`.
- Keys: Alt+← / Alt+→, plus mouse buttons 3 and 4 (handle `mouseup` with `e.button === 3 || 4` and call `preventDefault`).
- Hash mirror: `#/studio?video=<id>&clip=<id>`, `#/settings?section=ai` and so on, holding internal ids only. On boot, parse the hash. If it is invalid, go to `home`. Write it with `history.replaceState`, so the browser history doesn't fill up.
- Default route: `home`.
- `dashboard` is a real page (Create). Nothing redirects it.

`openInStudio(videoId, clipId?)` stays in App and calls `navigate({ page: 'studio', params: { videoId, clipId } })`. App derives `StudioTarget` from the route and passes `target`/`onTargetConsumed` to ClipStudio as today. `onTargetConsumed` calls `navigate({page:'studio'}, {replace:true, instant:true})` to strip the params.

ClipStudio's existing effect is keyed on `[target]`. Because App passes a **new object** whenever the params change, it still fires when the page is already mounted. `openCreator(id)` works the same way for `creators` (`initialSelected`, `onTargetConsumed`).

### 3.4 Window events (all handled in `lib/nav.ts`, installed once from App)

| Event | Behaviour |
|---|---|
| `open-queue` | navigate queue |
| `open-settings` | navigate settings; `(e as CustomEvent).detail?.section` → `params.section` (absent = top) |
| `open-models` | navigate models |
| `open-marketplace` (`OPEN_MARKETPLACE`) | navigate marketplace; Marketplace still calls `takeMarketplaceTab()` itself |
| `open-setup-wizard` | App shows SetupWizard |
| `app-language-changed` | App updates `locale` (remount below route state) |
| **new** `open-create` | `openLayer('create', detail)`; detail `{ link?: string; mode?: 'now' \| 'queue' }` |
| **new** `open-assistant` | `openLayer('assistant', detail)`; detail `{ prompt?: string }` |
| **new** `open-palette` | `openLayer('palette', detail)`; detail `{ query?: string }` |
| **new** `open-feedback` | B1 makes FeedbackHub listen and open its modal (additive `useEffect` in FeedbackHub.tsx) |
| **new** `open-activity`, `open-help` | open the respective layers |

Export constants and helpers from `lib/nav.ts`:

```ts
export const EV = { create: 'open-create', assistant: 'open-assistant', palette: 'open-palette', feedback: 'open-feedback', activity: 'open-activity', help: 'open-help' } as const
export function openSettings(section?: SettingsSection): void   // dispatches CustomEvent('open-settings', { detail: { section } })
export function openCreate(detail?: { link?: string; mode?: 'now' | 'queue' }): void
export function openAssistant(prompt?: string): void
```

### 3.5 Rail (`components/shell/Rail.tsx`)
- Width: 232px expanded, 68px collapsed, animated through `--rail-w`. Toggle with Ctrl+B or the chevron at the bottom. The choice persists as `solaris.ui.prefs.railPinned`.
- **Hover to expand is off by default.** Appearance offers an "Expand rail on hover" option with a 350ms delay.
- Below 1280px wide the rail is forced collapsed. Expanding it then overlays the content (absolute, glass) instead of pushing it.
- Top: the round logo. Hover rotates it 8° and adds a gold halo. When expanded it shows "Solaris Studio" in `.text-foil` and "by Arch" in muted.
- **CreateOrb** (inside Rail): a 48px circle with `--grad-ember` fill, `.border-orbit` and `.anim-breathe`, and a Plus icon. Expanded, it becomes a pill reading "New clips" plus `Kbd Ctrl N`. Click calls `openLayer('create', { originRect })` and adds a ripple via `::after`.
- Groups: Make, Discover, System. Each has a `t-micro` heading when expanded and a hairline when collapsed.
- Items use `aria-current="page"`. Collapsed items get a `Tooltip` with the label and caption, plus an `.sr-only` label.
- A single absolutely positioned `.rail-indicator` pill (burgundy tint with a gold left bar) sits behind the active item. Its translateY comes from the active button's `offsetTop`, with `transition: transform var(--dur-3) var(--ease-spring)`. It is also captured by the view transition.
- Badges:
  - Queue: count of processing + queued from `useQueueSnapshot()`. It turns into a red dot with a number when failed > 0. It carries `data-fly-target="queue"` for `flyTo`.
  - Watched channels: the existing pinging live dot (watching > 0), plus a red `LIVE` micro-tag when any watch is live. Liveness uses `api.automationActivity()`/WatchLive data that already exists. If no cheap source exists, skip the tag.
  - AI models: a small ring that fills while a `model_pull` event is in progress.
  - Clip Editor: the count of clips not yet exported, from `useLibrary().unexported` (cached, refreshed on job done).
- Footer: the FeedbackHub trigger restyled as an icon button (Bug icon plus "Feedback"); ModelSwitcher in compact mode (B1 restyles ModelSwitcher.tsx: when collapsed, a chip with the model initials opens its existing select in a Popover); and the **HealthDot**, which polls `api.preflight()` once at start and every 10 min. It is green when all checks pass and amber otherwise, and clicking it goes to `storage`.

### 3.6 TopBar (`components/shell/TopBar.tsx`)
- 52px, sticky, `.topbar` glass (it becomes solid on scroll via the scroll timeline).
- From left to right:
  - Back and Forward icon buttons, disabled when there is no history.
  - `Breadcrumbs`: the page label, then context crumbs that pages publish via `useBreadcrumbs(crumbs: {label: string; onClick?: () => void}[])` (exported by B1 from `lib/nav.ts`). Example: Clip Editor › "Video title" › "Clip 3".
  - A centred search trigger styled like an input: Search icon, "Search or run a command…" and `Kbd Ctrl K`. It calls `openLayer('palette')`. Below 1100px it shrinks to an icon button.
  - `JobsPill`: hidden when idle. While running it shows a `ProgressRing` (22px, `vtName="np-ring"` unless Home is active), the stage label from `jobProgress`, percent and ETA. Click opens a Popover with `<ProcessingBar/>` (the existing component), "Open queue" and Cancel.
  - Bell (`useActivity().unread` badge) opens the activity layer.
  - Help (`?` icon) opens the help layer.
  - Assistant (Sparkle) opens the assistant layer.
- `UpdateBanner` renders directly under the TopBar, unchanged.

### 3.7 TransportDock (`components/shell/TransportDock.tsx`)
- A 4px strip along the bottom of `shell-main`. It is hidden when the queue is empty and idle.
- Its width is overall progress: `done / (done + remaining)`, plus the running job's fraction. `done` counts jobs completed during this session's queue run (since the queue last became non-empty), taken from `useQueueSnapshot()`.
- A gold glowing head marks the leading edge.
- On hover it grows to 40px. It then shows a horizontal filmstrip of the processing item and up to 8 queued items (title chips) plus "Open queue".
- `aria-hidden` while collapsed. The expanded state has `role="region" aria-label="Queue progress"`.

### 3.8 KeepAlive (`components/shell/KeepAlive.tsx`)
- Mounts a page on first visit. Each page lives inside `<section data-page={id} hidden={!active} inert={!active} className={active ? 'page-active' : ''} style={{contentVisibility: active ? 'visible' : 'hidden'}}>`. Set `inert` via ref (`el.inert = !active`), because React 18 doesn't type it.
- An LRU keeps at most 6 mounted pages. `home` and the active page are never evicted.
- `marketplace` and `studio` are released 5 minutes after they were last active, unless a dialog is open inside them (`section.querySelector('dialog[open]')`).
- Each section scrolls on its own (`overflow-y:auto`), so scroll position survives.
- Every page component receives `active: boolean` as a prop (a **new prop on every page**, added by the page owner). B1 also exports `usePageActive()` (context) for nested components.
- Polls must pause when `!active || document.hidden`. Use `useVisible(active)` from `lib/stores/useVisible.ts`, which returns a boolean.

Page props contract. B1 renders exactly this; page owners must accept it:

```tsx
<Home active={a('home')} />
<Dashboard active={a('dashboard')} onOpenInStudio={openInStudio} />
<Queue active={a('queue')} onOpenInStudio={openInStudio} />
<Watch active={a('watch')} onOpenInStudio={openInStudio} onOpenCreator={openCreator} />
<ClipStudio active={a('studio')} target={studioTarget} onTargetConsumed={consumeStudio} creatorFilter={route.params?.creatorId ?? null} />
<Creators active={a('creators')} initialSelected={creatorTarget} onTargetConsumed={consumeCreator} onOpenInStudio={openInStudio} />
<Marketplace active={a('marketplace')} />          {/* B6 adds optional `active?: boolean` prop */}
<Models active={a('models')} />
<Settings active={a('settings')} section={route.params?.section ?? null} />
<Calendar active={a('calendar')} onOpenInStudio={openInStudio} />
<Storage active={a('storage')} />
```

Until each owner lands their prop, B1 renders with a `// @ts-expect-error until Bx lands` comment. Every owner must remove that comment when they add the prop, and the final tsc must be clean (**no `@ts-expect-error` may remain**). Simpler alternative: B1 adds the props, as optional, to the page signatures in one tiny edit per page during phase 0 (signature line only). **This is the chosen route.** B1 touches each page file's signature only, and then hands over ownership.

### 3.9 Keyboard map (`lib/hotkeys.ts`, B1)

| Keys | Action |
|---|---|
| Ctrl+K | palette (works even in inputs) |
| Ctrl+N | Create sheet |
| Ctrl+J | Assistant drawer |
| Ctrl+B | toggle rail |
| Ctrl+Shift+A | Activity center |
| G then H/N/Q/W/E/L/C/M/A/D/S | go to page (see PAGES chord column; 1.2s chord window) |
| `/` | focus the active page's search (pages register via `useHotkey('/', fn)`) |
| `?` | shortcut sheet |
| F1 | help drawer for the current page |
| Alt+← / Alt+→ | back / forward |
| Esc | close the **topmost** layer only (layer stack in nav.ts); dialogs handle Esc natively |

- The handler ignores events when focus is in `input`, `textarea`, `select` or `[contenteditable]`, except for Ctrl+K and Esc.
- Hotkeys are disabled while the Edit Bay is open, except Ctrl+K and Esc. TimelineEditor owns the editor keys, so **do not add Space/J/K/L**.
- Exported API:

```ts
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, opts?: { when?: boolean; allowInInputs?: boolean }): void
export const SHORTCUTS: { keys: string[]; label: string; group: 'Global' | 'Navigation' | 'Pages' }[]
```

### 3.10 Responsive behaviour (minimum 1024×640)

| Width | Behaviour |
|---|---|
| ≥ 1440 | rail may be pinned expanded; drawers can **dock** (assistant pin pushes content) |
| 1280–1439 | rail pinnable; drawers overlay |
| 1100–1279 | rail forced collapsed (expand overlays); Clip Editor inspector becomes a slide-over; Home grid 8 cols |
| 1024–1099 | TopBar search becomes icon; breadcrumbs show last crumb only; Home grid 6 cols, KPI tiles 2×2; Queue lanes become Tabs; Create sheet full width |
| height < 720 | TopBar 44px; Home hero paste shrinks; Premiere tile hidden; dialogs `max-height: calc(100vh - 32px)` with internal scroll |

The Create sheet is `min(1320px, 100vw)` wide, and full width below 1400px. AddVideos needs about 1300px, so it scrolls horizontally inside its container below that (`overflow-x:auto` wrapper). That is acceptable.

---

## 4. Per-screen specs

### 4.0 Test-pinned files (restyle only): exact strings that must survive

Rules:
- Do not rename, move or split these files. Do not change their default export names.
- Edits are only allowed by the listed owner, only as listed, and never on a line containing a pinned string. Keep indentation exact and keep typographic apostrophes (’) as they are.
- Preferred restyling route: CSS selectors in the owner's `styles/*.css`, scoped under wrapper classes in the files you own (e.g. `.edit-bay [role="tablist"]`).

| File | Owner | Allowed edits |
|---|---|---|
| `components/TimelineEditor.tsx` | B4 | **none** (CSS from outside only) |
| `components/ClipEditor.tsx` | B4 | className values on non-pinned lines |
| `components/ClipCard.tsx` | B4 | className values and wrapper markup on non-pinned lines, add `data-clip-id` / poster ref props |
| `components/EditSuggestions.tsx` | B4 | none |
| `components/YouTubePanel.tsx` | B4 | none |
| `components/queue/AddVideos.tsx` | B1 | ONLY: add an optional `initialLink?: string` prop to the signature line and one `useEffect` that seeds the first slot's link if empty. Nothing else. |
| `components/queue/StepFields.tsx` | — | none |
| `components/queue/QueueItemSettings.tsx` | — | none |
| `components/watch/WatchCard.tsx` | B5 | className values on non-pinned lines only |
| `components/PipelineFields.tsx` | — | none |
| `components/PluginStepsNote.tsx` | — | none |
| `components/NoClipsExplanation.tsx` | — | none |
| `components/UpdateBanner.tsx` | B1 | className values only |
| `pages/Marketplace.tsx` | B6 | className values, plus additive wrapper elements and imports **outside** the bodies of `EntryCard`, `InstallDialog` and `ListingPage`; optional `active` prop |
| `pages/MarketplaceDevelopers.tsx` | B6 | className values only |
| `pages/Settings.tsx` | B6 | layout restructure allowed, but the UpdateCard strings must stay |
| `lib/api.ts` | B1 | additive methods only |

Exact strings and regexes that must keep matching, by file:

**TimelineEditor.tsx**

```
const wordMuted = (w: Word): boolean => isWordMuted(edit, w)
const toggleWord = (w: Word): void => push(toggledWord(edit, w, duration))
noLayout: isLandscape ? 'landscape' : isVerticalLive ? 'vertical_live' : gaming ? 'gaming' : undefined
words: wordsRead ? words : undefined,
pushSuggestion(back.state.edit, back.state.layout, { id, kind: 'take_back', delta: session })
fromApplied(entry.applied, clip.start_s)
edit: { ...defaultEdit(duration), ...(baked ?? {}) },
const step: Past = nextLayout !== layout ? { edit, layout, suggestion: mark } : { edit, suggestion: mark }
setHistory((h) => pushed<Past>(h, step))
type Past = { edit: EditData; layout?: string; suggestion?: UseMark } | { speakers: SpeakerTurn[] | null }
setHistory((h) => pushed<Past>(h, { edit }))
setUses((u) => marksAfterUndo(u, mark))
if (last.layout !== undefined) setLayout(last.layout)
await api.rerenderClip(clip.id, undefined, renderOpts, usedSuggestions())
pendingRender={dirty ? { render_opts: buildRenderOpts(), suggestions: usedSuggestions() } : null}
await api.rerenderClip(clip.id)⏎   (newline directly after)
```

Plus the regexes in `tests/test_ui_edit_suggestions.py` and `tests/test_plugin_sdk_edit.py`:
- the suggestion `useOff` block;
- `setWords(r.words)` followed by `setWordsRead(true)`;
- the `setUses({})` and `setHistory` resets;
- layout tuples `['track', 'Auto (AI)',` / `['letterbox', 'Letterbox',` / `['center', 'Center',`;
- the fade `<option value={0}>{0.3}{0.5}{1}`;
- speeds `[0.75, 1, 1.25, 1.5, 2]` and hook seconds `[2, 3, 5, 8]`;
- `<span className="text-muted">Layout</span>` followed by the inline crop array.

**Since TimelineEditor is not edited at all, all of these survive by default.**

**ClipEditor.tsx**: `{suggestionLine(e, { start: clip.start_s, end: clip.end_s })}`

**ClipCard.tsx**: `const suggested = hasNewSuggestion(clip.scores?.plugin_edits)` · `Suggested edit⏎` (JSX text alone on its line) · `${suggested ? ', suggested edit' : ''}`

**EditSuggestions.tsx**: `disabled={busy || Boolean(card.useOff)}`

**YouTubePanel.tsx**: `render_first: pendingRender ?? null`

**lib/api.ts**: `...(suggestions ? { suggestions } : {})` · `suggestion?: { id: string; state: 'hidden' | 'new' }`

**AddVideos.tsx**:
- The `key: 'edit', label: 'Suggest edits', hint: '(Marketplace)', title: '…Not with Longform.'` block.
- `(s.options.pipeline && badSettings[s.key]) ||` followed by `stepProblemKeys(s.key, s.options).some((k) => badSettings[k])`.
- `if (key === 'edit') return Boolean(o.edit?.length)`
- `if (tg.key === 'edit' && editUsable.length === 0 && !slot.options.edit?.length) return null`
- `const first = firstStepPlugin(stepUsable, next)`
- `tg.key === 'steps' && !hasSteps(slot.options) && !firstStepPlugin(stepUsable, slot.options)`
- `disabled={disabled}`
- The "The only plugin you can use to rate or understand moments is this video’s Pipeline…" string.
- `onProblem={(bad) => setBadSettings((b) => ({ ...b, [slot.key]: bad }))}`
- ``setBadSettings((b) => ({ ...b, [`${slot.key}:${step}:${id}`]: bad }))``, which must appear **exactly twice**.
- `steps={['edit']}` · `plugins={editPlugins}`
- `label: 'Rate & understand',⏎    hint: '(Marketplace)',` (4-space indent).
- The long "Plugins you installed from the Marketplace look at the moments once they’re found…Not with Longform." string.
- `if (key === 'steps') return Boolean(o.rate?.length || o.understand?.length)`
- `{t('Fix the pipeline setting marked in red first.')}`

→ B1's `initialLink` addition must not create another `setBadSettings` line.

**StepFields.tsx**: `edit: { first: 'Suggest edits with', more: 'and with', none: 'No suggestions' }`, `t('Each plugin’s suggestion is shown on its own. You choose which to use.')`, and every listed single-quoted literal (Moments found by; Understand them with; …). Untouched.

**QueueItemSettings.tsx**: `stepsPatch(s, stepsKept, Boolean(channel))`, `const edits = editPatch(…)`, the `JSON.stringify([...])` list, and the Longform block whose `},` closes at 10 spaces. Untouched.

**WatchCard.tsx**: `mode: watch.publish.mode` · `max_posts: watch.publish.max_posts` · `presetLongform: Boolean(automation.presets.find((p) => p.id === watch.preset)?.options?.longform)` · `save={(patch) => api.patchWatch(watch.id, { options: patch })}` · `channel={{`

**PipelineFields.tsx / PluginStepsNote.tsx / NoClipsExplanation.tsx**: untouched (pinned `t()` strings and the aria-label).

**Marketplace.tsx**:
- `const TABS … = [` with ids exactly `'browse'`, `'installed'`.
- `t('For developers: install a pipeline you’re writing')` and `<MarketplaceDevelopers ` (trailing space); no `function AddFromLink(`.
- The bodies of `function EntryCard(`, `function InstallDialog(` and `function ListingPage(` end with `\n}\n` and keep their pinned contents.
- The `'Where it comes from'` / `<TechnicalDetails` ordering; `['Repository', listing.repository]`.
- `listing.author` occurs **exactly 2 times**, both in ListingPage.
- `sources.GITHUB_RE.pattern`.
- The ENFORCEMENT_NOTE literal, the "I trust this model…" string, the "Pipelines made by other developers…" string, `{(done.outputs ?? ['ranges']).includes('ranges')` and `t('Ready. Add a video in the Generate bar, tick Rate & understand and choose')`.
- No `t('Made by')`.
- Must not contain `each one finds a video’s moments`.
- No `t()` string may contain "plugin", jargon (commit, repository, manifest, fork, registry, checksum, pickle, settings.yaml, git, exit code, PATH), `everyone on this PC|how to get them|checked its listing`, `Nobody has read`, or `folder or a (GitHub )?link|Add from`. **This applies to any new `t()` text B6 adds inside Marketplace.tsx.** Put new copy in `components/marketplace/MarketplaceFeatured.tsx` instead, and still follow the same word rules there.

**MarketplaceDevelopers.tsx**: `t('For developers')` · `t('Solaris Studio hasn’t checked pipelines installed here. To find pipelines, use Browse.')`

**lib/plugins.ts**: `MarketplaceTab = 'browse' | 'installed' | 'developers'` (do not edit).

**Settings.tsx**: `` `Version ${state.version} is in the Microsoft Store. This copy is ${state.current}.` `` · `` `You're on the latest version (${state.current}).` `` · `` `Couldn't check the Microsoft Store just now.` `` · `window.studio.update.openStore()`

**UpdateBanner.tsx**: `window.studio.update.openStore()` · `if (!s.behind || s.skipped) return null`

---

### 4.1 Home hub: `pages/Home.tsx` (NEW, B3)

Container `max-w-[1600px] mx-auto p-6`, 12-column grid, gap 24 (16 when compact). Tiles use `.stagger` on first mount.

1. **Hero quick-paste** (12 columns, `components/home/QuickPaste.tsx`).
   - A large `.card-hero .border-orbit` glass bar, radius xl.
   - Placeholder: "Paste a YouTube, Twitch or Kick link, or drop a video".
   - Platform detection: `/(youtube\.com|youtu\.be)/`, `/twitch\.tv/` and `/kick\.com/` show the YouTube/Twitch/Kick icon badge, which morphs in.
   - On focus it calls `window.studio.readClipboardKey?.()`. If that returns a URL matching a platform and the field is empty, it shows a "Use copied link" chip. **It never auto-submits.**
   - Drag-and-drop of video files: the files go to `api.addLocalVideo` (exact signature in api.ts). Portrait files call `api.localVideoShape` and show the hint "Looks vertical: Vertical Live suggested".
   - "Generate" (`.btn-gold`) calls `api.createJob({ url, ...seedOptions(), ...presetOptions })`. Check the api.ts signature. On success it runs `flyTo(heroEl, queueBadge)` and shows the toast "Started" with "View queue" (dispatches `open-queue`).
   - "Options" (chevron) calls `openCreate({ link })`.
   - Invalid URL → `.anim-shake` plus inline error text.
   - Preset chips below: Shorts (default), Vertical Live, Gaming, Podcast, Longform. Each maps to an options bundle over `seedOptions()` (`vertical_live`, `gaming`, `podcast`, `longform`). Each chip has an Info button that opens a Popover titled **"What changes"**, listing the options in plain words.
   - Chip state is local and remembered in `solaris.ui.home.preset`.
2. **Now processing spotlight** (8 columns, `components/home/NowProcessing.tsx`).
   - Driven by `useActiveJob()`.
   - Content: a large ProgressRing (`vtName="np-ring"`), the stage label, display_title, "clip 3 of 8", a remote chip ("on Gaming PC") and a plugin name chip, the ETA ticking every second, a striped ProgressBar, and Cancel (`useConfirm`, then `api.cancelProcessing`).
   - Idle: "Up next: N videos · ETA" with a Resume/Pause toggle, or "Nothing running" with "Start something", which opens create.
   - `.card-glow` while running.
3. **Queue mini** (4 columns): three small rings (processing, waiting, failed) and "Open queue".
4. **Premiere: Best this week** (4 columns, optional tile, hidden when height < 720).
   - The highest-score clip from the last 7 days (`useRecentClips`).
   - Poster from `api.clipFrameUrl(id, 1)`. On hover it plays `/media/preview/{id}` muted through the shared HoverPreview (B4 exports `components/library/HoverPreview.tsx`; until it lands, use a plain `<video>`).
   - Overlay: title in `.t-md` foil, ScoreBadge, "Open in Clip Editor".
   - **No autoplay rotation.** Under reduced motion it never autoplays.
5. **Fresh clips** (8 columns, `components/home/RecentClips.tsx`).
   - A scroll-snap strip of 9:16 tiles, the newest 24 clips from `useRecentClips(24)`.
   - Each tile: poster, `.scrim-bottom` title, ScoreBadge top-left, duration as a `.t-mono` timecode bottom-right.
   - Hover: frame scrubbing via the `HoverPreview` (B4) API; after 400ms, muted playback.
   - Quick actions on hover: Open, Star/exported (`api.patchClip(id,{exported})`), Tighten (`api.tightenClip`, spinner, toast), Publish (`onOpenInStudio(videoId, clipId)` → inspector).
   - Filter chips: Best, Not exported, Scheduled.
   - Arrow buttons at the edges.
   - Skeleton tiles while loading.
6. **KPI tiles** (4 tiles, 3 columns each; `components/home/KpiTiles.tsx`):
   - Clips this week, with a delta arrow against last week.
   - Total clips (sum of `clip_count`).
   - Hours processed: the sum of `source_seconds` for completed queue jobs when known; otherwise label it honestly as "Processing time".
   - Average score: the `avg_score` from `api.creators()`, weighted by clip count.
   - Numbers use `CountUp`. Each tile has a 14-day `Sparkline` built from created_at.
7. **First clips quest** (`components/home/FirstClipsQuest.tsx`).
   - Shown until it is complete or dismissed (`solaris.ui.quest.dismissed`). It goes first in the grid when it is shown.
   - Steps are derived from real data:
     1. Add a video: any video exists.
     2. Clips made: any `clip_count > 0`.
     3. Open one in the Clip Editor: `solaris.ui.quest.openedEditor`, set by B4 when EditorView opens.
     4. Export or publish: any clip has `exported_at`, or a `publish` event with `terminal` arrived (B1's activity store exposes `hasPublished`).
     5. Watch a channel (optional): `api.watches().length > 0`.
   - Check-draw SVG per step, a progress ring, and `celebrate()` when all are done.
8. **Up next to publish** (6 columns): the next 5 posts. `api.woopSocialStatus()` must be enabled before calling `api.woopSocialSchedule()`. Also include clips with `scheduled_for` from the library. "Open calendar" button.
9. **Watch radar mini** (3 columns): the live dot, a countdown to `next_check_at` (`api.automationActivity()`), and the latest event. Links to watch.
10. **Engine** (3 columns): CPU, GPU, VRAM and disk rings from `useSystemStats(active)`.
11. **Activity log (advanced)** (12 columns): a `Disclosure`, closed by default, containing the old `describeEvent` monospace log. B3 moves `describeEvent` into `components/home/ActivityLog.tsx`.

Empty library (no videos): the grid is replaced by "Your first take": an `EmptyState illustration="sun"` with 3 illustrated steps (Paste → Clips → Publish), with QuickPaste still on top and the quest beneath.

Data: `useLibrary()`, `useRecentClips()`, `useQueueSnapshot()`, `useActiveJob()`, `useSystemStats(active)`, `api.creators()`, `api.automationActivity()`, `api.woopSocialStatus/Schedule`.

### 4.2 Create: `pages/Dashboard.tsx` (REWRITTEN, B3; page id `dashboard`, label "Create")

The full-page generate studio, for people who want everything on screen.
- `PageHeader eyebrow="MAKE" title="Create"` with the subtitle "Paste links or drop files. Pick a preset, fine-tune, generate." Actions: "Open queue", plus a model pill (read-only, linking to models).
- A preset strip (same chips and "What changes" popovers as Home; shared component `components/home/PresetChips.tsx`, owned by B3).
- `<AddVideos onAdded={…}/>` mounted unchanged inside `.card .create-surface` (full width, `overflow-x:auto`). `onAdded` → `flyTo` to the queue badge, plus a toast.
- `<ProcessingBar/>` underneath as a slim strip.
- "Recently processed": a poster list of the newest 10 videos (thumbnail from the first clip frame, title, channel, status `StatusChip`, clip count, process time). Clicking a row opens `onOpenInStudio(videoId)`. "See all in Clip Editor".
- Remove the resizable Assistant panel, its ResizeObserver code and the `dashboard.assistantHeight` usage. Remove the Activity card (it now lives on Home and in the ActivityDrawer). Remove `window.confirm` (deleting a video now lives in the Clip Editor).
- Props: `{ active, onOpenInStudio }`.

### 4.3 Create sheet: `components/shell/CreateSheet.tsx` (B2)
- A `Sheet` on the right, `min(1320px,100vw)` wide (full width under 1400px). It emerges from `payload.originRect` when given.
- Header: a Clapper icon whose slate-bar rotates closed once (keyframe in `b2-layers.css`), the title "New clips", and a `Segmented` control: "Generate now" / "Add to queue". Mode is informational: AddVideos already switches its button label by slot count. Keep the Segmented control, but its only job is setting the hint text. Do not fake behaviour.
- Body: `PresetChips` (from B3; until it lands, render nothing), then `<AddVideos onAdded={done} initialLink={payload?.link}/>`.
- `done`: `flyTo(sheetBody, queueBadge)`, a toast "Added to queue" with "View queue" (dispatches `open-queue`) and "Keep adding" (reopens), then the sheet closes.
- Opened by: CreateOrb, Ctrl+N, Home Options, palette "New clips…", Queue "+ Add videos", and `open-create` events.

### 4.4 Queue: `pages/Queue.tsx` (B5)
- **Header band**:
  - A big `ProgressRing` (overall fraction) with `formatQueueEta` inside.
  - "N videos remaining".
  - One state toggle button showing `StatusChip` Running / Paused / Stopping. Click calls `pauseQueue` or `resumeQueue` (the existing functions). Labels: "Pause queue" / "Start queue".
  - "+ Add videos" → `openCreate({ mode: 'queue' })`.
- **Lanes** (3 columns at ≥1280, Tabs below):
  - **Processing**: large QueueItem cards inside `.card-glow`.
  - **Up next**: numbered, with drag-to-reorder. Pointer drag on a `Grip` handle in a wrapper around each QueueItem: an animated placeholder, then on drop `api.moveJob(id, …)` (check the signature). Keyboard fallback: Alt+↑/↓ on a focused row. Keep "Clear waiting".
  - **Done & failed**: Segmented Completed / Failed; a search box filters titles; pages of 30 with "Show more"; keep "Clear completed/failed".
- Clear buttons become `HoldButton` (from components/ui: hold 800ms with a fill animation; clicking twice within 3s is the keyboard fallback).
- Failed cards get "Why did this fail?" in a `Disclosure` that loads `api.jobLog(id, 80)` (monospace, Copy button), plus Retry (`api.retryJob`).
- Lanes collapse with `.collapse`.
- AddVideos is **removed** from the page.
- Keep the 20s poll and event refresh, gated by `useVisible(active)`.
- Empty state: `EmptyState illustration="queue"` titled "Your queue is empty", body "Queue lets you line up many videos and leave Solaris Studio working.", with a "New clips" action.
- QueueItem.tsx (not pinned) may be restyled by B5.

### 4.5 Watched channels: `pages/Watch.tsx` (B5)
- **Radar hero** (`components/watch/RadarHero.tsx`, new):
  - A 180px radar: `.radar-sweep` over concentric hairline rings, with watch avatars as blips placed by hash angle. Live channels pulse `--color-live`.
  - The master switch is a large `Toggle` ("Auto-clipping") wired to `api.setAutomation({enabled})`. `.radar-off` when it is off.
  - "Next check in mm:ss" counts down every second from `next_check_at`, plus now.state, text and progress (`api.automationActivity()`).
  - "Check all now" calls `api.checkWatch(id)` for each watch, sequentially, then shows a toast.
  - A gear Popover "Radar settings": check interval, "Delete each watched video's download once published" (Toggle), and "Keep watching when the window is closed" (Toggle, only if `window.studio.tray` exists).
- The AI status line becomes one compact `Badge` chip that expands (Disclosure) to show the OpenRouterPrompt, or the provider plus the ChatGPT-plan warning. Same logic.
- `<WatchLive/>` sits in an "On air now" strip.
- **Channel grid**:
  - The first tile is "+ Watch a channel" (dashed, `.lift`). It opens `components/watch/AddChannelSheet.tsx`, a stepped `Sheet` with `StepProgress`:
    1. Platform and URL.
    2. When it posts (auto / ask / off as three choice cards) plus publish-to accounts (`useWoopAccounts`). If none are set up: "Connect a posting account" → `openSettings('publishing')`.
    3. Clips (frame-mode switches, SportFields, Vertical Live content).
    4. Schedule (WatchSchedule) and hashtags plus "Only use my hashtags".
  - The sheet uses the **same state, fields and `api.addWatch` call** as today's form, moved into the sheet component. Keep justAdded: the new card opens its setup and gets `.anim-flash`.
  - Each `<WatchCard/>` is wrapped in `components/watch/ChannelTile.tsx`: a platform-coloured 3px left edge, an `Avatar`, and found/queued/skipped counts from `api.watchItems(watch.id)`, loaded lazily with `useInView`.
- **Events timeline**: a collapsible right column (≥1440) or a Disclosure below, from activity `events[]` (time, text, link via `window.studio.openExternal`).
- WatchPublishSettings' `open-settings` dispatch may gain `{detail:{section:'publishing'}}` (B5 owns the watch/* files).
- No `window.confirm`.

### 4.6 Clip Editor library: `pages/ClipStudio.tsx` (B4; nav label stays **Clip Editor**)
- **Left video rail** (`components/library/VideoRail.tsx`, 280px, collapsible):
  - Search (`/` hotkey), creator filter chips (preselected from the `creatorFilter` prop), sort (Newest / Channel A–Z / Most clips), view toggle (List / By creator).
  - Rows: thumbnail (first clip frame), title, channel, status dot plus word, clip count, process time, and a ⋯ `MenuButton` with "Delete video" (`useConfirm` with tone danger → `api.deleteVideo`).
  - "All clips" sits at the top.
  - This replaces the creator-chip dropdown, and also absorbs the old Dashboard "Processed videos" table: search, channel filter, sort and delete are all kept.
- **Centre grid**:
  - Sticky toolbar: Segmented All / Shorts / Longform; sort (Best score / Newest / Time); density S/M/L; a Select toggle.
  - Right cluster keeps "Export all (N)", "Publish all (N)" (PublishAllDialog) and "Schedule" (ScheduleView), plus "Open calendar".
  - Notes (SportsNote / ClipDirectionNote / PluginStepsNote / export notice) go in one `Disclosure` titled "Notes for this video".
  - ClipCard grid with `.reveal`, and `.tilt` via `attachTilt` on the wrapper. Hover-scrubs frames by mouse X (`api.clipFrameUrl(id, t)`), then plays a muted preview after 400ms through **one shared `HoverPreview`**.
  - Multi-select: a checkbox on hover, shift-click for ranges, Ctrl+A for all visible, Esc to clear.
  - `BulkBar` (`components/library/BulkBar.tsx`) enters from the bottom with `@starting-style`: Export selected (`api.exportBatch` with the ids, then a toast with check-draw), Publish selected (PublishAllDialog with the subset if its props allow; otherwise disable with a tooltip "Use Publish all"), Mark exported, Delete (confirm).
  - Deleting a card collapses it.
- **Right inspector** (400px sticky; a slide-over below 1280): the existing `<ClipEditor/>`, restyled.
- Double-click, Enter or "Open editor" on a card: `markClipTransition(posterEl, clip.id)`, then `withViewTransition(() => openEditor())`.
- `window.alert` becomes `toast`. Keep target/onTargetConsumed/pendingClip unchanged.
- Breadcrumbs: Clip Editor › video title (› clip title in the editor).
- Empty state: `EmptyState illustration="film"` with "Make your first clips" → `openCreate()`. NoClipsExplanation stays inside the empty grid area.

**HoverPreview** (`components/library/HoverPreview.tsx`, B4). Exact API, because B3 uses it:

```ts
export function useHoverPreview(clipId: number, opts?: { src?: 'media' | 'preview'; scrub?: boolean; durationS?: number }):
  { ref: React.RefCallback<HTMLElement>; posterUrl: string; playing: boolean }
// One module-level <video muted playsInline preload="none"> moved into the hovered element; scrub sets poster to clipFrameUrl(id, t) by pointer X (throttled 120ms);
// 400ms hover → plays; leave → pauses & detaches. Disabled when motionReduced() (poster only). Pauses when document.hidden.
```

### 4.7 Clip Editor workspace / Edit Bay: `components/EditorModal.tsx` (EditorView) (B4)
- **The EditorView file may be restyled and re-laid out by B4** (it is not test-pinned). TimelineEditor is mounted unchanged.
- Root gets the class `edit-bay`. On mount: `document.documentElement.dataset.editBay = ''`, which makes the Rail collapse and the TopBar shrink to an 8px reveal strip that expands on hover. Remove it on unmount. Set `data-playing` on the html element while the video plays (this hides grain).
- Entry: a letterbox wipe (`animation: letterbox var(--dur-4) var(--ease-out-expo)`) on the stage, plus the `clip-<id>` view-transition name on the stage wrapper.
- Top bar: "← Back to clips", the title (inline edit via `api.patchClip(id,{title})`), a timecode display (`00:01:23`, `.t-mono`), the YouTube button, and a "Safe areas" toggle (PlatformOverlay).
- Stage: an abyss background with a radial burgundy glow (`--grad-velvet`), with the WatermarkOverlay and LiveTextOverlay unchanged.
- Timeline styling comes from `styles/b4-editor.css`, scoped `.edit-bay`:
  - the `[role="tablist"]` tabs become pills with a sliding gold underline (`[aria-selected="true"]`);
  - range inputs get gold thumbs;
  - word chips get `.edit-bay button` hover states.
  - Selectors must target roles and attributes, never change TimelineEditor markup.
- Esc closes as today. If TimelineEditor signals dirty state through an existing prop or callback, confirm via `useConfirm`. Otherwise keep today's behaviour.
- On first open, set `solaris.ui.quest.openedEditor = '1'`.

### 4.8 Schedule / Calendar: `pages/Calendar.tsx` (NEW, B6)
- `PageHeader eyebrow="MAKE" title="Schedule"`. Segmented Week / Month (`params.view`, default week). Prev, Today and Next buttons.
- Week view: 7 columns × hour rows (06–24, scrollable). Month view: a 6×7 grid.
- Chips show the platform icon, a 24px poster, the title, and a state `Badge` (scheduled / uploading / failed / posted).
- Sources, merged on the client (`lib/calendarData.ts`, B6):
  - `api.woopSocialSchedule()` if `woopSocialStatus` is enabled;
  - clips with `scheduled_for` from `useLibrary()` (B1's library store exposes `clipsByVideo` lazily: call `loadClipsFor(videoIds)`);
  - `api.youtubeUploads(50)` if `youtubeStatus` is enabled (posted);
  - `api.automationSlots(...)`, shown as dashed gold "free slot" ghosts;
  - `api.woopSocialInFlight()` (B1 adds the wrapper) for an "In flight" side list.
- Click a chip → `onOpenInStudio(videoId, clipId)`.
- Failed chips offer "Check stuck posts" (`api.woopSocialRefresh()` or `refreshWoopSocial`; use whichever exists for POST /woopsocial/refresh).
- Header buttons: "Open full schedule" (mounts `<ScheduleView onClose/>`) and "Publish all" (go to studio).
- With no provider connected: `EmptyState illustration="calendar"` with "Connect publishing" → `openSettings('publishing')`.
- No drag-to-reschedule (there is no endpoint).

### 4.9 Creators: `pages/Creators.tsx` (B5)
- **Left list**: search, sort (Clips / Avg score / Name), and a toggle List / Leaderboard.
  - Leaderboard: animated horizontal bars of clips and avg score, with bars growing via a `transform: scaleX` transition and stagger.
  - Rows: `Avatar` (seeded by creator id), name, platform badges, "Watched" Badge, and a mini meter of avg score.
- "Possible matches" becomes a dismissible `Callout` at the top. Two avatars joined by an animated line, and "Link as same creator" (`api.mergeCreators`).
- **Right detail**, with Tabs:
  - Overview: stats, channels with Detach and an add-channel form, Storylines chips, and **"See their clips"** → `navigate({page:'studio', params:{creatorId}})`.
  - Knowledge: grouped facts, state chips, a times-seen meter, delete per fact, "Forget the N unused".
  - Branding: the default branding select, "+ New branding" with WatermarkControls.
  - Preferences.
  - Danger zone: a red-bordered card at the end of Overview with Wipe learned memory and Delete this creator, both via `useConfirm({tone:'danger'})`.
- "Learning enabled" becomes a Toggle with a tooltip. Switching it off offers the wipe via `useConfirm`.
- `initialSelected` gets a scroll into view plus `.anim-flash`.
- All existing API calls are kept. Props: `{ active, initialSelected, onTargetConsumed, onOpenInStudio }`.

### 4.10 Marketplace: `pages/Marketplace.tsx`, `MarketplaceDevelopers.tsx` (B6, restricted)
- New `components/marketplace/MarketplaceFeatured.tsx`: a scroll-snap row of up to 3 large gradient cards. It takes the first official-tier listings from `plugins` catalog data (`listing.details?.tier === 'listed-official'`). Clicking scrolls to and opens the listing via an existing handler, if one is reachable from outside. Otherwise it shows "Find it in Browse" and focuses the search. Copy follows the banned-word rules.
- Rendered by `Marketplace.tsx` above the tabs: one additive import plus one JSX element **outside the pinned function bodies**.
- CSS (b6-system.css), scoped `.market`:
  - the tablist becomes a pill Segmented look;
  - listing cards get `.lift` and a category colour band (`[data-category]` if present; otherwise `:nth-child` hues);
  - InstallDialog's backdrop uses the shared look via a class on the outermost wrapper, which is outside the InstallDialog body only if it is a separate element. Otherwise leave it alone.
- Make the developers link visible as a ghost button **only through CSS**: its text and JSX stay the same.
- Accept an optional `active` prop.
- Run `PYTHONUTF8=1 pytest tests/test_ui_marketplace.py tests/test_ui_steps.py` after every edit.

### 4.11 AI models: `pages/Models.tsx` (B6)
- **"Where your AI runs"** card on top: Local (Ollama) or Cloud provider, a big status dot, and "Change" → `openSettings('ai')`. The cloud note and OpenRouterPrompt (highlighted when VRAM < 5.5GB) move inside it.
- Hardware hero: VRAM and RAM arcs plus the GPU name from `useSystemStats(active)`.
- Installed models as cards: an "Active" gold ring, size, speed meter (ok / slow / warn from `lib/modelSpeed`), Use (`api.activateModel`, with a ring-swap animation) and Remove (`useConfirm` → `api.deleteModel`).
- Recommendations as clickable cards with "Download" → `api.pullModel(tag)`, with no typing.
- Per-tag `ProgressBar` from `model_pull` events (completed/total). A "Download another model" tag input is kept.
- Offline: `EmptyState` "Ollama isn't reachable" with Retry.
- A **global download tray** shows `model_pull` progress as a persistent toast on every page. B1 implements it in the activity store and Toaster (`toast.progress(id, …)`).

### 4.12 Settings: `pages/Settings.tsx` (B6)
- Two columns. Left: a sticky section nav with a filter box. Right: `max-w-3xl` content.
- Sections (`SettingsSection` ids, in this order):

| id | label | cards |
|---|---|---|
| general | General | LanguageCard, SetupCard |
| appearance | Appearance & accessibility | AppearanceCard + new **MotionEffectsCard** (Reduce motion, Visual effects, Density, Expand rail on hover — uses `lib/uiPrefs.ts`) |
| notifications | Notifications | NotificationsCard |
| ai | AI | AICard (onOpenModels → navigate models), MinScoreSetting |
| publishing | Publishing accounts | **connection chip row** (YouTube / WoopSocial / Upload-Post: Connected / Not set up from the three status calls), YouTubeCard, WoopSocialCard, UploadPostCard |
| downloads | YouTube downloads | YouTubeDownloadCard |
| storage | Files & storage | ExportFolderCard, StorageCard, VideoStorageCard, link "Open Storage & health" |
| branding | Branding | BrandingCard |
| updates | Updates & license | UpdateCard (pinned strings verbatim), LicenseCard |
| advanced | Advanced | RemoteRenderCard, the config/settings.yaml info card |

- Each section is wrapped as `<section id={'settings-' + id} data-section={id}>` with a `SectionHeader`.
- The `section` prop scrolls there (`scrollIntoView({behavior: motionReduced() ? 'auto' : 'smooth'})`) and runs `.anim-flash`.
- An IntersectionObserver scroll-spy moves the gold nav indicator (a transform transition).
- The filter box hides cards whose title or keywords don't match (a static keyword map in the page).
- Card logic is unchanged. VideoStorageCard's two-step confirm may stay.

### 4.13 Storage & health: `pages/Storage.tsx` (NEW, B6)
- **Preflight checklist** from `api.preflight()`: FFmpeg, Ollama, model, Whisper, GPU and disk. Each row shows a check or alert icon, a word (Ready / Needs attention) and a fix hint. "Re-run checks".
- **Disk bar**: a stacked bar of source / transcript / clips from `api.storageVideos()` totals, plus disk free from `useSystemStats`.
- A ranked bar list of videos by size (top 30, "Show all"), each with "Delete video" (`useConfirm` → `api.deleteVideo`, then the row collapses).
- **Reclaimable** by category from `api.storage()`, plus a "Clean up" button (`api.storageCleanup()`). The bar shrinks and a `countUp` shows the bytes freed.
- Footer: app and engine version from `api.health()`.

### 4.14 Activity center: `components/shell/ActivityDrawer.tsx` (B2; store by B1)
- A 400px right `Sheet`. Filter chips: All / Jobs / Publishing / Watch / Models / Technical log.
- Event cards show relative time:
  - job done: clip count plus "Open clips" (→ openInStudio);
  - job failed: Retry (`api.retryJob`) plus "View log" (inline monospace `api.jobLog`, Copy);
  - publish: phase, and when posted a link via `window.studio.openExternal`;
  - model download: a progress bar;
  - automation: text plus link.
- The "Technical log" tab shows the raw `describeEvent` lines from the store's raw buffer.
- "Mark all read".

`lib/stores/activity.ts` (B1). Exact API:

```ts
export type ActivityKind = 'job' | 'publish' | 'watch' | 'model' | 'system'
export interface ActivityItem { id: string; at: number; kind: ActivityKind; tone: 'success' | 'warn' | 'error' | 'info';
  title: string; body?: string; videoId?: string; clipId?: number; jobId?: number | string; url?: string; progress?: number }
export function useActivity(): { items: ActivityItem[]; unread: number; raw: string[]; hasPublished: boolean; markAllRead: () => void }
export function startActivityFeed(): () => void   // called once by Shell: one useEvents-equivalent subscription + history seed
```

History seed: completed and failed jobs from `api.queue()`, `api.automationActivity().events`, and `api.youtubeUploads(50)` only when `youtubeStatus` is enabled. Unread is based on a lastSeen timestamp in `solaris.ui.activity.lastSeen`. The store also fires the toasts:
- "Your clips are ready": fetches `api.clips(videoId)`, shows the first 3 posters and "Open in Clip Editor", and calls `celebrate(jobsPill)`.
- Failed job: a toast with Retry.

### 4.15 Assistant drawer: `components/shell/AssistantDrawer.tsx` (B2)
- 440px wide. Can be pinned (≥1440 docks it and pushes content via the `html[data-dock="assistant"]` grid column; B1 reserves that column in shell.css).
- Hosts `<Assistant/>` unchanged.
- The page-aware "Try:" prompt above it is a row of chips from `lib/help.ts` by current page. Clicking a chip fills the Assistant input only if Assistant exposes a way; otherwise the chip copies the text into a `payload.prompt` banner the user can paste. Do not edit Assistant.tsx except restyling className values (B2 owns Assistant.tsx).
- Animate the assistant's step list with `.stagger` via CSS on its list elements (`.assistant-drawer ol > li`, `ul > li`).

### 4.16 Command palette: `components/shell/CommandPalette.tsx` (B2)
- A 640px glass `Dialog` near the top. Combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls` → `role="listbox"`, rows `role="option"` with `aria-selected`.
- Scope prefixes: `>` commands, `@` creators, `#` clips, `!` channels.
- Groups: Recent, Go to (every page and every Settings section), Actions, Clips, Videos, Creators, Watched channels, Add-ons (installed).
- Rows: icon, label with fuzzy-matched letters in gold, group, shortcut `Kbd`.
- Keys: ↑/↓, Enter, Ctrl+Enter (run and keep the palette open), Tab (switch preview).
- Preview pane (≥1100): the clip poster or creator stats.
- Pasting a URL puts "Generate clips from this link" on top (→ `api.createJob`), plus "Open with options…" (→ `openCreate({link})`).
- Text ending in `?` shows "Ask Solaris Studio" → `openAssistant(query)`.
- The list is virtualised when there are more than 200 rows (simple windowing).
- Recent items persist in `solaris.ui.palette.recent`.

`lib/commands.ts`:

```ts
export interface Command { id: string; label: string; group: 'Go to' | 'Actions' | 'Settings'; icon: IconName; keywords?: string[];
  shortcut?: string[]; when?: () => boolean; run: () => void | Promise<void> }
export function registerCommands(cmds: Command[]): () => void
export function useCommands(cmds: Command[], deps: unknown[]): void   // page-scoped registration while active
export function allCommands(): Command[]
```

Built-in actions (each with a toast on success or error):

| Action | Calls |
|---|---|
| New clips… | `openCreate()` |
| Pause queue / Resume queue | `api.pauseQueue()` / `api.resumeQueue()` |
| Clear completed / Clear failed | `useConfirm` → `api.clearQueue('completed'|'failed')` |
| Check all watched channels now | `api.watches()` → `api.checkWatch(id)` each |
| Turn auto-clipping on/off | `api.setAutomation({ enabled })` |
| Switch local model → (sub-list) | `api.models()` → `api.activateModel(tag)` |
| Switch AI provider → | `api.ai()` → `api.activateAI(...)` |
| Clean up storage | `api.storageCleanup()` |
| Refresh Marketplace | `plugins` refresh call in lib/plugins.ts (POST /marketplace/refresh) |
| Check stuck social posts | POST /woopsocial/refresh wrapper |
| Ask Solaris Studio… | `openAssistant()` |
| Report a problem | dispatch `open-feedback` |
| Re-run setup | dispatch `open-setup-wizard` |
| Show keyboard shortcuts | `openLayer('shortcuts')` |
| Toggle rail / Reduce motion / Reduce effects | uiPrefs |
| What's new | `openLayer('whatsnew')` |
| Take the tour | `openLayer('tour')` |

`lib/searchIndex.ts` (B2; value imports are allowed because no test runs it):
- Lazy build on first palette open. Sources: `api.videos()`, then `api.clips(id)` for the newest 150 videos at concurrency 6, plus `api.creators()`, `api.watches()` and `plugins.list()`.
- Cached in the module.
- Incremental rebuild of a single video on a `job` event with `status==='done' && job_type==='process'`, and on library invalidation (`invalidateLibrary` emits an event).
- Results route to studio (videoId, clipId), creators (creatorId), watch, and marketplace (tab installed).
- `lib/fuzzy.ts`: `score(query, text): { score: number; hits: number[] } | null`, a subsequence match with word-start and consecutive bonuses.

### 4.17 Help, shortcuts, What's new, tour (B2)
- **HelpDrawer**: page-aware content from `lib/help.ts`: `Record<Page, { purpose: string; howTo: { q: string; steps: string[] }[]; tryPrompts: string[] }>` plus a glossary of Pipeline, Vertical Live, Minimum score, Rate & understand, Branding, Auto-clipping and Add-on.
  - Links: "Report a problem" (`open-feedback`), "Re-run setup", "Take the tour".
  - Shell copy only. Never write the word "plugin".
- **Term** primitive (B1, components/ui/Term.tsx): a dotted underline plus a Popover definition taken from `lib/help.ts` GLOSSARY. Used only in files that builders own and that are not pinned.
- **ShortcutSheet**: renders `SHORTCUTS` from `lib/hotkeys.ts`.
- **WhatsNew**: shown once (`solaris.ui.whatsnew.v2`) on the first launch after the redesign, but not before the SetupWizard finishes. 5 cards:
  - setup now lands on Home;
  - New clips is a sheet (Ctrl+N) and also a Create page;
  - the processed videos list moved to the Clip Editor;
  - the Queue has one Pause/Start toggle;
  - Ctrl+K reaches everything.
- **Tour**: 3 stops (CreateOrb `data-tour="create"`, TopBar search `data-tour="palette"`, JobsPill or Bell `data-tour="activity"`). Each stop is a `Popover` positioned with getBoundingClientRect (no anchor positioning required), with a pulsing gold ring. Offered from the WhatsNew last card and from the palette. The dismissal persists.

### 4.18 SetupWizard: `components/SetupWizard.tsx` (B3, restyle)
- Logic unchanged; restyle only:
  - letterbox bars slide in;
  - the logo rises with an orbit ring that becomes the model-download ProgressRing;
  - step dots use a gold fill line;
  - the finish screen gets `celebrate()` and three cards: "Make your first clips" (opens create), "Watch a channel" (goes to watch) and "Take the tour".
- `onClose` → App navigates to `home` (B1).

### 4.19 Shell widgets restyled by B1
UpdateBanner (className only), FeedbackHub (trigger restyle plus the `open-feedback` listener; the modal adopts the Dialog look by class), ModelSwitcher (compact mode), ProcessingBar (B4 owns it; restyle with a striped bar and a glow head).

---

## 5. New features and the endpoints they use

`api.*` names are from `lib/api.ts`. **B1 adds missing wrappers** as additive methods: `woopSocialInFlight()` → GET `/woopsocial/in-flight`. Verify any wrapper for POST `/woopsocial/refresh` (`woopSocialRefresh` or `refreshWoopSocial`) and `/marketplace/refresh` (lib/plugins.ts) before adding a duplicate. **Integrations / "Waiting for VOD" is CUT** (there is no list endpoint).

| # | Feature | Owner | Endpoints |
|---|---|---|---|
| 1 | Icon rail with badges (queue count, failed dot, live dot, LIVE tag, model ring, unexported count) | B1 | GET /queue, GET /automation (30s), WS queue/job/automation/model_pull, GET /videos |
| 2 | TopBar: history, breadcrumbs, jobs pill + spotlight popover | B1 | WS progress/job, GET /queue, POST /cancel |
| 3 | TransportDock global playhead | B1 | GET /queue, WS progress |
| 4 | Keep-alive pages, hash deep links, back/forward | B1 | — |
| 5 | Health dot | B1 | GET /health/preflight |
| 6 | Toasts, ConfirmDialog (replaces window.confirm/alert in owned files) | B1 | — |
| 7 | "Your clips are ready" toast + celebrate | B1 | WS job, GET /videos/{id}/clips, /clips/{id}/frame |
| 8 | Global model download tray | B1 | WS model_pull |
| 9 | Auto "Reduce effects" under GPU load | B1 | GET /system/stats (only while processing, 8s) |
| 10 | Command palette + actions | B2 | POST /jobs, /queue/pause, /queue/resume, /queue/clear, POST /automation/watches/{id}/check, PATCH /automation, GET /models, POST /models/activate, GET /ai, POST /ai/activate, POST /storage/cleanup, POST /marketplace/refresh, POST /woopsocial/refresh |
| 11 | Global search index | B2 | GET /videos, GET /videos/{id}/clips, GET /creators, GET /automation/watches, plugins list |
| 12 | Create sheet (global AddVideos) | B2 | (AddVideos' own: POST /jobs, /jobs/batch, /videos/local, …) |
| 13 | Activity center with retry + log viewer | B2 (+B1 store) | WS all, GET /queue, GET /automation/activity, GET /youtube/status + /youtube/uploads, POST /jobs/{id}/retry, GET /jobs/{id}/log |
| 14 | Global assistant drawer with step trace + page prompts | B2 | GET /agent/status, POST /agent/chat, POST /publish/plan/execute |
| 15 | Help drawer, glossary, shortcut sheet, What's new, tour | B2 | — |
| 16 | Home quick-paste with clipboard + platform detection + presets | B3 | POST /jobs, POST /videos/local, GET /videos/local/shape |
| 17 | Now-processing spotlight | B3 | WS progress/job, GET /queue, POST /cancel, POST /queue/pause|resume |
| 18 | Fresh clips gallery with hover scrub/preview + quick actions | B3 (HoverPreview B4) | GET /videos, GET /videos/{id}/clips, /clips/{id}/frame, /media/{id}, /media/preview/{id}, PATCH /clips/{id}, POST /clips/{id}/tighten |
| 19 | KPI tiles with sparklines + count-up | B3 | GET /videos, GET /creators, GET /queue |
| 20 | First clips quest | B3 | GET /videos, GET /videos/{id}/clips (exported_at), WS publish, GET /automation/watches |
| 21 | Premiere "Best this week" tile | B3 | /media/preview/{id} |
| 22 | Up-next-to-publish, Watch mini, Engine rings | B3 | GET /woopsocial/status + /schedule, GET /automation/activity, GET /system/stats |
| 23 | Clip Editor video rail (absorbs processed-videos table) + delete video | B4 | GET /videos, DELETE /videos/{id} |
| 24 | Multi-select + BulkBar | B4 | POST /export/batch, PATCH /clips/{id}, DELETE /clips/{id} |
| 25 | Card→editor morph, Edit Bay, inline title edit, timecode, safe areas | B4 | PATCH /clips/{id} |
| 26 | Queue drag-to-reorder, hold-to-clear, failure triage | B5 | POST /jobs/{id}/move, POST /queue/clear, POST /jobs/{id}/retry, GET /jobs/{id}/log |
| 27 | Watch radar: countdown, check all, per-channel stats, stepped add sheet | B5 | GET /automation/activity, GET /automation/watches, POST /automation/watches/{id}/check, GET /automation/items?watch_id, POST /automation/watches, PATCH /automation |
| 28 | Creator leaderboard, avatars, "See their clips", tabs, danger zone | B5 | GET /creators, GET /creators/{id}, merge/learning/branding/knowledge/delete routes |
| 29 | Publishing calendar | B6 | GET /woopsocial/status, /woopsocial/schedule, /woopsocial/in-flight, POST /woopsocial/refresh, GET /youtube/status, /youtube/uploads, GET /automation/slots, clips scheduled_for |
| 30 | Storage & health page | B6 | GET /health, /health/preflight, GET /storage, GET /storage/videos, POST /storage/cleanup, DELETE /videos/{id} |
| 31 | Settings sections, filter, deep links, connection chips, motion/effects prefs | B6 | GET /youtube/status, /woopsocial/status, /uploadpost/status (+ existing card calls) |
| 32 | Models: where-AI-runs card, hardware arcs, one-click recommended download | B6 | GET /ai, GET /models, POST /models/pull, POST /models/activate, DELETE /models/{tag}, GET /system/stats |
| 33 | Marketplace featured row + storefront skin | B6 | GET /marketplace/catalog (existing plugins lib) |

Performance rules:
- Clip fan-out uses at most 6 concurrent requests, the newest 150 videos for search, and the newest 12 videos for Recent clips/Premiere.
- `/system/stats` is polled at most every 8s and only while a consumer is active. Use the shared `statsStore`.
- Provider-gated routes need their `/status` checked first.

---

## 6. Work partition (6 builders, strict file ownership)

### 6.1 Phases
- **Phase 0 (B1 alone, first; target: small and fast).** Tokens and motion CSS. `components/ui/*` (all primitives, at least as working minimal implementations matching the props in 6.4). `icons.tsx` additions. `lib/nav.ts`, `lib/motion.ts`, `lib/uiPrefs.ts`, `lib/hotkeys.ts`, `lib/stores/*`. The empty `styles/b*-*.css` files with their imports. Stub layer files plus `layers.ts`. Page signature props (`active` etc., all optional). `App.tsx` and Shell, with the existing pages mounted. `npm run typecheck` must be clean. Commit-ready.
- **Phase 1 (B2–B6 in parallel, B1 continues on shell polish).** Each builder touches only their own files. Need a primitive change? Ask B1. Do not edit `components/ui/*` yourself. Need something missing? Build it locally in your own folder.

### 6.2 Ownership table

| Builder | Owns (exclusive write) |
|---|---|
| **B1 Foundation & Shell** | `theme.css`, `styles/motion.css`, `styles/shell.css`, `components/ui/**`, `components/icons.tsx`, `components/shell/{Shell,Rail,TopBar,Breadcrumbs,JobsPill,TransportDock,KeepAlive,GoldGradientDefs,layers}.tsx/.ts`, `App.tsx`, `main.tsx` (only if needed), `lib/nav.ts`, `lib/motion.ts`, `lib/uiPrefs.ts`, `lib/hotkeys.ts`, `lib/stores/**`, `lib/api.ts` (additive only), `components/UpdateBanner.tsx` (className only), `components/FeedbackHub.tsx`, `components/ModelSwitcher.tsx`, `components/AppBoundary.tsx`, `components/queue/AddVideos.tsx` (only the `initialLink` addition), the phase-0 signature-line edits in every page, the stub files for B2's layers (B2 then overwrites them) |
| **B2 Global layers** | `components/shell/{CommandPalette,CreateSheet,ActivityDrawer,AssistantDrawer,HelpDrawer,ShortcutSheet,WhatsNew,Tour}.tsx`, `lib/commands.ts`, `lib/searchIndex.ts`, `lib/fuzzy.ts`, `lib/help.ts`, `components/Assistant.tsx` (className only), `styles/b2-layers.css` |
| **B3 Home & Create** | `pages/Home.tsx`, `pages/Dashboard.tsx`, `components/home/**` (QuickPaste, PresetChips, NowProcessing, RecentClips, KpiTiles, FirstClipsQuest, PremiereTile, UpNext, WatchMini, EngineTile, ActivityLog), `components/SetupWizard.tsx`, `components/SystemStats.tsx`, `styles/b3-home.css` |
| **B4 Clip Editor** | `pages/ClipStudio.tsx`, `components/EditorModal.tsx`, `components/library/**` (VideoRail, BulkBar, HoverPreview, ClipGrid), `components/ClipCard.tsx` (restricted), `components/ClipEditor.tsx` (restricted), `components/ProcessingBar.tsx`, `components/PublishAllDialog.tsx`, `components/ScheduleView.tsx`, `components/YouTubeBatchDialog.tsx`, `components/ScoreBadge.tsx`, `components/LiveTextOverlay.tsx`, `components/ClipDirectionNote.tsx`, `components/SportsNote.tsx`, `styles/b4-editor.css` (incl. all `.edit-bay` TimelineEditor styling). Read-only: TimelineEditor, EditSuggestions, YouTubePanel, UploadPostPanel, MultilingualExport and the other editor panels |
| **B5 Ops (Queue, Watch, Creators)** | `pages/Queue.tsx`, `pages/Watch.tsx`, `pages/Creators.tsx`, `components/queue/QueueItem.tsx`, `components/queue/QueueRow.tsx` (new wrapper with drag), `components/watch/**` except the pinned lines in WatchCard (WatchCard className only), new `components/watch/{RadarHero,AddChannelSheet,ChannelTile,EventsTimeline}.tsx`, `components/creators/**` (new: CreatorList, Leaderboard, CreatorDetail, DangerZone), `components/OpenRouterPrompt.tsx`, `components/SportFields.tsx` (className only), `components/ExplainedSelect.tsx`, `styles/b5-ops.css` |
| **B6 System & new pages** | `pages/Settings.tsx`, `pages/Models.tsx`, `pages/Marketplace.tsx` (restricted), `pages/MarketplaceDevelopers.tsx` (className only), `pages/Calendar.tsx`, `pages/Storage.tsx`, `components/marketplace/**` (new), `components/settings/**` (new: SettingsNav, ConnectionChips, MotionEffectsCard, SettingsSection), `lib/calendarData.ts`, `components/AICard.tsx`, `components/YouTubeCard.tsx`, `components/WoopSocialCard.tsx`, `components/UploadPostCard.tsx`, `components/RemoteRenderCard.tsx`, `components/TechnicalDetails.tsx` (className only), `styles/b6-system.css` |

**Nobody edits:** TimelineEditor, StepFields, QueueItemSettings, PipelineFields, PluginStepsNote, NoClipsExplanation, EditSuggestions, YouTubePanel, the lib Node-run files, `lib/plugins.ts`, `lib/i18n.ts`, `lib/appearance.ts`, locales, preload, main.
**Unowned files** (CaptionStyleControls, ColorControls, GamingLayoutEditor, WatermarkControls and the rest) **are not edited**. They inherit the restyled theme classes.

### 6.3 Shared data hooks (B1, `lib/stores/*`). Exact signatures

```ts
// queueStore.ts
export function useQueueSnapshot(): { snapshot: QueueSnapshot | null; remaining: number; failed: number; processing: number; queued: number; refresh: () => void }
// activeJob.ts
export interface ActiveJob { running: boolean; videoId?: string; title?: string; stage?: string; stageLabel?: string; fraction: number;
  clip?: { current: number; total: number }; remote?: string; plugin?: string; etaSeconds: number | null; paused: boolean; queuedAfter: number }
export function useActiveJob(): ActiveJob          // progressStore/applyEvent + queue estimate; 1s ETA tick only while running
// library.ts
export function useLibrary(): { videos: Video[] | null; unexported: number; loadClipsFor: (ids: string[]) => Promise<Record<string, Clip[]>>; refresh: () => void }
export function useRecentClips(n: number): { clips: (Clip & { video_id: string; video_title: string })[] | null }
export function invalidateLibrary(videoId?: string): void   // also emits window event 'library-changed'
// statsStore.ts
export function useSystemStats(active: boolean): SystemStats | null   // shared poll, 8s, only while ≥1 active consumer and !document.hidden
// useVisible.ts
export function useVisible(active: boolean): boolean                 // active && !document.hidden
export function usePageActive(): boolean
```

`Video`, `Clip`, `QueueSnapshot` and `SystemStats` are the types in `lib/types.ts` (use the names that exist there). The library store refreshes on `job` done events and on `invalidateLibrary`.

### 6.4 Shared primitives (`components/ui/*`, B1). Exact props
Import from the barrel: `import { Button, Dialog, … } from '../components/ui'` (`components/ui/index.ts`). Every primitive accepts `className?: string` (merged).

```ts
// Button.tsx
type ButtonVariant = 'accent' | 'gold' | 'ghost' | 'subtle' | 'danger'
export function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg';
  icon?: IconName; iconRight?: IconName; loading?: boolean }): JSX.Element                 // maps to .btn-* classes
export function IconButton(p: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName; size?: 'sm' | 'md';
  active?: boolean; badge?: number | 'dot' | null; tone?: 'default' | 'error' }): JSX.Element   // aria-label=label + Tooltip
export function HoldButton(p: { label: string; onConfirm: () => void; holdMs?: number; variant?: ButtonVariant; size?: 'sm' | 'md'; disabled?: boolean }): JSX.Element
// Card.tsx
export function Card(p: React.HTMLAttributes<HTMLDivElement> & { variant?: 'plain' | 'interactive' | 'glass' | 'hero' | 'glow' | 'sunken';
  as?: 'div' | 'section' | 'article' | 'button'; padded?: boolean }): JSX.Element
// PageHeader.tsx
export function PageHeader(p: { eyebrow?: string; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: IconName; vtName?: string }): JSX.Element
export function SectionHeader(p: { title: string; hint?: React.ReactNode; count?: number; actions?: React.ReactNode; id?: string }): JSX.Element
// Dialog.tsx  (native <dialog>, showModal, Esc via 'cancel' event, focus return to opener, aria-labelledby/-describedby)
export function Dialog(p: { open: boolean; onClose: () => void; title: string; description?: string; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  footer?: React.ReactNode; dismissible?: boolean; hideTitle?: boolean; children: React.ReactNode; initialFocus?: string /* css selector */ }): JSX.Element
// Sheet.tsx (native <dialog> class ui-sheet)
export function Sheet(p: { open: boolean; onClose: () => void; title: string; side?: 'right' | 'bottom'; width?: string;
  originRect?: DOMRect | null; header?: React.ReactNode; footer?: React.ReactNode; modal?: boolean /* false = docked, non-modal */; children: React.ReactNode }): JSX.Element
// Confirm.tsx
export function ConfirmProvider(p: { children: React.ReactNode }): JSX.Element
export function useConfirm(): (o: { title: string; body?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }) => Promise<boolean>
// Toast.tsx
export interface ToastOpts { title: string; body?: React.ReactNode; tone?: 'info' | 'success' | 'warn' | 'error'; icon?: IconName;
  thumbs?: string[]; action?: { label: string; run: () => void }; secondary?: { label: string; run: () => void }; duration?: number /* ms, 0 = sticky */; id?: string }
export function ToastProvider(p: { children: React.ReactNode }): JSX.Element
export function Toaster(): JSX.Element     // bottom-right stack, role="status" aria-live="polite" (error: role="alert"); pause on hover
export const toast: ((o: ToastOpts) => string) & { dismiss: (id: string) => void; progress: (id: string, o: ToastOpts & { value: number | null }) => void }
// Toggle.tsx
export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: React.ReactNode; disabled?: boolean;
  size?: 'sm' | 'md' | 'lg'; hideLabel?: boolean }): JSX.Element      // <button role="switch" aria-checked>
// Tabs.tsx
export interface TabItem { id: string; label: string; icon?: IconName; badge?: number | string }
export function Tabs(p: { items: TabItem[]; value: string; onChange: (id: string) => void; ariaLabel: string; variant?: 'underline' | 'pill' }): JSX.Element
export function Segmented(p: { items: TabItem[]; value: string; onChange: (id: string) => void; ariaLabel: string; size?: 'sm' | 'md' }): JSX.Element
// Badge.tsx
export type Tone = 'accent' | 'gold' | 'muted' | 'success' | 'warn' | 'error' | 'live'
export function Badge(p: { tone?: Tone; icon?: IconName; size?: 'xs' | 'sm'; children: React.ReactNode; title?: string }): JSX.Element
export function StatusChip(p: { status: 'running' | 'queued' | 'done' | 'failed' | 'paused' | 'stopping' | 'live' | 'idle' | 'scheduled' | 'posted'; label?: string }): JSX.Element
// Progress.tsx
export function ProgressBar(p: { value?: number | null /* 0..1; null/undefined = indeterminate */; label: string; tone?: 'accent' | 'gold' | 'success' | 'error';
  striped?: boolean; size?: 'xs' | 'sm' | 'md'; showValue?: boolean }): JSX.Element     // role="progressbar" aria-valuenow
export function ProgressRing(p: { value?: number | null; size?: number; stroke?: number; label: string; tone?: 'gold' | 'accent' | 'success' | 'error';
  vtName?: string; children?: React.ReactNode }): JSX.Element                           // uses .ring with --p
export function StepProgress(p: { steps: string[]; current: number }): JSX.Element
// Skeleton.tsx
export function Skeleton(p: { w?: number | string; h?: number | string; radius?: number | string; lines?: number; className?: string }): JSX.Element
// EmptyState.tsx
export function EmptyState(p: { illustration?: 'film' | 'radar' | 'calendar' | 'queue' | 'creators' | 'search' | 'sun' | 'storage';
  title: string; body?: React.ReactNode; action?: React.ReactNode; compact?: boolean }): JSX.Element   // inline-SVG line art, check-draw on enter
// Callout.tsx
export function Callout(p: { tone?: 'info' | 'gold' | 'warn' | 'error' | 'success'; title?: string; icon?: IconName; onDismiss?: () => void; children: React.ReactNode }): JSX.Element
// Disclosure.tsx (uses .collapse grid-rows animation; button aria-expanded/aria-controls)
export function Disclosure(p: { summary: React.ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void; id?: string; children: React.ReactNode }): JSX.Element
// Tooltip.tsx (popover="manual", positioned via getBoundingClientRect; aria-describedby; 300ms delay; Esc hides)
export function Tooltip(p: { content: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; children: React.ReactElement }): JSX.Element
// Popover.tsx
export function Popover(p: { trigger: (props: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean }) => React.ReactNode;
  align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; width?: number; children: React.ReactNode | ((close: () => void) => React.ReactNode) }): JSX.Element
export function MenuButton(p: { label: string; icon?: IconName; items: { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean }[] }): JSX.Element
// misc
export function Kbd(p: { keys: string[] }): JSX.Element
export function Avatar(p: { seed: string | number; name: string; size?: number; src?: string | null }): JSX.Element   // monogram on hash gradient (burgundy↔gold)
export function Sparkline(p: { values: number[]; width?: number; height?: number; tone?: 'gold' | 'accent'; label: string }): JSX.Element  // inline SVG bars
export function Meter(p: { value: number /* 0..1 */; label: string; tone?: Tone }): JSX.Element
export function CountUp(p: { value: number; format?: (n: number) => string; className?: string }): JSX.Element
  // integers without format → CSS @property --n counter; otherwise countUp(); aria-label carries the final value
export function Field(p: { label: string; hint?: React.ReactNode; error?: string; htmlFor?: string; children: React.ReactNode }): JSX.Element  // sets aria-invalid/aria-describedby
export function SearchInput(p: { value: string; onChange: (v: string) => void; placeholder: string; hotkey?: boolean /* registers '/' while page active */; ariaLabel?: string }): JSX.Element
export function Term(p: { term: string; children?: React.ReactNode }): JSX.Element     // glossary popover from lib/help.ts GLOSSARY
```

Note: `Term` imports `GLOSSARY` from `lib/help.ts` (B2). In phase 0, B1 creates `lib/help.ts` with `export const GLOSSARY: Record<string, string> = {}` and `export const HELP = {} as Record<string, never>`. B2 then takes over the file and fills it in, keeping both export names. `HELP` is typed as in 4.17.

### 6.5 Coordination rules
- Each builder writes CSS only in their own `styles/b*-*.css`. All classes are prefixed with your area (`.home-`, `.lib-`, `.ops-`, `.sys-`, `.lyr-`), except the shared ones B1 defines.
- New `t()` strings: free, but obey the banned-word rules.
- Cross-area navigation always goes through `navigate`, `openCreate`, `openSettings` or `openAssistant`. Never import another builder's page.
- When a builder needs another builder's component (e.g. B3 needs `HoverPreview`), code against the exact API given here. If it hasn't landed, use a local fallback guarded by a TODO, then switch.

---

## 7. Acceptance checklist

Run from the repo root (Git Bash):

```bash
cd ui && npm run typecheck                    # tsc clean, zero errors, no @ts-expect-error left from phase 0
cd ui && npm run build                        # electron-vite build passes
cd .. && PYTHONUTF8=1 python -m pytest tests/test_ui_edit_suggestions.py tests/test_ui_steps.py tests/test_ui_marketplace.py \
  tests/test_ui_store_update.py tests/test_ui_gaming_layout_sync.py tests/test_ui_layer_snapping.py tests/test_ui_speaker_turns_sync.py \
  tests/test_plugin_sdk_edit.py tests/test_job_progress.py tests/test_plugin_docs.py tests/test_site_developers.py -q
git diff --stat -- ui/src/renderer/src/locales ui/src/preload ui/src/main ui/src/renderer/index.html   # must be empty
git diff -- ui/package.json ui/package-lock.json                                                         # must be empty (no new deps)
```

Functional checks (manual, in `npm run dev` or `npm run dev:web`):
- [ ] Every page is reachable from the rail, from the palette (Go to) and by G-chords. "Clip Editor" is labelled exactly so.
- [ ] Every existing feature is reachable:
  - generate bar (Create page and Create sheet);
  - queue controls, clears, retry, move;
  - watch add, edit and master switch, tray option;
  - clip grid, inspector, full editor with all TimelineEditor tabs, Export all, Publish all, Schedule;
  - creators merge, branding, knowledge, wipe and delete;
  - Marketplace browse, installed, developers, install dialog;
  - model use, remove and download;
  - every Settings card;
  - FeedbackHub, ModelSwitcher, UpdateBanner, SetupWizard (re-open from Settings), Assistant (drawer).
- [ ] The window events `open-queue`, `open-settings` (with and without `detail.section`), `open-models`, `open-marketplace` (+ tab), `open-setup-wizard` and `app-language-changed` all work. Changing the language keeps the current page.
- [ ] openInStudio from Home, Create, Queue, Watch, the palette and the activity drawer opens the right video and clip, **also when the Clip Editor is already mounted**. openCreator from Watch selects the creator.
- [ ] Back and Forward (buttons, Alt+arrows, mouse buttons) work. A reload restores the route from the hash.
- [ ] Keep-alive: search and selection in the Clip Editor survive a page switch. Hidden pages stop polling (check the network panel).
- [ ] View transitions play between pages; there are no aborted-transition console errors from duplicate names. The card-to-editor morph works.
- [ ] `prefers-reduced-motion: reduce` (DevTools emulation) and Settings "Reduce motion: On" turn off view transitions, stagger, reveal, celebrate, flyTo, count-up animation, tilt and hover autoplay. Content stays fully visible.
- [ ] "Visual effects: Reduced" removes blur, grain and the orbit animation.
- [ ] 1024×640: no horizontal page scroll (except inside the AddVideos container), the rail is collapsed, and dialogs fit.
- [ ] Keyboard: Ctrl+K, Ctrl+N, Ctrl+J, Ctrl+B, `?`, `/`, F1, and Esc closes only the topmost layer. Focus is visible (gold) everywhere, including in the palette and drawers. The palette follows the combobox ARIA pattern. Toggles use `role="switch"`.
- [ ] No `window.confirm`/`window.alert` remain in files owned by B1, B3, B4, B5 or B6 (`grep -rn "window.confirm\|window.alert\|[^.]confirm(" ui/src/renderer/src/pages`).
- [ ] No new `window.studio` members are used. Optional members are guarded with `?.`. The browser shim (`npm run dev:web`) loads without errors.
- [ ] Every string pinned by the tests (section 4.0) is still present, byte for byte. The tests prove it.
- [ ] No user-facing copy uses "plugin" in new shell strings. No `t('Made by')`.
