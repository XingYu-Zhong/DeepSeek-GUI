import type { ApprovalPolicy } from '../contracts/policy.js'
import type { ApprovalRequest } from '../domain/approval.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type {
  UserInputRequest,
  UserInputResolution
} from './user-input-gate.js'

export type ToolProviderKind =
  | 'built-in'
  | 'mcp'
  | 'web'
  | 'skill'
  | 'memory'
  | 'gui'
  | 'delegation'

export type ToolProviderPolicy = {
  id: string
  kind: ToolProviderKind
  enabled: boolean
  available: boolean
  reason?: string
}

/**
 * Optional GUI plan context advertised by the renderer when starting
 * draft or refine plan turns. When present, Kun exposes the
 * `create_plan` tool to the model and gates the corresponding tool
 * adapter to this exact path/workspace. The struct is stable across
 * reconnects so replays reproduce the same gating.
 */
export type GuiPlanContext = {
  /** Operation that triggered the plan tool exposure. */
  operation: 'draft' | 'refine'
  /** Workspace root the plan must be written under. */
  workspaceRoot: string
  /** Reserved plan relative path the tool is allowed to write to. */
  relativePath: string
  /** Stable plan id; matches `GuiPlanArtifact.id` on the GUI side. */
  planId: string
  /** Original user request that originated the plan turn. */
  sourceRequest?: string
  /** Display title for the plan. */
  title?: string
  /** Optional turn id for debugging. */
  turnId?: string
}

export type ToolHostContext = {
  threadId: string
  turnId: string
  workspace: string
  /**
   * Thread mode advertised by the GUI. Kun restricts plan tools
   * to `plan` threads plus `planDraft`/`planRefine` turn kinds. The
   * field is optional for backward compatibility with older call sites.
   */
  threadMode?: 'agent' | 'plan'
  /** Optional GUI plan context (see above). */
  guiPlan?: GuiPlanContext
  /** Active model capability metadata used by capability-aware providers. */
  model?: ModelCapabilityMetadata
  /** Skill ids activated for this turn, if the Skill runtime is enabled. */
  activeSkillIds?: readonly string[]
  /** Optional memory recall/mutation policy for this turn. */
  memoryPolicy?: {
    enabled: boolean
    scopes?: readonly string[]
  }
  /** Optional delegation policy for this turn. */
  delegationPolicy?: {
    enabled: boolean
    maxParallel?: number
    maxChildRuns?: number
  }
  /** Optional provider allow-list. When set, other providers are not advertised or executed. */
  allowedProviderIds?: readonly string[]
  /** Optional tool-name allow-list. When set, other tools are not advertised or executed. */
  allowedToolNames?: readonly string[]
  approvalPolicy: ApprovalPolicy
  abortSignal: AbortSignal
  /** Resolves a pending approval with the user's decision. */
  awaitApproval: (approval: ApprovalRequest) => Promise<'allow' | 'deny'>
  /** Resolves structured GUI input requested by a tool call. */
  awaitUserInput?: (
    input: Omit<UserInputRequest, 'threadId' | 'turnId'>
  ) => Promise<UserInputResolution>
}

export type ToolCallLike = {
  callId: string
  toolName: string
  providerId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments: Record<string, unknown>
}

export type ToolExecutionUpdate = {
  output: unknown
  isError?: boolean
}

export type ToolHostResult = {
  item: TurnItem
  /** True if the call was decided by an approval. */
  approved: boolean
}

/**
 * Port for executing tool calls. The local tool host uses approval
 * boundaries and abort-signal cancellation; a remote host can fan out
 * to a sandboxed environment. The loop and tests only see the port.
 */
export interface ToolHost {
  readonly id: string
  /**
   * List tools available for the current turn. Tool hosts MAY scope
   * the list by mode/GUI plan context (e.g. only expose `create_plan`
   * during plan turns) so the model is not tempted to call gated
   * tools in normal agent turns.
   */
  listTools(context?: ToolHostContext): Promise<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    toolKind?: 'tool_call' | 'command_execution' | 'file_change'
    providerId?: string
    providerKind?: ToolProviderKind
  }[]>
  execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult>
  /** Optional runtime hygiene hook used when compaction/discard invalidates read context. */
  clearReadTracker?(threadId?: string): void
}
