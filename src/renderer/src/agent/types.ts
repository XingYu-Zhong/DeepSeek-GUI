import type {
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreMemoryRecordJson,
  CoreRuntimeInfoJson,
  CoreRuntimeSkillJson,
  CoreRuntimeToolDiagnosticsJson
} from './kun-contract'

export type ToolItemKind = 'tool_call' | 'command_execution' | 'file_change'

export type AttachmentReference = {
  id: string
  name?: string
  mimeType?: string
  width?: number
  height?: number
  previewUrl?: string
}

export type RuntimeChildMetadata = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
}

export type WebCitationSource = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type RuntimeDisclosureMetadata = {
  displayText?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  child?: RuntimeChildMetadata
  sources?: WebCitationSource[]
}

export type UserInputOption = {
  label: string
  description: string
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
}

export type UserInputAnswer = {
  id: string
  label: string
  value: string
}

export type NormalizedThread = {
  id: string
  title: string
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  status?: string
  archived?: boolean
  preview?: string
  latestTurnId?: string
  latestTurnStatus?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export type ThreadTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type ThreadTodoItem = {
  id: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  createdAt: string
  updatedAt: string
}

export type ThreadTodoList = {
  threadId: string
  items: ThreadTodoItem[]
  updatedAt: string
}

export type RuntimeConnectionStatus = 'idle' | 'checking' | 'ready' | 'offline'

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  summary?: boolean
}

export type ToolBlock = {
  kind: 'tool'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  /** Full text content from runtime: stdout/stderr or unified patch text */
  detail?: string
  /** Resolved file path for file_change items, when known */
  filePath?: string
  /** Optional structured metadata, e.g. { exit_code, duration_ms, command } */
  meta?: Record<string, unknown>
}

export type CompactionBlock = {
  kind: 'compaction'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
}

