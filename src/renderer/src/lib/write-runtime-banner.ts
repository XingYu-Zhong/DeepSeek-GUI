export type RuntimeConnectionLike = 'idle' | 'checking' | 'ready' | 'offline'

export function resolveWriteRuntimeBannerMessage({
  runtimeConnection,
  error,
  runtimeActionNeedsConnection
}: {
  runtimeConnection: RuntimeConnectionLike
  error?: string | null
  runtimeActionNeedsConnection: string
}): string | null {
  if (runtimeConnection === 'ready') return null

  const trimmedError = error?.trim() ?? ''
  if (!trimmedError) return null

  // In Write, offline is an expected state for file-only editing. Keep the
  // heavy diagnostic banner for actionable runtime failures, not routine
  // disabled-AI hints emitted by sidebar/workspace actions.
  if (trimmedError === runtimeActionNeedsConnection.trim()) return null

  return trimmedError
}
