import type { ReactElement } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  modelSupportsImageInput,
  getKunRuntimeSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type ModelProviderModelProfileV1,
  type SandboxMode
} from '@shared/app-settings'
import { parseClawCommand } from '@shared/claw-commands'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import { buildGuiPlanId, buildPlanRelativePath } from '@shared/gui-plan'
import { sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot } from '@shared/sdd-trace'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutCommandId
} from '@shared/keyboard-shortcuts'
import type { DesktopCommand, ModelProviderModelGroup, SkillListItem } from '@shared/kun-gui-api'
import type { WriteRetrievalContext } from '@shared/write-retrieval'
import type { ClipboardImageReadResult } from '@shared/workspace-file'
import type { AttachmentReference, ChatBlock, NormalizedThread } from '../agent/types'
import type { CoreRuntimeInfoJson, CoreRuntimeSkillJson } from '../agent/kun-contract'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import { isClawThread, providerIdForComposerModel } from '../store/chat-store-helpers'
import { threadHasPendingRuntimeWork } from '../store/chat-store-runtime-helpers'
import {
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls
} from '../lib/dev-preview-detection'
import { Sidebar } from './chat/Sidebar'
import { WorkbenchTopBar, type RightPanelMode } from './chat/WorkbenchTopBar'
import { MessageTimeline } from './chat/MessageTimeline'
import { IkunCameoLayer, KunCelebrationLayer } from './chat/AnimatedWorkLogo'
import {
  FloatingComposer,
  type ComposerExecutionSettings,
  type ComposerFileReference
} from './chat/FloatingComposer'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from './chat/FloatingComposerModelPicker'
import { SideConversationPanel } from './chat/SideConversationPanel'
import { SessionHeader } from './SessionHeader'
import { WriteWorkspaceView } from './write/WriteWorkspaceView'
import { WriteAssistantPanel } from './write/WriteAssistantPanel'
import { WriteSidebar } from './write/WriteSidebar'
import { SddAssistantPanel } from './sdd/SddAssistantPanel'
import { SddDraftEditorView } from './sdd/SddDraftEditorView'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
import { composeWritePrompt } from '../write/quoted-selection'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { isWriteThreadId } from '../write/write-thread-registry'
import { buildSddDraftId, createSddDraft, forgetRememberedSddDraft, useSddDraftStore } from '../sdd/sdd-draft-store'
import type { SddDraft, SddDraftSaveStatus } from '../sdd/sdd-draft-store'
import { listSddDraftHistory, titleFromSddDraftContent } from '../sdd/sdd-draft-history'
import { saveActiveSddDraftToDisk } from '../sdd/sdd-draft-actions'
import { restoreRememberedSddDraft, restoreSddDraft } from '../sdd/sdd-draft-restore'
import { composeSddAssistantPrompt } from '../sdd/sdd-assistant-prompt'
import { collectSddDraftImages, withAttachmentIds, type SddDraftImageReference } from '../sdd/sdd-draft-images'
import { PENDING_INFOGRAPHIC_PROTOCOL } from '../write/infographic-pending'
import { buildSddDraftToPlanPrompt } from '../sdd/sdd-plan-prompt'
import {
  isSddAssistantThread,
  isEmptySddAssistantThreadCandidate,
  markSddAssistantThread,
  releaseSddAssistantThread,
  sddAssistantThreadIdForDraft
} from '../sdd/sdd-thread-registry'
import {
  refreshSddChatTranscriptFromProvider,
  sddDraftRefForThreadId,
  writeSddChatTranscriptForThread
} from '../sdd/sdd-chat-transcript'
import { parseGuiPlanCommand } from '../plan/plan-command'
import { confirmDialog } from '../lib/confirm-dialog'
import { DevPreviewLaunchCard } from './DevPreviewLaunchCard'
import { RuntimeBanner } from './RuntimeBanner'
import { useWorkbenchLayout } from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { prepareImageAttachmentUpload } from '../lib/image-attachment-upload'
import { isChatAttachmentUploadEnabled } from '../lib/attachment-upload-availability'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { SETTINGS_CHANGED_EVENT, useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import { collectComposerChangeSummary } from '../lib/composer-change-summary'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { useUiModeCameosEnabled, useUiPluginStore } from '../store/ui-plugin-store'
import { readFocusModePreference, writeFocusModePreference } from '../lib/focus-mode'
import {
  buildComposerFileContextPrompt,
  mergeComposerFileReferences,
  type ComposerFileContextEntry
} from '../lib/composer-file-references'
import { resolveWriteRuntimeBannerMessage } from '../lib/write-runtime-banner'

const ChangeInspector = lazy(() =>
  import('./ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('./DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const PluginMarketplaceView = lazy(() =>
  import('./PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const WorkspaceFilePreviewPanel = lazy(() =>
  import('./WorkspaceFilePreviewPanel').then((module) => ({
    default: module.WorkspaceFilePreviewPanel
  }))
)
const PlanPanel = lazy(() =>
  import('./plan/PlanPanel').then((module) => ({ default: module.PlanPanel }))
)
const TodoPanel = lazy(() =>
  import('./todo/TodoPanel').then((module) => ({ default: module.TodoPanel }))
)
const ScheduleTasksView = lazy(() =>
  import('./schedule/ScheduleTasksView').then((module) => ({ default: module.ScheduleTasksView }))
)

type PendingSddPlanTarget = {
  planId: string
  relativePath: string
  workspaceRoot: string
}

const COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE = 60_000
const COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS = 180_000
const SDD_ASSISTANT_TITLE_SYNC_DELAY_MS = 900
const DESKTOP_SHORTCUT_COMMANDS: Partial<Record<KeyboardShortcutCommandId, DesktopCommand>> = {
  quit: 'quit',
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
  reload: 'reload',
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  'reset-zoom': 'resetZoom',
  'toggle-devtools': 'toggleDevTools',
  close: 'close',
  minimize: 'minimize',
  'toggle-maximize': 'toggleMaximize'
}

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function modelProfileForGroup(
  group: ModelProviderModelGroup,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

function modelProfileForSelection(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId?: string
): ModelProviderModelProfileV1 | undefined {
  const selectedProviderId = providerId?.trim()
  if (selectedProviderId) {
    const selectedGroup = groups.find((group) => group.providerId === selectedProviderId)
    if (selectedGroup) {
      const profile = modelProfileForGroup(selectedGroup, modelId)
      if (profile) return profile
    }
  }
  for (const group of groups) {
    const profile = modelProfileForGroup(group, modelId)
    if (profile) return profile
  }
  return undefined
}

function fileNameFromPath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'image'
}

function clipComposerFileContext(
  content: string,
  remainingChars: number,
  sourceTruncated: boolean
): { content: string; truncated: boolean; consumed: number } {
  const limit = Math.max(0, Math.min(COMPOSER_FILE_CONTEXT_MAX_CHARS_PER_FILE, remainingChars))
  const clipped = content.slice(0, limit)
  return {
    content: clipped,
    truncated: sourceTruncated || clipped.length < content.length,
    consumed: clipped.length
  }
}

function sddDraftPlanRelativePath(draft: SddDraft): string {
  const parts = draft.relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  const draftFolder = parts.at(-2)?.trim() || draft.id.split(':').pop()?.trim() || `draft-${Date.now()}`
  return buildPlanRelativePath(`sdd-${draftFolder}`)
}

function sddDraftSourceRequest(markdown: string, fallbackPath: string): string {
  const firstMeaningfulLine = markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return (firstMeaningfulLine || fallbackPath).slice(0, 160)
}

function sddAssistantThreadTitle(markdown: string, fallback: string): string {
  return titleFromSddDraftContent(markdown, fallback).trim() || fallback
}

function sddPlanMatchesPendingTarget(
  plan: { id: string; workspaceRoot: string; relativePath: string } | null,
  target: PendingSddPlanTarget | null
): boolean {
  if (!plan || !target) return false
  if (plan.id === target.planId) return true
  return buildGuiPlanId(plan.workspaceRoot, plan.relativePath) === target.planId
}

function mergeSkillCommands(
  runtimeSkills: CoreRuntimeSkillJson[],
  localSkills: SkillListItem[]
): CoreRuntimeSkillJson[] {
  const merged = new Map<string, CoreRuntimeSkillJson>()
  for (const skill of localSkills) {
    merged.set(skill.id, {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      root: skill.root,
      legacy: skill.legacy,
      scope: skill.scope
    })
  }
  for (const skill of runtimeSkills) {
    const existing = merged.get(skill.id)
    merged.set(skill.id, existing ? {
      ...skill,
      ...existing,
      triggers: skill.triggers ?? existing.triggers,
      allowedTools: skill.allowedTools ?? existing.allowedTools
    } : skill)
  }
  return [...merged.values()]
}

function sddAssistantContextFromBlocks(blocks: ChatBlock[], maxMessages = 10): string {
  const messages: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'user' && block.kind !== 'assistant') continue
    if (block.kind === 'user' && block.meta?.displayText) continue
    const text = block.text.trim()
    if (!text) continue
    messages.push(`${block.kind === 'user' ? 'User' : 'Requirement AI'}:\n${text}`)
  }
  return messages.slice(-maxMessages).join('\n\n').slice(0, 12_000)
}

function base64ImageToFile(image: SddDraftImageReference): File {
  return base64ToFile(image.dataBase64, fileNameFromPath(image.relativePath), image.mimeType)
}

function clipboardImageToFile(image: Extract<ClipboardImageReadResult, { ok: true }>): File {
  return base64ToFile(image.dataBase64, image.name, image.mimeType)
}

function base64ToFile(dataBase64: string, name: string, mimeType: string): File {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], name || 'image', { type: mimeType })
}

