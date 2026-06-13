import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_IMAGE_RECOGNITION_PROTOCOL,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_KUN_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  type AppSettingsV1,
  type KunContextCompactionSettingsV1,
  type KunHistoryHygieneSettingsV1,
  type KunImageGenerationSettingsV1,
  type KunImageRecognitionSettingsV1,
  type KunMcpSearchSettingsV1,
  type KunMusicGenerationSettingsV1,
  type KunRuntimeTuningSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunRuntimeSettingsV1,
  type KunSettingsEnvelopePatchV1,
  type KunSettingsEnvelopeV1,
  type KunSpeechToTextSettingsV1,
  type KunStorageSettingsV1,
  type KunTextToSpeechSettingsV1,
  type KunTokenEconomySettingsV1,
  type KunVideoGenerationSettingsV1,
  type ImageGenerationProtocol,
  type ImageRecognitionProtocol,
  type MusicGenerationProtocol,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelProviderSettingsV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol,
  type ApprovalPolicy,
  type SandboxMode
} from './app-settings-types'
import {
  normalizeModelProviderSettings,
  resolveKunRuntimeSettings
} from './app-settings-provider'

const LEGACY_COREAGENT_DATA_DIR = '~/.deepseekgui/coreagent'
const LEGACY_KUN_DEFAULT_MODEL = 'deepseek-chat'
const LEGACY_LOCAL_HTTP_DEFAULT_PORT = 7878

type LegacyLocalHttpRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  apiKey: string
  baseUrl: string
  runtimeToken: string
  extraCorsOrigins: string[]
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
}

type LegacyReasoningEffort = 'low' | 'medium' | 'high' | 'max'
type LegacyReasoningEditMode = 'review' | 'auto' | 'yolo' | 'plan'

type LegacyReasoningRuntimeSettingsV1 = {
  binaryPath: string
  autoStart: boolean
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: LegacyReasoningEffort
  editMode: LegacyReasoningEditMode
}

/**
 * Kun runtime settings. Mirrors the `kun serve` CLI
 * options. It is the only active agent settings object the GUI
 * stores after legacy settings have been migrated.
 */
function legacyLocalHttpRuntimeDefaults(port = 7878): LegacyLocalHttpRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    runtimeToken: '',
    extraCorsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE
  }
}

function legacyReasoningRuntimeDefaults(): LegacyReasoningRuntimeSettingsV1 {
  return {
    binaryPath: '',
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    model: LEGACY_KUN_DEFAULT_MODEL,
    reasoningEffort: 'medium',
    editMode: 'auto'
  }
}

export function defaultKunRuntimeSettings(
  port = DEFAULT_KUN_PORT
): KunRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: '',
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    runtimeToken: '',
    dataDir: DEFAULT_KUN_DATA_DIR,
    model: DEFAULT_KUN_MODEL,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    tokenEconomyMode: false,
    tokenEconomy: defaultKunTokenEconomySettings(),
    insecure: false,
    mcpSearch: defaultKunMcpSearchSettings(),
    storage: defaultKunStorageSettings(),
    contextCompaction: defaultKunContextCompactionSettings(),
    runtimeTuning: defaultKunRuntimeTuningSettings(),
    imageGeneration: defaultKunImageGenerationSettings(),
    speechToText: defaultKunSpeechToTextSettings(),
    textToSpeech: defaultKunTextToSpeechSettings(),
    imageRecognition: defaultKunImageRecognitionSettings(),
    musicGeneration: defaultKunMusicGenerationSettings(),
    videoGeneration: defaultKunVideoGenerationSettings(),
    modelProfiles: {}
  }
}

export function defaultKunImageGenerationSettings(): KunImageGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultSize: '',
    timeoutMs: 180_000
  }
}

export function defaultKunSpeechToTextSettings(): KunSpeechToTextSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    language: '',
    timeoutMs: 60_000
  }
}

export function defaultKunTextToSpeechSettings(): KunTextToSpeechSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    voice: '',
    format: 'mp3',
    timeoutMs: 120_000
  }
}

