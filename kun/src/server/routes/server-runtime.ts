import type { ThreadService } from '../../services/thread-service.js'
import type { TurnService } from '../../services/turn-service.js'
import type { UsageService } from '../../services/usage-service.js'
import type { ReviewService } from '../../services/review-service.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { WorkspaceInspector } from '../../ports/workspace-inspector.js'
import type { ToolHost, ToolProviderPolicy } from '../../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { RuntimeInfoResponse } from '../../contracts/runtime-info.js'
import type { McpServerDiagnostic } from '../../adapters/tool/mcp-tool-provider.js'
import type { McpSearchRuntimeDiagnostic } from '../../adapters/tool/mcp-tool-search.js'
import type { WebProviderDiagnostic } from '../../adapters/tool/web-tool-provider.js'
import type { SkillRuntimeDiagnostics } from '../../skills/skill-runtime.js'
import type { AttachmentDiagnostics } from '../../contracts/attachments.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { MemoryDiagnostics } from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import type { ReviewTarget } from '../../contracts/review.js'

export type RuntimeToolDiagnostics = {
  providers: ToolProviderPolicy[]
  mcpServers: McpServerDiagnostic[]
  mcpSearch?: McpSearchRuntimeDiagnostic
  webProviders: WebProviderDiagnostic[]
  skills: SkillRuntimeDiagnostics
  attachments: AttachmentDiagnostics
  memory: MemoryDiagnostics
}

/**
 * Dependencies that the HTTP router needs. Bundled into a single
 * type so callers can compose the runtime from the in-memory or
 * file-backed adapters without leaking concrete types into routes.
 */
export type ServerRuntime = {
  threadService: ThreadService
  turnService: TurnService
  usageService: UsageService
  reviewService?: ReviewService
  eventBus: EventBus
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> | void
  runReview?(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  info(): RuntimeInfoResponse
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  skills?(): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  shutdown?(): Promise<void>
}
