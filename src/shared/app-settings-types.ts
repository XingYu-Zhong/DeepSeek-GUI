import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { ApprovalPolicy, SandboxMode } from '../../kun/src/contracts/policy.js'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
export {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  inferModelEndpointFormatFromUrl,
  isCustomModelEndpointFormat,
  MODEL_ENDPOINT_FORMATS,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  resolveModelEndpointFormat,
  usesChatCompletionsShape
} from '../../kun/src/contracts/model-endpoint-format.js'
export { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel, type GuiUpdateChannel } from './gui-update'
export {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../../kun/src/contracts/policy.js'
export type UiFontScale = 'small' | 'medium' | 'large'
export type ScheduleRunMode = 'agent' | 'plan'
export type ScheduleKind = 'manual' | 'interval' | 'daily' | 'at'
export type ScheduleTaskStatus = 'idle' | 'running' | 'success' | 'error'
export type ScheduleModel = 'deepseek-v4-pro' | 'deepseek-v4-flash'
export type ScheduleReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
export type ClawRunMode = ScheduleRunMode
export type ClawImProvider = 'feishu' | 'weixin'
export type ClawScheduleKind = ScheduleKind
export type ClawTaskStatus = ScheduleTaskStatus
export type ClawModel = 'auto' | ScheduleModel

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const CUSTOM_IMAGE_GENERATION_PROVIDER_ID = 'custom'
export const IMAGE_GENERATION_PROTOCOLS = ['openai-images', 'minimax-image'] as const
export type ImageGenerationProtocol = (typeof IMAGE_GENERATION_PROTOCOLS)[number]
export const DEFAULT_IMAGE_GENERATION_PROTOCOL: ImageGenerationProtocol = 'openai-images'
export const CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID = 'custom'
export const SPEECH_TO_TEXT_PROTOCOLS = ['openai-transcriptions', 'mimo-asr'] as const
export type SpeechToTextProtocol = (typeof SPEECH_TO_TEXT_PROTOCOLS)[number]
export const DEFAULT_SPEECH_TO_TEXT_PROTOCOL: SpeechToTextProtocol = 'openai-transcriptions'
export const CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID = 'custom'
export const TEXT_TO_SPEECH_PROTOCOLS = ['openai-speech', 'minimax-t2a', 'mimo-tts'] as const
export type TextToSpeechProtocol = (typeof TEXT_TO_SPEECH_PROTOCOLS)[number]
export const DEFAULT_TEXT_TO_SPEECH_PROTOCOL: TextToSpeechProtocol = 'openai-speech'
export const IMAGE_RECOGNITION_PROTOCOLS = ['openai-chat-completions'] as const
export type ImageRecognitionProtocol = (typeof IMAGE_RECOGNITION_PROTOCOLS)[number]
export const DEFAULT_IMAGE_RECOGNITION_PROTOCOL: ImageRecognitionProtocol = 'openai-chat-completions'
export const CUSTOM_MUSIC_GENERATION_PROVIDER_ID = 'custom'
export const MUSIC_GENERATION_PROTOCOLS = ['minimax-music'] as const
export type MusicGenerationProtocol = (typeof MUSIC_GENERATION_PROTOCOLS)[number]
export const DEFAULT_MUSIC_GENERATION_PROTOCOL: MusicGenerationProtocol = 'minimax-music'
export const CUSTOM_VIDEO_GENERATION_PROVIDER_ID = 'custom'
export const VIDEO_GENERATION_PROTOCOLS = ['minimax-video'] as const
export type VideoGenerationProtocol = (typeof VIDEO_GENERATION_PROTOCOLS)[number]
export const DEFAULT_VIDEO_GENERATION_PROTOCOL: VideoGenerationProtocol = 'minimax-video'
export const DEFAULT_CLAW_MODEL = 'auto'
export const CLAW_MODEL_IDS = ['auto', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_SCHEDULE_MODEL = 'deepseek-v4-flash'
export const SCHEDULE_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_SCHEDULE_REASONING_EFFORT = 'medium'
export const SCHEDULE_REASONING_EFFORT_IDS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const
export const DEFAULT_SCHEDULE_INTERNAL_PORT = 8788
// 这些默认目录与 legacy-data-migration.ts 的 HOME_DATA_MIGRATION_MAPPINGS
// 一一对应:老安装的 ~/.deepseekgui/* 在启动期被搬到这里。
export const DEFAULT_WRITE_WORKSPACE_ROOT = '~/.kun/write_workspace'
export const DEFAULT_KUN_DATA_DIR = '~/.kun/data'
export const DEFAULT_KUN_MODEL = 'deepseek-v4-pro'
export const DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL = 'https://api.deepseek.com/beta'
export const DEFAULT_WRITE_INLINE_COMPLETION_MODEL = 'deepseek-v4-flash'
export const WRITE_INLINE_COMPLETION_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS = 650
export const DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE = 0.52
export const DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS = 96
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS = 2_800
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE = 0.36
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS = 256
export const DEFAULT_KUN_PORT = 8899
export const DEFAULT_WEIXIN_BRIDGE_RPC_URL = 'http://127.0.0.1:18790/api/v1/admin/rpc'
export const DEFAULT_MODEL_PROVIDER_ID = 'deepseek'
export type { ModelEndpointFormat }
export const MODEL_PROVIDER_INPUT_MODALITIES = ['text', 'image'] as const
export type ModelProviderInputModality = (typeof MODEL_PROVIDER_INPUT_MODALITIES)[number]
export const MODEL_PROVIDER_MESSAGE_PARTS = ['text', 'image_url', 'input_image'] as const
export type ModelProviderMessagePartSupport = (typeof MODEL_PROVIDER_MESSAGE_PARTS)[number]
export const MODEL_REASONING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]
export const MODEL_REASONING_REQUEST_PROTOCOLS = [
  'none',
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
  'openai-responses',
  'anthropic-thinking'
] as const
export type ModelReasoningRequestProtocol = (typeof MODEL_REASONING_REQUEST_PROTOCOLS)[number]
export type ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ModelReasoningEffort[]
  defaultEffort: ModelReasoningEffort
  requestProtocol: ModelReasoningRequestProtocol
}
export type ModelProviderModelProfileV1 = {
  aliases?: string[]
  contextWindowTokens?: number
  inputModalities: ModelProviderInputModality[]
  outputModalities: ModelProviderInputModality[]
  supportsToolCalling: boolean
  messageParts: ModelProviderMessagePartSupport[]
  reasoning?: ModelProviderReasoningCapabilityV1
}
export type ModelProviderImageCapabilityV1 = {
  protocol: ImageGenerationProtocol
  baseUrl: string
  models: string[]
}
export type ModelProviderSpeechCapabilityV1 = {
  protocol: SpeechToTextProtocol
  baseUrl: string
  models: string[]
}
export type ModelProviderTextToSpeechCapabilityV1 = {
  protocol: TextToSpeechProtocol
  baseUrl: string
  models: string[]
}
export type ModelProviderMusicCapabilityV1 = {
  protocol: MusicGenerationProtocol
  baseUrl: string
  models: string[]
}
export type ModelProviderVideoCapabilityV1 = {
  protocol: VideoGenerationProtocol
  baseUrl: string
  models: string[]
}
export type ModelProviderProfileV1 = {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  modelProfiles: Record<string, ModelProviderModelProfileV1>
  image?: ModelProviderImageCapabilityV1
  speech?: ModelProviderSpeechCapabilityV1
  textToSpeech?: ModelProviderTextToSpeechCapabilityV1
  music?: ModelProviderMusicCapabilityV1
  video?: ModelProviderVideoCapabilityV1
}
export type ModelProviderSettingsV1 = {
  apiKey: string
  baseUrl: string
  providers: ModelProviderProfileV1[]
}