export function defaultKunImageRecognitionSettings(): KunImageRecognitionSettingsV1 {
  return {
    enabled: false,
    enabledAt: undefined,
    protocol: DEFAULT_IMAGE_RECOGNITION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    prompt: 'Extract and summarize all visible text in this image. Include important labels, tables, UI text, and any context needed by a text-only model.',
    timeoutMs: 120_000
  }
}

export function defaultKunMusicGenerationSettings(): KunMusicGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    format: 'mp3',
    timeoutMs: 300_000
  }
}

export function defaultKunVideoGenerationSettings(): KunVideoGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultDuration: 6,
    defaultResolution: '1080P',
    timeoutMs: 900_000,
    pollIntervalMs: 10_000
  }
}

export function defaultKunMcpSearchSettings(): KunMcpSearchSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultKunTokenEconomySettings(): KunTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultKunHistoryHygieneSettings()
  }
}

export function defaultKunHistoryHygieneSettings(): KunHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultKunStorageSettings(): KunStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export function defaultKunContextCompactionSettings(): KunContextCompactionSettingsV1 {
  return {
    defaultSoftThreshold: 16_000,
    defaultHardThreshold: 24_000,
    summaryMode: 'heuristic',
    summaryTimeoutMs: 15_000,
    summaryMaxTokens: 1_200,
    summaryInputMaxBytes: 96 * 1024
  }
}

export function defaultKunRuntimeTuningSettings(): KunRuntimeTuningSettingsV1 {
  return {
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 512 * 1024
    }
  }
}

export function getKunRuntimeSettings(
  settings: AppSettingsV1
): KunRuntimeSettingsV1 {
  const raw = (settings as { agents?: { kun?: Partial<KunRuntimeSettingsV1> } }).agents?.kun
  return mergeKunRuntimeSettings(defaultKunRuntimeSettings(), raw)
}

export function kunSettingsEnvelope(
  kun: KunRuntimeSettingsV1
): KunSettingsEnvelopeV1 {
  return { kun }
}

export function kunSettingsPatch(
  kun: KunRuntimeSettingsPatchV1 | undefined
): KunSettingsEnvelopePatchV1 {
  return kun ? { kun } : {}
}

