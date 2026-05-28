import type { AgentProviderId as SharedAgentProviderId } from '@shared/agent-catalog'

export type AgentProviderId = SharedAgentProviderId

export type ToolItemKind = 'tool_call' | 'command_execution' | 'file_change'

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
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
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

export type ChatBlock =
  | { kind: 'user'; id: string; createdAt?: string; text: string; modelLabel?: string }
  | { kind: 'assistant'; id: string; createdAt?: string; text: string }
  | { kind: 'reasoning'; id: string; createdAt?: string; text: string }
  | ToolBlock
  | CompactionBlock
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
}

export type ThreadDeltaEvent = {
  text: string
  kind: 'agent_message' | 'agent_reasoning'
  seq?: number
}

export type ThreadEventSink = {
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onUserMessage(ev: UserMessageEventPayload): void
  onTool(ev: ToolEventPayload): void
  onCompaction(ev: CompactionEventPayload): void
  onApproval(req: ApprovalRequestPayload): void
  onUserInput(req: UserInputRequestPayload): void
  onUserInputStatus(ev: UserInputStatusPayload): void
  onTurnComplete(): void
  onError(err: Error): void
}

export interface AgentProvider {
  readonly id: AgentProviderId
  readonly displayName: string
  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
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
  }>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: { mode?: string; model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }>
  steerUserMessage?(threadId: string, turnId: string, text: string): Promise<void>
  interruptTurn(threadId: string, turnId: string): Promise<void>
  renameThread(threadId: string, title: string): Promise<void>
  archiveThread?(threadId: string, archived: boolean): Promise<void>
  deleteThread(threadId: string): Promise<void>
  compactThread?(threadId: string, reason?: string): Promise<void>
  forkThread?(threadId: string): Promise<NormalizedThread>
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
