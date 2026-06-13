import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'

export type CoreThreadStatus = 'idle' | 'running' | 'archived' | 'deleted'
export type CoreTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
export type CoreItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'allowed'
  | 'denied'
  | 'expired'
  | string

export type CoreThreadSummaryJson = {
  id: string
  title: string
  workspace?: string
  model: string
  mode: string
  status: CoreThreadStatus
  approvalPolicy?: string
  sandboxMode?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  createdAt: string
  updatedAt: string
}

export type CoreThreadJson = CoreThreadSummaryJson & {
  turns?: CoreTurnJson[]
  latestSeq?: number
}

export type CoreAttachmentMetadataJson = {
  id: string
  name: string
  mimeType: string
  byteSize: number
  hash: string
  width?: number
  height?: number
  localFilePath?: string
  textFallback?: CoreAttachmentTextFallbackJson
  threadIds?: string[]
  workspaces?: string[]
  createdAt: string
  updatedAt: string
}

export type CoreAttachmentTextFallbackJson = {
  dataBase64: string
  mimeType: string
  byteSize: number
  width?: number
  height?: number
  wasCompressed?: boolean
}

export type CoreAttachmentDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  count: number
  totalBytes: number
}

export type CoreMemoryRecordJson = {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  sourceThreadId?: string
  sourceTurnId?: string
  tags?: string[]
  confidence?: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type CoreThreadGoalStatusJson =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type CoreThreadGoalJson = {
  threadId: string
  objective: string
  status: CoreThreadGoalStatusJson
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type CoreThreadGoalResponseJson = {
  goal: CoreThreadGoalJson | null
}

export type CoreClearThreadGoalResponseJson = {
  cleared: boolean
}

export type CoreThreadTodoStatusJson = 'pending' | 'in_progress' | 'completed'

export type CoreThreadTodoSourceJson = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type CoreThreadTodoItemJson = {
  id: string
  content: string
  status: CoreThreadTodoStatusJson
  source?: CoreThreadTodoSourceJson
  createdAt: string
  updatedAt: string
}

export type CoreThreadTodoListJson = {
  threadId: string
  items: CoreThreadTodoItemJson[]
  updatedAt: string
}

export type CoreThreadTodosResponseJson = {
  todos: CoreThreadTodoListJson | null
}

export type CoreClearThreadTodosResponseJson = {
  cleared: boolean
}

export type CoreMemoryDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  activeCount: number
  tombstoneCount: number
  lastInjectedIds?: string[]
}

export type CoreRuntimeCapabilityStateJson = {
  status: 'available' | 'disabled' | 'unavailable'
  enabled: boolean
  available: boolean
  reason?: string
}

export type CoreRuntimeCapabilityManifestJson = {
  contractVersion: number
  model: {
    id: string
    inputModalities: Array<'text' | 'image'>
    outputModalities: Array<'text' | 'image'>
    supportsToolCalling: boolean
    contextWindowTokens?: number
    messageParts: Array<'text' | 'image_url' | 'input_image'>
  }
  cli: Record<'serve' | 'run' | 'chat' | 'exec', CoreRuntimeCapabilityStateJson>
  mcp: CoreRuntimeCapabilityStateJson & {
    configuredServers: number
    connectedServers: number
    toolCount: number
    search?: {
      enabled: boolean
      mode: 'direct' | 'search' | 'auto'
      active: boolean
      indexedToolCount: number
      advertisedToolCount: number
    }
  }
  web: CoreRuntimeCapabilityStateJson & {
    fetch: CoreRuntimeCapabilityStateJson
    search: CoreRuntimeCapabilityStateJson
    provider?: string
  }
  skills: CoreRuntimeCapabilityStateJson & {
    configuredRoots: number
    discoveredSkills: number
  }
  subagents: CoreRuntimeCapabilityStateJson & {
    maxParallel: number
    maxChildRuns: number
  }
  attachments: CoreRuntimeCapabilityStateJson & {
    maxImageBytes: number
    maxImageDimension: number
    allowedMimeTypes: string[]
    textFallbackMaxBase64Bytes?: number
    textFallbackMaxImageDimension?: number
    textFallbackPreferredMimeType?: string
  }
  memory: CoreRuntimeCapabilityStateJson & {
    scopes: Array<'user' | 'workspace' | 'project'>
    maxInjectedRecords: number
  }
  /** Optional so the GUI keeps working against older Kun builds without the capability. */
  imageGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  speechGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  imageRecognition?: CoreRuntimeCapabilityStateJson & {
    model?: string
    enabledAt?: string
  }
  musicGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
  videoGen?: CoreRuntimeCapabilityStateJson & {
    model?: string
  }
}

export type CoreRuntimeInfoJson = {
  host: string
  port: number
  dataDir: string
  configPath?: string
  model?: string
  approvalPolicy?: string
  sandboxMode?: string
  tokenEconomyMode?: boolean
  insecure?: boolean
  startedAt: string
  pid?: number
  capabilities: CoreRuntimeCapabilityManifestJson
}

export type CoreRuntimeToolDiagnosticsJson = {
  providers?: Array<Record<string, unknown>>
  mcpServers?: Array<Record<string, unknown>>
  mcpSearch?: {
    enabled?: boolean
    mode?: 'direct' | 'search' | 'auto'
    active?: boolean
    indexedToolCount?: number
    advertisedToolCount?: number
    topKDefault?: number
    topKMax?: number
	    minScore?: number
	    lastRefreshedAt?: string
	    lastError?: string
	    catalogFingerprint?: string
	    catalogDrift?: boolean
	  }
  webProviders?: Array<Record<string, unknown>>
  skills?: {
    enabled?: boolean
    roots?: Array<Record<string, unknown>>
    skills?: Array<Record<string, unknown>>
    validationErrors?: Array<Record<string, unknown> | string>
    lastActivations?: Array<Record<string, unknown>>
  }
  attachments?: CoreAttachmentDiagnosticsJson
  memory?: CoreMemoryDiagnosticsJson
  subagents?: {
    enabled?: boolean
    active?: number
    childRuns?: Array<Record<string, unknown>>
  }
}

export type CoreRuntimeSkillJson = {
  id: string
  name: string
  description?: string
  version?: string
  root?: string
  scope?: 'project' | 'global'
  legacy?: boolean
  triggers?: {
    commands?: string[]
    promptPatterns?: string[]
    fileTypes?: string[]
  }
  allowedTools?: string[]
}

export type CoreRuntimeSkillsResponseJson = {
  enabled?: boolean
  roots?: string[]
  skills?: CoreRuntimeSkillJson[]
  validationErrors?: Array<Record<string, unknown> | string>
}

export type CoreChildRuntimeMetadataJson = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
}