export function mergeKunRuntimeSettings(
  current: KunRuntimeSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): KunRuntimeSettingsV1 {
  const currentMcpSearch = normalizeKunMcpSearchSettings(current.mcpSearch)
  const nextMcpSearch = normalizeKunMcpSearchSettings({
    ...currentMcpSearch,
    ...(patch?.mcpSearch ?? {})
  })
  const currentTokenEconomy = normalizeKunTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeKunTokenEconomySettings({
    ...currentTokenEconomy,
    ...(patch?.tokenEconomy ?? {}),
    historyHygiene: {
      ...currentTokenEconomy.historyHygiene,
      ...(patch?.tokenEconomy?.historyHygiene ?? {})
    }
  }, currentTokenEconomy.enabled)
  const tokenEconomyEnabled = typeof patch?.tokenEconomy?.enabled === 'boolean'
    ? patch.tokenEconomy.enabled
    : typeof patch?.tokenEconomyMode === 'boolean'
      ? patch.tokenEconomyMode
      : patchedTokenEconomy.enabled
  const nextTokenEconomy = {
    ...patchedTokenEconomy,
    enabled: tokenEconomyEnabled
  }
  const currentStorage = normalizeKunStorageSettings(current.storage)
  const nextStorage = normalizeKunStorageSettings({
    ...currentStorage,
    ...(patch?.storage ?? {})
  })
  const currentContextCompaction = normalizeKunContextCompactionSettings(current.contextCompaction)
  const nextContextCompaction = normalizeKunContextCompactionSettings({
    ...currentContextCompaction,
    ...(patch?.contextCompaction ?? {})
  })
  const currentImageGeneration = normalizeKunImageGenerationSettings(current.imageGeneration)
  const nextImageGeneration = normalizeKunImageGenerationSettings({
    ...currentImageGeneration,
    ...(patch?.imageGeneration ?? {})
  })
  const currentSpeechToText = normalizeKunSpeechToTextSettings(current.speechToText)
  const nextSpeechToText = normalizeKunSpeechToTextSettings({
    ...currentSpeechToText,
    ...(patch?.speechToText ?? {})
  })
  const currentTextToSpeech = normalizeKunTextToSpeechSettings(current.textToSpeech)
  const nextTextToSpeech = normalizeKunTextToSpeechSettings({
    ...currentTextToSpeech,
    ...(patch?.textToSpeech ?? {})
  })
  const currentImageRecognition = normalizeKunImageRecognitionSettings(current.imageRecognition)
  const nextImageRecognition = normalizeKunImageRecognitionSettings({
    ...currentImageRecognition,
    ...(patch?.imageRecognition ?? {})
  })
  const currentMusicGeneration = normalizeKunMusicGenerationSettings(current.musicGeneration)
  const nextMusicGeneration = normalizeKunMusicGenerationSettings({
    ...currentMusicGeneration,
    ...(patch?.musicGeneration ?? {})
  })
  const currentVideoGeneration = normalizeKunVideoGenerationSettings(current.videoGeneration)
  const nextVideoGeneration = normalizeKunVideoGenerationSettings({
    ...currentVideoGeneration,
    ...(patch?.videoGeneration ?? {})
  })
  const currentRuntimeTuning = normalizeKunRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeKunRuntimeTuningSettings({
    ...currentRuntimeTuning,
    ...(patch?.runtimeTuning
      ? {
          toolStorm: {
            ...currentRuntimeTuning.toolStorm,
            ...(patch.runtimeTuning.toolStorm ?? {})
          },
          toolArgumentRepair: {
            ...currentRuntimeTuning.toolArgumentRepair,
            ...(patch.runtimeTuning.toolArgumentRepair ?? {})
          }
        }
      : {})
  })
  const nextModelProfiles = normalizeKunModelProfiles(current.modelProfiles, patch?.modelProfiles)
  return {
    ...current,
    ...(patch ?? {}),
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    mcpSearch: nextMcpSearch,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning,
    imageGeneration: nextImageGeneration,
    speechToText: nextSpeechToText,
    textToSpeech: nextTextToSpeech,
    imageRecognition: nextImageRecognition,
    musicGeneration: nextMusicGeneration,
    videoGeneration: nextVideoGeneration,
    modelProfiles: nextModelProfiles
  }
}

function normalizeKunImageGenerationSettings(
  input: Partial<KunImageGenerationSettingsV1> | undefined
): KunImageGenerationSettingsV1 {
  const defaults = defaultKunImageGenerationSettings()
  const defaultSize = typeof input?.defaultSize === 'string' ? input.defaultSize.trim() : ''
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunImageGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultSize: /^(auto|\d+x\d+)$/.test(defaultSize) ? defaultSize : '',
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeKunImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  return value === 'minimax-image' ? 'minimax-image' : DEFAULT_IMAGE_GENERATION_PROTOCOL
}

