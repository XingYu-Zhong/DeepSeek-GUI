import { create } from 'zustand'
import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildClawRuntimePrompt, getActiveAgentApiKey } from '@shared/app-settings'
import type {
  AppRoute,
  ChatState,
  InitialSetupMode,
  PluginHostRoute,
  QueuedUserMessage,
  SendMessageOverrides,
  SettingsRouteSection
} from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'
import { createClawActions } from './chat-store-claw-actions'
import { createSideActions } from './chat-store-side-actions'
import {
  activeClawChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  mergeComposerPickList,
  newClawChannel,
  normalizeClawComposerModel,
  optimisticUserModelLabel,
  persistComposerModel,
  readCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { createNavigationActions } from './chat-store-navigation-actions'
import { createThreadActions } from './chat-store-thread-actions'
import { createMaintenanceActions } from './chat-store-maintenance-actions'

export type { AppRoute, SettingsRouteSection } from './chat-store-types'
export { CLAW_COMPOSER_MODEL_IDS } from './chat-store-helpers'

let sseAbort: AbortController | null = null
const sseAbortRef = {
  get current(): AbortController | null {
    return sseAbort
  },
  set current(value: AbortController | null) {
    sseAbort = value
  }
}
let composerModelLoadPromise: Promise<void> | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  route: 'chat',
  settingsReturnRoute: 'chat',
  pluginHostRoute: 'chat',
  settingsSection: 'general',
  initialSetupOpen: false,
  initialSetupMode: 'required',
  workspaceRoot: '',
  workspaceLabel: i18n.t('common:workingDirectory'),
  runtimeConnection: 'idle',
  codeWorkspaceRoots: [],
  threads: [],
  threadSearch: '',
  showArchivedThreads: false,
  activeThreadId: null,
  activeThreadGoal: null,
  activeThreadTodos: null,
  blocks: [],
  liveReasoning: '',
  liveAssistant: '',
  lastSeq: 0,
  usageRefreshKey: 0,
  busy: false,
  error: null,
  runtimeErrorDetail: null,
  currentTurnId: null,
  currentTurnUserId: null,
  turnStartedAtByUserId: {},
  turnDurationByUserId: {},
  turnReasoningFirstAtByUserId: {},
  turnReasoningLastAtByUserId: {},
  inspectorSelectedId: null,
  composerModel: '',
  composerPickList: mergeComposerPickList(false, []),
  composerModelGroups: [],
  queuedMessages: [],
  watchTurnCompletion: {},
  unreadThreadIds: {},
  sideConversations: {},
  sidePanel: { open: false, activeSideId: null },
  clawChannels: [],
  activeClawChannelId: '',

  ...createClawActions({
    set,
    get,
    i18n,
    getProvider,
    newClawChannel,
    normalizeClawComposerModel,
    activeClawChannel,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined),
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  }),

  ...createAppActions({
    set,
    get,
    i18n,
    persistComposerModel,
    readStoredComposerModel,
    mergeComposerPickList,
    getComposerModelLoadPromise: () => composerModelLoadPromise,
    setComposerModelLoadPromise: (promise) => {
      composerModelLoadPromise = promise
    },
    applyTheme,
    applyUiFontScale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined)
  }),

  ...createSideActions({
    set,
    get,
    getProvider,
    t: (key) => i18n.t(key),
    formatRuntimeError,
    shouldOpenSettingsForError
  }),

  ...createNavigationActions({ set, get, sseAbortRef }),

  ...createThreadActions({ set, get, sseAbortRef }),

  ...createMaintenanceActions({ set, get, sseAbortRef })
}))
