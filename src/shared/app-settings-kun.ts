import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_KUN_PORT,
  DEFAULT_SANDBOX_MODE,
  type AppSettingsV1,
  type KunContextCompactionSettingsV1,
  type KunHistoryHygieneSettingsV1,
  type KunMcpSearchSettingsV1,
  type KunRuntimeTuningSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunRuntimeSettingsV1,
  type KunSettingsEnvelopePatchV1,
  type KunSettingsEnvelopeV1,
  type KunStorageSettingsV1,
  type KunTokenEconomySettingsV1,
  type ModelProviderSettingsV1,
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
    sandboxMode: 'workspace-write'
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
    runtimeTuning: defaultKunRuntimeTuningSettings()
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
  return {
    ...current,
    ...(patch ?? {}),
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    mcpSearch: nextMcpSearch,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning
  }
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
      : nonEmptyStringOrFallback(explicitKun.baseUrl, legacySeed.baseUrl)
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
    runtimeTuning: normalizeKunRuntimeTuningSettings(explicitKun.runtimeTuning)
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
