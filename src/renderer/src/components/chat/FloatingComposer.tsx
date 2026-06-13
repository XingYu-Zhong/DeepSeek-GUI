import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import {
  Archive,
  BarChart3,
  FileEdit,
  FileText,
  GitFork,
  ImagePlus,
  ListTodo,
  Loader2,
  MessageCircleMore,
  Mic,
  Minimize2,
  PauseCircle,
  Pencil,
  Plus,
  PlayCircle,
  RotateCcw,
  SearchCode,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { AttachmentReference, ReviewTarget } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  relativeWorkspacePath,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileMention,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import {
  COMPACT_COMMAND_ALIASES,
  getGoalPanelDraftObjective,
  getSlashQuery,
  NEW_COMMAND_ALIASES,
  parseBtwCommand,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseReviewCommand,
  REVIEW_COMMAND_ALIASES,
  type SlashCommand,
  type SlashCommandId
} from './floating-composer-commands'
export { parseBtwCommand, parseCompactCommand, parseGoalCommand, parseNewCommand, parseReviewCommand } from './floating-composer-commands'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import { GitBranchPicker } from './GitBranchPicker'
import {
  FloatingComposerModelPicker,
  type ComposerReasoningEffort
} from './FloatingComposerModelPicker'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import {
  type ComposerExecutionSettings
} from './FloatingComposerExecutionPicker'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'
import { useComposerDraft } from './use-composer-draft'
import { useSpeechToTextSettings, useVoiceDictation } from './use-voice-dictation'
import { VoiceRecordingStrip } from './VoiceRecordingStrip'
import type { ComposerChangedFile } from '../../lib/composer-change-summary'

export type { ComposerFileReference } from '../../lib/composer-file-references'
export type { ComposerExecutionSettings } from './FloatingComposerExecutionPicker'

type Props = {
  variant?: 'default' | 'compact'
  workspaceRootOverride?: string
  input: string
  setInput: (v: string) => void
  mode: 'plan' | 'agent'
  setMode: (m: 'plan' | 'agent') => void
  busy: boolean
  runtimeReady: boolean
  hasActiveThread: boolean
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort?: string
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onConfigureProviders?: () => void
  hideModelPicker?: boolean
  modelPickerMode?: 'select' | 'combobox'
  queuedMessages: QueuedComposerMessage[]
  onRemoveQueuedMessage: (id: string) => void
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  fileReferenceEnabled?: boolean
  fileReferences?: ComposerFileReference[]
  webAccessAvailable?: boolean
  executionSettings?: ComposerExecutionSettings | null
  executionSettingsApplying?: boolean
  changedFiles?: ComposerChangedFile[]
  changedFileStats?: { added: number; removed: number } | null
  skillCommands?: Array<{
    id: string
    name: string
    description?: string
    root?: string
    scope?: 'project' | 'global'
    legacy?: boolean
    triggers?: {
      commands?: string[]
      fileTypes?: string[]
      promptPatterns?: string[]
    }
  }>
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onAddFileReference?: (reference: ComposerFileReference) => void
  onRemoveFileReference?: (relativePath: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onPlanCommand?: () => void
  onNewCommand?: () => void
  onReviewCommand?: (target: ReviewTarget) => void
  onExecutionSettingsChange?: (patch: Partial<ComposerExecutionSettings>) => void
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  /**
   * When set, the `/btw` slash command is offered. It is omitted from
   * side-conversation composers (non-goal: no nested `/btw`).
   */
  onBtwCommand?: (seedText?: string) => void
  /**
   * Hide the `/btw` slash entry (e.g. inside a side conversation).
   */
  hideBtwCommand?: boolean
}

type SkillCommand = NonNullable<Props['skillCommands']>[number]

const EMPTY_MODEL_GROUPS: ModelProviderModelGroup[] = []
const EMPTY_ATTACHMENTS: AttachmentReference[] = []
const EMPTY_FILE_REFERENCES: ComposerFileReference[] = []
const EMPTY_CHANGED_FILES: ComposerChangedFile[] = []
const EMPTY_SKILL_COMMANDS: SkillCommand[] = []

type ComposerTransferItem = {
  kind?: string
  type?: string
  getAsFile?: () => File | null
}

type WorkspaceFileIndexRecord = {
  files: ComposerFileReference[]
  loadedAt: number
}

export type ComposerImageTransferSource = {
  files?: ArrayLike<File> | null
  items?: ArrayLike<ComposerTransferItem> | null
}

export type ComposerClipboardImageSource = ComposerImageTransferSource & {
  getData?: (format: string) => string
}

function ComposerImageAttachmentPreview({
  attachment,
  onRemoveAttachment
}: {
  attachment: AttachmentReference
  onRemoveAttachment?: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const title = attachment.name || attachment.id
  const previewUrl = attachment.previewUrl ?? ''

  return (
    <span
      className="ds-no-drag relative block h-20 w-20 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm"
      title={title}
    >
      <button
        type="button"
        onClick={() => setImagePreviewOpen(true)}
        className="block h-full w-full cursor-zoom-in"
        aria-label={t('imagePreviewOpen', { name: title })}
        title={t('imagePreviewOpen', { name: title })}
      >
        <img
          src={previewUrl}
          alt={title}
          className="h-full w-full object-cover"
        />
      </button>
      {onRemoveAttachment ? (
        <button
          type="button"
          onClick={() => onRemoveAttachment(attachment.id)}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950 text-white shadow-sm transition hover:bg-zinc-800"
          aria-label={t('composerRemoveAttachment')}
          title={t('composerRemoveAttachment')}
        >
          <X className="h-3 w-3" strokeWidth={2.2} />
        </button>
      ) : null}
      <ImagePreviewLightbox
        open={imagePreviewOpen}
        src={previewUrl}
        alt={title}
        title={title}
        downloadHref={previewUrl}
        downloadName={title}
        onClose={() => setImagePreviewOpen(false)}
      />
    </span>
  )
}

function arrayLikeValues<T>(value: ArrayLike<T> | null | undefined): T[] {
  if (!value) return []
  const out: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item) out.push(item)
  }
  return out
}

function isImageMimeType(value: string | undefined): boolean {
  return value?.toLowerCase().startsWith('image/') === true
}

function imageMimeTypeFromFileName(name: string | undefined): string | undefined {
  const lower = name?.toLowerCase() ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.heic')) return 'image/heic'
  if (lower.endsWith('.heif')) return 'image/heif'
  return undefined
}

function comparablePath(path: string | undefined): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isProjectSkillRoot(skillRoot: string | undefined, workspaceRoot: string): boolean {
  const root = comparablePath(skillRoot)
  const workspace = comparablePath(workspaceRoot)
  return Boolean(root && workspace && (root === workspace || root.startsWith(`${workspace}/`)))
}

function isProjectSkill(skill: { root?: string; scope?: 'project' | 'global' }, workspaceRoot: string): boolean {
  return skill.scope === 'project' || (skill.scope !== 'global' && isProjectSkillRoot(skill.root, workspaceRoot))
}

function normalizedImageFile(file: File, mimeTypeHint?: string): File | null {
  const mimeType = isImageMimeType(file.type)
    ? file.type
    : isImageMimeType(mimeTypeHint)
      ? mimeTypeHint
      : imageMimeTypeFromFileName(file.name)
  if (!mimeType) return null
  if (file.type === mimeType) return file
  return new File([file], file.name || 'image', {
    type: mimeType,
    lastModified: file.lastModified
  })
}

const FILE_MENTION_MAX_DEPTH = 6
const FILE_MENTION_MAX_DIRECTORIES = 140
const FILE_MENTION_MAX_FILES = 1200
const FILE_MENTION_CACHE_TTL_MS = 30_000
const FILE_MENTION_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const FILE_MENTION_TEXT_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.dart',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])
const FILE_MENTION_TEXT_NAMES = new Set([
  '.env',
  '.gitignore',
  'dockerfile',
  'makefile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme'
])
const workspaceFileIndexCache = new Map<string, WorkspaceFileIndexRecord | Promise<WorkspaceFileIndexRecord>>()

function isMentionableWorkspaceFile(entry: WorkspaceEntry): boolean {
  if (entry.type !== 'file') return false
  const name = entry.name.toLowerCase()
  if (FILE_MENTION_TEXT_NAMES.has(name)) return true
  if (!entry.ext) return false
  return FILE_MENTION_TEXT_EXTENSIONS.has(entry.ext.toLowerCase())
}

function fileReferenceFromEntry(entry: WorkspaceEntry, workspaceRoot: string): ComposerFileReference {
  const relativePath = relativeWorkspacePath(entry.path, workspaceRoot)
  return {
    path: entry.path,
    relativePath,
    name: entry.name
  }
}

async function loadWorkspaceFileIndex(workspaceRoot: string): Promise<WorkspaceFileIndexRecord> {
  const root = workspaceRoot.trim()
  const cached = workspaceFileIndexCache.get(root)
  const now = Date.now()
  if (cached && !(cached instanceof Promise) && now - cached.loadedAt < FILE_MENTION_CACHE_TTL_MS) {
    return cached
  }
  if (cached instanceof Promise) return cached

  const task = (async (): Promise<WorkspaceFileIndexRecord> => {
    const files: ComposerFileReference[] = []
    const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
    let visitedDirectories = 0

    while (
      queue.length > 0 &&
      visitedDirectories < FILE_MENTION_MAX_DIRECTORIES &&
      files.length < FILE_MENTION_MAX_FILES
    ) {
      const current = queue.shift()
      if (!current) break
      visitedDirectories += 1
      const result = await window.kunGui.listWorkspaceDirectory({
        workspaceRoot: root,
        path: current.path
      })
      if (!result.ok) continue

      for (const entry of result.entries) {
        if (entry.type === 'directory') {
          if (
            current.depth < FILE_MENTION_MAX_DEPTH &&
            !FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())
          ) {
            queue.push({ path: entry.path, depth: current.depth + 1 })
          }
          continue
        }
        if (isMentionableWorkspaceFile(entry)) {
          files.push(fileReferenceFromEntry(entry, root))
          if (files.length >= FILE_MENTION_MAX_FILES) break
        }
      }
    }

    return { files, loadedAt: Date.now() }
  })()

  workspaceFileIndexCache.set(root, task)
  try {
    const result = await task
    workspaceFileIndexCache.set(root, result)
    return result
  } catch (error) {
    workspaceFileIndexCache.delete(root)
    throw error
  }
}

