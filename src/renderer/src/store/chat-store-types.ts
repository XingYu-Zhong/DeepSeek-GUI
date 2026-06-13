import type {
  AttachmentReference,
  ChatBlock,
  NormalizedThread,
  RuntimeConnectionStatus,
  ReviewTarget,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoStatus,
  UserInputAnswer
} from '../agent/types'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel
} from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export type QueuedUserMessage = {
  id: string
  text: string
  displayText?: string
  mode?: string
  model?: string
  providerId?: string
  modelLabel?: string
  reasoningEffort?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  /**
   * Optional GUI plan context forwarded to Kun. The renderer
   * attaches it for plan/refine turns so the runtime can advertise
   * the native `create_plan` tool and gate the write to the reserved
   * plan artifact.
   */
  guiPlan?: {
    operation: 'draft' | 'refine'
    workspaceRoot: string
    relativePath: string
    planId: string
    sourceRequest?: string
    title?: string
  }
}

/**
 * GUI plan context attached to a send-message call. Mirrors the
 * Kun `GuiPlanContextSchema` and is forwarded to the runtime
 * request body so plan/refine turns are scoped to a reserved path.
 */
export type GuiPlanMessageContext = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type SendMessageOverrides = {
  queued?: QueuedUserMessage
  model?: string
  providerId?: string
  modelLabel?: string
  reasoningEffort?: string
  displayText?: string
  guiPlan?: GuiPlanMessageContext
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
}

export type InitialSetupMode = 'required' | 'preview'
export type SettingsRouteSection =
  | 'general'
  | 'providers'
  | 'write'
  | 'imageInput'
  | 'imageGeneration'
  | 'mediaGeneration'
  | 'speechToText'
  | 'agents'
  | 'permissions'
  | 'skill'
  | 'mcp'
  | 'shortcuts'
  | 'easterEgg'
  | 'claw'
  | 'updates'
export type AppRoute = 'chat' | 'write' | 'settings' | 'plugins' | 'claw' | 'schedule'
export type PluginHostRoute = 'chat' | 'claw'

/**
 * A side conversation ("by-the-way") running alongside the active
 * thread. It owns its own timeline, composer, busy state, and SSE
 * subscription so it can stream in parallel with the main thread.
 *
 * The slice is namespaced under `sideConversations[threadId]` and
 * MUST NOT mutate any main-thread state (`activeThreadId`, `blocks`,
 * `busy`, etc.) — isolation is structural.
 */
export type SideConversation = {
  threadId: string
  parentThreadId: string
  title: string
  createdAt: string
  /** Timestamp the snapshot was taken from the parent. */
  inheritedAt: string
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  lastSeq: number
  input: string
  model: string
  reasoningEffort: string
  busy: boolean
  turnId: string | null
  userItemId: string | null
  error: string | null
}

export type SidePanelState = {
  open: boolean
  activeSideId: string | null
}