export type ModelProviderImageCapabilityPatchV1 = Partial<ModelProviderImageCapabilityV1>
export type ModelProviderSpeechCapabilityPatchV1 = Partial<ModelProviderSpeechCapabilityV1>
export type ModelProviderTextToSpeechCapabilityPatchV1 = Partial<ModelProviderTextToSpeechCapabilityV1>
export type ModelProviderMusicCapabilityPatchV1 = Partial<ModelProviderMusicCapabilityV1>
export type ModelProviderVideoCapabilityPatchV1 = Partial<ModelProviderVideoCapabilityV1>
export type ModelProviderModelProfilePatchV1 = Partial<ModelProviderModelProfileV1>
export type ModelProviderProfilePatchV1 = Partial<Omit<ModelProviderProfileV1, 'image' | 'speech' | 'textToSpeech' | 'music' | 'video' | 'modelProfiles'>> & {
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
  image?: ModelProviderImageCapabilityPatchV1 | null
  speech?: ModelProviderSpeechCapabilityPatchV1 | null
  textToSpeech?: ModelProviderTextToSpeechCapabilityPatchV1 | null
  music?: ModelProviderMusicCapabilityPatchV1 | null
  video?: ModelProviderVideoCapabilityPatchV1 | null
}
export type ModelProviderSettingsPatchV1 = Partial<
  Omit<ModelProviderSettingsV1, 'providers'>
