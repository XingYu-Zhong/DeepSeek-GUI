import type {
  ChatBlock,
  NormalizedThread,
  RuntimeDisclosureMetadata,
  UserMessageEventPayload
} from '../agent/types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import type { ChatState } from './chat-store-types'

type ThreadDetailProviderLike = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
}

export function threadBelongsToWorkspace(
  thread: { workspace?: string },
  workspaceRoot: string
): boolean {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return false
  return normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
}

export function hasPendingRuntimeWork(block: ChatBlock): boolean {
  if (block.kind === 'tool') return block.status === 'running'
  if (block.kind === 'compaction') return block.status === 'running'
  if (block.kind === 'review') return block.status === 'running'
  if (block.kind === 'approval') return block.status === 'pending'
  if (block.kind === 'user_input') return block.status === 'pending'
  return false
}

function assistantBlockHasVisibleContent(block: Extract<ChatBlock, { kind: 'assistant' }>): boolean {
  const withoutThink = block.text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
  return withoutThink.length > 0
}

export function threadHasPendingRuntimeWork(blocks: ChatBlock[]): boolean {
  let pendingInCurrentTurn = false

  for (const block of blocks) {
    if (block.kind === 'user') {
      pendingInCurrentTurn = false
      continue
    }
    if (hasPendingRuntimeWork(block)) {
      pendingInCurrentTurn = true
      continue
    }
    if (pendingInCurrentTurn && block.kind === 'assistant' && assistantBlockHasVisibleContent(block)) {
      pendingInCurrentTurn = false
    }
  }

  return pendingInCurrentTurn
}

export function settlePendingRuntimeWorkAfterInterrupt(blocks: ChatBlock[]): ChatBlock[] {
  let changed = false
  const next = blocks.map((block): ChatBlock => {
    if (block.kind === 'tool' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'compaction' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'review' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'approval' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'user_input' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'cancelled' as const }
    }
    return block
  })
  return changed ? next : blocks
}

export function threadSnapshotLooksRunning(blocks: ChatBlock[], threadStatus?: string): boolean {
  if (threadStatus != null && threadStatus.trim()) {
    return runtimeStatusLooksRunning(threadStatus)
  }
  return threadHasPendingRuntimeWork(blocks)
}

export function findLatestUserBlockId(blocks: ChatBlock[]): string | null {
  for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
    const block = blocks[idx]
    if (block?.kind === 'user') return block.id
  }
  return null
}

export function upsertUserBlock(blocks: ChatBlock[], ev: UserMessageEventPayload): ChatBlock[] {
  const nextBlock: ChatBlock = {
    kind: 'user',
    id: ev.itemId,
    createdAt: ev.createdAt,
    text: ev.text,
    ...(ev.modelLabel ? { modelLabel: ev.modelLabel } : {}),
    ...(ev.managedBy ? { managedBy: ev.managedBy } : {}),
    ...(ev.meta ? { meta: ev.meta } : {})
  }
  const existingIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === ev.itemId)
  if (existingIndex < 0) return [...blocks, nextBlock]
  const current = blocks[existingIndex]
  const meta = mergeRuntimeDisclosureMeta(
    current.kind === 'user' ? current.meta : undefined,
    nextBlock.kind === 'user' ? nextBlock.meta : undefined
  )
  const merged: ChatBlock = {
    ...current,
    ...nextBlock,
    createdAt: current.createdAt ?? nextBlock.createdAt,
    ...(meta ? { meta } : {})
  }
  const next = [...blocks]
  next[existingIndex] = merged
  return next
}

function mergeRuntimeDisclosureMeta(
  current: RuntimeDisclosureMetadata | undefined,
  next: RuntimeDisclosureMetadata | undefined
): RuntimeDisclosureMetadata | undefined {
  if (!current && !next) return undefined
  return {
    ...(current ?? {}),
    ...(next ?? {})
  }
}

export function reconcileOptimisticUserBlock(
  blocks: ChatBlock[],
  optimisticId: string,
  runtimeId: string,
  fallbackText?: string,
  modelLabel?: string
): ChatBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'user' || block.id !== optimisticId) return block
    return {
      ...block,
      id: runtimeId,
      ...(fallbackText && !block.text.trim() ? { text: fallbackText } : {}),
      ...(modelLabel && !block.modelLabel ? { modelLabel } : {})
    }
  })
}

export function collectAssistantTextForTurn(
  blocks: ChatBlock[],
  userBlockId: string,
  liveAssistant: string
): string {
  const userIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === userBlockId)
  if (userIndex < 0) return liveAssistant.trim()
  const parts: string[] = []
  for (let index = userIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === 'user') break
    if (block.kind === 'assistant' && block.text.trim()) {
      parts.push(block.text.trim())
    }
  }
  if (liveAssistant.trim()) parts.push(liveAssistant.trim())
  return parts.join('\n\n').trim()
}

export function clearedThreadSelection(): Pick<
  ChatState,
  | 'activeThreadId'
  | 'activeThreadGoal'
  | 'activeThreadTodos'
  | 'blocks'
  | 'lastSeq'
  | 'liveReasoning'
  | 'liveAssistant'
  | 'busy'
  | 'currentTurnId'
  | 'currentTurnUserId'
  | 'turnStartedAtByUserId'
  | 'turnDurationByUserId'
  | 'turnReasoningFirstAtByUserId'
  | 'turnReasoningLastAtByUserId'
  | 'inspectorSelectedId'
  | 'queuedMessages'
> {
  return {
    activeThreadId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    blocks: [],
    lastSeq: 0,
    liveReasoning: '',
    liveAssistant: '',
    busy: false,
    currentTurnId: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    queuedMessages: []
  }
}

export async function findReusableEmptyThreadId(
  state: ChatState,
  provider: ThreadDetailProviderLike,
  workspaceRoot: string,
  isReusableThread: (thread: NormalizedThread) => boolean = () => true
): Promise<string | null> {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return null

  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : null
  if (
    activeThread &&
    isReusableThread(activeThread) &&
    normalizeWorkspaceRoot(activeThread.workspace) === normalizedWorkspace &&
    !threadHasUserMessage(state.blocks)
  ) {
    return activeThread.id
  }

  const candidates = state.threads
    .filter(
      (thread) =>
        thread.id !== activeThread?.id &&
        isReusableThread(thread) &&
        normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  for (const thread of candidates) {
    try {
      const { blocks } = await provider.getThreadDetail(thread.id)
      if (!threadHasUserMessage(blocks)) return thread.id
    } catch {
      /* ignore and keep checking other candidates */
    }
  }

  return null
}

function runtimeStatusLooksRunning(status?: string): boolean {
  const normalized = status?.trim().toLowerCase()
  return normalized === 'running'
    || normalized === 'in_progress'
    || normalized === 'queued'
    || normalized === 'started'
}

function threadHasUserMessage(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => block.kind === 'user')
}