function normalizeKunSpeechToTextSettings(
  input: Partial<KunSpeechToTextSettingsV1> | undefined
): KunSpeechToTextSettingsV1 {
  const defaults = defaultKunSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunSpeechToTextProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    language: typeof input?.language === 'string' ? input.language.trim().toLowerCase().slice(0, 16) : defaults.language,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeKunSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  return value === 'mimo-asr' ? 'mimo-asr' : DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

function normalizeKunTextToSpeechSettings(
  input: Partial<KunTextToSpeechSettingsV1> | undefined
): KunTextToSpeechSettingsV1 {
  const defaults = defaultKunTextToSpeechSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunTextToSpeechProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    voice: typeof input?.voice === 'string' ? input.voice.trim().slice(0, 128) : defaults.voice,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeKunTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

function normalizeKunImageRecognitionSettings(
  input: Partial<KunImageRecognitionSettingsV1> | undefined
): KunImageRecognitionSettingsV1 {
  const defaults = defaultKunImageRecognitionSettings()
  const enabled = input?.enabled === true
  const enabledAt = typeof input?.enabledAt === 'string' && isIsoDateString(input.enabledAt.trim())
    ? input.enabledAt.trim()
    : undefined
  return {
    enabled,
    ...(enabled ? { enabledAt: enabledAt ?? new Date().toISOString() } : {}),
    protocol: DEFAULT_IMAGE_RECOGNITION_PROTOCOL,
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    prompt: typeof input?.prompt === 'string' && input.prompt.trim()
      ? input.prompt.trim().slice(0, 2000)
      : defaults.prompt,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function isIsoDateString(value: string): boolean {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time)
}

function normalizeKunImageRecognitionProtocol(value: unknown): ImageRecognitionProtocol {
  return value === 'openai-chat-completions' ? value : DEFAULT_IMAGE_RECOGNITION_PROTOCOL
}

function normalizeKunMusicGenerationSettings(
  input: Partial<KunMusicGenerationSettingsV1> | undefined
): KunMusicGenerationSettingsV1 {
  const defaults = defaultKunMusicGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunMusicGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 900_000)
  }
}

function normalizeKunMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

function normalizeKunVideoGenerationSettings(
  input: Partial<KunVideoGenerationSettingsV1> | undefined
): KunVideoGenerationSettingsV1 {
  const defaults = defaultKunVideoGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunVideoGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultDuration: boundedPositiveInt(input?.defaultDuration, defaults.defaultDuration, 60),
    defaultResolution: typeof input?.defaultResolution === 'string' && input.defaultResolution.trim()
      ? input.defaultResolution.trim().slice(0, 32)
      : defaults.defaultResolution,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 1_800_000),
    pollIntervalMs: boundedPositiveInt(input?.pollIntervalMs, defaults.pollIntervalMs, 60_000)
  }
}

function normalizeKunVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

function normalizeAudioFormat(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return /^(mp3|wav|flac|pcm16)$/.test(normalized) ? normalized : fallback
}

function normalizeKunTokenEconomySettings(
  input: Partial<KunTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): KunTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeKunHistoryHygieneSettings(input?.historyHygiene)
  }
}

function normalizeKunHistoryHygieneSettings(
  input: Partial<KunHistoryHygieneSettingsV1> | undefined
): KunHistoryHygieneSettingsV1 {
  const defaults = defaultKunHistoryHygieneSettings()
  return {
    maxToolResultLines: boundedPositiveInt(input?.maxToolResultLines, defaults.maxToolResultLines, 100_000),
    maxToolResultBytes: boundedPositiveInt(input?.maxToolResultBytes, defaults.maxToolResultBytes, 8 * 1024 * 1024),
    maxToolResultTokens: boundedPositiveInt(input?.maxToolResultTokens, defaults.maxToolResultTokens, 256_000),
    maxToolArgumentStringBytes: boundedPositiveInt(
      input?.maxToolArgumentStringBytes,
      defaults.maxToolArgumentStringBytes,
      8 * 1024 * 1024
    ),
    maxToolArgumentStringTokens: boundedPositiveInt(
      input?.maxToolArgumentStringTokens,
      defaults.maxToolArgumentStringTokens,
      64_000
    ),
    maxArrayItems: boundedPositiveInt(input?.maxArrayItems, defaults.maxArrayItems, 10_000)
  }
}