> & {
  providers?: ModelProviderProfilePatchV1[]
}

export type KunRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  /** Optional override. Leave empty to inherit the General model provider API key. */
  apiKey: string
  /** Optional override. Leave empty to inherit the General model provider Base URL. */
  baseUrl: string
  /** Selected General model provider profile. Empty or missing means the default provider. */
  providerId: string
  /** Effective model request format. Resolved from the selected model provider. */
  endpointFormat: ModelEndpointFormat
  runtimeToken: string
  dataDir: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  /** Compress safe tool context before each model call. */
  tokenEconomyMode: boolean
  /** Detailed token-saving behavior used when building Kun model requests. */
  tokenEconomy: KunTokenEconomySettingsV1
  /** When true, the runtime skips bearer-token auth. Local dev only. */
  insecure: boolean
  /** GUI-managed MCP progressive discovery/search settings written into Kun config.json. */
  mcpSearch: KunMcpSearchSettingsV1
  /** Persistent store backend used by Kun. */
  storage: KunStorageSettingsV1
  /** Fallback compaction thresholds and summary behavior. Per-model thresholds live in Kun config models.profiles. */
  contextCompaction: KunContextCompactionSettingsV1
  /** Low-level loop guards and model argument repair tuning. */
  runtimeTuning: KunRuntimeTuningSettingsV1
  /** OpenAI-compatible image generation provider shared by chat agents and Write image tools. */
  imageGeneration: KunImageGenerationSettingsV1
  /** Speech-to-text provider used for voice input in the composer. */
  speechToText: KunSpeechToTextSettingsV1
  /** Text-to-speech provider exposed to agents as generate_speech. */
  textToSpeech: KunTextToSpeechSettingsV1
  /** 给纯文本模型和图片识别工具使用的多模态 fallback 配置。 */
  imageRecognition: KunImageRecognitionSettingsV1
  /** Music generation provider exposed to agents as generate_music. */
  musicGeneration: KunMusicGenerationSettingsV1
  /** Video generation provider exposed to agents as generate_video. */
  videoGeneration: KunVideoGenerationSettingsV1
  /** GUI 写入 Kun `models.profiles` 的模型能力配置。 */
  modelProfiles: Record<string, ModelProviderModelProfileV1>
}

export type KunImageGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for image generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their image capability. */
  protocol: ImageGenerationProtocol
  /** Custom image API root, or an override for the selected provider image API root. */
  baseUrl: string
  /** Custom image API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Default "WxH" or "auto" used when the model omits aspect ratio and size. Empty means provider default. */
  defaultSize: string
  timeoutMs: number
}

export type KunSpeechToTextSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech recognition. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their speech capability. */
  protocol: SpeechToTextProtocol
  /** Custom speech API root, or an override for the selected provider speech API root. */
  baseUrl: string
  /** Custom speech API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Language hint sent to the provider ("zh", "en", ...). Empty means auto-detect. */
  language: string
  timeoutMs: number
}

export type KunTextToSpeechSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their TTS capability. */
  protocol: TextToSpeechProtocol
  /** Custom TTS API root, or an override for the selected provider TTS API root. */
  baseUrl: string
  /** Custom TTS API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Provider voice id/name. Empty means provider default. */
  voice: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunImageRecognitionSettingsV1 = {
  enabled: boolean
  enabledAt?: string
  protocol: ImageRecognitionProtocol
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  timeoutMs: number
}