export type ReviewTarget =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type ReviewFinding = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type ReviewOutput = {
  findings: ReviewFinding[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

export type ReviewBlock = {
  kind: 'review'
  id: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type ChatBlock =
  | {
      kind: 'user'
      id: string
      createdAt?: string
      text: string
      modelLabel?: string
      managedBy?: 'claw'
      meta?: RuntimeDisclosureMetadata
    }
  | { kind: 'assistant'; id: string; createdAt?: string; text: string }
  | { kind: 'reasoning'; id: string; createdAt?: string; text: string }
  | ToolBlock
  | CompactionBlock
  | ReviewBlock
  | { kind: 'system'; id: string; createdAt?: string; text: string }
  | {
      kind: 'approval'
      id: string
      createdAt?: string
      approvalId: string
      summary: string
      toolName?: string
      status: 'pending' | 'allowed' | 'denied' | 'error'
      errorMessage?: string
      meta?: RuntimeDisclosureMetadata
    }
  | {
      kind: 'user_input'
      id: string
      createdAt?: string
      requestId: string
      questions: UserInputQuestion[]
      status: 'pending' | 'submitted' | 'cancelled' | 'error'
      answers?: UserInputAnswer[]
      errorMessage?: string
    }

export type ApprovalRequestPayload = {
  approvalId: string
  summary: string
  toolName?: string
  meta?: RuntimeDisclosureMetadata
}

export type ToolEventPayload = {
  itemId: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  detail?: string
  filePath?: string
  meta?: Record<string, unknown>
}

export type RuntimeStatusEventPayload = {
  kind:
    | 'tool_result_upload_wait'
    | 'tool_catalog_changed'
    | 'tool_storm_suppressed'
    | 'compaction_summary_fallback'
  itemId: string
  turnId?: string
  createdAt?: string
  message?: string
  toolResultCount?: number
  changeKind?: 'additive' | 'breaking'
  toolName?: string
  callId?: string
}

export type CompactionEventPayload = {
  itemId: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
  createdAt?: string
}

export type ReviewEventPayload = {
  itemId: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type UserInputRequestPayload = {
  itemId: string
  requestId: string
  questions: UserInputQuestion[]
}

export type UserInputStatusPayload = {
  itemId: string
  status: 'submitted' | 'cancelled' | 'error'
  answers?: UserInputAnswer[]
  errorMessage?: string
}

export type UserMessageEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  text: string
  modelLabel?: string
  managedBy?: 'claw'
  meta?: RuntimeDisclosureMetadata
}

export type ThreadDeltaEvent = {
  text: string
  kind: 'agent_message' | 'agent_reasoning'
  seq?: number
}

/** Cumulative usage/cost for a Kun thread. */
export type ThreadUsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
}

export type ThreadEventSink = {
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onUserMessage(ev: UserMessageEventPayload): void
  onTool(ev: ToolEventPayload): void
  onCompaction(ev: CompactionEventPayload): void
  onReview?(ev: ReviewEventPayload): void
  onApproval(req: ApprovalRequestPayload): void
  onUserInput(req: UserInputRequestPayload): void
  onUserInputStatus(ev: UserInputStatusPayload): void
  onRuntimeStatus?(ev: RuntimeStatusEventPayload): void
  onGoal(ev: { threadId: string; goal: ThreadGoal | null; cleared?: boolean; createdAt?: string }): void
  onTodos?(ev: { threadId: string; todos: ThreadTodoList | null; cleared?: boolean; createdAt?: string }): void
  onTurnComplete(): void
  onError(err: Error): void
  /** Optional: cumulative usage update for the thread. */
  onUsage?(usage: ThreadUsageSnapshot): void
}

export interface AgentProvider {
  readonly id: 'kun'
  readonly displayName: string
  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review?: boolean
  }
  connect(): Promise<void>
  listThreads(options?: ThreadListOptions): Promise<NormalizedThread[]>
  createThread(input: { workspace?: string; title?: string; mode?: string }): Promise<NormalizedThread>
  getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    goal?: ThreadGoal | null
    todos?: ThreadTodoList | null
  }>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: string
      model?: string
      reasoningEffort?: string
      displayText?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      attachmentIds?: string[]
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }>
  reviewThread?(
    threadId: string,
    target: ReviewTarget,
    options?: { model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }>
  getRuntimeInfo?(): Promise<CoreRuntimeInfoJson>
  getToolDiagnostics?(): Promise<CoreRuntimeToolDiagnosticsJson>
  listSkills?(): Promise<CoreRuntimeSkillJson[]>
  uploadAttachment?(input: {
    name: string
    mimeType?: string
    dataBase64: string
    textFallback?: CoreAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<CoreAttachmentMetadataJson>
  getAttachmentContent?(
    attachmentId: string,
    options?: { threadId?: string; workspace?: string }
  ): Promise<CoreAttachmentContentResponseJson>
  listMemories?(options?: { workspace?: string; includeDeleted?: boolean }): Promise<CoreMemoryRecordJson[]>
  updateMemory?(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }
  ): Promise<CoreMemoryRecordJson>
  deleteMemory?(memoryId: string): Promise<CoreMemoryRecordJson>
  steerUserMessage?(threadId: string, turnId: string, text: string): Promise<void>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
  renameThread(threadId: string, title: string): Promise<void>
  archiveThread?(threadId: string, archived: boolean): Promise<void>
  deleteThread(threadId: string): Promise<void>
  compactThread?(threadId: string, reason?: string): Promise<void>
  getThreadGoal?(threadId: string): Promise<ThreadGoal | null>
  setThreadGoal?(
    threadId: string,
    patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }
  ): Promise<ThreadGoal>
  clearThreadGoal?(threadId: string): Promise<boolean>
  getThreadTodos?(threadId: string): Promise<ThreadTodoList | null>
  setThreadTodos?(
    threadId: string,
    todos: Array<{
      id?: string
      content: string
      status: ThreadTodoStatus
      source?: ThreadTodoSource
    }>
  ): Promise<ThreadTodoList>
  clearThreadTodos?(threadId: string): Promise<boolean>
  forkThread?(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ): Promise<NormalizedThread>
  resumeSession?(
    sessionId: string,
    options?: { model?: string; mode?: string }
  ): Promise<{ threadId: string; sessionId: string }>
  subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void>
  /** Runtime HTTP: POST /v1/approvals/{id} */
  submitApprovalDecision?(
    approvalId: string,
    decision: 'allow' | 'deny',
    remember?: boolean
  ): Promise<void>
  /** Runtime HTTP compatibility path for request_user_input responses. */
  submitUserInputResponse?(requestId: string, answers: UserInputAnswer[]): Promise<void>
  cancelUserInput?(requestId: string): Promise<void>
}