function normalizeKunMcpSearchSettings(
  input: Partial<KunMcpSearchSettingsV1> | undefined
): KunMcpSearchSettingsV1 {
  const defaults = defaultKunMcpSearchSettings()
  const topKMax = positiveInt(input?.topKMax, defaults.topKMax)
  const topKDefault = Math.min(positiveInt(input?.topKDefault, defaults.topKDefault), topKMax)
  return {
    enabled: input?.enabled === true,
    mode: input?.mode === 'direct' || input?.mode === 'search' || input?.mode === 'auto'
      ? input.mode
      : defaults.mode,
    autoThresholdToolCount: positiveInt(input?.autoThresholdToolCount, defaults.autoThresholdToolCount),
    topKDefault,
    topKMax,
    minScore: nonNegativeNumber(input?.minScore, defaults.minScore)
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function boundedPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

function normalizeKunStorageSettings(
  input: Partial<KunStorageSettingsV1> | undefined
): KunStorageSettingsV1 {
  const defaults = defaultKunStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

function normalizeKunContextCompactionSettings(
  input: Partial<KunContextCompactionSettingsV1> | undefined
): KunContextCompactionSettingsV1 {
  const defaults = defaultKunContextCompactionSettings()
  const defaultSoftThreshold = boundedPositiveInt(input?.defaultSoftThreshold, defaults.defaultSoftThreshold)
  const requestedHardThreshold = boundedPositiveInt(input?.defaultHardThreshold, defaults.defaultHardThreshold)
  return {
    defaultSoftThreshold,
    defaultHardThreshold: Math.max(defaultSoftThreshold, requestedHardThreshold),
    summaryMode: input?.summaryMode === 'model' || input?.summaryMode === 'heuristic'
      ? input.summaryMode
      : defaults.summaryMode,
    summaryTimeoutMs: boundedPositiveInt(input?.summaryTimeoutMs, defaults.summaryTimeoutMs, 120_000),
    summaryMaxTokens: boundedPositiveInt(input?.summaryMaxTokens, defaults.summaryMaxTokens, 16_000),
    summaryInputMaxBytes: boundedPositiveInt(input?.summaryInputMaxBytes, defaults.summaryInputMaxBytes, 8 * 1024 * 1024)
  }
}

function normalizeKunRuntimeTuningSettings(
  input: Partial<KunRuntimeTuningSettingsV1> | undefined
): KunRuntimeTuningSettingsV1 {
  const defaults = defaultKunRuntimeTuningSettings()
  return {
    toolStorm: {
      enabled: input?.toolStorm?.enabled !== false,
      windowSize: boundedPositiveInt(input?.toolStorm?.windowSize, defaults.toolStorm.windowSize, 128),
      threshold: Math.max(2, boundedPositiveInt(input?.toolStorm?.threshold, defaults.toolStorm.threshold, 128))
    },
    toolArgumentRepair: {
      maxStringBytes: boundedPositiveInt(
        input?.toolArgumentRepair?.maxStringBytes,
        defaults.toolArgumentRepair.maxStringBytes,
        16 * 1024 * 1024
      )
    }
  }
}

function normalizeKunModelProfiles(
  current: Record<string, ModelProviderModelProfileV1> | undefined,
  patch: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, rawProfile] of Object.entries(current ?? {})) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    profiles[modelId] = normalizeKunModelProfile(rawProfile)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return profiles
  for (const [rawModelId, rawProfile] of Object.entries(patch)) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    if (rawProfile === null) {
      delete profiles[modelId]
      continue
    }
    profiles[modelId] = normalizeKunModelProfile({
      ...(profiles[modelId] ?? {}),
      ...rawProfile
    })
  }
  return profiles
}

function normalizeKunModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeKunModelInputModalities(input?.inputModalities)
  const fallbackMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = typeof input?.contextWindowTokens === 'number' &&
    Number.isInteger(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : undefined
  const reasoning = normalizeKunReasoningCapability(input?.reasoning)
  return {
    ...(normalizeKunProfileAliases(input?.aliases).length
      ? { aliases: normalizeKunProfileAliases(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities,
    outputModalities: normalizeKunModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeKunModelMessageParts(input?.messageParts, fallbackMessageParts),
    ...(reasoning ? { reasoning } : {})
  }
}

function normalizeKunReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeKunReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeKunReasoningEffort(input.defaultEffort)
  const requestProtocol = normalizeKunReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort && supportedEfforts.includes(defaultEffort)
      ? defaultEffort
      : supportedEfforts[0],
    requestProtocol
  }
}

function normalizeKunReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const efforts: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeKunReasoningEffort(item)
    if (effort && !efforts.includes(effort)) efforts.push(effort)
  }
  return efforts
}

function normalizeKunReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

function normalizeKunReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

function normalizeModelProfileId(value: string): string {
  return value.trim().slice(0, 128)
}

function normalizeKunProfileAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const aliases: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const alias = item.trim().slice(0, 128)
    if (alias && !aliases.includes(alias)) aliases.push(alias)
    if (aliases.length >= 50) break
  }
  return aliases
}

function normalizeKunModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const modalities: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !modalities.includes(item)) {
      modalities.push(item)
    }
    if (modalities.length >= 8) break
  }
  return modalities.length > 0 ? modalities : ['text']
}

function normalizeKunModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const parts: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !parts.includes(item)
    ) {
      parts.push(item)
    }
    if (parts.length >= 8) break
  }
  return parts.length > 0 ? parts : [...fallback]
}

export function withKunRuntimeSettings(
  settings: AppSettingsV1,
  kun: KunRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: kunSettingsEnvelope(kun)
  }
}

export function applyKunRuntimePatch(
  settings: AppSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withKunRuntimeSettings(
    settings,
    mergeKunRuntimeSettings(getKunRuntimeSettings(settings), patch)
  )
}

export function isKunRuntimeInsecure(runtime: Pick<KunRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure || !runtime.runtimeToken.trim()
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveKunRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: KunSettingsEnvelopeV1,
  patch: KunSettingsEnvelopePatchV1 | undefined
): KunSettingsEnvelopeV1 {
  return kunSettingsEnvelope(
    mergeKunRuntimeSettings(defaults.kun, patch?.kun)
  )
}

type LegacyAgentsSettingsShape = {
  kun?: Partial<KunRuntimeSettingsV1>
  codewhale?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  reasonix?: Partial<LegacyReasoningRuntimeSettingsV1>
}

type LegacyAppSettingsShape = Partial<Omit<AppSettingsV1, 'agents' | 'provider'>> & {
  agents?: LegacyAgentsSettingsShape
  provider?: Partial<ModelProviderSettingsV1>
  deepseek?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  /** Legacy single-provider discriminator. Read only inside migration. */
  agentProvider?: unknown
}

function nonEmptyStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function upgradeLegacyKunDefaultDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_KUN_DATA_DIR
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase()
  if (
    !trimmed ||
    normalized === LEGACY_COREAGENT_DATA_DIR ||
    normalized.endsWith('/.deepseekgui/coreagent')
  ) {
    return DEFAULT_KUN_DATA_DIR
  }
  return trimmed
}

function upgradeLegacyKunDefaultModel(value: unknown, fallback: string): string {
  const model = nonEmptyStringOrFallback(value, fallback).trim()
  return model === LEGACY_KUN_DEFAULT_MODEL ? DEFAULT_KUN_MODEL : model
}

