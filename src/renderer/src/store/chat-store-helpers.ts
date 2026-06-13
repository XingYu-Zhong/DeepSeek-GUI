import type { ChatBlock, NormalizedThread } from '../agent/types'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  CLAW_MANAGED_INSTRUCTIONS_HEADING,
  CLAW_MODEL_IDS,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider
} from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../lib/workspace-path'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

const COMPOSER_MODEL_STORAGE_KEY = 'kun.composerModel'
const COMPOSER_PROVIDER_STORAGE_KEY = 'kun.composerProviderId'
const TURN_MODEL_STORAGE_KEY = 'kun.turnModelLabel'
const CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'kun.codeWorkspaceRoots.v1'
export const MAX_CODE_WORKSPACE_ROOTS = 30
export const MAX_TURN_MODEL_LABELS = 500

export const CLAW_COMPOSER_MODEL_IDS = [...CLAW_MODEL_IDS]

export function readStoredComposerModel(allowedIds: readonly string[]): string {
  const raw = readBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY)
  if (raw === null) return ''
  if (raw === '') return ''
  if (allowedIds.includes(raw)) return raw
  return ''
}

export function persistComposerModel(model: string): void {
  writeBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY, model)
}

export function readStoredComposerProviderId(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string
): string {
  const raw = readBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY)
  const providerId = raw?.trim() ?? ''
  if (!providerId) return ''
  const group = modelGroups.find((item) => item.providerId === providerId)
  if (!group) return ''
  const model = modelId.trim()
  if (!model) return providerId
  return modelGroupHasModel(group, model) ? providerId : ''
}

export function persistComposerProviderId(providerId: string): void {
  const normalized = providerId.trim()
  if (normalized) {
    writeBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY, normalized)
  } else {
    writeBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY, '')
  }
}

export function providerIdForComposerModel(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string
): string {
  const model = modelId.trim()
  if (!model) return ''
  return modelGroups.find((group) => modelGroupHasModel(group, model))?.providerId ?? ''
}

function modelGroupHasModel(group: ModelProviderModelGroup, modelId: string): boolean {
  const normalized = normalizeComposerModelId(modelId)
  if (!normalized) return false
  return group.modelIds.some((id) => normalizeComposerModelId(id) === normalized)
}

function normalizeComposerModelId(modelId: string): string {
  return modelId.trim().toLowerCase()
}

export function compactCodeWorkspaceRoots(workspaceRoots: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const workspaceRoot of workspaceRoots) {
    const normalized = normalizeWorkspaceRoot(workspaceRoot ?? '').replace(/[\\/]+$/, '')
    if (!normalized) continue
    if (isInternalTemporaryWorkspace(normalized)) continue
    if (isInternalDeepSeekGuiWorkspace(normalized)) continue
    if (isClawWorkspacePath(normalized)) continue
    const key = workspaceRootIdentityKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out.slice(0, MAX_CODE_WORKSPACE_ROOTS)
}

function workspaceIdentityKeySet(workspaceRoots: readonly (string | undefined | null)[]): Set<string> {
  const keys = new Set<string>()
  for (const workspaceRoot of workspaceRoots) {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(workspaceRoot ?? ''))
    if (key) keys.add(key)
  }
  return keys
}

export function reconcileCodeWorkspaceRoots(options: {
  currentRoots: readonly (string | undefined | null)[]
  codeThreadWorkspaceRoots: readonly (string | undefined | null)[]
  writeWorkspaceRoots: readonly (string | undefined | null)[]
  preservedWorkspaceRoots?: readonly (string | undefined | null)[]
}): string[] {
  const writeKeys = workspaceIdentityKeySet(options.writeWorkspaceRoots)
  if (writeKeys.size === 0) {
    return compactCodeWorkspaceRoots([
      ...options.codeThreadWorkspaceRoots,
      ...options.currentRoots,
      ...(options.preservedWorkspaceRoots ?? [])
    ])
  }

  const codeThreadKeys = workspaceIdentityKeySet(options.codeThreadWorkspaceRoots)
  const preservedKeys = workspaceIdentityKeySet(options.preservedWorkspaceRoots ?? [])
  const retainedCurrentRoots = options.currentRoots.filter((workspaceRoot) => {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(workspaceRoot ?? ''))
    if (!key) return false
    if (!writeKeys.has(key)) return true
    return codeThreadKeys.has(key) || preservedKeys.has(key)
  })

  return compactCodeWorkspaceRoots([
    ...options.codeThreadWorkspaceRoots,
    ...retainedCurrentRoots,
    ...(options.preservedWorkspaceRoots ?? [])
  ])
}

