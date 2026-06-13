import {
  DEFAULT_KUN_MODEL,
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  normalizeWriteInlineCompletionModel,
  normalizeWriteSelectionAssistSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
  type WriteInlineCompletionSettingsV1,
  type WriteSelectionAssistSettingsV1,
  type WriteSettingsV1
} from '@shared/app-settings'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { isWriteWorkspaceEntry } from '@shared/write-text-file'
import i18n from '../i18n'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import type { WritePreviewMode, WriteWorkspaceState } from './write-workspace-store-types'

export const WRITE_PREVIEW_MODE_KEY = 'kun.write.preview-mode'
export const WRITE_ASSISTANT_OPEN_KEY = 'kun.write.assistant-open'
export const WRITE_ASSISTANT_MODEL_KEY = 'kun.write.assistant-model'
export const WRITE_ASSISTANT_PROVIDER_KEY = 'kun.write.assistant-provider'
const DEFAULT_WRITE_ASSISTANT_MODEL = DEFAULT_KUN_MODEL

export function readStoredPreviewMode(): WritePreviewMode {
  const raw = readBrowserStorageItem(WRITE_PREVIEW_MODE_KEY)
  return raw === 'rich' || raw === 'source' || raw === 'live' || raw === 'split' || raw === 'preview'
    ? raw
    : 'rich'
}

export function readStoredAssistantOpen(): boolean {
  return readBrowserStorageItem(WRITE_ASSISTANT_OPEN_KEY) !== '0'
}

export function readStoredAssistantModel(): string {
  const stored = readBrowserStorageItem(WRITE_ASSISTANT_MODEL_KEY)
  const normalized = normalizeWriteAssistantModel(stored)
  if (stored !== null && stored.trim() !== normalized) {
    writeBrowserStorageItem(WRITE_ASSISTANT_MODEL_KEY, normalized)
  }
  return normalized
}

export function readStoredAssistantProviderId(): string {
  return readBrowserStorageItem(WRITE_ASSISTANT_PROVIDER_KEY)?.trim() ?? ''
}

export function normalizeWriteAssistantModel(model: string | null | undefined): string {
  const normalized = model?.trim() ?? ''
  return !normalized || normalized.toLowerCase() === 'auto'
    ? DEFAULT_WRITE_ASSISTANT_MODEL
    : normalized
}

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}

export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a.charCodeAt(index) === b.charCodeAt(index)) index += 1
  return index
}


export function compactWorkspaceRoots(values: string[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const value of values) {
    const normalized = normalizePath(value.trim())
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    roots.push(normalized)
  }
  return roots
}

export function normalizeWriteSettings(settings?: Partial<WriteSettingsV1> | null): {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  selectionAssist: WriteSelectionAssistSettingsV1
} {
  const defaultWorkspaceRoot = normalizePath(settings?.defaultWorkspaceRoot || DEFAULT_WRITE_WORKSPACE_ROOT)
  const activeWorkspaceRoot = normalizePath(settings?.activeWorkspaceRoot || defaultWorkspaceRoot)
  const workspaces = compactWorkspaceRoots([
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    ...(Array.isArray(settings?.workspaces) ? settings.workspaces : [])
  ])
  const rawInlineCompletion = (settings?.inlineCompletion ?? {}) as Partial<WriteInlineCompletionSettingsV1>
  const debounceMs = Number(rawInlineCompletion.debounceMs)
  const longDebounceMs = Number(rawInlineCompletion.longDebounceMs)
  const minAcceptScore = Number(rawInlineCompletion.minAcceptScore)
  const longMinAcceptScore = Number(rawInlineCompletion.longMinAcceptScore)
  const maxTokens = Number(rawInlineCompletion.maxTokens)
  const longMaxTokens = Number(rawInlineCompletion.longMaxTokens)
  const model = normalizeWriteInlineCompletionModel(rawInlineCompletion.model)
  const rawModel = typeof rawInlineCompletion.model === 'string' ? rawInlineCompletion.model.trim() : ''
  return {
    defaultWorkspaceRoot,
    activeWorkspaceRoot: workspaces.includes(activeWorkspaceRoot) ? activeWorkspaceRoot : defaultWorkspaceRoot,
    workspaces: workspaces.length > 0 ? workspaces : [defaultWorkspaceRoot],
    inlineCompletion: {
      enabled: rawInlineCompletion.enabled !== false,
      retrievalEnabled: rawInlineCompletion.retrievalEnabled !== false,
      longCompletionEnabled: rawInlineCompletion.longCompletionEnabled !== false,
      inheritProvider: typeof rawInlineCompletion.inheritProvider === 'boolean'
        ? rawInlineCompletion.inheritProvider
        : !rawInlineCompletion.providerId?.trim(),
      providerId: rawInlineCompletion.providerId?.trim() || '',
      apiKey: rawInlineCompletion.apiKey?.trim() || '',
      baseUrl: rawInlineCompletion.baseUrl?.trim() || '',
      inheritModel: typeof rawInlineCompletion.inheritModel === 'boolean'
        ? rawInlineCompletion.inheritModel
        : !rawModel || rawModel === DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
      model,
      debounceMs: Number.isFinite(debounceMs)
        ? Math.max(150, Math.min(5_000, Math.round(debounceMs)))
        : DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
      longDebounceMs: Number.isFinite(longDebounceMs)
        ? Math.max(1_000, Math.min(15_000, Math.round(longDebounceMs)))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      minAcceptScore: Number.isFinite(minAcceptScore)
        ? Math.max(0.1, Math.min(0.95, minAcceptScore))
        : DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
      longMinAcceptScore: Number.isFinite(longMinAcceptScore)
        ? Math.max(0.1, Math.min(0.95, longMinAcceptScore))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
      maxTokens: Number.isFinite(maxTokens)
        ? Math.max(16, Math.min(512, Math.round(maxTokens)))
        : DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
      longMaxTokens: Number.isFinite(longMaxTokens)
        ? Math.max(64, Math.min(1_024, Math.round(longMaxTokens)))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
    },
    selectionAssist: normalizeWriteSelectionAssistSettings(settings?.selectionAssist)
  }
}