function upgradeLegacyKunDefaultPort(value: unknown, fallback: number): number {
  return value === LEGACY_LOCAL_HTTP_DEFAULT_PORT ? DEFAULT_KUN_PORT : fallback
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const rawAgentProvider = parsed.agentProvider
  const isReasoningLegacy = rawAgentProvider === 'reasonix'
  const hasProviderSettings = typeof parsed.provider === 'object' && parsed.provider !== null
  const defaults = legacyLocalHttpRuntimeDefaults()
  const kunDefaults = defaultKunRuntimeSettings()
  const legacyDeepseek = parsed.deepseek ?? {}
  const legacyLocalHttp = {
    ...defaults,
    ...(parsed.agents?.codewhale ?? {}),
    ...legacyDeepseek
  }
  const legacyReasoning = {
    ...legacyReasoningRuntimeDefaults(),
    ...(parsed.agents?.reasonix ?? {})
  }
  const explicitKun: Partial<KunRuntimeSettingsV1> = parsed.agents?.kun ?? {}
  const legacySource = isReasoningLegacy ? legacyReasoning : legacyLocalHttp
  const legacySeed = {
    binaryPath: kunDefaults.binaryPath,
    port: isReasoningLegacy
      ? kunDefaults.port
      : upgradeLegacyKunDefaultPort(legacyLocalHttp.port, legacyLocalHttp.port),
    autoStart: isReasoningLegacy ? legacyReasoning.autoStart : legacyLocalHttp.autoStart,
    apiKey: legacySource.apiKey,
    baseUrl: legacySource.baseUrl,
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    runtimeToken: isReasoningLegacy ? kunDefaults.runtimeToken : legacyLocalHttp.runtimeToken,
    model: isReasoningLegacy ? legacyReasoning.model : kunDefaults.model,
    approvalPolicy: isReasoningLegacy ? kunDefaults.approvalPolicy : legacyLocalHttp.approvalPolicy,
    sandboxMode: isReasoningLegacy ? kunDefaults.sandboxMode : legacyLocalHttp.sandboxMode
  }
  const provider = normalizeModelProviderSettings({
    apiKey: hasProviderSettings
      ? parsed.provider?.apiKey
      : nonEmptyStringOrFallback(explicitKun.apiKey, legacySeed.apiKey),
    baseUrl: hasProviderSettings
      ? parsed.provider?.baseUrl
      : nonEmptyStringOrFallback(explicitKun.baseUrl, legacySeed.baseUrl),
    providers: parsed.provider?.providers
  })
  const kun = {
    ...kunDefaults,
    ...legacySeed,
    ...explicitKun,
    apiKey: hasProviderSettings ? explicitKun.apiKey ?? '' : '',
    baseUrl: hasProviderSettings ? explicitKun.baseUrl ?? '' : '',
    runtimeToken: nonEmptyStringOrFallback(explicitKun.runtimeToken, legacySeed.runtimeToken),
    dataDir: upgradeLegacyKunDefaultDataDir(explicitKun.dataDir),
    model: upgradeLegacyKunDefaultModel(explicitKun.model, legacySeed.model),
    tokenEconomyMode: typeof explicitKun.tokenEconomy?.enabled === 'boolean'
      ? explicitKun.tokenEconomy.enabled
      : explicitKun.tokenEconomyMode ?? kunDefaults.tokenEconomyMode,
    tokenEconomy: normalizeKunTokenEconomySettings(
      explicitKun.tokenEconomy,
      explicitKun.tokenEconomyMode ?? kunDefaults.tokenEconomyMode
    ),
    mcpSearch: normalizeKunMcpSearchSettings(explicitKun.mcpSearch),
    storage: normalizeKunStorageSettings(explicitKun.storage),
    contextCompaction: normalizeKunContextCompactionSettings(explicitKun.contextCompaction),
    runtimeTuning: normalizeKunRuntimeTuningSettings(explicitKun.runtimeTuning),
    imageGeneration: normalizeKunImageGenerationSettings(explicitKun.imageGeneration),
    speechToText: normalizeKunSpeechToTextSettings(explicitKun.speechToText),
    textToSpeech: normalizeKunTextToSpeechSettings(explicitKun.textToSpeech),
    imageRecognition: normalizeKunImageRecognitionSettings(explicitKun.imageRecognition),
    musicGeneration: normalizeKunMusicGenerationSettings(explicitKun.musicGeneration),
    videoGeneration: normalizeKunVideoGenerationSettings(explicitKun.videoGeneration)
  }
  // Strip the legacy `agentProvider` discriminator and the legacy
  // per-provider settings from the surfaced migration result. The
  // runtime now has a single agent (Kun) and we no longer
  // round-trip the legacy value into the new settings shape.
  const { deepseek: _legacyDeepseek, agents: _agents, agentProvider: _agentProvider, ...rest } = parsed
  void _legacyDeepseek
  void _agents
  void _agentProvider
  return {
    ...rest,
    provider,
    agents: {
      kun
    }
  }
}
