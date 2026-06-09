import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  type AppSettingsV1,
  type WriteInlineCompletionSettingsV1,
  type WriteSettingsPatchV1,
  type WriteSettingsV1
} from './app-settings-types'
import { getActiveAgentApiKey, getKunRuntimeSettings } from './app-settings-kun'
import { resolveModelProviderBaseUrl } from './app-settings-provider'
import { compactStrings } from './app-settings-normalizers'

export function defaultWriteSettings(): WriteSettingsV1 {
  return {
    defaultWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    activeWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    workspaces: [DEFAULT_WRITE_WORKSPACE_ROOT],
    inlineCompletion: {
      enabled: true,
      retrievalEnabled: true,
      longCompletionEnabled: true,
      apiKey: '',
      baseUrl: '',
      inheritModel: true,
      model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
      debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
      longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
      longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
      maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
      longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
    }
  }
}

function normalizeWriteInlineCompletionSettings(
  input: Partial<WriteInlineCompletionSettingsV1> | undefined
): WriteInlineCompletionSettingsV1 {
  const defaults = defaultWriteSettings().inlineCompletion
  const debounceMs = Number(input?.debounceMs)
  const longDebounceMs = Number(input?.longDebounceMs)
  const minAcceptScore = Number(input?.minAcceptScore)
  const longMinAcceptScore = Number(input?.longMinAcceptScore)
  const maxTokens = Number(input?.maxTokens)
  const longMaxTokens = Number(input?.longMaxTokens)
  const model = normalizeWriteInlineCompletionModel(input?.model)
  return {
    enabled: input?.enabled !== false,
    retrievalEnabled: input?.retrievalEnabled !== false,
    longCompletionEnabled: input?.longCompletionEnabled !== false,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    inheritModel: shouldInheritWriteInlineCompletionModel(input),
    model,
    debounceMs:
      Number.isFinite(debounceMs)
        ? Math.max(150, Math.min(5_000, Math.round(debounceMs)))
        : defaults.debounceMs,
    longDebounceMs:
      Number.isFinite(longDebounceMs)
        ? Math.max(1_000, Math.min(15_000, Math.round(longDebounceMs)))
        : defaults.longDebounceMs,
    minAcceptScore:
      Number.isFinite(minAcceptScore)
        ? Math.max(0.1, Math.min(0.95, minAcceptScore))
        : defaults.minAcceptScore,
    longMinAcceptScore:
      Number.isFinite(longMinAcceptScore)
        ? Math.max(0.1, Math.min(0.95, longMinAcceptScore))
        : defaults.longMinAcceptScore,
    maxTokens:
      Number.isFinite(maxTokens)
        ? Math.max(16, Math.min(512, Math.round(maxTokens)))
        : defaults.maxTokens,
    longMaxTokens:
      Number.isFinite(longMaxTokens)
        ? Math.max(64, Math.min(1_024, Math.round(longMaxTokens)))
        : defaults.longMaxTokens
  }
}

export function normalizeWriteInlineCompletionModel(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || trimmed === 'auto') return DEFAULT_WRITE_INLINE_COMPLETION_MODEL
  return trimmed
}

export function shouldInheritWriteInlineCompletionModel(
  input: Partial<Pick<WriteInlineCompletionSettingsV1, 'inheritModel' | 'model'>> | undefined
): boolean {
  if (typeof input?.inheritModel === 'boolean') return input.inheritModel
  const trimmed = typeof input?.model === 'string' ? input.model.trim() : ''
  return !trimmed || trimmed === DEFAULT_WRITE_INLINE_COMPLETION_MODEL
}

function getNormalizedWriteInlineCompletionSettings(settings: AppSettingsV1): WriteInlineCompletionSettingsV1 {
  return normalizeWriteSettings(
    (settings as { write?: WriteSettingsPatchV1 }).write
  ).inlineCompletion
}

export function resolveWriteInlineCompletionBaseUrl(settings: AppSettingsV1): string {
  const configured = getNormalizedWriteInlineCompletionSettings(settings).baseUrl.trim()
  if (configured && configured !== DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL) {
    return configured
  }
  return resolveModelProviderBaseUrl(settings)
}

export function resolveWriteInlineCompletionApiKey(settings: AppSettingsV1): string {
  const configured = getNormalizedWriteInlineCompletionSettings(settings).apiKey.trim()
  return configured || getActiveAgentApiKey(settings)
}

export function resolveWriteInlineCompletionModel(
  settings: AppSettingsV1,
  requestedModel?: string | null
): string {
  const requested = typeof requestedModel === 'string' ? requestedModel.trim() : ''
  if (requested) return normalizeWriteInlineCompletionModel(requested)
  const configuredSettings = getNormalizedWriteInlineCompletionSettings(settings)
  const configured = configuredSettings.model.trim()
  if (!configuredSettings.inheritModel) {
    return normalizeWriteInlineCompletionModel(configured)
  }
  const runtimeModel = getKunRuntimeSettings(settings).model?.trim() ?? ''
  if (runtimeModel) return runtimeModel
  return normalizeWriteInlineCompletionModel(configured)
}

export function normalizeWriteSettings(input: WriteSettingsPatchV1 | undefined): WriteSettingsV1 {
  const defaults = defaultWriteSettings()
  const source = input ?? {}
  const defaultWorkspaceRoot =
    typeof source.defaultWorkspaceRoot === 'string' && source.defaultWorkspaceRoot.trim()
      ? source.defaultWorkspaceRoot.trim()
      : defaults.defaultWorkspaceRoot
  const activeWorkspaceRoot =
    typeof source.activeWorkspaceRoot === 'string' && source.activeWorkspaceRoot.trim()
      ? source.activeWorkspaceRoot.trim()
      : defaultWorkspaceRoot
  const workspaces = compactStrings([
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    ...(Array.isArray(source.workspaces) ? source.workspaces : [])
  ])
  return {
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    workspaces: workspaces.length > 0 ? workspaces : [defaultWorkspaceRoot],
    inlineCompletion: normalizeWriteInlineCompletionSettings(source.inlineCompletion)
  }
}

export function mergeWriteSettings(
  current: WriteSettingsV1,
  patch: WriteSettingsPatchV1 | undefined
): WriteSettingsV1 {
  const inlinePatch = patch?.inlineCompletion ?? {}
  const nextInlineCompletion: Partial<WriteInlineCompletionSettingsV1> = {
    ...current.inlineCompletion,
    ...inlinePatch
  }

  if ('model' in inlinePatch && !('inheritModel' in inlinePatch)) {
    delete (nextInlineCompletion as { inheritModel?: boolean }).inheritModel
  }

  return normalizeWriteSettings({
    ...current,
    ...(patch ?? {}),
    inlineCompletion: nextInlineCompletion
  })
}