export type KunMusicGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for music generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: MusicGenerationProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunVideoGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for video generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: VideoGenerationProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** Default video duration in seconds. */
  defaultDuration: number
  /** Default provider resolution value, e.g. 1080P. */
  defaultResolution: string
  timeoutMs: number
  pollIntervalMs: number
}

export type KunMcpSearchMode = 'direct' | 'search' | 'auto'

export type KunMcpSearchSettingsV1 = {
  enabled: boolean
  mode: KunMcpSearchMode
  autoThresholdToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
}

export type KunStorageBackend = 'hybrid' | 'file'

export type KunStorageSettingsV1 = {
  backend: KunStorageBackend
  sqlitePath: string
}

export type KunCompactionSummaryMode = 'heuristic' | 'model'

export type KunHistoryHygieneSettingsV1 = {
  maxToolResultLines: number
  maxToolResultBytes: number
  maxToolResultTokens: number
  maxToolArgumentStringBytes: number
  maxToolArgumentStringTokens: number
  maxArrayItems: number
}

export type KunTokenEconomySettingsV1 = {
  enabled: boolean
  compressToolDescriptions: boolean
  compressToolResults: boolean
  conciseResponses: boolean
  historyHygiene: KunHistoryHygieneSettingsV1
}

export type KunContextCompactionSettingsV1 = {
  defaultSoftThreshold: number
  defaultHardThreshold: number
  summaryMode: KunCompactionSummaryMode
  summaryTimeoutMs: number
  summaryMaxTokens: number
  summaryInputMaxBytes: number
}

export type KunToolStormSettingsV1 = {
  enabled: boolean
  windowSize: number
  threshold: number
}

export type KunToolArgumentRepairSettingsV1 = {
  maxStringBytes: number
}

export type KunRuntimeTuningSettingsV1 = {
  toolStorm: KunToolStormSettingsV1
  toolArgumentRepair: KunToolArgumentRepairSettingsV1
}

/**
 * Compatibility shell kept because persisted settings still use the
 * `agents.kun` envelope. Prefer operating on the contained
 * `KunRuntimeSettingsV1` directly in new code.
 */
export type KunSettingsEnvelopeV1 = {
  kun: KunRuntimeSettingsV1
}

/** @deprecated Use `KunSettingsEnvelopeV1`. */
export type AgentRuntimeSettingsMapV1 = KunSettingsEnvelopeV1

export type KunRuntimeTuningSettingsPatchV1 = {
  toolStorm?: Partial<KunToolStormSettingsV1>
  toolArgumentRepair?: Partial<KunToolArgumentRepairSettingsV1>
}

export type KunTokenEconomySettingsPatchV1 = Partial<
  Omit<KunTokenEconomySettingsV1, 'historyHygiene'>
> & {
  historyHygiene?: Partial<KunHistoryHygieneSettingsV1>
}

export type KunRuntimeSettingsPatchV1 = Partial<
  Omit<
    KunRuntimeSettingsV1,
    'mcpSearch' | 'storage' | 'contextCompaction' | 'runtimeTuning' | 'tokenEconomy' | 'imageGeneration' | 'speechToText' | 'textToSpeech' | 'imageRecognition' | 'musicGeneration' | 'videoGeneration' | 'modelProfiles'
  >
> & {
  mcpSearch?: Partial<KunMcpSearchSettingsV1>
  tokenEconomy?: KunTokenEconomySettingsPatchV1
  storage?: Partial<KunStorageSettingsV1>
  contextCompaction?: Partial<KunContextCompactionSettingsV1>
  runtimeTuning?: KunRuntimeTuningSettingsPatchV1
  imageGeneration?: Partial<KunImageGenerationSettingsV1>
  speechToText?: Partial<KunSpeechToTextSettingsV1>
  textToSpeech?: Partial<KunTextToSpeechSettingsV1>
  imageRecognition?: Partial<KunImageRecognitionSettingsV1>
  musicGeneration?: Partial<KunMusicGenerationSettingsV1>
  videoGeneration?: Partial<KunVideoGenerationSettingsV1>
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
}

export type KunSettingsEnvelopePatchV1 = {
  kun?: KunRuntimeSettingsPatchV1
}

export type LogConfigV1 = {
  enabled: boolean
  retentionDays: number
}

export type NotificationConfigV1 = {
  turnComplete: boolean
}

