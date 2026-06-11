import type { ChatBlock, NormalizedThread } from '../agent/types'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import {
  DEFAULT_CLAW_MODEL,
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

const COMPOSER_MODEL_STORAGE_KEY = 'deepseekgui.composerModel'
const TURN_MODEL_STORAGE_KEY = 'deepseekgui.turnModelLabel'
const CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'deepseekgui.codeWorkspaceRoots.v1'
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
      if (trimmed && trimmed.toLowerCase() !== 'auto') ordered.add(trimmed)
    }
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
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
    model: DEFAULT_CLAW_MODEL,
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
  return trimmed && trimmed.toLowerCase() !== 'auto' ? trimmed : DEFAULT_CLAW_MODEL
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

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  'deepseek-v4-pro': 'V4 Pro',
  'deepseek-v4-flash': 'V4 Flash'
}

function friendlyModelName(model: string): string {
  return FRIENDLY_MODEL_NAMES[model.trim().toLowerCase()] ?? model
}

export function optimisticUserModelLabel(
  composerModel: string,
  threadModel: string | undefined
): string | undefined {
  const composer = composerModel.trim()
  if (composer) return friendlyModelName(composer)
  const model = threadModel?.trim()
  return model ? friendlyModelName(model) : undefined
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