export function readCodeWorkspaceRoots(): string[] {
  try {
    const raw = readBrowserStorageItem(CODE_WORKSPACE_ROOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return compactCodeWorkspaceRoots(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return []
  }
}

export function saveCodeWorkspaceRoots(workspaceRoots: readonly string[]): void {
  writeBrowserStorageItem(
    CODE_WORKSPACE_ROOTS_STORAGE_KEY,
    JSON.stringify(compactCodeWorkspaceRoots(workspaceRoots))
  )
}

export function rememberCodeWorkspaceRoots(
  currentRoots: readonly string[],
  workspaceRoots: readonly (string | undefined | null)[]
): string[] {
  const next = compactCodeWorkspaceRoots([...workspaceRoots, ...currentRoots])
  saveCodeWorkspaceRoots(next)
  return next
}

export function forgetCodeWorkspaceRoot(
  currentRoots: readonly string[],
  workspaceRoot: string
): string[] {
  const normalized = normalizeWorkspaceRoot(workspaceRoot)
  const key = workspaceRootIdentityKey(normalized)
  const next = compactCodeWorkspaceRoots(
    currentRoots.filter((root) => workspaceRootIdentityKey(normalizeWorkspaceRoot(root)) !== key)
  )
  saveCodeWorkspaceRoots(next)
  return next
}

export function mergeComposerPickList(upstreamOk: boolean, upstreamIds: string[]): string[] {
  const ordered = new Set<string>()
  for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
    ordered.add(id)
  }
  if (upstreamOk) {
    for (const id of upstreamIds) {
      const trimmed = id.trim()
      if (trimmed && trimmed !== 'auto') ordered.add(trimmed)
    }
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
}

export function fallbackComposerModel(pickList: readonly string[], runtimeDefault: string): string {
  const allowed = new Set(pickList)
  const preferred = runtimeDefault.trim()
  if (preferred && preferred.toLowerCase() !== 'auto' && allowed.has(preferred)) return preferred
  return DEFAULT_COMPOSER_MODEL_IDS.find((id) => allowed.has(id)) ?? pickList[0] ?? ''
}

export function newClawChannel(
  provider: ClawImProvider,
  agentProfile?: Partial<ClawImAgentProfileV1>,
  platformCredential?: ClawImPlatformCredentialV1
): ClawImChannelV1 {
  const now = new Date().toISOString()
  const fallbackId = `im-${provider}-${Date.now()}`
  const defaultName = defaultClawProviderLabel(provider)
  const profileName = agentProfile?.name?.trim() || defaultName
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    provider,
    label: profileName,
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '',
    conversations: [],
    agentProfile: {
      name: profileName,
      description: agentProfile?.description?.trim() ?? '',
      identity: agentProfile?.identity ?? '',
      personality: agentProfile?.personality ?? '',
      userContext: agentProfile?.userContext ?? '',
      replyRules: agentProfile?.replyRules ?? ''
    },
    ...(platformCredential ? { platformCredential } : {}),
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeClawComposerModel(raw: string): string {
  const trimmed = raw.trim()
  return trimmed || 'auto'
}

export function activeClawChannel(
  state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>
): ClawImChannelV1 | null {
  return state.clawChannels.find((channel) => channel.id === state.activeClawChannelId) ?? null
}

function addClawThreadId(ids: Set<string>, threadId: string | undefined): void {
  const id = threadId?.trim() ?? ''
  if (id) ids.add(id)
}

export function clawThreadIdsFromChannels(
  channels: ClawImChannelV1[]
): Set<string> {
  const ids = new Set<string>()
  for (const channel of channels) {
    addClawThreadId(ids, channel.threadId)
    for (const conversation of channel.conversations) {
      addClawThreadId(ids, conversation.localThreadId)
    }
  }
  return ids
}

export function clawThreadTitleLooksManaged(title: string | undefined): boolean {
  const trimmed = title?.trim() ?? ''
  return trimmed.startsWith(CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    trimmed.startsWith('[Claw:') ||
    trimmed.startsWith('[Claw IM:') ||
    trimmed.startsWith('[Claw]')
}

export function isClawThread(
  thread: Pick<NormalizedThread, 'id' | 'title'>,
  channels: ClawImChannelV1[] = []
): boolean {
  return clawThreadTitleLooksManaged(thread.title) || clawThreadIdsFromChannels(channels).has(thread.id)
}

export function optimisticUserModelLabel(
  composerModel: string,
  threadModel: string | undefined
): string | undefined {
  const composer = composerModel.trim()
  if (composer) return composer.toLowerCase() === 'auto' ? 'auto' : composer
  const model = threadModel?.trim()
  return model || undefined
}

export function rememberTurnModel(threadId: string, itemId: string, model: string): void {
  const thread = threadId.trim()
  const item = itemId.trim()
  const label = model.trim()
  if (!thread || !item || !label) return
  const key = `${thread}|${item}`
  const map = loadTurnModelMap()
  delete map[key]
  map[key] = label
  saveTurnModelMap(map)
}

export function hydrateBlockModelLabels(threadId: string, blocks: ChatBlock[]): ChatBlock[] {
  const map = loadTurnModelMap()
  let changed = false
  const next = blocks.map((block) => {
    if (block.kind !== 'user') return block
    if (block.modelLabel) return block
    const label = map[`${threadId}|${block.id}`]
    if (!label) return block
    changed = true
    return { ...block, modelLabel: label }
  })
  return changed ? next : blocks
}

function defaultClawProviderLabel(provider: ClawImProvider): string {
  if (provider === 'weixin') return 'weixin agent'
  return 'feishu agent'
}

function loadTurnModelMap(): Record<string, string> {
  try {
    const raw = readBrowserStorageItem(TURN_MODEL_STORAGE_KEY)
    if (!raw) return {}
    return normalizeTurnModelMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function normalizeTurnModelMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<[string, string]> = []
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim()
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !key.includes('|') || !value) continue
    entries.push([key, value])
  }
  const recent = entries.slice(-MAX_TURN_MODEL_LABELS)
  return Object.fromEntries(recent)
}

function saveTurnModelMap(map: Record<string, string>): void {
  writeBrowserStorageItem(TURN_MODEL_STORAGE_KEY, JSON.stringify(normalizeTurnModelMap(map)))
}