export type AppBehaviorConfigV1 = {
  openAtLogin: boolean
  startMinimized: boolean
  closeToTray: boolean
}

export type ScheduleSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
}

export type ScheduledTaskScheduleV1 = {
  kind: ScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ScheduledTaskV1 = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  /** Optional Claw IM channel whose persona/defaults should drive this scheduled task. */
  clawChannelId: string
  /** Selected model provider for this scheduled task. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  schedule: ScheduledTaskScheduleV1
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: ScheduleTaskStatus
  lastMessage: string
  lastThreadId: string
}

export type ScheduleInternalSettingsV1 = {
  port: number
  secret: string
}

export type ScheduleSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default model provider used when creating scheduled tasks. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  promptPrefix: string
  skills: ScheduleSkillSettingsV1
  keepAwake: boolean
  internal: ScheduleInternalSettingsV1
  tasks: ScheduledTaskV1[]
}

export type ClawSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  promptPrefix: string
}

export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  /** Default model provider for IM channels without their own provider. Empty inherits Kun runtime provider. */
  providerId?: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
}

export type ClawTaskScheduleV1 = {
  kind: ClawScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ClawTaskV1 = ScheduledTaskV1

export type ClawImAgentProfileV1 = {
  name: string
  description: string
  identity: string
  personality: string
  userContext: string
  replyRules: string
}

export type ClawImFeishuPlatformCredentialV1 = {
  kind: 'feishu'
  appId: string
  appSecret: string
  domain: string
  createdAt: string
}

export type ClawImWeixinPlatformCredentialV1 = {
  kind: 'weixin'
  accountId: string
  sessionKey: string
  createdAt: string
}

export type ClawImPlatformCredentialV1 =
  | ClawImFeishuPlatformCredentialV1
  | ClawImWeixinPlatformCredentialV1

export type ClawImRemoteSessionV1 = {
  chatId: string
  messageId: string
  threadId: string
  senderId: string
  senderName: string
  updatedAt: string
}

export type ClawImConversationV1 = {
  id: string
  chatId: string
  remoteThreadId: string
  latestMessageId: string
  senderId: string
  senderName: string
  /** Kun thread id this conversation maps to. */
  localThreadId: string
  workspaceRoot: string
  createdAt: string
  updatedAt: string
}

export type ClawImChannelV1 = {
  id: string
  provider: ClawImProvider
  label: string
  enabled: boolean
  /** Model provider used by this IM channel. Empty inherits the IM/global provider. */
  providerId?: string
  model: string
  /** Kun thread id this channel maps to. */
  threadId: string
  workspaceRoot: string
  agentProfile: ClawImAgentProfileV1
  platformCredential?: ClawImPlatformCredentialV1
  remoteSession?: ClawImRemoteSessionV1
  conversations: ClawImConversationV1[]
  /** When the one-time IM welcome/intro message was delivered. */
  welcomeSentAt?: string
  createdAt: string
  updatedAt: string
}

export type ClawSettingsV1 = {
  enabled: boolean
  skills: ClawSkillSettingsV1
  im: ClawImSettingsV1
  channels: ClawImChannelV1[]
  tasks: ClawTaskV1[]
}

export type WriteInlineCompletionSettingsV1 = {
  enabled: boolean
  retrievalEnabled: boolean
  longCompletionEnabled: boolean
  /** When true, Write inherits Kun's selected provider instead of using `providerId`. */
  inheritProvider: boolean
  /** Selected provider for Write inline completion when `inheritProvider` is false. */
  providerId: string
  apiKey: string
  baseUrl: string
  /** When true, Write inherits Kun's runtime model instead of using `model` as an override. */
  inheritModel: boolean
  model: string
  debounceMs: number
  longDebounceMs: number
  minAcceptScore: number
  longMinAcceptScore: number
  maxTokens: number
  longMaxTokens: number
}

/** 'edit' rewrites the selection in place; 'chat' hands it to the sidebar assistant. */
export type WriteQuickActionMode = 'edit' | 'chat'

export type WriteQuickActionV1 = {
  /** Stable identifier; built-in ids ('polish' | 'explain' | 'reformat') get localized fallbacks. */
  id: string
  /** Display label shown in the selection toolbar; empty = localized default for built-in ids. */
  label: string
  /** Prompt used for the edit/chat; empty = localized default for built-in ids. */
  prompt: string
  /** Whether the result rewrites the selection in place ('edit') or goes to the sidebar ('chat'). */
  mode: WriteQuickActionMode
}

export type WriteSelectionAssistSettingsV1 = {
  /** Custom infographic generation prompt prefix; empty = built-in default. */
  infographicPrompt: string
  /** Custom UI design mockup prompt prefix; empty = built-in default. */
  designDraftPrompt: string
  /** Custom interactive HTML prototype prompt; empty = built-in default. */
  prototypePrompt: string
  quickActions: WriteQuickActionV1[]
}

export type WriteSettingsV1 = {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  selectionAssist: WriteSelectionAssistSettingsV1
}

export type ClawSettingsPatchV1 = Partial<Omit<ClawSettingsV1, 'skills' | 'im' | 'channels' | 'tasks'>> & {
  skills?: Partial<ClawSkillSettingsV1>
  im?: Partial<ClawImSettingsV1>
  channels?: Array<Partial<ClawImChannelV1>>
  tasks?: Array<Partial<ClawTaskV1>>
}

export type ScheduleSettingsPatchV1 = Partial<
  Omit<ScheduleSettingsV1, 'skills' | 'internal' | 'tasks'>
> & {
  skills?: Partial<ScheduleSkillSettingsV1>
  internal?: Partial<ScheduleInternalSettingsV1>
  tasks?: Array<Partial<ScheduledTaskV1>>
}

export type WriteSettingsPatchV1 = Partial<Omit<WriteSettingsV1, 'inlineCompletion' | 'selectionAssist'>> & {
  inlineCompletion?: Partial<WriteInlineCompletionSettingsV1>
  selectionAssist?: Partial<Omit<WriteSelectionAssistSettingsV1, 'quickActions'>> & {
    /** Replaced wholesale when present. */
    quickActions?: Array<Partial<WriteQuickActionV1>>
  }
}

export type ClawGeneratedFileV1 = {
  path: string
  relativePath?: string
  fileName: string
}

export type ClawRunResult =
  | { ok: true; threadId: string; turnId?: string; text?: string; message?: string; files?: ClawGeneratedFileV1[] }
  | { ok: false; message: string }

export type ScheduleRunResult = ClawRunResult

export type ScheduleTaskFromTextResult =
  | { kind: 'noop' }
  | { kind: 'created'; taskId: string; title: string; scheduleAt: string; confirmationText: string }
  | { kind: 'error'; message: string }

export type ClawTaskFromTextResult = ScheduleTaskFromTextResult

export type ClawRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}

