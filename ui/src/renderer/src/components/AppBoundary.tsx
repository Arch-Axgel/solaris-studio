import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Last line of defence for the whole window.
 *
 *  React unmounts the entire tree on an unhandled render error, so without
 *  this the app becomes a blank white window with nothing to click and
 *  nothing to read — the worst possible failure, because it looks identical
 *  to a hang and tells the user nothing.
 *
 *  A real cause of exactly that: the preload script is only rebuilt when the
 *  window is recreated, while the renderer hot-reloads on every save. Editing
 *  both leaves new UI calling a `window.studio` method the running preload
 *  does not have yet.
 *
 *  Nothing here can be lost by crashing: videos, clips and edits all live in
 *  the database and on disk, not in this process.
 */
export default class AppBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Solaris Studio crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    const message = String(this.state.error?.message ?? this.state.error)
    // A stale preload is common enough in development to name directly,
    // rather than leaving someone to decode "undefined is not an object".
    const stalePreload = /window\.studio|Cannot read (properties|property)/i.test(message)

    return (
      <div className="app-crash h-screen grid place-items-center p-8 text-ink">
        <div className="app-crash-card max-w-lg w-full space-y-4">
          <div className="flex items-start gap-4">
            <span className="app-crash-mark" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4.5M12 17h.01" />
              </svg>
            </span>
            <div>
              <p className="t-micro">Solaris Studio</p>
              <h1 className="t-xl text-ink">Solaris Studio hit a problem</h1>
              <div className="gold-rule mt-3" />
            </div>
          </div>
          <p className="text-sm text-muted leading-relaxed">
            The window failed to draw. Your videos, clips and edits are safe — they live on
            disk and in the database, not in this window.
          </p>
          {stalePreload && (
            <p className="text-sm text-muted leading-relaxed">
              This usually means the app was updated while running. Fully closing and
              reopening it should fix it.
            </p>
          )}
          <pre className="t-mono text-muted/80 bg-abyss border border-line/60 rounded-xl p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {message}
          </pre>
          <div className="flex gap-2 pt-1">
            <button className="btn-accent" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="btn-ghost" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
          <p className="text-xs text-muted">
            If it keeps happening, the Feedback button in the app sends this with the
            diagnostics attached.
          </p>
        </div>
      </div>
    )
  }
}
