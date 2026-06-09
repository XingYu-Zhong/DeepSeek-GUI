import { lazy, Suspense } from 'react'

const AppShell = lazy(() => import('./AppShell'))

function StartupShell(): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-ds-main text-ds-muted">
      <div className="flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card px-4 py-2 text-[13px] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        <span>Loading DeepSeek GUI...</span>
      </div>
    </div>
  )
}

export default function App(): React.ReactElement {
  return (
    <Suspense fallback={<StartupShell />}>
      <AppShell />
    </Suspense>
  )
}