export function imageFilesFromTransfer(source: ComposerImageTransferSource | null | undefined): File[] {
  if (!source) return []
  const files: File[] = []
  const seen = new Set<File>()
  const addFile = (file: File | null | undefined, mimeTypeHint?: string): void => {
    if (!file || seen.has(file)) return
    seen.add(file)
    const normalized = normalizedImageFile(file, mimeTypeHint)
    if (normalized) files.push(normalized)
  }

  for (const item of arrayLikeValues(source.items)) {
    if (item.kind && item.kind !== 'file') continue
    if (!isImageMimeType(item.type)) continue
    addFile(item.getAsFile?.(), item.type)
  }
  for (const file of arrayLikeValues(source.files)) {
    addFile(file)
  }
  return files
}

export function imageTransferHasImages(source: ComposerImageTransferSource | null | undefined): boolean {
  if (!source) return false
  if (arrayLikeValues(source.files).some((file) => normalizedImageFile(file) !== null)) return true
  return arrayLikeValues(source.items).some((item) =>
    (!item.kind || item.kind === 'file') && isImageMimeType(item.type)
  )
}

export function handleComposerImagePaste({
  canPickAttachment,
  clipboardData,
  preventDefault,
  onPickAttachments,
  onPasteClipboardImage
}: {
  canPickAttachment: boolean
  clipboardData: ComposerClipboardImageSource
  preventDefault: () => void
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
}): boolean {
  if (!canPickAttachment || (!onPickAttachments && !onPasteClipboardImage)) return false
  const files = imageFilesFromTransfer(clipboardData)
  const hasPlainText = Boolean(clipboardData.getData?.('text/plain'))
  const hasImageTransfer = imageTransferHasImages(clipboardData)
  if (files.length > 0) {
    preventDefault()
    if (onPasteClipboardImage) {
      void onPasteClipboardImage({ silentNoImage: false })
      return true
    }
    onPickAttachments?.(files)
    return true
  }
  if (!onPasteClipboardImage) return false

  const shouldPreventDefault = !hasPlainText || hasImageTransfer
  if (shouldPreventDefault) preventDefault()
  void onPasteClipboardImage({ silentNoImage: !shouldPreventDefault })
  return shouldPreventDefault
}