export function withResolvedInlineCompletionSettings(
  write: {
    defaultWorkspaceRoot: string
    activeWorkspaceRoot: string
    workspaces: string[]
    inlineCompletion: WriteInlineCompletionSettingsV1
    selectionAssist: WriteSelectionAssistSettingsV1
  },
  settings: Pick<AppSettingsV1, 'provider' | 'agents' | 'write'>
): {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  selectionAssist: WriteSelectionAssistSettingsV1
} {
  return {
    ...write,
    inlineCompletion: {
      ...write.inlineCompletion,
      apiKey: resolveWriteInlineCompletionApiKey(settings as never),
      baseUrl: resolveWriteInlineCompletionBaseUrl(settings as never),
      model: resolveWriteInlineCompletionModel(settings as never)
    }
  }
}

export function writeBasenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

export function writeDirnameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return normalized
  return normalized.slice(0, index)
}

export function writeJoinPath(base: string, next: string): string {
  if (!base) return next
  return `${normalizePath(base)}/${next.replace(/^\/+/, '')}`
}

export function writeRelativeToWorkspace(workspaceRoot: string, filePath: string): string {
  const normalizedRoot = normalizePath(workspaceRoot)
  const normalizedFile = normalizePath(filePath)
  const prefix = `${normalizedRoot}/`
  if (normalizedRoot && normalizedFile.startsWith(prefix)) return normalizedFile.slice(prefix.length)
  return writeBasenameFromPath(filePath)
}

export function activeFileStorageKey(workspaceRoot: string): string {
  return `kun.write.active-file:${normalizePath(workspaceRoot)}`
}

export function rememberActiveFile(workspaceRoot: string, nextPath: string | null): void {
  if (!workspaceRoot.trim()) return
  if (nextPath) {
    writeBrowserStorageItem(activeFileStorageKey(workspaceRoot), nextPath)
  } else {
    removeBrowserStorageItem(activeFileStorageKey(workspaceRoot))
  }
}

export function readRememberedActiveFile(workspaceRoot: string): string {
  return readBrowserStorageItem(activeFileStorageKey(workspaceRoot)) ?? ''
}

export function emptySelection(): WriteEditorSelectionState {
  return { text: '', ranges: [], charCount: 0 }
}

export function formatWriteImageLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No handler registered for')
    ? i18n.t('common:writeImageRestartRequired')
    : message
}

export function isMissingImageIpc(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No handler registered for') ||
    message.includes('readWorkspaceImage is not a function')
}

export function imageMimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  return ''
}

export function filterWriteEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.filter(isWriteWorkspaceEntry)
}

export function initialState(): Pick<
  WriteWorkspaceState,
  | 'workspaceRoot'
  | 'rootDirectory'
  | 'entriesByDir'
  | 'expandedDirs'
  | 'loadingDirs'
  | 'treeError'
  | 'activeFilePath'
  | 'activeFileKind'
  | 'fileContent'
  | 'imageDataUrl'
  | 'imageMimeType'
  | 'pdfDataBase64'
  | 'pdfMimeType'
  | 'pdfMtimeMs'
  | 'fileSize'
  | 'fileTruncated'
  | 'fileError'
  | 'fileLoading'
  | 'saveStatus'
  | 'selection'
  | 'quotedSelections'
  | 'recentEdits'
> {
  return {
    workspaceRoot: '',
    rootDirectory: '',
    entriesByDir: {},
    expandedDirs: new Set(),
    loadingDirs: {},
    treeError: null,
    activeFilePath: null,
    activeFileKind: null,
    fileContent: '',
    imageDataUrl: '',
    imageMimeType: '',
    pdfDataBase64: '',
    pdfMimeType: '',
    pdfMtimeMs: 0,
    fileSize: 0,
    fileTruncated: false,
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved',
    selection: emptySelection(),
    quotedSelections: [],
    recentEdits: []
  }
}
