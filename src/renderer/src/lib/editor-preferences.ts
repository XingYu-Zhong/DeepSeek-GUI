import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

export const PREFERRED_EDITOR_STORAGE_KEY = 'deepseekgui.editor.preferredId'

export function readPreferredEditorId(): string | undefined {
  const value = readBrowserStorageItem(PREFERRED_EDITOR_STORAGE_KEY)?.trim()
  return value || undefined
}

export function writePreferredEditorId(editorId: string): void {
  writeBrowserStorageItem(PREFERRED_EDITOR_STORAGE_KEY, editorId)
}