export type ChatState = {
  route: AppRoute
  settingsReturnRoute: Exclude<AppRoute, 'settings'>
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  workspaceRoot: string
  workspaceLabel: string
  runtimeConnection: RuntimeConnectionStatus
  runtimeStatus: KunRuntimeStatusPayload | null
  codeWorkspaceRoots: string[]
  threads: NormalizedThread[]
  threadSearch: string
  showArchivedThreads: boolean
  activeThreadId: string | null
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  lastSeq: number
  usageRefreshKey: number
  busy: boolean
  error: string | null
  runtimeErrorDetail: string | null
  currentTurnId: string | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  inspectorSelectedId: string | null
  composerModel: string
  composerProviderId: string
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
  disabledSkillIds: string[]
  queuedMessages: QueuedUserMessage[]
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  /**
   * Side conversations opened via `/btw`. The main thread selection
   * and subscription are never touched by these entries.
   */
  sideConversations: Record<string, SideConversation>
  sidePanel: SidePanelState
  clawChannels: ClawImChannelV1[]
  activeClawChannelId: string
  appendLocalClawTurn: (userText: string, replyText: string) => void
  setError: (message: string | null) => void
  setComposerModel: (modelId: string, providerId?: string) => void
  loadComposerModels: () => Promise<void>
  setRoute: (r: AppRoute) => void
  openWrite: () => Promise<void>
  openCode: () => Promise<void>
  ensureWriteThreadForWorkspace: (workspaceRoot?: string) => Promise<string | null>
  createWriteThread: (workspaceRoot?: string) => Promise<string | null>
  selectWriteThread: (threadId: string, workspaceRoot?: string) => Promise<void>
  openSettings: (section?: SettingsRouteSection) => void
  openPlugins: (host?: PluginHostRoute) => void
  openClaw: () => void
  openSchedule: () => void
  refreshClawChannels: () => Promise<void>
  addClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: string
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<ClawImSettingsV1>
      preserveRoute?: boolean
    }
  ) => Promise<void>
  selectClawChannel: (channelId: string) => Promise<void>
  selectClawConversation: (channelId: string, threadId: string) => Promise<void>
  deleteClawChannel: (channelId: string) => Promise<void>
  resetClawChannelSession: (channelId: string) => Promise<void>
  setClawChannelModel: (channelId: string, model: string) => Promise<void>
  openInitialSetup: (mode?: InitialSetupMode) => void
  closeInitialSetup: () => void
  boot: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background', options?: { restart?: boolean }) => Promise<void>
  chooseWorkspace: (options?: { createThreadAfter?: boolean; selectThreadAfter?: boolean }) => Promise<string | null>
  selectWorkspaceRoot: (workspaceRoot: string) => Promise<string | null>
  clearWorkspace: () => Promise<void>
  deleteWorkspace: (workspacePath: string) => Promise<void>
  refreshThreads: () => Promise<void>
  setThreadSearch: (query: string) => void
  setShowArchivedThreads: (show: boolean) => void
  createThread: (options?: { workspaceRoot?: string; forceNew?: boolean }) => Promise<void>
  selectThread: (id: string) => Promise<void>
  recoverActiveTurn: () => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  reviewActiveThread: (target: ReviewTarget) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  removeQueuedMessage: (id: string) => void
  rewindAndResend: (userBlockId: string, newText: string) => Promise<void>
  interrupt: (options?: { discard?: boolean }) => Promise<void>
  renameActiveThread: (title: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  archiveThread: (threadId: string, archived: boolean) => Promise<void>
  compactActiveThread: (reason?: string) => Promise<void>
  forkActiveThread: () => Promise<void>
  setActiveThreadGoal: (objective: string) => Promise<boolean>
  setActiveThreadGoalStatus: (status: ThreadGoalStatus) => Promise<boolean>
  clearActiveThreadGoal: () => Promise<boolean>
  setActiveThreadTodoStatus: (todoId: string, status: ThreadTodoStatus) => Promise<boolean>
  clearActiveThreadTodos: () => Promise<boolean>
  syncPlanTodosFromMarkdown: (
    plan: { id: string; relativePath: string },
    markdown: string
  ) => Promise<boolean>
  /**
   * Spawn a side conversation from the active thread. Available even
   * while the active thread is running. Does not change `activeThreadId`.
   * If `seedText` is provided, immediately sends it as the first turn.
   */
  spawnSideConversation: (seedText?: string) => Promise<string | null>
  /**
   * Open the side chat surface without creating an underlying side
   * thread. The first draft send will create the side thread.
   */
  openSideConversationDraft: () => void
  sendSideMessage: (sideId: string, text: string) => Promise<boolean>
  interruptSide: (sideId: string) => Promise<void>
  setSideInput: (sideId: string, text: string) => void
  setSideModel: (sideId: string, model: string) => void
  setSideReasoningEffort: (sideId: string, effort: string) => void
  selectSideConversation: (sideId: string) => void
  setSidePanelOpen: (open: boolean) => void
  closeSideConversation: (sideId: string) => Promise<void>
  discardSideConversation: (sideId: string) => Promise<void>
  promoteSideConversation: (sideId: string) => Promise<void>
  resumeSessionIntoThread: (
    sessionId: string,
    options?: { model?: string; mode?: string }
  ) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  selectInspectorItem: (id: string | null) => void
  applyI18nFromSettings: (locale: 'en' | 'zh') => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