export type CoreWebSourceJson = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type CoreTurnJson = {
  id: string
  threadId: string
  status: CoreTurnStatus
  prompt: string
  model?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  items?: CoreTurnItemJson[]
  attachmentIds?: string[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  error?: string
}

export type CoreTurnItemJson = {
  id: string
  turnId: string
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: CoreItemStatus
  createdAt: string
  finishedAt?: string
  kind: string
  text?: string
  displayText?: string
  toolName?: string
  callId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
  approvalId?: string
  inputId?: string
  prompt?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  summary?: string
  replacedTokens?: number
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  message?: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
  attachmentIds?: string[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  target?: CoreReviewTargetJson
  title?: string
  reviewText?: string
}

export type CoreReviewTargetJson =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type CoreReviewFindingJson = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type CoreReviewOutputJson = {
  findings: CoreReviewFindingJson[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

/**
 * Structured plan metadata the renderer expects on a successful
 * `create_plan` tool result. Mirrors the Kun output contract
 * so the Workbench can reload the saved plan file and update the
 * Plan panel without parsing assistant prose.
 */
export type CorePlanToolResultJson = {
  summary?: string
  plan_id: string
  workspace_root: string
  relative_path: string
  absolute_path?: string
  source_request?: string
  title?: string
  operation: 'draft' | 'refine'
  saved_at: string
  content_hash?: string
  byte_size?: number
}

export type CoreStartTurnResponseJson = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

export type CoreStartReviewResponseJson = CoreStartTurnResponseJson & {
  reviewItemId?: string
}

export type CoreAttachmentUploadResponseJson = {
  attachment: CoreAttachmentMetadataJson
}

export type CoreAttachmentContentResponseJson = {
  attachment: CoreAttachmentMetadataJson
  dataBase64: string
}

export type CoreMemoryListResponseJson = {
  memories: CoreMemoryRecordJson[]
}

export type CoreResumeSessionResponseJson = {
  thread_id?: string
  threadId?: string
  session_id?: string
  sessionId?: string
  message_count?: number
  summary?: string
}

/**
 * Optional plan context attached to a start-turn request. Carries the
 * reserved plan id, workspace root, and relative path the Kun
 * should expose to the model via the `create_plan` tool.
 */
export type CoreStartTurnPlanContextJson = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

/**
 * Native Kun plan tool name. Re-exported alongside the shared
 * constant for renderer consumers.
 */
export const CORE_PLAN_TOOL_NAME = GUI_PLAN_CREATE_PLAN_TOOL_NAME

export type CoreUsageSnapshotJson = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  cacheHitRate?: number
  turns?: number
  costUsd?: number
  costCny?: number
  tokenEconomySavingsTokens?: number
}

export type CoreRuntimeEventJson = {
  kind?: string
  seq?: number
  timestamp?: string
  threadId?: string
  turnId?: string
  itemId?: string
  item?: CoreTurnItemJson
  approvalId?: string
  approvalPolicy?: string
  sandboxMode?: string
  toolName?: string
  callId?: string
  readyCount?: number
  toolResultCount?: number
  recognizedCount?: number
  totalCount?: number
	  fingerprint?: string
	  toolCount?: number
	  changeKind?: 'additive' | 'breaking'
	  toolNames?: string[]
  status?: string
  stage?:
    | 'setup'
    | 'pre_start'
    | 'post_start'
    | 'input_received'
    | 'input_cached'
    | 'input_routed'
    | 'input_compressed'
    | 'input_remembered'
    | 'pre_send'
    | 'post_send'
    | 'response_received'
  label?: string
  details?: unknown
  summary?: string
  prompt?: string
  inputId?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  replacedTokens?: number
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  usage?: CoreUsageSnapshotJson
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  cleared?: boolean
  message?: string
  code?: string
  severity?: 'info' | 'warning' | 'error'
  child?: CoreChildRuntimeMetadataJson
}

export type RuntimeErrorJson = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}
