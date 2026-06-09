import i18n from '../i18n'

export function formatWorkspacePickerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("No handler registered for 'workspace:pick-directory'")) {
    return i18n.t('common:workspacePickerNeedsRestart')
  }
  if (message.includes('workspace:pick-directory')) {
    return i18n.t('common:workspacePickerUnavailable')
  }
  return message
}