export function formatGoalElapsedSeconds(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  if (value < 60) return `${value}s`
  const minutes = Math.floor(value / 60)
  const remainingSeconds = value % 60
  if (value < 3600) {
    return remainingSeconds === 0
      ? `${minutes}m`
      : `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(value / 3600)
  const remainingMinutes = Math.floor((value % 3600) / 60)
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`
}

export function shouldShowGoalFloater({
  compact,
  hasActiveGoal,
  slashQuery,
  goalPanelOpen,
  composerMenuOpen
}: {
  compact: boolean
  hasActiveGoal: boolean
  slashQuery: string | null
  goalPanelOpen: boolean
  composerMenuOpen: boolean
}): boolean {
  return !compact && hasActiveGoal && slashQuery == null && !goalPanelOpen && !composerMenuOpen
}

export function FloatingComposer({
  variant = 'default',
  workspaceRootOverride,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeReady,
  hasActiveThread,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups = EMPTY_MODEL_GROUPS,
  composerReasoningEffort,
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onConfigureProviders,
  hideModelPicker = false,
  modelPickerMode = 'select',
  queuedMessages,
  onRemoveQueuedMessage,
  attachments = EMPTY_ATTACHMENTS,
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  fileReferenceEnabled = false,
  fileReferences = EMPTY_FILE_REFERENCES,
  executionSettings = null,
  executionSettingsApplying = false,
  changedFiles = EMPTY_CHANGED_FILES,
  changedFileStats = null,
  skillCommands = EMPTY_SKILL_COMMANDS,
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onAddFileReference,
  onRemoveFileReference,
  onSend,
  onInterrupt,
  onPlanCommand,
  onNewCommand,
  onReviewCommand,
  onExecutionSettingsChange,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  onBtwCommand,
  hideBtwCommand = false
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const usageRefreshKey = useChatStore((s) => s.usageRefreshKey)
  const threads = useChatStore((s) => s.threads)
  const compactActiveThread = useChatStore((s) => s.compactActiveThread)
  const forkActiveThread = useChatStore((s) => s.forkActiveThread)
  const archiveThread = useChatStore((s) => s.archiveThread)
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const setActiveThreadGoal = useChatStore((s) => s.setActiveThreadGoal)
  const setActiveThreadGoalStatus = useChatStore((s) => s.setActiveThreadGoalStatus)
  const clearActiveThreadGoal = useChatStore((s) => s.clearActiveThreadGoal)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const compact = variant === 'compact'
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const speechToTextSettings = useSpeechToTextSettings()
  const dictationInputRef = useRef(input)
  useEffect(() => {
    dictationInputRef.current = input
  }, [input])
  const dictationPrimaryActionRef = useRef<(() => void) | null>(null)
  const dictation = useVoiceDictation({
    speechToText: speechToTextSettings,
    onText: (text, intent) => {
      const existing = dictationInputRef.current.replace(/\s+$/, '')
      setInput(existing ? `${existing} ${text}` : text)
      if (intent === 'send') {
        // 等 setInput 的重渲染落地后再走正常的发送路径,
        // 这样语音直发和手动点发送行为完全一致。
        window.setTimeout(() => dictationPrimaryActionRef.current?.(), 0)
      }
    }
  })
  const showVoiceDictation = Boolean(
    speechToTextSettings?.enabled &&
    speechToTextSettings.baseUrl.trim() &&
    speechToTextSettings.apiKey.trim() &&
    speechToTextSettings.model.trim()
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeThreadWorkspace = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.workspace
    : ''
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  const activeThreadArchived = activeThread?.archived === true
  const showThreadUsageFooter = !compact && route === 'chat' && Boolean(activeThreadId) && runtimeReady
  const threadUsageState = useThreadUsageState(
    activeThreadId,
    showThreadUsageFooter,
    `${activeThread?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}:${usageRefreshKey}`
  )
  const threadUsage = threadUsageState.usage
  const effectiveWorkspaceRoot = normalizeWorkspaceRoot(activeThreadWorkspace || workspaceRootOverride || workspaceRoot)
  const clawAgentName =
    activeClawChannel?.agentProfile.name.trim()
    || activeClawChannel?.label.trim()
    || t('clawEmptyHeroFallbackName')
  const clawHasInboundConversation = Boolean(
    activeThreadId ||
    activeClawChannel?.threadId.trim() ||
    activeClawChannel?.conversations.some((conversation) => conversation.localThreadId.trim()) ||
    activeClawChannel?.conversations.length ||
    activeClawChannel?.remoteSession?.chatId?.trim()
  )

  const canEditComposer = route === 'claw' ? clawHasInboundConversation : true
  const canCompose = runtimeReady && (
    route === 'claw'
      ? clawHasInboundConversation
      : (hasActiveThread || !!effectiveWorkspaceRoot)
  )
  const canChangeModel = canCompose && !busy
  const canSend = canCompose && (
    input.trim().length > 0 ||
    (attachmentUploadEnabled && attachments.length > 0) ||
    (fileReferenceEnabled && fileReferences.length > 0)
  )
  const canPickAttachment = canCompose && attachmentUploadEnabled && !attachmentUploadBusy
  const showIntentToolbar = !compact && route === 'chat'
  const showComposerMenuButton = showIntentToolbar
  const canTogglePlanMode = canCompose && Boolean(onPlanCommand)
  const canCreateNewThread = runtimeReady && route !== 'claw' && Boolean(effectiveWorkspaceRoot) && Boolean(onNewCommand)
  const canOpenGoalPanel = canCompose && route !== 'claw'
  const canRunReview = canCompose && route !== 'claw' && Boolean(onReviewCommand)
  const canOpenComposerMenu = showComposerMenuButton
    && (canTogglePlanMode || canCreateNewThread || canOpenGoalPanel || canRunReview)
  const showToolbarStartControls = showComposerMenuButton
  const showChangeSummary = !compact && route === 'chat' && changedFiles.length > 0
  const effectiveChangedFileStats = changedFileStats ?? changedFiles.reduce(
    (stats, file) => ({
      added: stats.added + file.added,
      removed: stats.removed + file.removed
    }),
    { added: 0, removed: 0 }
  )
  const visibleChangedFiles = changedFiles.slice(0, 3)
  const hiddenChangedFileCount = Math.max(0, changedFiles.length - visibleChangedFiles.length)
  const stretchModelPicker =
    compact && modelPickerMode === 'combobox' && !showToolbarStartControls && !hideModelPicker
  const draft = useComposerDraft({ input, canCompose: canEditComposer })
  const slashQuery = getSlashQuery(input)
  const [composerCursor, setComposerCursor] = useState(() => input.length)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [fileMentionSuggestions, setFileMentionSuggestions] = useState<ComposerFileReference[]>([])
  const [fileMentionLoading, setFileMentionLoading] = useState(false)
  const [selectedFileMentionIndex, setSelectedFileMentionIndex] = useState(0)
  const [dismissedFileMentionKey, setDismissedFileMentionKey] = useState<string | null>(null)
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [goalPanelOpen, setGoalPanelOpen] = useState(false)
  const [goalRuntimeNowMs, setGoalRuntimeNowMs] = useState(() => Date.now())
  const composerRootRef = useRef<HTMLDivElement | null>(null)
  const composerMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const goalPanelRef = useRef<HTMLDivElement | null>(null)
  const goalRuntimeStartedAtRef = useRef<number | null>(null)
  const placeholder = !runtimeReady
    ? t('runtimeActionNeedsConnection')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('workspaceRequiredToCreateThread')
      : goalPanelOpen && route !== 'claw'
        ? t('goalComposerPlaceholder')
      : busy
        ? t('composerQueuePlaceholder')
        : route === 'claw'
            ? clawHasInboundConversation
              ? t('clawPlaceholder', { name: clawAgentName })
              : t('clawPlaceholderNeedsInbound')
            : mode === 'plan'
              ? t('composerPlanPlaceholder')
              : hasActiveThread
                ? t('placeholder')
                : t('composerStartsThread')
  const footerHint = !runtimeReady
    ? t('composerOfflineHint')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('composerWorkspaceHint')
      : route === 'claw'
          ? clawHasInboundConversation
            ? t('clawComposerHint')
            : t('clawComposerHintNeedsInbound')
          : t('composerSlashHint')
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const threadActionDisabled = !runtimeReady || busy || !activeThreadId
    const goalActionDisabled = !canOpenGoalPanel
    const commands: SlashCommand[] = []
    if (route !== 'claw') {
      commands.push({
        id: 'new',
        title: t('slashCommandNewTitle'),
        description: t('slashCommandNewDescription'),
        keywords: ['create', 'new', 'thread', 'chat', '会话', '新建', ...NEW_COMMAND_ALIASES],
        icon: <Plus className="h-4 w-4" strokeWidth={1.9} />,
        disabled: !canCreateNewThread
      })
    }
    if (onPlanCommand) {
      commands.push({
        id: 'plan',
        title: t('slashCommandPlanTitle'),
        description: t('slashCommandPlanDescription'),
        keywords: ['plan', 'planner', 'planning', '规划', '计划'],
        icon: <ListTodo className="h-4 w-4" strokeWidth={1.9} />
      })
    }

    if (route !== 'claw') {
      const dynamicSkillCommands = skillCommands
        .filter((skill) => skill.id.trim() && skill.name.trim())
        .sort((left, right) => {
          const leftProject = isProjectSkill(left, effectiveWorkspaceRoot)
          const rightProject = isProjectSkill(right, effectiveWorkspaceRoot)
          if (leftProject !== rightProject) return leftProject ? -1 : 1
          return left.name.localeCompare(right.name)
        })
        .slice(0, 40)
        .map<SlashCommand>((skill) => {
          const prompt = `/skill:${skill.id} `
          const scopeLabel = isProjectSkill(skill, effectiveWorkspaceRoot)
            ? t('slashSkillScopeProject')
            : t('slashSkillScopeGlobal')
          const triggers = [
            ...(skill.triggers?.commands ?? []),
            ...(skill.triggers?.fileTypes ?? []),
            ...(skill.triggers?.promptPatterns ?? [])
          ]
          return {
            id: `skill:${skill.id}`,
            kind: 'skill',
            title: skill.name,
            description: skill.description?.trim() || t('slashSkillDescriptionFallback'),
            keywords: [skill.id, skill.name, skill.root ?? '', scopeLabel, 'skill', '技能', ...triggers],
            icon: <Sparkles className="h-4 w-4" strokeWidth={1.9} />,
            badge: prompt.trim(),
            scopeLabel,
            skillPrompt: prompt,
            disabled: !runtimeReady
          }
        })
      commands.push(...dynamicSkillCommands)

      commands.push({
        id: 'goal',
        title: t('slashCommandGoalTitle'),
        description: t('slashCommandGoalDescription'),
        keywords: ['goal', 'objective', 'target', '目标', '任务'],
        icon: <Target className="h-4 w-4" strokeWidth={1.9} />,
        disabled: goalActionDisabled
      })

      if (onBtwCommand && !hideBtwCommand) {
        // `/btw` is available even while the main thread is busy — the
        // point of the command is to run a parallel aside next to a
        // running task.
        commands.push({
          id: 'btw',
          title: t('slashCommandBtwTitle'),
          description: t('slashCommandBtwDescription'),
          keywords: ['btw', 'by-the-way', 'aside', 'side', '顺便', '旁支'],
          icon: <MessageCircleMore className="h-4 w-4" strokeWidth={1.9} />,
          disabled: !runtimeReady || !activeThreadId
        })
      }

      if (onReviewCommand) {
        commands.push({
          id: 'review',
          title: t('slashCommandReviewTitle'),
          description: t('slashCommandReviewDescription'),
          keywords: REVIEW_COMMAND_ALIASES,
          icon: <SearchCode className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }

      commands.push(
        {
          id: 'compact',
          title: t('slashCommandCompactTitle'),
          description: t('slashCommandCompactDescription'),
          keywords: COMPACT_COMMAND_ALIASES,
          icon: <Minimize2 className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        },
        {
          id: 'fork',
          title: t('slashCommandForkTitle'),
          description: t('slashCommandForkDescription'),
          keywords: ['fork', 'branch', 'copy', '分叉', '复制'],
          icon: <GitFork className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        }
      )

      if (activeThreadArchived) {
        commands.push({
          id: 'restore',
          title: t('slashCommandRestoreTitle'),
          description: t('slashCommandRestoreDescription'),
          keywords: ['restore', 'unarchive', '恢复'],
          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      } else {
        commands.push({
          id: 'archive',
          title: t('slashCommandArchiveTitle'),
          description: t('slashCommandArchiveDescription'),
          keywords: ['archive', 'hide', '归档'],
          icon: <Archive className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }
    }

    return commands
  }, [
    activeThreadArchived,
    activeThreadId,
    busy,
    canOpenGoalPanel,
    effectiveWorkspaceRoot,
    hideBtwCommand,
    onBtwCommand,
    canCreateNewThread,
    onPlanCommand,
    onReviewCommand,
    route,
    runtimeReady,
    skillCommands,
    t
  ])

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery == null) return []
    if (!slashQuery) return slashCommands
    return slashCommands.filter((command) => {
      const haystack = [command.id, command.title, command.description, ...command.keywords]
      return haystack.some((part) => part.toLowerCase().includes(slashQuery))
    })
  }, [slashCommands, slashQuery])

  const highlightedSlashCommand =
    filteredSlashCommands.length > 0
      ? filteredSlashCommands[Math.min(selectedCommandIndex, filteredSlashCommands.length - 1)]
      : null
  const activeFileMention = useMemo<ComposerFileMention | null>(() => {
    if (!fileReferenceEnabled || slashQuery != null || !effectiveWorkspaceRoot) return null
    return getFileMentionAtCursor(input, composerCursor)
  }, [composerCursor, effectiveWorkspaceRoot, fileReferenceEnabled, input, slashQuery])
  const activeFileMentionKey = activeFileMention
    ? `${activeFileMention.start}:${activeFileMention.query}:${activeFileMention.quoted ? 'q' : 'p'}`
    : null
  const showFileMentionMenu =
    canCompose &&
    Boolean(activeFileMention) &&
    activeFileMentionKey !== dismissedFileMentionKey &&
    !composerMenuOpen &&
    !goalPanelOpen
  const highlightedFileMention =
    fileMentionSuggestions.length > 0
      ? fileMentionSuggestions[Math.min(selectedFileMentionIndex, fileMentionSuggestions.length - 1)]
      : null
  const parsedGoalCommand = parseGoalCommand(input)
  const goalPanelDraftObjective = getGoalPanelDraftObjective(input, goalPanelOpen)
  const canSetGoalPanelDraft =
    route !== 'claw'
    && runtimeReady
    && canOpenGoalPanel
    && goalPanelDraftObjective.length > 0
  const primaryActionLabel = highlightedSlashCommand
    ? t('slashCommandApply')
    : canSetGoalPanelDraft
      ? t('goalSetCurrentInput')
    : busy
      ? t('queueMessage')
      : t('send')
  const primaryActionDisabled = highlightedSlashCommand
    ? highlightedSlashCommand.disabled === true
    : canSetGoalPanelDraft
      ? false
    : !canSend
  const primaryActionLoading = !runtimeReady
  const goalRuntimeStartedAtMs = goalRuntimeStartedAtRef.current
  const liveGoalElapsedSeconds =
    busy && activeThreadGoal?.status === 'active' && goalRuntimeStartedAtMs != null
      ? Math.max(0, Math.floor((goalRuntimeNowMs - goalRuntimeStartedAtMs) / 1000))
      : 0
  const goalElapsedLabel = activeThreadGoal
    ? formatGoalElapsedSeconds((activeThreadGoal.timeUsedSeconds ?? 0) + liveGoalElapsedSeconds)
    : ''
  const goalBannerLabel = activeThreadGoal
    ? activeThreadGoal.status === 'active'
      ? t('goalActiveHeading')
      : t(`goalStatusShort.${activeThreadGoal.status}`)
    : ''
  const goalMenuChecked = activeThreadGoal?.status === 'active'
  const showGoalFloater = shouldShowGoalFloater({
    compact,
    hasActiveGoal: Boolean(activeThreadGoal),
    slashQuery,
    goalPanelOpen,
    composerMenuOpen
  })

  useEffect(() => {
    setSelectedCommandIndex(0)
  }, [slashQuery])

  useEffect(() => {
    setSelectedFileMentionIndex(0)
  }, [activeFileMentionKey])

  useEffect(() => {
    if (slashQuery != null || goalPanelOpen) setComposerMenuOpen(false)
  }, [goalPanelOpen, slashQuery])

  useEffect(() => {
    if (!showFileMentionMenu || !activeFileMention || !effectiveWorkspaceRoot) {
      setFileMentionSuggestions((current) => (current.length === 0 ? current : []))
      setFileMentionLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setFileMentionLoading(true)
      void loadWorkspaceFileIndex(effectiveWorkspaceRoot)
        .then((index) => {
          if (cancelled) return
          setFileMentionSuggestions(
            filterWorkspaceFileMentionSuggestions(index.files, activeFileMention.query, fileReferences)
          )
        })
        .catch(() => {
          if (!cancelled) setFileMentionSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setFileMentionLoading(false)
        })
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeFileMention, effectiveWorkspaceRoot, fileReferences, showFileMentionMenu])

  useEffect(() => {
    if (!composerMenuOpen && !goalPanelOpen) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (composerMenuButtonRef.current?.contains(target)) return
      if (composerMenuPanelRef.current?.contains(target)) return
      if (goalPanelRef.current?.contains(target)) return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setComposerMenuOpen(false)
      setGoalPanelOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [composerMenuOpen, goalPanelOpen])

  useEffect(() => {
    const shouldTimeGoal = busy && activeThreadGoal?.status === 'active'
    if (!shouldTimeGoal) {
      goalRuntimeStartedAtRef.current = null
      setGoalRuntimeNowMs(Date.now())
      return
    }

    if (goalRuntimeStartedAtRef.current == null) {
      const startedAt = Date.now()
      goalRuntimeStartedAtRef.current = startedAt
      setGoalRuntimeNowMs(startedAt)
    }

    const interval = window.setInterval(() => {
      setGoalRuntimeNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [busy, activeThreadGoal?.createdAt, activeThreadGoal?.objective, activeThreadGoal?.status])

  const applySlashCommand = (commandId: SlashCommandId): void => {
    if (commandId.startsWith('skill:')) {
      const command = slashCommands.find((item) => item.id === commandId)
      if (command?.skillPrompt) {
        setInput(command.skillPrompt)
        draft.focusComposer()
      }
      return
    }
    if (commandId === 'plan') {
      setInput('')
      setMode('plan')
      onPlanCommand?.()
      draft.focusComposer()
      return
    }
    if (commandId === 'new' && onNewCommand) {
      setInput('')
      onNewCommand()
      draft.focusComposer()
      return
    }
    if (commandId === 'compact') {
      setInput('')
      void compactActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'goal') {
      setInput('')
      setGoalPanelOpen(true)
      draft.focusComposer()
      return
    }
    if (commandId === 'review' && onReviewCommand) {
      setInput('')
      void onReviewCommand({ kind: 'uncommittedChanges' })
      draft.focusComposer()
      return
    }
    if (commandId === 'fork') {
      setInput('')
      void forkActiveThread()
      draft.focusComposer()
      return
    }
    if (commandId === 'archive' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, true)
      draft.focusComposer()
      return
    }
    if (commandId === 'restore' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, false)
      draft.focusComposer()
      return
    }
    if (commandId === 'btw' && onBtwCommand) {
      // Empty aside — open a side conversation without a seed question.
      setInput('')
      void onBtwCommand()
      return
    }
  }

  const runGoalCommand = (command: ReturnType<typeof parseGoalCommand>): boolean => {
    if (command === false) return false
    if (!canOpenGoalPanel) return true
    setInput('')
    setGoalPanelOpen(false)
    if (command.action === 'menu') {
      setGoalPanelOpen(true)
      draft.focusComposer()
      return true
    }
    if (command.action === 'set') {
      void setActiveThreadGoal(command.objective)
      return true
    }
    if (command.action === 'pause') {
      void setActiveThreadGoalStatus('paused')
      return true
    }
    if (command.action === 'resume') {
      void setActiveThreadGoalStatus('active')
      return true
    }
    if (command.action === 'clear') {
      void clearActiveThreadGoal()
      return true
    }
    return true
  }

  const setGoalFromComposerInput = (): boolean => {
    if (!canSetGoalPanelDraft) return false
    setInput('')
    setGoalPanelOpen(false)
    void setActiveThreadGoal(goalPanelDraftObjective)
    draft.focusComposer()
    return true
  }

  const handleComposerMenuButtonClick = (): void => {
    if (!canOpenComposerMenu) return
    setGoalPanelOpen(false)
    setComposerMenuOpen((open) => !open)
    draft.focusComposer()
  }

  const handleAttachmentMenuClick = (): void => {
    if (!canPickAttachment || !onPickAttachments) return
    setComposerMenuOpen(false)
    fileInputRef.current?.click()
    draft.focusComposer()
  }

  const handlePlanToolbarClick = (): void => {
    if (!canTogglePlanMode) return
    setComposerMenuOpen(false)
    if (mode === 'plan') {
      setMode('agent')
    } else {
      setMode('plan')
      onPlanCommand?.()
    }
    draft.focusComposer()
  }

  const handleGoalMenuClick = (): void => {
    if (!canOpenGoalPanel) return
    setComposerMenuOpen(false)
    if (activeThreadGoal?.status === 'active') {
      void setActiveThreadGoalStatus('paused')
    } else if (activeThreadGoal) {
      void setActiveThreadGoalStatus('active')
    } else {
      setGoalPanelOpen(true)
    }
    draft.focusComposer()
  }

  const syncComposerCursor = (element = draft.textareaRef.current): void => {
    if (!element) return
    setComposerCursor(element.selectionStart ?? input.length)
  }

  const applyFileMention = (reference: ComposerFileReference | null): void => {
    if (!reference || !activeFileMention) return
    const next = replaceFileMentionInInput(input, activeFileMention, reference)
    setInput(next.input)
    onAddFileReference?.(reference)
    setDismissedFileMentionKey(null)
    window.requestAnimationFrame(() => {
      const textarea = draft.textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
      setComposerCursor(next.cursor)
    })
  }

  const removeFileReference = (relativePath: string): void => {
    onRemoveFileReference?.(relativePath)
    const nextInput = removeComposerFileMentionToken(input, relativePath)
    if (nextInput !== input) {
      setInput(nextInput)
      window.requestAnimationFrame(() => syncComposerCursor())
    }
    draft.focusComposer()
  }

  const handlePrimaryAction = (): void => {
    if (highlightedSlashCommand) {
      if (highlightedSlashCommand.disabled) return
      applySlashCommand(highlightedSlashCommand.id)
      return
    }
    if (setGoalFromComposerInput()) {
      return
    }
    if (runGoalCommand(parsedGoalCommand)) {
      return
    }
    if (onNewCommand && parseNewCommand(input)) {
      const command = slashCommands.find((item) => item.id === 'new')
      if (command?.disabled) return
      setInput('')
      onNewCommand()
      draft.focusComposer()
      return
    }
    const compactCommand = parseCompactCommand(input)
    if (compactCommand) {
      const command = slashCommands.find((item) => item.id === 'compact')
      if (command?.disabled) return
      setInput('')
      void compactActiveThread(compactCommand.reason)
      draft.focusComposer()
      return
    }
    if (onReviewCommand) {
      const reviewCommand = parseReviewCommand(input)
      if (reviewCommand !== false) {
        const command = slashCommands.find((item) => item.id === 'review')
        if (command?.disabled) return
        setInput('')
        void onReviewCommand(reviewCommand)
        draft.focusComposer()
        return
      }
    }
    // Send-time interception: `/btw <question>` is treated as a side
    // conversation spawn, mirroring the plan-mode interception.
    if (onBtwCommand && !hideBtwCommand) {
      const parsed = parseBtwCommand(input)
      if (parsed !== false) {
        setInput('')
        void onBtwCommand(parsed ?? undefined)
        return
      }
    }
    onSend()
  }
  dictationPrimaryActionRef.current = primaryActionDisabled ? null : handlePrimaryAction

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const sendByEnter =
      event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey
    const composing = draft.isComposingEvent(event)

    if (!composing && showFileMentionMenu) {
      if (event.key === 'ArrowDown' && fileMentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedFileMentionIndex((current) => (current + 1) % fileMentionSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp' && fileMentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedFileMentionIndex((current) =>
          current === 0 ? fileMentionSuggestions.length - 1 : current - 1
        )
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && highlightedFileMention) {
        event.preventDefault()
        applyFileMention(highlightedFileMention)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedFileMentionKey(activeFileMentionKey)
        setFileMentionSuggestions([])
        return
      }
    }

    if (!composing && slashQuery != null) {
      if (event.key === 'ArrowDown' && filteredSlashCommands.length > 0) {
        event.preventDefault()
        setSelectedCommandIndex((current) => (current + 1) % filteredSlashCommands.length)
        return
      }
      if (event.key === 'ArrowUp' && filteredSlashCommands.length > 0) {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          current === 0 ? filteredSlashCommands.length - 1 : current - 1
        )
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setInput('')
        return
      }
    }

    if (!sendByEnter || composing) return

    event.preventDefault()
    handlePrimaryAction()
  }

  const handleComposerShellMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!canEditComposer) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest("button,input,textarea,select,a,summary,[role='button'],[contenteditable='true']")
    ) {
      return
    }
    event.preventDefault()
    draft.textareaRef.current?.focus()
  }

  useEffect(() => {
    if (compact || route !== 'chat' || !canEditComposer) return
    const active = document.activeElement
    const activeIsExternalEditor =
      active instanceof HTMLElement &&
      Boolean(active.closest("input,textarea,select,[contenteditable='true']")) &&
      !composerRootRef.current?.contains(active)
    if (activeIsExternalEditor) return

    const frame = window.requestAnimationFrame(() => {
      const current = document.activeElement
      const currentIsExternalEditor =
        current instanceof HTMLElement &&
        Boolean(current.closest("input,textarea,select,[contenteditable='true']")) &&
        !composerRootRef.current?.contains(current)
      if (!currentIsExternalEditor) {
        draft.textareaRef.current?.focus()
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeThreadId, canEditComposer, compact, route, runtimeReady, draft.textareaRef])

  const handleAttachmentInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0 || !onPickAttachments) return
    onPickAttachments(files)
  }

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLElement>): void => {
    handleComposerImagePaste({
      canPickAttachment,
      clipboardData: event.clipboardData,
      preventDefault: () => event.preventDefault(),
      onPickAttachments,
      onPasteClipboardImage
    })
  }

  const handleComposerDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    const dataTransferTypes = Array.from(event.dataTransfer.types ?? [])
    const canAcceptImages = canPickAttachment && imageTransferHasImages(event.dataTransfer)
    if (!dataTransferTypes.includes('Files') && !canAcceptImages) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const insertTextAtComposerCursor = (text: string): void => {
    if (!text) return
    const textarea = draft.textareaRef.current
    const currentValue = input
    const selectionStart = textarea?.selectionStart ?? composerCursor ?? currentValue.length
    const selectionEnd = textarea?.selectionEnd ?? selectionStart
    const before = currentValue.slice(0, selectionStart)
    const after = currentValue.slice(selectionEnd)
    const leadingPad = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const trailingPad = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
    const insertion = `${leadingPad}${text}${trailingPad}`
    const nextInput = `${before}${insertion}${after}`
    const nextCursor = before.length + insertion.length - trailingPad.length
    setInput(nextInput)
    window.requestAnimationFrame(() => {
      const el = draft.textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
      setComposerCursor(nextCursor)
    })
  }

  const handleComposerDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const imageFiles = canPickAttachment ? imageFilesFromTransfer(event.dataTransfer) : []
    const rawFiles = Array.from(event.dataTransfer.files ?? [])
    const isImageLike = (file: File): boolean =>
      isImageMimeType(file.type) || Boolean(imageMimeTypeFromFileName(file.name))
    const pathFiles = rawFiles.filter((file) => !isImageLike(file))
    if (imageFiles.length === 0 && pathFiles.length === 0) return
    event.preventDefault()
    if (imageFiles.length > 0 && onPickAttachments) {
      onPickAttachments(imageFiles)
    }
    if (pathFiles.length > 0) {
      const paths: string[] = []
      for (const file of pathFiles) {
        try {
          const path = window.kunGui.getPathForFile(file)
          if (path) paths.push(path)
        } catch {
          // ignore files we cannot resolve a filesystem path for
        }
      }
      if (paths.length > 0) insertTextAtComposerCursor(paths.join(' '))
    }
    draft.focusComposer()
  }

  return (
    <div
      ref={composerRootRef}
      className={compact
        ? 'ds-floating-composer ds-no-drag pointer-events-auto w-full pb-0 pt-0'
        : 'ds-floating-composer ds-no-drag ds-chat-column-inset pointer-events-auto w-full max-w-4xl pb-3 pt-0'}
    >
      <FloatingComposerQueuedMessages
        messages={queuedMessages}
        onRemove={onRemoveQueuedMessage}
      />

      <div className="relative">
        {showGoalFloater && activeThreadGoal ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-full z-20 mb-2 flex justify-center">
            <div className="pointer-events-auto flex min-h-11 w-full max-w-[46rem] items-center gap-2 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1.5 text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl dark:bg-ds-card/90">
              <Target className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-5">
                <span className="shrink-0 font-semibold text-ds-ink">
                  {goalBannerLabel}
                </span>
                <span className="min-w-0 truncate text-ds-muted">
                  {activeThreadGoal.objective}
                </span>
                <span className="shrink-0 text-ds-faint">
                  · {goalElapsedLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setGoalPanelOpen(true)
                    draft.focusComposer()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionEdit')}
                  title={t('goalActionEdit')}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setActiveThreadGoalStatus(activeThreadGoal.status === 'active' ? 'paused' : 'active')
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                  title={activeThreadGoal.status === 'active' ? t('goalActionPause') : t('goalActionResume')}
                >
                  {activeThreadGoal.status === 'active' ? (
                    <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void clearActiveThreadGoal()
                  }}
                  className="ds-no-drag flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('goalActionClear')}
                  title={t('goalActionClear')}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {composerMenuOpen && slashQuery == null ? (
          <div
            ref={composerMenuPanelRef}
            className="absolute bottom-12 left-1 z-40 w-48 overflow-hidden rounded-[18px] border border-ds-border bg-white py-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            {attachmentUploadEnabled ? (
              <>
                <button
                  type="button"
                  disabled={!canPickAttachment || !onPickAttachments}
                  onClick={handleAttachmentMenuClick}
                  className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                >
                  {attachmentUploadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.9} />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t('composerAddImage')}</span>
                </button>
                <div className="my-1 h-px bg-ds-border-muted/70" />
              </>
            ) : null}
            <button
              type="button"
              disabled={!canTogglePlanMode}
              onClick={handlePlanToolbarClick}
              className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
            >
              <ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">{t('composerMenuPlanMode')}</span>
              <span
                role="switch"
                aria-checked={mode === 'plan'}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  mode === 'plan'
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    mode === 'plan' ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                />
              </span>
            </button>
            <button
              type="button"
              disabled={!canOpenGoalPanel}
              onClick={handleGoalMenuClick}
              className="ds-no-drag flex h-8 w-full items-center gap-2 px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
            >
              <Target className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">{t('composerMenuPursueGoal')}</span>
              <span
                role="switch"
                aria-checked={goalMenuChecked}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  goalMenuChecked
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    goalMenuChecked ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                />
              </span>
            </button>
          </div>
        ) : null}

        {slashQuery != null ? (
          <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[760px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(20,47,95,0.14)]">
            <div className="flex h-7 items-center px-2.5 text-[11.5px] font-semibold text-ds-muted">
              {t('slashCommandMenuTitle')}
            </div>
            {filteredSlashCommands.length > 0 ? (
              <div className="flex max-h-[min(300px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1">
                {filteredSlashCommands.map((command) => {
                  const active = highlightedSlashCommand?.id === command.id
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashCommand(command.id)}
                      disabled={command.disabled}
                      className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        active && !command.disabled
                          ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(20,47,95,0.06)]'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent disabled:hover:text-ds-muted'
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                          active && !command.disabled ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                        }`}
                      >
                        {command.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                          {command.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                          {command.description}
                        </span>
                      </span>
                      <span className="hidden min-w-[106px] shrink-0 flex-col items-end gap-1 sm:flex">
                        {command.scopeLabel ? (
                          <span className="text-[10.5px] font-semibold leading-none text-ds-muted">
                            {command.scopeLabel}
                          </span>
                        ) : null}
                        <span className="max-w-[150px] truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint">
                          {command.badge ?? `/${command.id}`}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
                {t('slashCommandEmpty')}
              </div>
            )}
          </div>
        ) : null}

        {showFileMentionMenu ? (
          <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[680px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(20,47,95,0.14)]">
            <div className="flex h-7 items-center gap-2 px-2.5 text-[11.5px] font-semibold text-ds-muted">
              <FileText className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
              <span>{t('composerFileMentionMenuTitle')}</span>
              {fileMentionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-faint" strokeWidth={1.9} />
              ) : null}
            </div>
            {fileMentionSuggestions.length > 0 ? (
              <div className="flex max-h-[min(280px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1">
                {fileMentionSuggestions.map((reference) => {
                  const active = highlightedFileMention?.relativePath === reference.relativePath
                  return (
                    <button
                      key={reference.relativePath}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFileMention(reference)}
                      className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition ${
                        active
                          ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(20,47,95,0.06)]'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                          active ? 'bg-white text-accent shadow-sm dark:bg-ds-card' : 'bg-ds-hover text-ds-muted'
                        }`}
                      >
                        <FileText className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                          {reference.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                          {reference.relativePath}
                        </span>
                      </span>
                      <span className="hidden max-w-[170px] shrink-0 truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint sm:block">
                        {formatComposerFileMentionToken(reference.relativePath)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
                {fileMentionLoading ? t('composerFileMentionLoading') : t('composerFileMentionEmpty')}
              </div>
            )}
          </div>
        ) : null}

        {goalPanelOpen && slashQuery == null ? (
          <div
            ref={goalPanelRef}
            className="absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] border border-ds-border bg-ds-card/95 p-3 shadow-[0_18px_52px_rgba(20,47,95,0.14)] backdrop-blur-xl dark:bg-ds-card/90"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ds-border-muted text-ds-muted">
                <Target className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-[14px] font-semibold text-ds-ink">
                    {activeThreadGoal ? activeThreadGoal.objective : t('goalNoActiveTitle')}
                  </div>
                  {activeThreadGoal ? (
                    <span className="shrink-0 rounded-lg border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                      {t(`goalStatusShort.${activeThreadGoal.status}`)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canSetGoalPanelDraft ? (
                    <button
                      type="button"
                      onClick={setGoalFromComposerInput}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('goalSetCurrentInput')}
                    </button>
                  ) : null}
                  {activeThreadGoal?.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('paused')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionPause')}
                      title={t('goalActionPause')}
                    >
                      <PauseCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void setActiveThreadGoalStatus('active')
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionResume')}
                      title={t('goalActionResume')}
                    >
                      <PlayCircle className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                  {activeThreadGoal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalPanelOpen(false)
                        void clearActiveThreadGoal()
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('goalActionClear')}
                      title={t('goalActionClear')}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoalPanelOpen(false)}
                className="rounded-lg p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('close')}
                title={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        ) : null}

        <div
          className={`ds-composer-shell ds-chat-composer ds-frosted ds-no-drag flex flex-col gap-1 px-3 pb-2 pt-2 transition ${
            draft.focused ? 'ds-chat-composer-focus' : ''
          } ${compact ? 'rounded-[24px] px-3 py-2 shadow-none' : ''}`}
          onMouseDown={handleComposerShellMouseDown}
          onPaste={handleComposerPaste}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
        >
          {showChangeSummary ? (
            <div className="ds-no-drag mb-1 rounded-2xl border border-ds-border-muted bg-ds-card/78 px-3 py-2 shadow-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-hover text-ds-muted">
                  <FileEdit className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-ds-ink">
                    <span className="truncate">{t('composerChangedFilesTitle', { count: changedFiles.length })}</span>
                    <span className="font-mono text-[12px] text-ds-diff-added">
                      +{effectiveChangedFileStats.added}
                    </span>
                    <span className="font-mono text-[12px] text-ds-diff-removed">
                      -{effectiveChangedFileStats.removed}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ds-muted">
                    {visibleChangedFiles.map((file) => (
                      <span key={file.path} className="max-w-[220px] truncate" title={file.path}>
                        {file.path}
                      </span>
                    ))}
                    {hiddenChangedFileCount > 0 ? (
                      <span className="text-ds-faint">
                        {t('composerChangedFilesMore', { count: hiddenChangedFileCount })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onOpenChanges ? (
                    <button
                      type="button"
                      onClick={onOpenChanges}
                      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                    >
                      {t('composerOpenChanges')}
                    </button>
                  ) : null}
                  {onReviewChanges ? (
                    <button
                      type="button"
                      disabled={reviewChangesDisabled}
                      onClick={onReviewChanges}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <SearchCode className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('composerReviewChanges')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <textarea
            ref={draft.textareaRef}
            rows={1}
            className={`ds-no-drag block w-full min-w-0 resize-none break-words bg-transparent px-1 py-2.5 text-[15px] leading-[1.45] text-ds-ink placeholder:text-ds-faint focus:outline-none [overflow-wrap:anywhere] ${
              canEditComposer ? '' : 'opacity-80'
            } ${compact ? 'text-[14px] py-2' : 'min-h-[40px]'}`}
            placeholder={placeholder}
            value={input}
            disabled={!canEditComposer}
            onChange={(e) => {
              setInput(e.target.value)
              setComposerCursor(e.target.selectionStart ?? e.target.value.length)
              setDismissedFileMentionKey(null)
            }}
            onSelect={(e) => syncComposerCursor(e.currentTarget)}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            onCompositionStart={draft.onCompositionStart}
            onCompositionEnd={draft.onCompositionEnd}
            onKeyDown={handleComposerKeyDown}
          />
          {fileReferences.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {fileReferences.map((reference) => (
                <span
                  key={reference.relativePath}
                  className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/80 px-2 text-[12px] font-medium text-ds-muted"
                  title={reference.relativePath}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  <span className="max-w-52 truncate">{reference.relativePath}</span>
                  {onRemoveFileReference ? (
                    <button
                      type="button"
                      onClick={() => removeFileReference(reference.relativePath)}
                      className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                      aria-label={t('composerRemoveFileReference')}
                      title={t('composerRemoveFileReference')}
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {attachments.length > 0 || attachmentUploadError ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {attachments.map((attachment) => (
                attachment.previewUrl ? (
                  <ComposerImageAttachmentPreview
                    key={attachment.id}
                    attachment={attachment}
                    onRemoveAttachment={onRemoveAttachment}
                  />
                ) : (
                  <span
                    key={attachment.id}
                    className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/80 px-2 text-[12px] font-medium text-ds-muted"
                    title={attachment.id}
                  >
                    <ImagePlus className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    <span className="max-w-40 truncate">{attachment.name || attachment.id}</span>
                    {onRemoveAttachment ? (
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(attachment.id)}
                        className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        aria-label={t('composerRemoveAttachment')}
                        title={t('composerRemoveAttachment')}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                )
              ))}
              {attachmentUploadError ? (
                <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
                  {attachmentUploadError}
                </span>
              ) : null}
            </div>
          ) : null}
          {attachmentUploadEnabled ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={handleAttachmentInput}
            />
          ) : null}
          {dictation.error ? (
            <div className="px-1">
              <span className="min-w-0 break-words text-[12px] font-medium text-red-600 dark:text-red-300">
                {dictation.error}
              </span>
            </div>
          ) : null}
          <div
            className={`ds-composer-toolbar flex min-h-9 items-center gap-2 ${
              showToolbarStartControls ? 'justify-between' : 'justify-end'
            }`}
          >
            {showToolbarStartControls ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden">
                {showComposerMenuButton ? (
                  <>
                    <button
                      ref={composerMenuButtonRef}
                      type="button"
                      disabled={!canOpenComposerMenu}
                      onClick={handleComposerMenuButtonClick}
                      className={`ds-no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 ${
                        composerMenuOpen ? 'bg-ds-hover text-ds-ink' : ''
                      }`}
                      aria-label={t('composerMenuTitle')}
                      title={t('composerMenuTitle')}
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.8} />
                    </button>
                    {mode === 'plan' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandPlanTitle')}
                      >
                        <ListTodo className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandPlanTitle')}</span>
                      </span>
                    ) : null}
                    {activeThreadGoal?.status === 'active' ? (
                      <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ds-hover px-2.5 text-[13px] font-medium text-ds-muted"
                        title={t('slashCommandGoalTitle')}
                      >
                        <Target className="h-3.5 w-3.5" strokeWidth={1.9} />
                        <span>{t('slashCommandGoalTitle')}</span>
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            <div
              className={`flex min-w-0 items-center justify-end gap-1.5 ${
                stretchModelPicker || dictation.status === 'recording' ? 'flex-1' : 'shrink-0'
              }`}
            >
              {dictation.status === 'recording' ? (
                <>
                  <VoiceRecordingStrip
                    getLevel={dictation.getLevel}
                    startedAtMs={dictation.startedAtMs}
                  />
                  <button
                    type="button"
                    onClick={() => dictation.stop('insert')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    aria-label={t('composerVoiceStop')}
                    title={t('composerVoiceStop')}
                  >
                    <Square className="h-3 w-3 fill-current" strokeWidth={2.4} />
                  </button>
                  <button
                    type="button"
                    onClick={() => dictation.stop('send')}
                    className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    aria-label={t('composerVoiceSend')}
                    title={t('composerVoiceSend')}
                  >
                    <Send className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </>
              ) : (
              <>
              {hideModelPicker ? null : (
                <FloatingComposerModelPicker
                  compact={compact}
                  mode={modelPickerMode}
                  composerModel={composerModel}
                  composerProviderId={composerProviderId}
                  composerPickList={composerPickList}
                  composerModelGroups={composerModelGroups}
                  composerReasoningEffort={composerReasoningEffort}
                  canChangeModel={canChangeModel}
                  stretch={stretchModelPicker}
                  onComposerModelChange={onComposerModelChange}
                  onComposerReasoningEffortChange={onComposerReasoningEffortChange}
                  onConfigureProviders={onConfigureProviders}
                />
              )}
              {showVoiceDictation ? (
                <button
                  type="button"
                  disabled={dictation.status === 'transcribing' || !canEditComposer}
                  onClick={dictation.toggle}
                  className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={
                    dictation.status === 'transcribing'
                      ? t('composerVoiceTranscribing')
                      : t('composerVoiceStart')
                  }
                  title={
                    dictation.status === 'transcribing'
                      ? t('composerVoiceTranscribing')
                      : t('composerVoiceStart')
                  }
                >
                  {dictation.status === 'transcribing' ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                  ) : (
                    <Mic className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              ) : null}
              {busy ? (
                <button
                  type="button"
                  onClick={() => onInterrupt()}
                  className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  aria-label={t('interrupt')}
                  title={t('interrupt')}
                >
                  <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2.4} />
                </button>
              ) : null}
              <button
                type="button"
                disabled={primaryActionDisabled}
                onClick={handlePrimaryAction}
                className="ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_10px_22px_rgba(20,47,95,0.22)] transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-ds-card disabled:text-ds-faint disabled:shadow-none dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-ds-card dark:disabled:text-ds-faint"
                aria-label={primaryActionLabel}
                title={primaryActionLabel}
              >
                {primaryActionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={2.2} />
                )}
              </button>
              </>
              )}
            </div>
          </div>
        </div>
      </div>
      {compact ? null : (
        <div className="ds-composer-footer mt-1 flex min-h-7 flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5 px-3">
          <div className="ds-composer-footer-left flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <GitBranchPicker workspaceRoot={effectiveWorkspaceRoot} />
            {showThreadUsageFooter ? (
              <div
                className="ds-composer-usage ds-no-drag inline-flex min-h-7 max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-visible rounded-lg border border-ds-border-muted bg-ds-card/72 px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ds-muted shadow-sm"
                title={
                  threadUsage
                    ? t('sessionUsageDetailsTitle', {
                        tokens: formatCompactNumber(threadUsage.totalTokens),
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny),
                        saved: formatCompactNumber(threadUsage.tokenEconomySavingsTokens),
                        cache: formatPercent(threadUsage.cacheHitRate),
                        cached: formatCompactNumber(threadUsage.cachedTokens),
                        miss: formatCompactNumber(threadUsage.cacheMissTokens),
                        turns: threadUsage.turns
                      })
                    : t('sessionUsageUnavailable')
                }
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                {threadUsage ? (
                  <>
                    <span className="ds-composer-usage-tokens shrink-0 truncate tabular-nums">
                      {t('sessionUsageTokens', {
                        tokens: formatCompactNumber(threadUsage.totalTokens)
                      })}
                    </span>
                    <span className="ds-composer-usage-cost-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cost shrink-0 truncate tabular-nums">
                      {t('sessionUsageCost', {
                        cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny)
                      })}
                    </span>
                    {threadUsage.tokenEconomySavingsTokens > 0 ? (
                      <>
                        <span className="ds-composer-usage-context-savings-separator text-ds-faint">·</span>
                        <span
                          className="ds-composer-usage-context-savings shrink-0 tabular-nums text-emerald-700 dark:text-emerald-300"
                          title={t('sessionUsageContextSavingsTitle', {
                            tokens: formatCompactNumber(threadUsage.tokenEconomySavingsTokens)
                          })}
                        >
                          {t('sessionUsageContextSavings', {
                            tokens: formatCompactNumber(threadUsage.tokenEconomySavingsTokens)
                          })}
                        </span>
                      </>
                    ) : null}
                    <span className="ds-composer-usage-cache-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cache shrink-0 truncate tabular-nums">
                      {t('sessionUsageCache', {
                        cache: formatPercent(threadUsage.cacheHitRate)
                      })}
                    </span>
                    <span className="ds-composer-usage-turns-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-turns shrink-0 truncate tabular-nums">
                      {t('sessionUsageTurns', { turns: threadUsage.turns })}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-ds-faint">
                    {threadUsageState.loading
                      ? t('sessionUsageLoading')
                      : t('sessionUsageUnavailable')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {footerHint ? (
            <div className="ds-composer-footer-hint min-w-0 flex-1 text-right text-[12.5px] font-medium text-ds-faint">
              <span className="block truncate">{footerHint}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