export type ScheduleRuntimeStatus = {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  powerSaveBlockerActive: boolean
}

export type GuiUpdateConfigV1 = {
  channel: GuiUpdateChannel
}

export type AppSettingsV1 = {
  version: 1
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  uiFontScale: UiFontScale
  provider: ModelProviderSettingsV1
  agents: KunSettingsEnvelopeV1
  workspaceRoot: string
  log: LogConfigV1
  notifications: NotificationConfigV1
  appBehavior: AppBehaviorConfigV1
  keyboardShortcuts: KeyboardShortcutsConfigV1
  write: WriteSettingsV1
  claw: ClawSettingsV1
  schedule: ScheduleSettingsV1
  guiUpdate: GuiUpdateConfigV1
  codePromptPrefix: string
  /** User-disabled skill IDs. Disabled skills are hidden from command surfaces. */
  disabledSkillIds: string[]
}

export type AppSettingsPatch = Partial<
  Omit<AppSettingsV1, 'provider' | 'agents' | 'log' | 'notifications' | 'appBehavior' | 'keyboardShortcuts' | 'write' | 'claw' | 'schedule' | 'guiUpdate'>
> & {
  provider?: ModelProviderSettingsPatchV1
  agents?: KunSettingsEnvelopePatchV1
  log?: Partial<LogConfigV1>
  notifications?: Partial<NotificationConfigV1>
  appBehavior?: Partial<AppBehaviorConfigV1>
  keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  schedule?: ScheduleSettingsPatchV1
  guiUpdate?: Partial<GuiUpdateConfigV1>
}