export function Workbench(): ReactElement {
  const { t } = useTranslation('common')
  const {
    threads,
    threadSearch,
    showArchivedThreads,
    activeThreadId,
    selectThread,
    createThread,
    blocks,
    liveReasoning,
    liveAssistant,
    error,
    runtimeErrorDetail,
    busy,
    route,
    pluginHostRoute,
    workspaceRoot,
    runtimeConnection,
    setRoute,
    openCode,
    openWrite,
    ensureWriteThreadForWorkspace,
    createWriteThread,
    openSettings,
    openPlugins,
    openClaw,
    openSchedule,
    chooseWorkspace,
    clawChannels,
    activeClawChannelId,
    selectClawChannel,
    resetClawChannelSession,
    setClawChannelModel,
    appendLocalClawTurn,
    setError,
    sendMessage,
    reviewActiveThread,
    queuedMessages,
    removeQueuedMessage,
    interrupt,
    probeRuntime,
    composerModel,
    composerProviderId,
    composerPickList,
    composerModelGroups,
    disabledSkillIds,
    setComposerModel,
    setThreadSearch,
    setShowArchivedThreads,
    renameThread,
    archiveThread,
    deleteThread,
    spawnSideConversation,
    openSideConversationDraft,
    selectSideConversation,
    setSidePanelOpen,
    sideConversations,
    sidePanel
  } = useChatStore(
    useShallow((s) => ({
      threads: s.threads,
      threadSearch: s.threadSearch,
      showArchivedThreads: s.showArchivedThreads,
      activeThreadId: s.activeThreadId,
      selectThread: s.selectThread,
      createThread: s.createThread,
      blocks: s.blocks,
      liveReasoning: s.liveReasoning,
      liveAssistant: s.liveAssistant,
      error: s.error,
      runtimeErrorDetail: s.runtimeErrorDetail,
      busy: s.busy,
      route: s.route,
      pluginHostRoute: s.pluginHostRoute,
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      setRoute: s.setRoute,
      openCode: s.openCode,
      openWrite: s.openWrite,
      ensureWriteThreadForWorkspace: s.ensureWriteThreadForWorkspace,
      createWriteThread: s.createWriteThread,
      openSettings: s.openSettings,
      openPlugins: s.openPlugins,
      openClaw: s.openClaw,
      openSchedule: s.openSchedule,
      chooseWorkspace: s.chooseWorkspace,
      clawChannels: s.clawChannels,
      activeClawChannelId: s.activeClawChannelId,
      selectClawChannel: s.selectClawChannel,
      resetClawChannelSession: s.resetClawChannelSession,
      setClawChannelModel: s.setClawChannelModel,
      appendLocalClawTurn: s.appendLocalClawTurn,
      setError: s.setError,
      sendMessage: s.sendMessage,
      reviewActiveThread: s.reviewActiveThread,
      queuedMessages: s.queuedMessages,
      removeQueuedMessage: s.removeQueuedMessage,
      interrupt: s.interrupt,
      probeRuntime: s.probeRuntime,
      composerModel: s.composerModel,
      composerProviderId: s.composerProviderId,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      disabledSkillIds: s.disabledSkillIds,
      setComposerModel: s.setComposerModel,
      setThreadSearch: s.setThreadSearch,
      setShowArchivedThreads: s.setShowArchivedThreads,
      renameThread: s.renameThread,
      archiveThread: s.archiveThread,
      deleteThread: s.deleteThread,
      spawnSideConversation: s.spawnSideConversation,
      openSideConversationDraft: s.openSideConversationDraft,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      sideConversations: s.sideConversations,
      sidePanel: s.sidePanel
    }))
  )
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const [composerReasoningEffort, setComposerReasoningEffort] =
    useState<ComposerReasoningEffort>('max')
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [imageRecognitionSettings, setImageRecognitionSettings] =
    useState<AppSettingsV1['agents']['kun']['imageRecognition'] | null>(null)
  const [legacyImageRecognitionEnabledAt] = useState(() => new Date().toISOString())
  const [runtimeSkills, setRuntimeSkills] = useState<CoreRuntimeSkillJson[]>([])
  const [composerAttachments, setComposerAttachments] = useState<AttachmentReference[]>([])
  const [composerFileReferences, setComposerFileReferences] = useState<ComposerFileReference[]>([])
  const [composerExecutionSettings, setComposerExecutionSettings] =
    useState<ComposerExecutionSettings | null>(null)
  const [composerExecutionApplying, setComposerExecutionApplying] = useState(false)
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const [connectPhoneSidebarOpen, setConnectPhoneSidebarOpen] = useState(false)
  const initUiPlugins = useUiPluginStore((s) => s.initUiPlugins)
  const uiModeCameosEnabled = useUiModeCameosEnabled()
  const [focusModeEnabled, setFocusModeEnabled] = useState(readFocusModePreference)
  const [runtimeLogPath, setRuntimeLogPath] = useState('')
  const [planPanelOverlayPreferred, setPlanPanelOverlayPreferred] = useState(false)
  const writeAssistantOpen = useWriteWorkspaceStore((s) => s.assistantOpen)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const writeAssistantProviderId = useWriteWorkspaceStore((s) => s.assistantProviderId)
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const activeSddDraft = useSddDraftStore((s) => s.activeDraft)
  const sddDraftContent = useSddDraftStore((s) => s.content)
  const sddDraftOperationStatus = useSddDraftStore((s) => s.operationStatus)
  const writeAssistantPickList = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
      const normalized = id.trim()
      if (normalized && normalized.toLowerCase() !== 'auto') ordered.add(normalized)
    }
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized && normalized.toLowerCase() !== 'auto') ordered.add(normalized)
    }
    const current = writeAssistantModel.trim()
    if (current && current.toLowerCase() !== 'auto') ordered.add(current)
    return [...ordered]
  }, [composerPickList, writeAssistantModel])
  const resolvedWriteAssistantProviderId = useMemo(() => {
    const stored = writeAssistantProviderId.trim()
    if (stored) {
      const group = composerModelGroups.find((item) => item.providerId === stored)
      const modelKey = normalizeModelCapabilityKey(writeAssistantModel)
      const storedMatchesModel =
        !modelKey ||
        group?.modelIds.some((modelId) => normalizeModelCapabilityKey(modelId) === modelKey) === true
      if (group && storedMatchesModel) return stored
    }
    return providerIdForComposerModel(composerModelGroups, writeAssistantModel)
  }, [composerModelGroups, writeAssistantModel, writeAssistantProviderId])
  const stageInsetClass = 'ds-stage-inset'
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const keyboardShortcutBindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts),
    [keyboardShortcuts]
  )

  const draftByThread = useRef<Record<string, string>>({})
  const prevThreadId = useRef<string | null>(null)
  const inputRef = useRef('')
  const sddUpgradeInFlightRef = useRef(false)
  const sddUpgradeTargetRef = useRef<PendingSddPlanTarget | null>(null)
  const sddTitleSyncTimerRef = useRef<number | null>(null)
  const lastSyncedSddTitleRef = useRef<Record<string, string>>({})
  const timelineBlocks = blocks
  const timelineLiveReasoning = liveReasoning
  const timelineLiveAssistant = liveAssistant
  const devPreviewBlocks = useMemo<ChatBlock[]>(() => {
    const liveText = timelineLiveAssistant.trim()
    if (!liveText) return timelineBlocks
    return [
      ...timelineBlocks,
      {
        kind: 'assistant',
        id: '__live-assistant-dev-preview',
        text: timelineLiveAssistant
      }
    ]
  }, [timelineBlocks, timelineLiveAssistant])
  const detectedDevPreviewUrls = useMemo(
    () => extractLatestTurnDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const autoOpenDevPreviewUrls = useMemo(
    () => extractLatestTurnAutoOpenDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeSkillWorkspace = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot || '',
    [activeThreadId, threads, workspaceRoot]
  )
  const composerChangeSummary = useMemo(
    () => collectComposerChangeSummary(timelineBlocks, activeSkillWorkspace),
    [activeSkillWorkspace, timelineBlocks]
  )
  const latestDevPreviewUrl = detectedDevPreviewUrls[0] ?? null
  const latestAutoOpenDevPreviewUrl = autoOpenDevPreviewUrls[0] ?? null
  const currentSideConversations = useMemo(
    () =>
      Object.values(sideConversations)
        .filter((side) => side.parentThreadId === activeThreadId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [activeThreadId, sideConversations]
  )
  const currentSideRunningCount = currentSideConversations.reduce(
    (count, side) => count + (side.busy ? 1 : 0),
    0
  )
  const {
    beginLeftResize,
    beginRightResize,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setRightPanelMode,
    setRightSidebarWidth,
    shellRef,
    toggleLeftSidebar,
    toggleRightPanelMode,
  } = useWorkbenchLayout({
    activeThreadId,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    route,
    workspaceRoot,
    writeAssistantOpen
  })
  const titleForSddDraft = useCallback((draft: SddDraft): string => {
    const snapshot = useSddDraftStore.getState()
    const markdown = snapshot.activeDraft?.id === draft.id ? snapshot.content : ''
    return sddAssistantThreadTitle(markdown, t('sddUntitledRequirement'))
  }, [t])
  const renameSddAssistantThreadToDraft = useCallback(async (
    threadId: string,
    draft: SddDraft
  ): Promise<void> => {
    const targetId = threadId.trim()
    const nextTitle = titleForSddDraft(draft)
    if (!targetId || !nextTitle || runtimeConnection !== 'ready') return
    const currentTitle = useChatStore.getState().threads.find((thread) => thread.id === targetId)?.title.trim()
    if (currentTitle === nextTitle || lastSyncedSddTitleRef.current[targetId] === nextTitle) return
    try {
      await getProvider().renameThread(targetId, nextTitle)
      lastSyncedSddTitleRef.current[targetId] = nextTitle
      useChatStore.setState((state) => ({
        threads: state.threads.map((thread) =>
          thread.id === targetId ? { ...thread, title: nextTitle } : thread
        )
      }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [runtimeConnection, setError, titleForSddDraft])
  const {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    replanChangedRequirements,
    sendPlanTurn,
    verifyGuiPlan
  } = useWorkbenchPlanController({
    blocks,
    busy,
    mode,
    route,
    sendMessage,
    setError,
    setMode,
    setRightPanelMode,
    setRightSidebarWidth,
    t,
    workspaceRoot,
    onPlanBuildStarted: async (plan) => {
      const threadId = plan.threadId?.trim() || useChatStore.getState().activeThreadId
      const draft = useSddDraftStore.getState().activeDraft
      if (!threadId) return
      if (draft) await renameSddAssistantThreadToDraft(threadId, draft)
      if (!releaseSddAssistantThread(threadId)) return
      await useChatStore.getState().refreshThreads()
    }
  })
  const planPanelInOverlay =
    route === 'chat' &&
    !activeSddDraft &&
    rightPanelMode === 'plan' &&
    planPanelOverlayPreferred

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 900px), (orientation: portrait)')
    const sync = (): void => setPlanPanelOverlayPreferred(media.matches)
    sync()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }
    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  useEffect(() => {
    if (!planPanelInOverlay) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setRightPanelMode(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [planPanelInOverlay, setRightPanelMode])

  useEffect(() => {
    const runDesktopShortcut = (command: DesktopCommand): void => {
      if (typeof window.kunGui?.runDesktopCommand !== 'function') return
      void window.kunGui.runDesktopCommand(command)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      const commandId = findKeyboardShortcutCommand(
        keyboardShortcutBindings,
        keyboardEventToShortcut(event)
      )
      if (!commandId) return
      event.preventDefault()

      if (commandId === 'toggle-plan-mode') {
        if (mode === 'plan') {
          setMode('agent')
        } else {
          setMode('plan')
          void handleGuiPlanCommand()
        }
        return
      }
      if (commandId === 'new-chat') {
        void createThread()
        return
      }
      if (commandId === 'choose-workspace') {
        void chooseWorkspace()
        return
      }
      if (commandId === 'settings') {
        openSettings()
        return
      }

      const desktopCommand = DESKTOP_SHORTCUT_COMMANDS[commandId]
      if (desktopCommand) runDesktopShortcut(desktopCommand)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    chooseWorkspace,
    createThread,
    handleGuiPlanCommand,
    keyboardShortcutBindings,
    mode,
    openSettings,
    setMode
  ])
  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.kunGui?.getLogPath !== 'function') return
    let cancelled = false
    void window.kunGui
      .getLogPath()
      .then((path) => {
        if (!cancelled) setRuntimeLogPath(path)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 形象工坊:读取偏好、应用 DOM 属性/token,并在插件模式下加载图集
    void initUiPlugins()
  }, [initUiPlugins])

  useEffect(() => {
    let cancelled = false
    const applySettings = (settings: AppSettingsV1): void => {
      if (!cancelled) setImageRecognitionSettings(getKunRuntimeSettings(settings).imageRecognition)
    }
    void rendererRuntimeClient.getSettings()
      .then(applySettings)
      .catch(() => undefined)
    const onSettingsChanged = (event: Event): void => {
      applySettings((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-focus-mode', focusModeEnabled ? 'on' : 'off')
  }, [focusModeEnabled])

  const updateFocusMode = (enabled: boolean): void => {
    writeFocusModePreference(enabled)
    setFocusModeEnabled(enabled)
  }

  useEffect(() => {
    const previousThreadId = prevThreadId.current
    prevThreadId.current = activeThreadId
    if (previousThreadId !== null && previousThreadId !== activeThreadId && sidePanel.open) {
      setSidePanelOpen(false)
    }
  }, [activeThreadId, setSidePanelOpen, sidePanel.open])

  const openSideChat = (): void => {
    const latestSide = currentSideConversations.at(-1)
    if (latestSide) {
      selectSideConversation(latestSide.threadId)
      return
    }
    openSideConversationDraft()
  }

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient.getSettings()
      .then((settings) => {
        if (cancelled) return
        setComposerExecutionSettings({
          approvalPolicy: settings.agents.kun.approvalPolicy,
          sandboxMode: settings.agents.kun.sandboxMode
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const updateComposerExecutionSettings = (patch: Partial<ComposerExecutionSettings>): void => {
    if (!composerExecutionSettings || composerExecutionApplying) return
    const previous = composerExecutionSettings
    const next = { ...previous, ...patch }
    setComposerExecutionSettings(next)
    setComposerExecutionApplying(true)
    void rendererRuntimeClient.setSettings({
      agents: {
        kun: {
          ...(patch.approvalPolicy ? { approvalPolicy: patch.approvalPolicy as ApprovalPolicy } : {}),
          ...(patch.sandboxMode ? { sandboxMode: patch.sandboxMode as SandboxMode } : {})
        }
      }
    }).then((settings) => {
      setComposerExecutionSettings({
        approvalPolicy: settings.agents.kun.approvalPolicy,
        sandboxMode: settings.agents.kun.sandboxMode
      })
      void probeRuntime('background')
    }).catch((error: unknown) => {
      setComposerExecutionSettings(previous)
      setError(error instanceof Error ? error.message : String(error))
    }).finally(() => setComposerExecutionApplying(false))
  }

  const codeThreads = useMemo(
    () => threads.filter((thread) =>
      !isWriteThreadId(thread.id) &&
      !isClawThread(thread, clawChannels) &&
      !isSddAssistantThread(thread)
    ),
    [clawChannels, threads]
  )

  const mirrorClawCommand = async (userText: string, replyText: string): Promise<void> => {
    if (!activeThreadId || typeof window.kunGui?.mirrorClawChannelMessage !== 'function') return
    const userResult = await window.kunGui.mirrorClawChannelMessage(
      activeThreadId,
      userText,
      'user'
    )
    if (!userResult.ok) return
    await window.kunGui.mirrorClawChannelMessage(
      activeThreadId,
      replyText,
      'assistant'
    )
  }

  const clawHelpText = (): string =>
    [
      t('clawHelpTitle'),
      '',
      `- \`/help\`: ${t('clawHelpCommandHelp')}`,
      `- \`/new\`: ${t('clawHelpCommandNew')}`,
      `- \`/model auto\`: ${t('clawHelpCommandModelAuto')}`,
      `- \`/model pro\`: ${t('clawHelpCommandModelPro')}`,
      `- \`/model flash\`: ${t('clawHelpCommandModelFlash')}`,
      `- \`/model\`: ${t('clawHelpCommandModelShow')}`
    ].join('\n')

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    if (rightPanelMode === 'plan' && !activeGuiPlan) {
      setRightPanelMode(null)
    }
  }, [activeGuiPlan, rightPanelMode, setRightPanelMode])

  useEffect(() => {
    if (
      !activeGuiPlan ||
      !sddUpgradeInFlightRef.current ||
      !sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    sddUpgradeInFlightRef.current = false
    sddUpgradeTargetRef.current = null
    useSddDraftStore.getState().setOperationStatus('idle')
    const completedDraft = useSddDraftStore.getState().activeDraft
    if (completedDraft) forgetRememberedSddDraft(completedDraft)
    useSddDraftStore.getState().clearActiveDraft()
  }, [activeGuiPlan])

  useEffect(() => {
    if (
      busy ||
      !sddUpgradeInFlightRef.current ||
      sddDraftOperationStatus !== 'upgrading' ||
      sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    const timeout = window.setTimeout(() => {
      if (!sddUpgradeInFlightRef.current) return
      if (useSddDraftStore.getState().operationStatus !== 'upgrading') return
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('error', t('planToolResultMissing'))
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [activeGuiPlan, busy, sddDraftOperationStatus, t])

  useEffect(() => {
    let cancelled = false
    const runtimeReady = runtimeConnection === 'ready'
    if (!runtimeReady) setRuntimeInfo(null)
    const provider = getProvider()
    const localSkillsTask = typeof window !== 'undefined' && typeof window.kunGui?.listSkills === 'function'
      ? window.kunGui.listSkills(activeSkillWorkspace || undefined)
      : Promise.resolve({ ok: true as const, skills: [], validationErrors: [] })
    void Promise.allSettled([
      runtimeReady && provider.getRuntimeInfo ? provider.getRuntimeInfo() : Promise.resolve(null),
      runtimeReady && provider.listSkills ? provider.listSkills() : Promise.resolve([]),
      localSkillsTask
    ])
      .then(([runtimeResult, skillsResult, localSkillsResult]) => {
        if (cancelled) return
        setRuntimeInfo(runtimeResult.status === 'fulfilled' ? runtimeResult.value : null)
        const runtimeSkillList = skillsResult.status === 'fulfilled' ? skillsResult.value : []
        const localSkillList =
          localSkillsResult.status === 'fulfilled' && localSkillsResult.value.ok
            ? localSkillsResult.value.skills
            : []
        setRuntimeSkills(mergeSkillCommands(runtimeSkillList, localSkillList))
      })
      .catch(() => {
        if (!cancelled) {
          if (!runtimeReady) setRuntimeInfo(null)
          setRuntimeSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeSkillWorkspace, runtimeConnection])

  const selectedComposerModel = route === 'claw'
    ? activeClawChannel?.model ?? 'auto'
    : route === 'write' || rightPanelMode === 'sdd-ai'
      ? writeAssistantModel
    : composerModel
  const selectedComposerProviderId = route === 'write' || rightPanelMode === 'sdd-ai'
    ? resolvedWriteAssistantProviderId
    : route === 'chat'
      ? composerProviderId
      : ''
  const selectedModelSupportsImageInput = useMemo(() => {
    const selected = selectedComposerModel.trim()
    const runtimeModel = runtimeInfo?.capabilities.model
    if (!selected || selected.toLowerCase() === 'auto') {
      return runtimeModel?.inputModalities.includes('image') === true
    }
    const profile = modelProfileForSelection(composerModelGroups, selected, selectedComposerProviderId)
    if (profile) return modelSupportsImageInput(profile)
    if (runtimeModel && normalizeModelCapabilityKey(runtimeModel.id) === normalizeModelCapabilityKey(selected)) {
      return runtimeModel.inputModalities.includes('image')
    }
    return false
  }, [composerModelGroups, runtimeInfo, selectedComposerModel, selectedComposerProviderId])
  const activeThreadCreatedAt = threads.find((thread) => thread.id === activeThreadId)?.createdAt
  const activeThreadFirstUserMessageCreatedAt = blocks.find((block) => block.kind === 'user')?.createdAt
  const localImageRecognitionAvailable = Boolean(
    imageRecognitionSettings?.enabled &&
    imageRecognitionSettings.baseUrl.trim() &&
    imageRecognitionSettings.apiKey.trim() &&
    imageRecognitionSettings.model.trim()
  )
  const imageRecognitionAvailable =
    runtimeInfo?.capabilities.imageRecognition?.available === true || localImageRecognitionAvailable
  const imageRecognitionEnabledAt =
    runtimeInfo?.capabilities.imageRecognition?.enabledAt ||
    imageRecognitionSettings?.enabledAt ||
    (localImageRecognitionAvailable ? legacyImageRecognitionEnabledAt : undefined)

  const attachmentUploadEnabled = isChatAttachmentUploadEnabled({
    runtimeConnection,
    route,
    mode,
    attachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available,
    modelSupportsImageInput: selectedModelSupportsImageInput,
    imageRecognitionAvailable,
    imageRecognitionEnabledAt,
    threadCreatedAt: activeThreadCreatedAt,
    firstUserMessageCreatedAt: activeThreadFirstUserMessageCreatedAt
  })
  const webAccessAvailable =
    runtimeInfo?.capabilities.web.fetch.available === true ||
    runtimeInfo?.capabilities.web.search.available === true

  const clearComposerAttachments = (): void => {
    setComposerAttachments([])
  }

  const activeComposerWorkspace = (): string | undefined => {
    const sddDraft = useSddDraftStore.getState().activeDraft
    if (rightPanelMode === 'sdd-ai' && sddDraft?.workspaceRoot) return sddDraft.workspaceRoot
    const writeWorkspace = useWriteWorkspaceStore.getState().workspaceRoot
    if (route === 'write' && writeWorkspace.trim()) return writeWorkspace
    return threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot || undefined
  }

  const clearComposerFileReferences = (): void => {
    setComposerFileReferences([])
  }

  const addComposerFileReference = (reference: ComposerFileReference): void => {
    setComposerFileReferences((current) => mergeComposerFileReferences(current, reference))
  }

  const removeComposerFileReference = (relativePath: string): void => {
    const key = relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
    setComposerFileReferences((current) =>
      current.filter((reference) =>
        reference.relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase() !== key
      )
    )
  }

  useEffect(() => {
    if (route !== 'chat') setComposerFileReferences([])
  }, [route])

  const handlePickAttachments = async (
    files: File[],
    options: { localFilePaths?: string[] } = {}
  ): Promise<void> => {
    if (!files.length || !attachmentUploadEnabled) return
    const provider = getProvider()
    if (typeof provider.uploadAttachment !== 'function') {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    setAttachmentUploadBusy(true)
    setAttachmentUploadError(null)
    try {
      const workspace = activeComposerWorkspace()
      const attachmentCapabilities = runtimeInfo?.capabilities.attachments
      if (!attachmentCapabilities) {
        setAttachmentUploadError(t('composerAttachmentUnavailable'))
        return
      }
      const uploaded: AttachmentReference[] = []
      for (const [index, file] of files.entries()) {
        if (!file.type.startsWith('image/')) continue
        const prepared = await prepareImageAttachmentUpload(file, attachmentCapabilities)
        const localFilePath =
          options.localFilePaths?.[index] ||
          (typeof window.kunGui?.getPathForFile === 'function' ? window.kunGui.getPathForFile(file) : '')
        const attachment = await provider.uploadAttachment({
          name: file.name || 'image',
          mimeType: prepared.mimeType,
          dataBase64: prepared.dataBase64,
          ...(localFilePath ? { localFilePath } : {}),
          textFallback: prepared.textFallback,
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          ...(workspace ? { workspace } : {})
        })
        uploaded.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          width: attachment.width,
          height: attachment.height,
          previewUrl: `data:${prepared.mimeType};base64,${prepared.dataBase64}`
        })
      }
      if (uploaded.length > 0) {
        setComposerAttachments((current) => {
          const byId = new Map(current.map((attachment) => [attachment.id, attachment]))
          for (const attachment of uploaded) {
            byId.set(attachment.id, attachment)
          }
          return [...byId.values()]
        })
      }
    } catch (error) {
      setAttachmentUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setAttachmentUploadBusy(false)
    }
  }

  const removeComposerAttachment = (id: string): void => {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const handlePasteClipboardImage = async (options: { silentNoImage?: boolean } = {}): Promise<void> => {
    if (!attachmentUploadEnabled) return
    if (typeof window.kunGui?.readClipboardImage !== 'function') {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const image = await window.kunGui.readClipboardImage()
    if (!image.ok) {
      if (options.silentNoImage) return
      setAttachmentUploadError(image.message)
      return
    }
    await handlePickAttachments([clipboardImageToFile(image)], { localFilePaths: [image.localFilePath] })
  }

  const sendWritePrompt = (value: string): void => {
    const v = value.trim()
    const attachments = composerAttachments
    const attachmentIds = attachments.map((attachment) => attachment.id)
    if (!v && attachmentIds.length === 0) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    setInput('')
    void (async () => {
      const threadId = await ensureWriteThreadForWorkspace(writeWorkspaceRoot)
      if (!threadId) {
        setInput(v)
        return
      }
      const retrievalQuery = [
        ...writeState.quotedSelections.map((selection) => selection.text),
        v
      ].join('\n\n').trim()
      let retrieval: WriteRetrievalContext | null = null
      if (retrievalQuery && typeof window.kunGui?.retrieveWriteContext === 'function') {
        try {
          const result = await window.kunGui.retrieveWriteContext({
            workspaceRoot: writeWorkspaceRoot,
            currentFilePath: writeState.activeFilePath ?? undefined,
            query: retrievalQuery,
            maxSnippets: 4,
            includeCurrentFile: true
          })
          if (result.ok) retrieval = result.context
        } catch (error) {
          void window.kunGui?.logError?.('write-retrieval', 'Failed to retrieve write context', {
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
      const messageText = v || t('composerImageOnlyPrompt')
      const prompt = composeWritePrompt(messageText, writeState.quotedSelections, {
        workspaceRoot: writeWorkspaceRoot,
        activeFilePath: writeState.activeFilePath,
        retrieval
      })
      const model = writeState.assistantModel.trim()
      const providerId =
        writeState.assistantProviderId.trim() || providerIdForComposerModel(composerModelGroups, model)
      const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
      const sent = await sendMessage(prompt, mode === 'plan' ? 'plan' : 'agent', {
        ...(!v && attachmentIds.length > 0 ? { displayText: t('composerImageOnlyDisplay') } : {}),
        ...(model ? { model } : {}),
        ...(providerId ? { providerId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds, attachments } : {})
      })
      if (sent) {
        useWriteWorkspaceStore.getState().clearQuotedSelections()
        if (attachmentIds.length > 0) clearComposerAttachments()
      }
    })()
  }

  const createSddAssistantThreadForDraft = async (draft: SddDraft): Promise<string | null> => {
    const normalizedWorkspace = normalizeWorkspaceRoot(draft.workspaceRoot)
    if (!normalizedWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return null
    }
    if (runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return null
    }
    try {
      const provider = getProvider()
      const thread = await provider.createThread({
        workspace: normalizedWorkspace,
        title: titleForSddDraft(draft),
        mode: 'agent'
      })
      const normalizedThread = {
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace) || normalizedWorkspace
      }
      markSddAssistantThread(draft, normalizedThread.id)
      // Record the thread association inside the requirement unit right away.
      void writeSddChatTranscriptForThread({
        workspaceRoot: draft.workspaceRoot,
        draftRelativePath: draft.relativePath,
        threadId: normalizedThread.id,
        blocks: []
      })
      useChatStore.setState((state) => ({
        activeThreadId: normalizedThread.id,
        threads: state.threads.some((item) => item.id === normalizedThread.id)
          ? state.threads
          : [normalizedThread, ...state.threads]
      }))
      setRoute('chat')
      await selectThread(normalizedThread.id)
      void useChatStore.getState().refreshThreads()
      return normalizedThread.id
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  const ensureSddAssistantThreadForDraft = async (draft: SddDraft): Promise<string | null> => {
    const registeredThreadId = sddAssistantThreadIdForDraft(draft)
    if (registeredThreadId) {
      setRoute('chat')
      if (useChatStore.getState().activeThreadId !== registeredThreadId) {
        await selectThread(registeredThreadId)
      }
      if (useChatStore.getState().activeThreadId === registeredThreadId) {
        void renameSddAssistantThreadToDraft(registeredThreadId, draft)
        return registeredThreadId
      }
    }
    return createSddAssistantThreadForDraft(draft)
  }

  useEffect(() => {
    const draft = activeSddDraft
    if (!draft || runtimeConnection !== 'ready') return
    const threadId = sddAssistantThreadIdForDraft(draft)
    if (!threadId) return
    const nextTitle = sddAssistantThreadTitle(sddDraftContent, t('sddUntitledRequirement'))
    if (!nextTitle || lastSyncedSddTitleRef.current[threadId] === nextTitle) return
    if (sddTitleSyncTimerRef.current) {
      window.clearTimeout(sddTitleSyncTimerRef.current)
    }
    sddTitleSyncTimerRef.current = window.setTimeout(() => {
      sddTitleSyncTimerRef.current = null
      const latestDraft = useSddDraftStore.getState().activeDraft
      if (!latestDraft || latestDraft.id !== draft.id) return
      const latestThreadId = sddAssistantThreadIdForDraft(latestDraft)
      if (latestThreadId !== threadId) return
      void renameSddAssistantThreadToDraft(threadId, latestDraft)
    }, SDD_ASSISTANT_TITLE_SYNC_DELAY_MS)
    return () => {
      if (sddTitleSyncTimerRef.current) {
        window.clearTimeout(sddTitleSyncTimerRef.current)
        sddTitleSyncTimerRef.current = null
      }
    }
  }, [activeSddDraft, renameSddAssistantThreadToDraft, runtimeConnection, sddDraftContent, t])

  const openSddRequirementDraft = async (
    draft: SddDraft,
    content: string,
    options: {
      lastSavedContent?: string
      saveStatus?: SddDraftSaveStatus
      openAssistant?: boolean
    } = {}
  ): Promise<boolean> => {
    useSddDraftStore.getState().setActiveDraft(draft, content, {
      lastSavedContent: options.lastSavedContent,
      saveStatus: options.saveStatus
    })
    // Self-heal the unit's conversation record (covers turns that completed
    // while the draft was closed or in another thread).
    void refreshSddChatTranscriptFromProvider(draft)
    setInput('')
    setMode('agent')
    setRoute('chat')
    if (options.openAssistant ?? runtimeConnection === 'ready') {
      setRightSidebarWidth((width) => Math.max(width, 420))
      const sddThreadId = await ensureSddAssistantThreadForDraft(draft)
      if (sddThreadId) {
        setRightPanelMode('sdd-ai')
      } else {
        setRightPanelMode(null)
      }
    } else {
      setRightPanelMode(null)
    }
    return true
  }

  const dismissActiveSddDraft = (options: { closeAssistant?: boolean } = {}): void => {
    const draft = useSddDraftStore.getState().activeDraft
    if (draft) {
      void saveActiveSddDraftToDisk()
      useSddDraftStore.getState().clearActiveDraft()
    }
    if (options.closeAssistant && rightPanelMode === 'sdd-ai') setRightPanelMode(null)
  }

  const openSddAssistantPanel = async (): Promise<void> => {
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return
    setRightSidebarWidth((width) => Math.max(width, 420))
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    setRightPanelMode('sdd-ai')
  }

  const toggleSddAssistantPanel = async (): Promise<void> => {
    if (rightPanelMode === 'sdd-ai') {
      setRightPanelMode(null)
      return
    }
    await openSddAssistantPanel()
  }

  const quoteToSddAssistant = (prompt: string): void => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setInput(input.trim() ? `${input.trim()}\n\n${trimmed}` : trimmed)
    void openSddAssistantPanel()
  }

  const startNewSddRequirement = async (): Promise<void> => {
    const activeCodeWorkspace = activeThreadId
      ? normalizeWorkspaceRoot(codeThreads.find((thread) => thread.id === activeThreadId)?.workspace ?? '')
      : ''
    let targetWorkspace = activeCodeWorkspace || normalizeWorkspaceRoot(workspaceRoot)
    if (!targetWorkspace) {
      const picked = await chooseWorkspace({ selectThreadAfter: false })
      targetWorkspace = normalizeWorkspaceRoot(picked ?? useChatStore.getState().workspaceRoot)
    }
    if (!targetWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return
    }
    const restored = await restoreRememberedSddDraft({
      workspaceRoot: targetWorkspace,
      readWorkspaceFile: window.kunGui.readWorkspaceFile
    })
    if (restored.kind === 'restored') {
      await openSddRequirementDraft(restored.draft, restored.content, {
        lastSavedContent: restored.lastSavedContent,
        saveStatus: restored.saveStatus
      })
      return
    }

    const draftUuid = globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`
    const draft = createSddDraft({ id: draftUuid, workspaceRoot: targetWorkspace })
    const initialContent = [
      `# ${t('sddUntitledRequirement')}`,
      '',
      `## ${t('sddTemplateBackground')}`,
      '',
      `## ${t('sddTemplateGoal')}`,
      '',
      `## ${t('sddTemplateAcceptance')}`,
      ''
    ].join('\n')
    const result = await window.kunGui.createWorkspaceFile({
      workspaceRoot: targetWorkspace,
      path: draft.relativePath,
      content: initialContent
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    const activeDraft = { ...draft, absolutePath: result.path }
    await openSddRequirementDraft(activeDraft, initialContent)
  }

  const openSddRequirementDraftFromHistory = async (draft: SddDraft): Promise<void> => {
    const current = useSddDraftStore.getState().activeDraft
    if (current && current.id !== draft.id) {
      await saveActiveSddDraftToDisk()
    }
    const restored = await restoreSddDraft({
      draft,
      readWorkspaceFile: window.kunGui.readWorkspaceFile
    })
    if (restored.kind !== 'restored') {
      setError(restored.kind === 'unreadable' ? restored.message : t('sddDraftHistoryOpenFailed'))
      return
    }
    await openSddRequirementDraft(restored.draft, restored.content, {
      lastSavedContent: restored.lastSavedContent,
      saveStatus: restored.saveStatus
    })
  }

  const sddDraftFromRegisteredThread = (threadId: string): SddDraft | null => {
    const ref = sddDraftRefForThreadId(threadId)
    if (!ref) return null
    const timestamp = new Date(0).toISOString()
    return {
      id: buildSddDraftId(ref.workspaceRoot, ref.draftRelativePath),
      workspaceRoot: ref.workspaceRoot,
      relativePath: ref.draftRelativePath,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  const findSddDraftForSidebarThread = async (
    threadId: string,
    thread: NormalizedThread | null
  ): Promise<SddDraft | null> => {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null

    if (isSddAssistantThread(thread ?? { id: normalizedThreadId })) {
      return sddDraftFromRegisteredThread(normalizedThreadId)
    }

    if (thread && !isEmptySddAssistantThreadCandidate(thread)) return null
    const listWorkspaceDirectory = window.kunGui?.listWorkspaceDirectory
    const readWorkspaceFile = window.kunGui?.readWorkspaceFile
    if (typeof listWorkspaceDirectory !== 'function' || typeof readWorkspaceFile !== 'function') {
      return null
    }

    const targetWorkspace = normalizeWorkspaceRoot(thread?.workspace || workspaceRoot)
    if (!targetWorkspace) return null
    const history = await listSddDraftHistory({
      workspaceRoot: targetWorkspace,
      listWorkspaceDirectory,
      readWorkspaceFile,
      limit: 80
    }).catch(() => [])
    return history.find((draft) => draft.chatThreadIds?.includes(normalizedThreadId)) ?? null
  }

  // NOTE: We intentionally do NOT auto-restore a remembered requirement draft
  // on mount / workspace switch. Opening the app (or switching the working
  // directory) should land on a clean new conversation in the selected
  // directory — not silently reopen the last requirement. Remembered drafts
  // stay reachable from the sidebar (需求草稿) and the "新建需求" restore-or-create
  // flow; they just no longer hijack startup. See the workspace picker below
  // the composer for switching directories.

  const sendSddAssistantPrompt = async (value: string): Promise<void> => {
    const v = value.trim()
    const draft = useSddDraftStore.getState().activeDraft
    const attachments = composerAttachments
    const attachmentIds = attachments.map((attachment) => attachment.id)
    if ((!v && attachmentIds.length === 0) || !draft) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    const snapshot = useSddDraftStore.getState()
    void saveActiveSddDraftToDisk()
    const userPrompt = v || t('composerImageOnlyPrompt')
    const prompt = composeSddAssistantPrompt({
      userPrompt,
      draftMarkdown: snapshot.content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    setInput('')
    const model = writeAssistantModel.trim()
    const providerId = resolvedWriteAssistantProviderId.trim()
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const sent = await sendMessage(prompt, mode === 'plan' ? 'plan' : 'agent', {
      displayText: v || t('composerImageOnlyDisplay'),
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {})
    })
    if (sent) {
      if (attachmentIds.length > 0) clearComposerAttachments()
    } else {
      setInput(v)
    }
  }

  const uploadSddImagesAsAttachments = async (
    images: SddDraftImageReference[],
    threadId: string,
    workspace: string
  ): Promise<{ images: SddDraftImageReference[]; attachmentIds: string[] }> => {
    const provider = getProvider()
    const attachmentCapabilities = runtimeInfo?.capabilities.attachments
    if (!attachmentCapabilities || typeof provider.uploadAttachment !== 'function') {
      throw new Error(t('composerAttachmentUnavailable'))
    }
    const attachmentIds: string[] = []
    for (const image of images) {
      const file = base64ImageToFile(image)
      const prepared = await prepareImageAttachmentUpload(file, attachmentCapabilities)
      const attachment = await provider.uploadAttachment({
        name: fileNameFromPath(image.relativePath),
        mimeType: prepared.mimeType,
        dataBase64: prepared.dataBase64,
        textFallback: prepared.textFallback,
        threadId,
        workspace
      })
      attachmentIds.push(attachment.id)
    }
    return { images: withAttachmentIds(images, attachmentIds), attachmentIds }
  }

  const firstVisionCapableModel = (): { modelId: string; providerId?: string } | null => {
    for (const group of composerModelGroups) {
      for (const modelId of group.modelIds) {
        const profile = modelProfileForSelection(composerModelGroups, modelId, group.providerId)
        if (profile && modelSupportsImageInput(profile)) {
          const providerId = group.providerId.trim()
          return {
            modelId,
            ...(providerId ? { providerId } : {})
          }
        }
      }
    }
    return null
  }

  /** Send a prototype-generation turn to the SDD assistant. Image-driven
   * prototypes need a vision model: prompt to switch when the current one
   * cannot read images. Returns false when nothing was sent. */
  const sendSddPrototypeTurn = async (payload: {
    prompt: string
    displayText: string
    image?: { absolutePath: string; alt: string }
  }): Promise<boolean> => {
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return false
    if (runtimeConnection !== 'ready') {
      useSddDraftStore.getState().setOperationStatus('error', t('runtimeActionNeedsConnection'))
      return false
    }

    if (payload.image && !selectedModelSupportsImageInput) {
      const visionSelection = firstVisionCapableModel()
      if (!visionSelection) {
        useSddDraftStore.getState().setOperationStatus('error', t('sddPrototypeNoVisionModel'))
        return false
      }
      const switchModel = await confirmDialog(
        t('sddPrototypeSwitchVisionModel', { model: visionSelection.modelId })
      )
      if (!switchModel) return false
      setWriteAssistantModel(visionSelection.modelId, visionSelection.providerId)
    }

    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return false
    await openSddAssistantPanel()

    let attachmentIds: string[] = []
    if (payload.image) {
      try {
        const read = await window.kunGui.readWorkspaceImage({
          path: payload.image.absolutePath,
          workspaceRoot: draft.workspaceRoot
        })
        if (!read.ok) throw new Error(read.message)
        const dataBase64 = read.dataUrl.split(';base64,', 2)[1] ?? ''
        if (!dataBase64) throw new Error(t('composerAttachmentUnavailable'))
        const uploaded = await uploadSddImagesAsAttachments(
          [
            {
              index: 1,
              alt: payload.image.alt,
              markdownPath: payload.image.absolutePath,
              relativePath: payload.image.absolutePath,
              mimeType: read.mimeType,
              dataBase64,
              byteSize: read.size
            }
          ],
          threadId,
          draft.workspaceRoot
        )
        attachmentIds = uploaded.attachmentIds
      } catch (error) {
        useSddDraftStore.getState().setOperationStatus(
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return false
      }
    }

    const assistantSelection = useWriteWorkspaceStore.getState()
    const model = assistantSelection.assistantModel.trim()
    const providerId =
      assistantSelection.assistantProviderId.trim() || providerIdForComposerModel(composerModelGroups, model)
    return sendMessage(payload.prompt, 'agent', {
      displayText: payload.displayText,
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {})
    })
  }

  const handleSddNextStep = async (): Promise<void> => {
    const snapshot = useSddDraftStore.getState()
    const draft = snapshot.activeDraft
    if (!draft) return
    if (sddUpgradeInFlightRef.current || snapshot.operationStatus === 'upgrading') return
    if (!snapshot.content.trim()) {
      useSddDraftStore.getState().setOperationStatus('error', t('sddEmptyDraftError'))
      return
    }
    // An in-flight image placeholder would be snapshotted into the plan prompt
    // (and trip the image collector); finish or delete it first.
    if (snapshot.content.includes(PENDING_INFOGRAPHIC_PROTOCOL)) {
      useSddDraftStore.getState().setOperationStatus('error', t('sddPendingImageBlocked'))
      return
    }
    const chatSnapshot = useChatStore.getState()
    if (chatSnapshot.busy || threadHasPendingRuntimeWork(chatSnapshot.blocks)) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    if (chatSnapshot.runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return
    }
    sddUpgradeInFlightRef.current = true
    useSddDraftStore.getState().setOperationStatus('upgrading')
    const saved = await saveActiveSddDraftToDisk()
    if (!saved) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', useSddDraftStore.getState().error)
      return
    }

    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }

    const collected = await collectSddDraftImages({
      markdown: useSddDraftStore.getState().content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    if (collected.errors.length > 0) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', collected.errors.join('\n'))
      return
    }

    const supportsImageAttachments =
      collected.images.length > 0 &&
      runtimeInfo?.capabilities.model.inputModalities.includes('image') === true &&
      runtimeInfo.capabilities.attachments.available === true &&
      typeof getProvider().uploadAttachment === 'function'

    let imagesForPrompt = collected.images
    let attachmentIds: string[] = []
    let imageMode: 'attachments' | 'base64' | 'none' =
      collected.images.length === 0 ? 'none' : 'base64'

    if (supportsImageAttachments) {
      try {
        const uploaded = await uploadSddImagesAsAttachments(collected.images, threadId, draft.workspaceRoot)
        imagesForPrompt = uploaded.images
        attachmentIds = uploaded.attachmentIds
        imageMode = 'attachments'
      } catch (error) {
        sddUpgradeInFlightRef.current = false
        useSddDraftStore.getState().setOperationStatus(
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return
      }
    }

    const latestDraftContent = useSddDraftStore.getState().content
    const planRelativePath = sddDraftPlanRelativePath(draft)
    const planId = buildGuiPlanId(draft.workspaceRoot, planRelativePath)
    const sourceRequest = sddDraftSourceRequest(latestDraftContent, draft.relativePath)
    const assistantContext = sddAssistantContextFromBlocks(blocks)
    const prompt = buildSddDraftToPlanPrompt({
      draftMarkdown: latestDraftContent,
      draftRelativePath: draft.relativePath,
      planRelativePath,
      assistantContext,
      workspaceRoot: draft.workspaceRoot,
      images: imagesForPrompt,
      imageMode
    })
    sddUpgradeTargetRef.current = {
      planId,
      relativePath: planRelativePath,
      workspaceRoot: draft.workspaceRoot
    }
    setMode('plan')
    const sent = await sendPlanTurn(prompt, {
      displayText: t('sddGeneratePlanAction'),
      workspaceRoot: draft.workspaceRoot,
      guiPlan: {
        operation: 'draft',
        workspaceRoot: draft.workspaceRoot,
        relativePath: planRelativePath,
        planId,
        sourceRequest
      },
      ...(attachmentIds.length ? { attachmentIds } : {})
    })
    if (!sent) {
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }
    // Baseline the trace snapshot so later draft edits can be detected as
    // requirement drift against the plan that is about to be generated.
    const tracePath = sddDraftTraceRelativePath(draft.relativePath)
    if (tracePath) {
      await window.kunGui
        .writeWorkspaceFile({
          workspaceRoot: draft.workspaceRoot,
          path: tracePath,
          content: JSON.stringify(
            buildSddTraceSnapshot(latestDraftContent, planRelativePath),
            null,
            2
          )
        })
        .catch(() => undefined)
    }
  }

  const readComposerFileContextEntries = async (
    references: ComposerFileReference[],
    workspace: string
  ): Promise<ComposerFileContextEntry[]> => {
    const entries: ComposerFileContextEntry[] = []
    let remainingChars = COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS
    for (const reference of references) {
      if (remainingChars <= 0) break
      const result = await window.kunGui.readWorkspaceFile({
        workspaceRoot: workspace,
        path: reference.relativePath || reference.path
      })
      if (!result.ok) {
        throw new Error(t('composerFileReadFailed', {
          path: reference.relativePath,
          message: result.message
        }))
      }
      const clipped = clipComposerFileContext(result.content, remainingChars, result.truncated)
      remainingChars -= clipped.consumed
      entries.push({
        relativePath: reference.relativePath,
        content: clipped.content,
        ...(clipped.truncated ? { truncated: true } : {})
      })
    }
    return entries
  }

  const handleSend = (): void => {
    void handleSendAsync()
  }

  const handleSendAsync = async (): Promise<void> => {
    const v = input.trim()
    const attachments = route === 'chat' || route === 'write' ? composerAttachments : []
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const fileReferences = route === 'chat' ? composerFileReferences : []
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    if (!v && attachmentIds.length === 0 && fileReferences.length === 0) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const emptyPrompt =
      fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyPrompt')
        : fileReferences.length > 0
          ? t('composerFileOnlyPrompt')
          : t('composerImageOnlyPrompt')
    const emptyDisplayText = v
      ? undefined
      : fileReferences.length > 0 && attachmentIds.length > 0
        ? t('composerFileAndImageOnlyDisplay', { count: fileReferences.length })
        : fileReferences.length > 0
          ? t('composerFileOnlyDisplay', { count: fileReferences.length })
          : t('composerImageOnlyDisplay')
    const messageText = v || emptyPrompt
    const prepareChatMessage = async (): Promise<{ text: string; displayText?: string } | null> => {
      if (fileReferences.length === 0) {
        return {
          text: messageText,
          ...(emptyDisplayText ? { displayText: emptyDisplayText } : {})
        }
      }
      const workspace = normalizeWorkspaceRoot(
        threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot
      )
      if (!workspace) {
        setError(t('workspaceRequiredToCreateThread'))
        return null
      }
      try {
        const fileContext = await readComposerFileContextEntries(fileReferences, workspace)
        const displayText = v || emptyDisplayText
        return {
          text: buildComposerFileContextPrompt(messageText, fileContext),
          ...(displayText ? { displayText } : {})
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return null
      }
    }

    if (activeSddDraft && rightPanelMode === 'sdd-ai') {
      void sendSddAssistantPrompt(v)
      return
    }
    const planCommand = parseGuiPlanCommand(v)
    if (planCommand) {
      setInput('')
      void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
      return
    }
    if (route === 'chat' && mode === 'plan') {
      const prepared = await prepareChatMessage()
      if (!prepared) return
      setInput('')
      clearComposerAttachments()
      clearComposerFileReferences()
      void sendPlanTurn(prepared.text, {
        ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds, attachments } : {})
      })
      return
    }
    if (route === 'write') {
      sendWritePrompt(v)
      return
    }
    if (route === 'claw') {
      const command = parseClawCommand(v)
      if (command?.kind === 'clear') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await resetClawChannelSession(activeClawChannelId)
          const replyText = t('clawNewSessionStarted')
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'help') {
        setInput('')
        const replyText = clawHelpText()
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'model') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          await setClawChannelModel(activeClawChannelId, command.model)
          const replyText = t('clawModelChanged', { model: command.model })
          appendLocalClawTurn(v, replyText)
          await mirrorClawCommand(v, replyText)
        })()
        return
      }
      if (command?.kind === 'showModel') {
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        const replyText = t('clawModelCurrent', {
          model: activeClawChannel?.model ?? 'auto'
        })
        appendLocalClawTurn(v, replyText)
        void mirrorClawCommand(v, replyText)
        return
      }
      if (command?.kind === 'showProvider' || command?.kind === 'provider') {
        setError('Provider commands are available in IM chats.')
        return
      }
      if (!activeClawChannelId) {
        setError(t('clawNoActiveIm'))
        return
      }
      setInput('')
      void (async () => {
        const taskResult = typeof window.kunGui?.createClawTaskFromText === 'function'
          ? await window.kunGui.createClawTaskFromText(v, {
              channelId: activeClawChannelId,
              modelHint: activeClawChannel?.model,
              ...(reasoningEffort ? { reasoningEffort } : {}),
              mode
            })
          : { kind: 'noop' as const }
        if (taskResult.kind === 'created') {
          appendLocalClawTurn(v, taskResult.confirmationText)
          await mirrorClawCommand(v, taskResult.confirmationText)
          return
        }
        if (taskResult.kind === 'error') {
          appendLocalClawTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
          return
        }
        if (!activeThreadId) {
          await selectClawChannel(activeClawChannelId)
          await useChatStore.getState().sendMessage(v, mode === 'plan' ? 'plan' : 'agent', {
            ...(reasoningEffort ? { reasoningEffort } : {})
          })
          return
        }
        await sendMessage(v, mode === 'plan' ? 'plan' : 'agent', {
          ...(reasoningEffort ? { reasoningEffort } : {})
        })
      })()
      return
    }
    const prepared = await prepareChatMessage()
    if (!prepared) return
    setInput('')
    clearComposerAttachments()
    clearComposerFileReferences()
    void sendMessage(prepared.text, mode === 'plan' ? 'plan' : 'agent', {
      ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments } : {})
    })
  }

  const openThread = (id: string): void => {
    setConnectPhoneSidebarOpen(false)
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      const sddDraft = await findSddDraftForSidebarThread(id, thread)
      if (sddDraft) {
        markSddAssistantThread(sddDraft, id)
        await openSddRequirementDraftFromHistory(sddDraft)
        void useChatStore.getState().refreshThreads()
        return
      }
      if (useSddDraftStore.getState().activeDraft) dismissActiveSddDraft({ closeAssistant: true })
      setRoute('chat')
      await selectThread(id)
    })()
  }

  const startNewChat = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread()
  }

  const startNewChatInWorkspace = (workspaceRoot: string): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({ workspaceRoot })
  }

  const openCodeMode = (): void => {
    setConnectPhoneSidebarOpen(false)
    void openCode()
  }

  const openWriteMode = (): void => {
    setConnectPhoneSidebarOpen(false)
    void openWrite()
  }

  const openPluginsView = (): void => {
    setConnectPhoneSidebarOpen(false)
    openPlugins(sidebarView === 'claw' ? 'claw' : 'chat')
  }

  const openScheduleView = (): void => {
    setConnectPhoneSidebarOpen(false)
    openSchedule()
  }

  const toggleConnectPhone = (): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    openClaw()
    setConnectPhoneSidebarOpen((open) => !open)
  }

  const sidebarView: 'chat' | 'write' | 'claw' | 'schedule' =
    route === 'claw' || (route === 'plugins' && pluginHostRoute === 'claw')
      ? 'claw'
      : route === 'schedule'
        ? 'schedule'
      : route === 'write'
        ? 'write'
        : 'chat'

  const closeRightPanel = (): void => {
    if (route === 'write') {
      setWriteAssistantOpen(false)
      return
    }
    setRightPanelMode(null)
    setFilePreviewTarget(null)
  }

  const startNewWriteAssistantConversation = (): void => {
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    setInput('')
    writeState.clearQuotedSelections()
    void createWriteThread(writeWorkspaceRoot)
  }

  const pickWriteAssistantWorkspace = async (): Promise<void> => {
    try {
      const writeState = useWriteWorkspaceStore.getState()
      writeState.setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        writeState.workspaceRoot || writeState.defaultWorkspaceRoot || workspaceRoot || undefined
      )
      if (!picked.canceled && picked.path) {
        await useWriteWorkspaceStore.getState().addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      useWriteWorkspaceStore.getState().setFileError(formatWorkspacePickerError(error))
    }
  }

  const renderRuntimeBanner = (message: string, detail?: string | null): ReactElement => (
    <RuntimeBanner
      message={message}
      detail={detail}
      logPath={runtimeLogPath || null}
      runtimeReady={runtimeConnection === 'ready'}
      stageInsetClass={stageInsetClass}
      t={t}
      onOpenLogDir={
        typeof window !== 'undefined' && typeof window.kunGui?.openLogDir === 'function'
          ? () => window.kunGui.openLogDir()
          : undefined
      }
      onOpenSettings={() => openSettings('agents')}
      onRetryConnection={() => void probeRuntime('user', { restart: true })}
    />
  )

  const writeRuntimeBannerMessage = resolveWriteRuntimeBannerMessage({
    runtimeConnection,
    error,
    runtimeActionNeedsConnection: t('runtimeActionNeedsConnection')
  })
  const rightPanelDockedVisible = rightPanelVisible && !planPanelInOverlay

  const renderPlanPanel = (className: string): ReactElement => (
    <PlanPanel
      workspaceRoot={workspaceRoot}
      activeThreadId={activeThreadId}
      runtimeReady={runtimeConnection === 'ready'}
      busy={busy}
      className={className}
      onCollapse={closeRightPanel}
      onBuildPlan={() => void buildGuiPlan()}
      onVerifyPlan={() => void verifyGuiPlan()}
      onReplanChanged={(ids) => void replanChangedRequirements(ids)}
    />
  )

  const renderRightPanel = (): ReactElement | null => {
    if (!rightPanelDockedVisible) return null
    return (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
          onPointerDown={beginRightResize}
        />
        <div className="h-full min-h-0 shrink-0" style={{ width: rightSidebarWidth }}>
          <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {route === 'write' && writeAssistantOpen ? (
              <WriteAssistantPanel
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeConnection={runtimeConnection}
                activeThreadId={activeThreadId}
                blocks={blocks}
                liveReasoning={liveReasoning}
                liveAssistant={liveAssistant}
                composerModel={writeAssistantModel}
                composerProviderId={resolvedWriteAssistantProviderId}
                composerPickList={writeAssistantPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={composerReasoningEffort}
                setComposerModel={setWriteAssistantModel}
                setComposerReasoningEffort={setComposerReasoningEffort}
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                attachments={composerAttachments}
                attachmentUploadEnabled={attachmentUploadEnabled}
                attachmentUploadBusy={attachmentUploadBusy}
                attachmentUploadError={attachmentUploadError}
                onPickAttachments={(files) => void handlePickAttachments(files)}
                onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                onRemoveAttachment={removeComposerAttachment}
                onSend={handleSend}
                onInterrupt={(options) => void interrupt(options)}
                onRetryConnection={() => void probeRuntime('user', { restart: true })}
                onOpenSettings={() => openSettings('agents')}
                onConfigureProviders={() => openSettings('providers')}
                onNewConversation={startNewWriteAssistantConversation}
                onPickWorkspace={() => void pickWriteAssistantWorkspace()}
                onCollapse={closeRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : rightPanelMode === 'sdd-ai' && activeSddDraft ? (
              <SddAssistantPanel
                draft={activeSddDraft}
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeConnection={runtimeConnection}
                activeThreadId={activeThreadId}
                blocks={blocks}
                liveReasoning={liveReasoning}
                liveAssistant={liveAssistant}
                composerModel={writeAssistantModel}
                composerProviderId={resolvedWriteAssistantProviderId}
                composerPickList={writeAssistantPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={composerReasoningEffort}
                setComposerModel={setWriteAssistantModel}
                setComposerReasoningEffort={setComposerReasoningEffort}
                queuedMessages={queuedMessages}
                removeQueuedMessage={removeQueuedMessage}
                attachments={composerAttachments}
                attachmentUploadEnabled={attachmentUploadEnabled}
                attachmentUploadBusy={attachmentUploadBusy}
                attachmentUploadError={attachmentUploadError}
                onPickAttachments={(files) => void handlePickAttachments(files)}
                onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                onRemoveAttachment={removeComposerAttachment}
                onSend={handleSend}
                onInterrupt={(options) => void interrupt(options)}
                onRetryConnection={() => void probeRuntime('user', { restart: true })}
                onOpenSettings={() => openSettings('agents')}
                onConfigureProviders={() => openSettings('providers')}
                onNewConversation={() => {
                  setInput('')
                  void createSddAssistantThreadForDraft(activeSddDraft)
                }}
                onCollapse={closeRightPanel}
                className="h-full max-h-full w-full"
              />
            ) : rightPanelMode === 'changes' ? (
              <ChangeInspector
                blocks={blocks}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'todo' ? (
              <TodoPanel
                className="h-full max-h-full w-full"
                onCollapse={closeRightPanel}
                onOpenPlan={openGuiPlanPanel}
              />
            ) : rightPanelMode === 'browser' ? (
              <DevBrowserPanel
                blocks={devPreviewBlocks}
                preferredUrl={latestDevPreviewUrl}
                className="h-full max-h-full w-full flex-col"
                onCollapse={closeRightPanel}
              />
            ) : rightPanelMode === 'plan' ? (
              renderPlanPanel('h-full max-h-full w-full')
            ) : (
              <WorkspaceFilePreviewPanel
                target={filePreviewTarget}
                workspaceRoot={workspaceRoot}
                className="h-full max-h-full w-full"
                onClose={closeRightPanel}
              />
            )}
          </Suspense>
        </div>
      </>
    )
  }

  const renderPlanPanelOverlay = (): ReactElement | null => {
    if (!planPanelInOverlay) return null
    return (
      <div
        className="ds-plan-panel-overlay ds-no-drag"
        role="dialog"
        aria-modal="true"
        aria-label={t('planPanelTitle')}
      >
        <button
          type="button"
          className="ds-plan-panel-overlay-backdrop"
          aria-label={t('cancel')}
          onClick={closeRightPanel}
        />
        <div className="ds-plan-panel-overlay-card">
          <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
            {renderPlanPanel('h-full max-h-full w-full')}
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
      {!leftSidebarCollapsed ? (
        <>
          <div className="min-h-0 shrink-0" style={{ width: leftSidebarWidth }}>
            {route === 'write' ? (
              <WriteSidebar
                activeView={sidebarView}
                connectPhoneSidebarOpen={connectPhoneSidebarOpen}
                onCodeOpen={openCodeMode}
                onWriteOpen={openWriteMode}
                onOpenSettings={(section) => openSettings(section)}
                onToggleConnectPhone={toggleConnectPhone}
                onToggleSidebar={toggleLeftSidebar}
              />
            ) : (
            <Sidebar
              threads={codeThreads}
              activeThreadId={activeThreadId}
              activeView={sidebarView}
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
              pluginsActive={route === 'plugins'}
              runtimeReady={runtimeConnection === 'ready'}
              threadSearch={threadSearch}
              showArchivedThreads={showArchivedThreads}
              onThreadSearchChange={setThreadSearch}
              onShowArchivedThreadsChange={setShowArchivedThreads}
              onSelectThread={openThread}
              onRenameThread={renameThread}
              onArchiveThread={(id) => archiveThread(id, true)}
              onDeleteThread={deleteThread}
              onRestoreThread={(id) => archiveThread(id, false)}
              onNewChat={startNewChat}
              onNewChatInWorkspace={startNewChatInWorkspace}
              onNewRequirement={() => void startNewSddRequirement()}
              onOpenRequirementDraft={(draft) => void openSddRequirementDraftFromHistory(draft)}
              onOpenSettings={(section) => openSettings(section)}
              onOpenPlugins={openPluginsView}
              focusModeEnabled={focusModeEnabled}
              onFocusModeChange={updateFocusMode}
              onToggleConnectPhone={toggleConnectPhone}
              onCodeOpen={openCodeMode}
              onWriteOpen={openWriteMode}
              onScheduleOpen={openScheduleView}
              onToggleSidebar={toggleLeftSidebar}
            />
            )}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
            onPointerDown={beginLeftResize}
          />
        </>
      ) : null}

      <main
        className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          route === 'plugins' ? 'px-0' : ''
        }`}
      >
        {route === 'plugins' ? (
          <>
            <div className="ds-no-drag shrink-0 px-4 pt-4">
              <SidebarTitlebarToggleButton
                onClick={toggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            </div>
            <Suspense fallback={<div className="h-full bg-ds-main" />}>
              <PluginMarketplaceView />
            </Suspense>
          </>
        ) : route === 'schedule' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ScheduleTasksView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={toggleLeftSidebar}
              onOpenThread={openThread}
            />
          </Suspense>
        ) : route === 'write' ? (
          <>
            {writeRuntimeBannerMessage ? renderRuntimeBanner(writeRuntimeBannerMessage, runtimeErrorDetail) : null}
            <div className="flex min-h-0 flex-1">
              <WriteWorkspaceView
                leftSidebarCollapsed={leftSidebarCollapsed}
                onToggleLeftSidebar={toggleLeftSidebar}
                input={input}
                setInput={setInput}
                onSubmitPrompt={sendWritePrompt}
              />
              {renderRightPanel()}
            </div>
          </>
        ) : (
          <>
        {error && !(runtimeConnection !== 'ready' && !activeThreadId) ? renderRuntimeBanner(error, runtimeErrorDetail) : null}

        <div className="flex min-h-0 flex-1">
          <div className={`flex min-h-0 min-w-0 flex-1 ${activeSddDraft ? '' : stageInsetClass}`}>
          {activeSddDraft ? (
            <SddDraftEditorView
              leftSidebarCollapsed={leftSidebarCollapsed}
              assistantOpen={rightPanelMode === 'sdd-ai'}
              onToggleLeftSidebar={toggleLeftSidebar}
              onToggleAssistant={() => void toggleSddAssistantPanel()}
              onAssistantQuote={quoteToSddAssistant}
              onPrototypeTurn={sendSddPrototypeTurn}
              onNext={() => void handleSddNextStep()}
              onClose={() => dismissActiveSddDraft({ closeAssistant: true })}
              nextDisabled={busy || runtimeConnection !== 'ready' || sddDraftOperationStatus === 'upgrading'}
            />
          ) : (
            <section className="ds-chat-stage ds-drag flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="chat-topbar ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full shrink-0 items-stretch overflow-visible rounded-[24px]">
              <div className="chat-topbar-grid grid w-full min-w-0 items-start gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
                <div
                  className={`chat-topbar-session flex min-w-0 items-center gap-2.5 ${
                    leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
                  }`}
                >
                  {leftSidebarCollapsed ? (
                    <SidebarTitlebarToggleButton
                      onClick={toggleLeftSidebar}
                      title={t('sidebarExpand')}
                      ariaLabel={t('sidebarExpand')}
                    />
                  ) : null}
                  <SessionHeader compact className="min-w-0 flex-1" />
                </div>
                <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-start">
                  {busy ? (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                      {t('running')}
                    </span>
                  ) : null}
                  <WorkbenchTopBar
                    rightPanelMode={rightPanelMode}
                    onToggleRightPanelMode={toggleRightPanelMode}
                    planPanelEnabled={Boolean(activeGuiPlan)}
                    sideChatCount={currentSideConversations.length}
                    sideChatRunningCount={currentSideRunningCount}
                    sideChatOpen={sidePanel.open}
                    sideChatEnabled={runtimeConnection === 'ready' && Boolean(activeThreadId)}
                    onOpenSideChat={openSideChat}
                  />
                </div>
              </div>
            </header>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <MessageTimeline
                blocks={timelineBlocks}
                liveReasoning={timelineLiveReasoning}
                live={timelineLiveAssistant}
                activeThreadId={activeThreadId}
                runtimeConnection={runtimeConnection}
                runtimeError={error}
                onRetryConnection={() => void probeRuntime('user', { restart: true })}
                onOpenSettings={() => openSettings('agents')}
                onSelectSuggestion={(text) => setInput(text)}
                focusModeEnabled={focusModeEnabled}
                planActionsBusy={busy}
                onBuildPlan={() => void buildGuiPlan()}
                onOpenPlan={openGuiPlanPanel}
                devPreviewCard={
                  showDevPreviewCard ? (
                    <DevPreviewLaunchCard
                      url={latestDevPreviewUrl}
                      opened={rightPanelMode === 'browser'}
                      onOpen={openDevPreview}
                    />
                  ) : null
                }
              />
              {uiModeCameosEnabled && !focusModeEnabled ? <IkunCameoLayer /> : null}
              {!focusModeEnabled ? <KunCelebrationLayer active={busy} suppressed={Boolean(error)} /> : null}
            </div>
            <div className="ds-no-drag flex shrink-0 justify-center px-2 pb-3 pt-0 sm:px-4 md:px-6 lg:px-8">
              <FloatingComposer
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                busy={busy}
                runtimeReady={runtimeConnection === 'ready'}
                hasActiveThread={Boolean(activeThreadId)}
                composerModel={
                  route === 'claw'
                    ? clawChannels.find((channel) => channel.id === activeClawChannelId)?.model ?? 'auto'
                    : composerModel
                }
                composerProviderId={route === 'chat' ? composerProviderId : undefined}
                composerPickList={composerPickList}
                composerModelGroups={composerModelGroups}
                composerReasoningEffort={
                  route === 'chat' || route === 'claw' ? composerReasoningEffort : undefined
                }
                onComposerModelChange={(modelId, providerId) => {
                  if (route === 'claw' && activeClawChannelId) {
                    void setClawChannelModel(activeClawChannelId, modelId)
                    return
                  }
                  setComposerModel(modelId, providerId)
                }}
                onComposerReasoningEffortChange={
                  route === 'chat' || route === 'claw' ? setComposerReasoningEffort : undefined
                }
                onConfigureProviders={() => openSettings('providers')}
                onSend={handleSend}
                attachments={composerAttachments}
                attachmentUploadEnabled={attachmentUploadEnabled}
                attachmentUploadBusy={attachmentUploadBusy}
                attachmentUploadError={attachmentUploadError}
                fileReferenceEnabled={route === 'chat' && !activeSddDraft}
                fileReferences={composerFileReferences}
                webAccessAvailable={webAccessAvailable}
                executionSettings={composerExecutionSettings}
                executionSettingsApplying={composerExecutionApplying}
                changedFiles={composerChangeSummary?.files}
                changedFileStats={composerChangeSummary}
                skillCommands={runtimeSkills}
                disabledSkillIds={disabledSkillIds}
                onPickAttachments={(files) => void handlePickAttachments(files)}
                onPasteClipboardImage={(options) => void handlePasteClipboardImage(options)}
                onRemoveAttachment={removeComposerAttachment}
                onAddFileReference={addComposerFileReference}
                onRemoveFileReference={removeComposerFileReference}
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={removeQueuedMessage}
                onInterrupt={(options) => void interrupt(options)}
                onPlanCommand={() => void handleGuiPlanCommand()}
                onNewCommand={() => void createThread({ workspaceRoot: activeSkillWorkspace, forceNew: true })}
                onReviewCommand={(target) => void reviewActiveThread(target)}
                onExecutionSettingsChange={updateComposerExecutionSettings}
                onOpenChanges={() => setRightPanelMode('changes')}
                onReviewChanges={() => void reviewActiveThread({ kind: 'uncommittedChanges' })}
                reviewChangesDisabled={busy || runtimeConnection !== 'ready'}
                onBtwCommand={(seedText) => {
                  if (seedText?.trim()) {
                    void spawnSideConversation(seedText)
                    return
                  }
                  openSideConversationDraft()
                }}
              />
            </div>
          </section>
          )}
          </div>

          {route === 'chat' && !activeSddDraft ? (
            <SideConversationPanel rightOffset={rightPanelDockedVisible ? rightSidebarWidth + 24 : 24} />
          ) : null}

          {renderRightPanel()}
        </div>

          </>
        )}
        {renderPlanPanelOverlay()}
      </main>
    </div>
  )
}
