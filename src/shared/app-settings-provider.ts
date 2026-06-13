import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
  type AppSettingsV1,
  type ImageGenerationProtocol,
  type KunImageGenerationSettingsV1,
  type KunImageRecognitionSettingsV1,
  type KunMusicGenerationSettingsV1,
  type KunRuntimeSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunSpeechToTextSettingsV1,
  type KunTextToSpeechSettingsV1,
  type KunVideoGenerationSettingsV1,
  type MusicGenerationProtocol,
  type ModelProviderImageCapabilityPatchV1,
  type ModelProviderImageCapabilityV1,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderMusicCapabilityPatchV1,
  type ModelProviderMusicCapabilityV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelProviderProfilePatchV1,
  type ModelProviderProfileV1,
  type ModelProviderSettingsPatchV1,
  type ModelProviderSettingsV1,
  type ModelProviderSpeechCapabilityPatchV1,
  type ModelProviderSpeechCapabilityV1,
  type ModelProviderTextToSpeechCapabilityPatchV1,
  type ModelProviderTextToSpeechCapabilityV1,
  type ModelProviderVideoCapabilityPatchV1,
  type ModelProviderVideoCapabilityV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol
} from './app-settings-types'
import { normalizeModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import { getKunRuntimeSettings } from './app-settings-kun'
import { normalizeDeepseekBaseUrl } from './app-settings-normalizers'
import { DEFAULT_COMPOSER_MODEL_IDS } from './default-composer-models'
import {
  TOKEN_PLAN_PROVIDER_ID_SUFFIX,
  getModelProviderPreset,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  type ModelProviderPreset
} from './model-provider-presets'

const DEFAULT_MODEL_PROVIDER_NAME = 'DeepSeek'
const DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS = 24_000
const DEFAULT_TEXT_MODEL_PROFILE: ModelProviderModelProfileV1 = {
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
}
const SPEECH_TO_TEXT_MODEL_PATTERN =
  /(^|[/_.:-])(asr|stt|whisper|transcription|transcriptions)([/_.:-]|$)|speech[-_.:/]?to[-_.:/]?text|audio[-_.:/]?transcription/i
const TEXT_TO_SPEECH_MODEL_PATTERN =
  /(^|[/_.:-])tts([/_.:-]|$)|(^|[/_.:-])speech[-_.:/]?\d|text[-_.:/]?to[-_.:/]?speech|speech[-_.:/]?synthesis|voiceclone|voicedesign/i
const SPEECH_ONLY_MODEL_PATTERN =
  /(^|[/_.:-])(asr|stt|tts|whisper|transcription|transcriptions|speech)([/_.:-]|$)|voiceclone|voicedesign/i
const IMAGE_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(image|images|dall-e|dalle|flux|sdxl|cogview|wanx|kolors|imagen|seedream|seededit|t2i|i2i)([/_.:-]|$)|stable[-_.:/]?diffusion|text[-_.:/]?to[-_.:/]?image/i
const MUSIC_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(music|song|cover)([/_.:-]|$)|text[-_.:/]?to[-_.:/]?music|music[-_.:/]?generation/i
const VIDEO_GENERATION_MODEL_PATTERN =
  /(^|[/_.:-])(video|videos|hailuo|sora|veo|kling|seedance|t2v|i2v|s2v)([/_.:-]|$)|text[-_.:/]?to[-_.:/]?video|image[-_.:/]?to[-_.:/]?video/i
const NON_TEXT_MODEL_PATTERN =
  /(^|[/_.:-])(embedding|embeddings|embed|bge|rerank|reranker|moderation|ocr|image|images|video|videos|music|song|audio|dall-e|dalle|flux|sdxl|cogview|cogvideo|wanx|kolors|imagen|seedream|seededit|seedance|sora|veo|kling|hailuo|t2i|i2i|t2v|i2v|s2v)([/_.:-]|$)|stable[-_.:/]?diffusion|text[-_.:/]?to[-_.:/]?image|text[-_.:/]?to[-_.:/]?video|image[-_.:/]?to[-_.:/]?video|text[-_.:/]?to[-_.:/]?music|music[-_.:/]?generation/i

export function defaultModelProviderSettings(): ModelProviderSettingsV1 {
  const defaultProvider = defaultModelProviderProfile('', DEFAULT_DEEPSEEK_BASE_URL)
  return {
    apiKey: defaultProvider.apiKey,
    baseUrl: defaultProvider.baseUrl,
    providers: [defaultProvider]
  }
}

export function normalizeModelProviderSettings(
  input: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsV1 {
  const defaults = defaultModelProviderSettings()
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey
  const baseUrl = normalizeModelProviderBaseUrl(input?.baseUrl, defaults.baseUrl)
  const rawProviders = Array.isArray(input?.providers) ? input.providers : []
  const providersById = new Map<string, ModelProviderProfileV1>()
  const defaultProvider = defaultModelProviderProfile(apiKey, baseUrl)
  providersById.set(defaultProvider.id, defaultProvider)
  for (const rawProvider of rawProviders) {
    const provider = normalizeModelProviderProfile(rawProvider)
    if (!provider) continue
    providersById.set(provider.id, provider.id === DEFAULT_MODEL_PROVIDER_ID
      ? {
          ...defaultProvider,
          ...provider,
          apiKey,
          baseUrl,
          modelProfiles: {
            ...defaultProvider.modelProfiles,
            ...provider.modelProfiles
          }
        }
      : provider)
  }
  const providers = [...providersById.values()]
  return {
    apiKey,
    baseUrl,
    providers
  }
}

export function mergeModelProviderSettings(
  current: ModelProviderSettingsV1,
  patch: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsV1 {
  return normalizeModelProviderSettings({
    ...current,
    ...(patch ?? {})
  })
}

export function getModelProviderSettings(settings: AppSettingsV1): ModelProviderSettingsV1 {
  return normalizeModelProviderSettings((settings as { provider?: ModelProviderSettingsPatchV1 }).provider)
}

export function modelProviderSettingsPatch(
  provider: ModelProviderSettingsPatchV1 | undefined
): ModelProviderSettingsPatchV1 {
  return provider ? { ...provider } : {}
}

export function resolveModelProviderApiKey(settings: AppSettingsV1): string {
  return getDefaultModelProviderProfile(settings).apiKey.trim()
}

export function resolveModelProviderBaseUrl(settings: AppSettingsV1): string {
  return normalizeDeepseekBaseUrl(getDefaultModelProviderProfile(settings).baseUrl)
}

export function getDefaultModelProviderProfile(settings: AppSettingsV1): ModelProviderProfileV1 {
  return getModelProviderProfile(settings, DEFAULT_MODEL_PROVIDER_ID)
}

export function getModelProviderProfile(
  settings: AppSettingsV1,
  providerId: string | undefined
): ModelProviderProfileV1 {
  const provider = getModelProviderSettings(settings)
  const id = normalizeModelProviderId(providerId || DEFAULT_MODEL_PROVIDER_ID)
  return provider.providers.find((profile) => profile.id === id) ?? provider.providers[0] ?? defaultModelProviderProfile(provider.apiKey, provider.baseUrl)
}

export function listModelProviderModelIds(settings: AppSettingsV1): string[] {
  const nonTextModelIds = listNonTextModelIds(settings)
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.models) {
      const trimmed = model.trim()
      if (!trimmed || !isComposerChatModelId(trimmed, nonTextModelIds)) continue
      if (!modelProfileSupportsTextChat(modelProviderModelProfile(provider, trimmed))) continue
      ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listSpeechToTextModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.speech?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listImageGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.image?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listTextToSpeechModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.textToSpeech?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listMusicGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.music?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listVideoGenerationModelIds(settings: AppSettingsV1): string[] {
  const ids = new Set<string>()
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const model of provider.video?.models ?? []) {
      const trimmed = model.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function listNonTextModelIds(settings: AppSettingsV1): string[] {
  return [...new Set([
    ...listSpeechToTextModelIds(settings),
    ...listImageGenerationModelIds(settings),
    ...listTextToSpeechModelIds(settings),
    ...listMusicGenerationModelIds(settings),
    ...listVideoGenerationModelIds(settings)
  ])].sort((a, b) => a.localeCompare(b))
}

export function isComposerChatModelId(
  modelId: string,
  nonTextModelIds: readonly string[] = []
): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (!normalized || normalized === 'auto') return false
  const excludedIds = new Set(nonTextModelIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  if (excludedIds.has(normalized)) return false
  return !SPEECH_ONLY_MODEL_PATTERN.test(normalized) && !NON_TEXT_MODEL_PATTERN.test(normalized)
}

export function isSpeechToTextModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && SPEECH_TO_TEXT_MODEL_PATTERN.test(normalized)
}

export function isImageGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && IMAGE_GENERATION_MODEL_PATTERN.test(normalized)
}

export function isTextToSpeechModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && TEXT_TO_SPEECH_MODEL_PATTERN.test(normalized)
}

export function isMusicGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && MUSIC_GENERATION_MODEL_PATTERN.test(normalized)
}

export function isVideoGenerationModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return Boolean(normalized) && VIDEO_GENERATION_MODEL_PATTERN.test(normalized)
}

export function modelProfileSupportsTextChat(
  profile: Pick<ModelProviderModelProfileV1, 'inputModalities' | 'outputModalities'> | undefined
): boolean {
  if (!profile) return true
  return profile.inputModalities.includes('text') && profile.outputModalities.includes('text')
}

export function modelProviderModelProfile(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const normalized = normalizeModelKey(modelId)
  if (!normalized) return undefined
  return provider.modelProfiles[normalized]
}

export function modelProviderModelProfilesForSettings(
  settings: AppSettingsV1
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  const nonTextModelIds = listNonTextModelIds(settings)
  for (const provider of getModelProviderSettings(settings).providers) {
    for (const [modelId, profile] of Object.entries(provider.modelProfiles)) {
      const normalized = normalizeModelKey(modelId)
      if (!normalized || !isComposerChatModelId(normalized, nonTextModelIds)) continue
      if (!modelProfileSupportsTextChat(profile)) continue
      profiles[normalized] = {
        ...profile,
        contextWindowTokens: profile.contextWindowTokens ?? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS
      }
    }
  }
  return profiles
}

export function modelSupportsImageInput(
  profile: Pick<ModelProviderModelProfileV1, 'inputModalities'> | undefined
): boolean {
  return profile?.inputModalities.includes('image') === true
}

export function modelReasoningEfforts(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  return profile?.reasoning
}

export function listImageGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.image))
}

export function listSpeechToTextProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.speech))
}

export function listTextToSpeechProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.textToSpeech))
}

export function listMusicGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.music))
}

export function listVideoGenerationProviderProfiles(settings: AppSettingsV1): ModelProviderProfileV1[] {
  return getModelProviderSettings(settings).providers.filter((provider) => Boolean(provider.video))
}

type MiniMaxMediaCapabilityKey = 'textToSpeech' | 'music' | 'video'
type MiniMaxMediaCapability =
  | ModelProviderTextToSpeechCapabilityV1
  | ModelProviderMusicCapabilityV1
  | ModelProviderVideoCapabilityV1
type TokenPlanCapabilityKey = 'image' | 'speech' | 'textToSpeech' | 'music' | 'video'
type ProviderCapabilityWithBaseUrl = {
  protocol: string
  baseUrl: string
  models: readonly string[]
}
type TokenPlanCapabilityWithOptionalBaseUrl = {
  protocol: string
  baseUrl?: string
  models: readonly string[]
}

type KunMediaSettingCore = Partial<{
  enabled: boolean
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
}>

const MINIMAX_PROVIDER_ID = 'minimax'
const MINIMAX_TOKEN_PLAN_PROVIDER_ID = `${MINIMAX_PROVIDER_ID}${TOKEN_PLAN_PROVIDER_ID_SUFFIX}`

export function defaultMiniMaxMediaGenerationKunPatch(input: {
  providers: readonly ModelProviderProfileV1[]
  currentKun?: Partial<KunRuntimeSettingsV1>
  kunPatch?: KunRuntimeSettingsPatchV1
}): KunRuntimeSettingsPatchV1 | undefined {
  const patch: KunRuntimeSettingsPatchV1 = {}
  if (!input.kunPatch?.textToSpeech && isBlankKunMediaSetting(input.currentKun?.textToSpeech)) {
    const match = configuredMiniMaxMediaCapability(input.providers, 'textToSpeech', input.currentKun?.providerId)
    if (match) {
      patch.textToSpeech = {
        enabled: true,
        providerId: match.provider.id,
        protocol: match.capability.protocol as TextToSpeechProtocol,
        baseUrl: '',
        apiKey: '',
        model: match.model
      }
    }
  }
  if (!input.kunPatch?.musicGeneration && isBlankKunMediaSetting(input.currentKun?.musicGeneration)) {
    const match = configuredMiniMaxMediaCapability(input.providers, 'music', input.currentKun?.providerId)
    if (match) {
      patch.musicGeneration = {
        enabled: true,
        providerId: match.provider.id,
        protocol: match.capability.protocol as MusicGenerationProtocol,
        baseUrl: '',
        apiKey: '',
        model: match.model
      }
    }
  }
  if (!input.kunPatch?.videoGeneration && isBlankKunMediaSetting(input.currentKun?.videoGeneration)) {
    const match = configuredMiniMaxMediaCapability(input.providers, 'video', input.currentKun?.providerId)
    if (match) {
      patch.videoGeneration = {
        enabled: true,
        providerId: match.provider.id,
        protocol: match.capability.protocol as VideoGenerationProtocol,
        baseUrl: '',
        apiKey: '',
        model: match.model
      }
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

function isBlankKunMediaSetting(setting: KunMediaSettingCore | undefined): boolean {
  return setting?.enabled !== true &&
    !setting?.providerId?.trim() &&
    !setting?.baseUrl?.trim() &&
    !setting?.apiKey?.trim() &&
    !setting?.model?.trim()
}

function configuredMiniMaxMediaCapability(
  providers: readonly ModelProviderProfileV1[],
  key: MiniMaxMediaCapabilityKey,
  currentProviderId: string | undefined
): { provider: ModelProviderProfileV1; capability: MiniMaxMediaCapability; model: string } | null {
  const byId = new Map(providers.map((provider) => [provider.id, providerWithPresetCapabilities(provider)]))
  for (const id of preferredMiniMaxMediaProviderIds(currentProviderId)) {
    const provider = byId.get(id)
    if (!provider?.apiKey.trim()) continue
    const capability = provider[key]
    const model = capability ? firstCapabilityModel(capability.models) : ''
    if (!capability || !model) continue
    return { provider, capability, model }
  }
  return null
}

function preferredMiniMaxMediaProviderIds(currentProviderId: string | undefined): string[] {
  const normalized = normalizeModelProviderId(currentProviderId)
  const ids = normalized === MINIMAX_PROVIDER_ID || normalized === MINIMAX_TOKEN_PLAN_PROVIDER_ID
    ? [normalized, MINIMAX_PROVIDER_ID, MINIMAX_TOKEN_PLAN_PROVIDER_ID]
    : [MINIMAX_PROVIDER_ID, MINIMAX_TOKEN_PLAN_PROVIDER_ID]
  return ids.filter((id, index) => ids.indexOf(id) === index)
}

function providerWithPresetCapabilities(provider: ModelProviderProfileV1): ModelProviderProfileV1 {
  const tokenPlanPreset = tokenPlanPresetForProvider(provider)
  const presetProfile = tokenPlanPreset?.tokenPlan
    ? modelProviderTokenPlanProfile(tokenPlanPreset, provider.apiKey, provider.baseUrl)
    : modelProviderPresetProfileForProvider(provider)
  if (!presetProfile) return provider
  const image = mergePresetCapability(provider.image, presetProfile.image)
  const speech = mergePresetCapability(provider.speech, presetProfile.speech)
  const textToSpeech = mergePresetCapability(provider.textToSpeech, presetProfile.textToSpeech)
  const music = mergePresetCapability(provider.music, presetProfile.music)
  const video = mergePresetCapability(provider.video, presetProfile.video)
  return {
    ...provider,
    ...(image ? { image } : {}),
    ...(speech ? { speech } : {}),
    ...(textToSpeech ? { textToSpeech } : {}),
    ...(music ? { music } : {}),
    ...(video ? { video } : {})
  }
}

function modelProviderPresetProfileForProvider(provider: ModelProviderProfileV1): ModelProviderProfileV1 | null {
  const preset = getModelProviderPreset(provider.id)
  return preset ? modelProviderPresetProfile(preset, provider.apiKey) : null
}

function mergePresetCapability<T extends { baseUrl: string; models: string[] }>(
  stored: T | undefined,
  preset: T | undefined
): T | undefined {
  if (!stored) return preset
  if (!preset) return stored
  return {
    ...preset,
    ...stored,
    baseUrl: stored.baseUrl.trim() || preset.baseUrl,
    models: stored.models.length > 0 ? stored.models : preset.models
  }
}

function firstCapabilityModel(models: readonly string[]): string {
  return models.map((model) => model.trim()).find(Boolean) ?? ''
}

export function resolveKunSpeechToTextSettings(settings: AppSettingsV1): KunSpeechToTextSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const speechToText = runtime.speechToText
  const providerId = normalizeModelProviderId(speechToText.providerId)
  if (!providerId || providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID) {
    return {
      ...speechToText,
      providerId,
      protocol: normalizeSpeechToTextProtocol(speechToText.protocol)
    }
  }
  const provider = getModelProviderProfile(settings, providerId)
  const speech = provider.speech
  if (!speech) {
    return {
      ...speechToText,
      providerId,
      protocol: normalizeSpeechToTextProtocol(speechToText.protocol)
    }
  }
  return {
    ...speechToText,
    providerId: provider.id,
    protocol: speech.protocol,
    baseUrl: resolveProviderSpeechBaseUrl(provider, speech),
    apiKey: provider.apiKey.trim(),
    model: resolveProviderSpeechModel(speechToText.model, speech.models)
  }
}

function resolveProviderSpeechBaseUrl(
  provider: ModelProviderProfileV1,
  speech: ModelProviderSpeechCapabilityV1
): string {
  return resolveProviderCapabilityBaseUrl(provider, speech, 'speech')
}

function resolveProviderCapabilityBaseUrl(
  provider: ModelProviderProfileV1,
  capability: ProviderCapabilityWithBaseUrl,
  key: TokenPlanCapabilityKey
): string {
  const tokenPlan = tokenPlanPresetForProvider(provider)
  const tokenPlanConfig = tokenPlan?.tokenPlan
  const tokenPlanCapability = tokenPlanConfig ? tokenPlanCapabilityForKey(tokenPlanConfig, key) : undefined
  if (!tokenPlanConfig || !tokenPlanCapability) return capability.baseUrl
  if (capability.protocol !== tokenPlanCapability.protocol) return capability.baseUrl
  if (!sameModelIds(capability.models, tokenPlanCapability.models)) return capability.baseUrl

  const regularCapability = presetCapabilityForKey(tokenPlan, key)
  const legacyPresetBaseUrl = regularCapability &&
    regularCapability.protocol === tokenPlanCapability.protocol &&
    sameModelIds(regularCapability.models, tokenPlanCapability.models)
    ? regularCapability.baseUrl
    : undefined
  const knownPresetUrls = knownTokenPlanCapabilityBaseUrls(
    tokenPlanConfig,
    tokenPlanCapability.baseUrl,
    legacyPresetBaseUrl
  )
  const capabilityBaseUrl = canonicalBaseUrl(capability.baseUrl)
  if (!capabilityBaseUrl || knownPresetUrls.some((url) => canonicalBaseUrl(url) === capabilityBaseUrl)) {
    return deriveTokenPlanCapabilityBaseUrl(tokenPlanConfig, provider.baseUrl, tokenPlanCapability.baseUrl)
  }
  return capability.baseUrl
}

function tokenPlanCapabilityForKey(
  tokenPlan: NonNullable<ModelProviderPreset['tokenPlan']>,
  key: TokenPlanCapabilityKey
): TokenPlanCapabilityWithOptionalBaseUrl | undefined {
  switch (key) {
    case 'image':
      return tokenPlan.image
    case 'speech':
      return tokenPlan.speech
    case 'textToSpeech':
      return tokenPlan.textToSpeech
    case 'music':
      return tokenPlan.music
    case 'video':
      return tokenPlan.video
  }
}

function presetCapabilityForKey(
  preset: ModelProviderPreset,
  key: TokenPlanCapabilityKey
): ProviderCapabilityWithBaseUrl | undefined {
  switch (key) {
    case 'image':
      return preset.image
    case 'speech':
      return preset.speech
    case 'textToSpeech':
      return preset.textToSpeech
    case 'music':
      return preset.music
    case 'video':
      return preset.video
  }
}

function knownTokenPlanCapabilityBaseUrls(
  tokenPlan: NonNullable<ModelProviderPreset['tokenPlan']>,
  capabilityBaseUrl: string | undefined,
  legacyPresetBaseUrl: string | undefined
): string[] {
  const planBaseUrls = [
    tokenPlan.baseUrl,
    ...(tokenPlan.regions?.map((region) => region.baseUrl) ?? [])
  ]
  const legacyBaseUrls = legacyPresetBaseUrl?.trim() ? [legacyPresetBaseUrl] : []
  if (!capabilityBaseUrl?.trim()) return [...planBaseUrls, ...legacyBaseUrls]
  return planBaseUrls
    .map((baseUrl) => deriveTokenPlanCapabilityBaseUrl(tokenPlan, baseUrl, capabilityBaseUrl))
    .concat(legacyBaseUrls)
    .filter((url): url is string => Boolean(url.trim()))
}

function deriveTokenPlanCapabilityBaseUrl(
  tokenPlan: NonNullable<ModelProviderPreset['tokenPlan']>,
  providerBaseUrl: string,
  capabilityBaseUrl: string | undefined
): string {
  const providerUrl = providerBaseUrl.trim()
  if (!capabilityBaseUrl?.trim()) return providerUrl
  const providerOrigin = urlOrigin(providerUrl)
  const capabilityOrigin = urlOrigin(capabilityBaseUrl)
  if (!providerOrigin || !capabilityOrigin) return capabilityBaseUrl.trim()
  const planOrigins = [
    tokenPlan.baseUrl,
    ...(tokenPlan.regions?.map((region) => region.baseUrl) ?? [])
  ].map(urlOrigin).filter((origin): origin is string => Boolean(origin))
  if (!planOrigins.includes(capabilityOrigin)) return capabilityBaseUrl.trim()
  return replaceUrlOrigin(capabilityBaseUrl, providerOrigin)
}

function urlOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

function replaceUrlOrigin(value: string, origin: string): string {
  try {
    const url = new URL(value.trim())
    const path = url.pathname.replace(/\/+$/, '')
    return `${origin}${path === '/' ? '' : path}${url.search}`
  } catch {
    return value.trim()
  }
}

function resolveProviderSpeechModel(configuredModel: string, providerModels: readonly string[]): string {
  const model = configuredModel.trim()
  if (!model) return providerModels[0] ?? ''
  if (providerModels.length === 0) return model
  if (providerModels.some((providerModel) => providerModel.trim().toLowerCase() === model.toLowerCase())) {
    return model
  }
  return TEXT_TO_SPEECH_MODEL_PATTERN.test(model) ? providerModels[0] ?? model : model
}

export function resolveKunTextToSpeechSettings(settings: AppSettingsV1): KunTextToSpeechSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const textToSpeech = runtime.textToSpeech
  const providerId = normalizeModelProviderId(textToSpeech.providerId)
  if (!providerId || providerId === CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID) {
    return {
      ...textToSpeech,
      providerId,
      protocol: normalizeTextToSpeechProtocol(textToSpeech.protocol)
    }
  }
  const provider = getModelProviderProfile(settings, providerId)
  const capability = provider.textToSpeech
  if (!capability) {
    return {
      ...textToSpeech,
      providerId,
      protocol: normalizeTextToSpeechProtocol(textToSpeech.protocol)
    }
  }
  return {
    ...textToSpeech,
    providerId: provider.id,
    protocol: capability.protocol,
    baseUrl: resolveProviderCapabilityBaseUrl(provider, capability, 'textToSpeech'),
    apiKey: provider.apiKey.trim(),
    model: resolveProviderCapabilityModel(textToSpeech.model, capability.models)
  }
}

export function resolveKunImageRecognitionSettings(settings: AppSettingsV1): KunImageRecognitionSettingsV1 {
  return getKunRuntimeSettings(settings).imageRecognition
}

export function resolveKunMusicGenerationSettings(settings: AppSettingsV1): KunMusicGenerationSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const musicGeneration = runtime.musicGeneration
  const providerId = normalizeModelProviderId(musicGeneration.providerId)
  if (!providerId || providerId === CUSTOM_MUSIC_GENERATION_PROVIDER_ID) {
    return {
      ...musicGeneration,
      providerId,
      protocol: normalizeMusicGenerationProtocol(musicGeneration.protocol)
    }
  }
  const provider = getModelProviderProfile(settings, providerId)
  const capability = provider.music
  if (!capability) {
    return {
      ...musicGeneration,
      providerId,
      protocol: normalizeMusicGenerationProtocol(musicGeneration.protocol)
    }
  }
  return {
    ...musicGeneration,
    providerId: provider.id,
    protocol: capability.protocol,
    baseUrl: resolveProviderCapabilityBaseUrl(provider, capability, 'music'),
    apiKey: provider.apiKey.trim(),
    model: resolveProviderCapabilityModel(musicGeneration.model, capability.models)
  }
}

export function resolveKunVideoGenerationSettings(settings: AppSettingsV1): KunVideoGenerationSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const videoGeneration = runtime.videoGeneration
  const providerId = normalizeModelProviderId(videoGeneration.providerId)
  if (!providerId || providerId === CUSTOM_VIDEO_GENERATION_PROVIDER_ID) {
    return {
      ...videoGeneration,
      providerId,
      protocol: normalizeVideoGenerationProtocol(videoGeneration.protocol)
    }
  }
  const provider = getModelProviderProfile(settings, providerId)
  const capability = provider.video
  if (!capability) {
    return {
      ...videoGeneration,
      providerId,
      protocol: normalizeVideoGenerationProtocol(videoGeneration.protocol)
    }
  }
  return {
    ...videoGeneration,
    providerId: provider.id,
    protocol: capability.protocol,
    baseUrl: resolveProviderCapabilityBaseUrl(provider, capability, 'video'),
    apiKey: provider.apiKey.trim(),
    model: resolveProviderCapabilityModel(videoGeneration.model, capability.models)
  }
}

function resolveProviderCapabilityModel(configuredModel: string, providerModels: readonly string[]): string {
  const model = configuredModel.trim()
  if (!model) return providerModels[0] ?? ''
  if (providerModels.length === 0) return model
  return providerModels.some((providerModel) => providerModel.trim().toLowerCase() === model.toLowerCase())
    ? model
    : providerModels[0] ?? model
}

function tokenPlanPresetForProvider(provider: Pick<ModelProviderProfileV1, 'id'>) {
  if (!provider.id.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)) return null
  const preset = getModelProviderPreset(provider.id.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length))
  return preset?.tokenPlan ? preset : null
}

function sameModelIds(a: readonly string[], b: readonly string[]): boolean {
  const left = a.map((model) => model.trim().toLowerCase()).filter(Boolean).sort()
  const right = b.map((model) => model.trim().toLowerCase()).filter(Boolean).sort()
  return left.length === right.length && left.every((model, index) => model === right[index])
}

function canonicalBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function resolveKunImageGenerationSettings(settings: AppSettingsV1): KunImageGenerationSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const imageGeneration = runtime.imageGeneration
  const providerId = normalizeModelProviderId(imageGeneration.providerId)
  if (!providerId || providerId === CUSTOM_IMAGE_GENERATION_PROVIDER_ID) {
    return {
      ...imageGeneration,
      providerId,
      protocol: normalizeImageGenerationProtocol(imageGeneration.protocol)
    }
  }
  const provider = getModelProviderProfile(settings, providerId)
  const image = provider.image
  if (!image) {
    return {
      ...imageGeneration,
      providerId,
      protocol: normalizeImageGenerationProtocol(imageGeneration.protocol)
    }
  }
  return {
    ...imageGeneration,
    providerId: provider.id,
    protocol: image.protocol,
    baseUrl: resolveProviderCapabilityBaseUrl(provider, image, 'image'),
    apiKey: provider.apiKey.trim(),
    model: resolveProviderCapabilityModel(imageGeneration.model, image.models)
  }
}

export function resolveKunRuntimeSettings(settings: AppSettingsV1): KunRuntimeSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const providerId = normalizeModelProviderId(runtime.providerId)
  const runtimeApiKey = runtime.apiKey?.trim() ?? ''
  const runtimeBaseUrl = runtime.baseUrl?.trim() ?? ''
  const providerBaseUrl = provider.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL
  const useProviderCredentials = Boolean(providerId)

  return {
    ...runtime,
    apiKey: useProviderCredentials ? provider.apiKey.trim() : runtimeApiKey || provider.apiKey.trim(),
    baseUrl:
      !useProviderCredentials && runtimeBaseUrl && runtimeBaseUrl !== DEFAULT_DEEPSEEK_BASE_URL
        ? normalizeDeepseekBaseUrl(runtimeBaseUrl)
        : normalizeDeepseekBaseUrl(providerBaseUrl),
    endpointFormat: provider.endpointFormat,
    imageGeneration: resolveKunImageGenerationSettings(settings),
    speechToText: resolveKunSpeechToTextSettings(settings),
    textToSpeech: resolveKunTextToSpeechSettings(settings),
    imageRecognition: resolveKunImageRecognitionSettings(settings),
    musicGeneration: resolveKunMusicGenerationSettings(settings),
    videoGeneration: resolveKunVideoGenerationSettings(settings),
    modelProfiles: modelProviderModelProfilesForSettings(settings)
  }
}

function defaultModelProviderProfile(apiKey: string, baseUrl: string): ModelProviderProfileV1 {
  return {
    id: DEFAULT_MODEL_PROVIDER_ID,
    name: DEFAULT_MODEL_PROVIDER_NAME,
    apiKey: apiKey.trim(),
    baseUrl: normalizeModelProviderBaseUrl(baseUrl),
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    models: [...DEFAULT_COMPOSER_MODEL_IDS],
    modelProfiles: {
      'deepseek-v4-pro': deepseekTextModelProfile(),
      'deepseek-v4-flash': {
        ...deepseekTextModelProfile(),
        aliases: ['deepseek-chat', 'deepseek-reasoner']
      }
    }
  }
}

function normalizeModelProviderProfile(
  input: ModelProviderProfilePatchV1 | undefined
): ModelProviderProfileV1 | null {
  const id = normalizeModelProviderId(input?.id)
  if (!id) return null
  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : id
  const baseUrl = normalizeModelProviderBaseUrl(input?.baseUrl)
  const models = normalizeProviderModels(input?.models)
  const modelProfiles = withPresetModelProfiles(
    id,
    models,
    normalizeModelProviderModelProfiles(input?.modelProfiles, models)
  )
  const image = normalizeModelProviderImageCapability(input?.image)
  const speech = normalizeModelProviderSpeechCapability(input?.speech)
  const textToSpeech = normalizeModelProviderTextToSpeechCapability(input?.textToSpeech)
  const music = normalizeModelProviderMusicCapability(input?.music)
  const video = normalizeModelProviderVideoCapability(input?.video)
  return providerWithPresetCapabilities({
    id,
    name,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : '',
    baseUrl,
    endpointFormat: normalizeModelEndpointFormat(input?.endpointFormat),
    models,
    modelProfiles,
    ...(image ? { image } : {}),
    ...(speech ? { speech } : {}),
    ...(textToSpeech ? { textToSpeech } : {}),
    ...(music ? { music } : {}),
    ...(video ? { video } : {})
  })
}

function deepseekTextModelProfile(): ModelProviderModelProfileV1 {
  return {
    ...DEFAULT_TEXT_MODEL_PROFILE,
    contextWindowTokens: 1_000_000,
    reasoning: {
      supportedEfforts: ['off', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'deepseek-chat-completions'
    }
  }
}

/**
 * Stored provider settings may predate the capability metadata in the presets
 * (older saves carry empty modelProfiles). For known preset providers the
 * preset is the source of truth, so its profiles override stale stored ones;
 * stored profiles for models the preset does not know are kept.
 */
function withPresetModelProfiles(
  providerId: string,
  models: readonly string[],
  stored: Record<string, ModelProviderModelProfileV1>
): Record<string, ModelProviderModelProfileV1> {
  const presetProfiles = presetModelProfilesForProvider(providerId)
  if (!presetProfiles) return stored
  const knownModelKeys = new Set(models.map(normalizeModelKey).filter(Boolean))
  const merged = { ...stored }
  for (const [rawModelId, presetProfile] of Object.entries(presetProfiles)) {
    const modelId = normalizeModelKey(rawModelId)
    if (!modelId) continue
    if (knownModelKeys.size > 0 && !knownModelKeys.has(modelId)) {
      const aliases = normalizeProviderModels(presetProfile.aliases)
      if (!aliases.some((alias) => knownModelKeys.has(normalizeModelKey(alias)))) continue
    }
    merged[modelId] = normalizeModelProviderModelProfile(presetProfile)
  }
  return merged
}

function presetModelProfilesForProvider(
  providerId: string
): Record<string, ModelProviderModelProfileV1> | null {
  const isTokenPlan = providerId.endsWith(TOKEN_PLAN_PROVIDER_ID_SUFFIX)
  const preset = getModelProviderPreset(
    isTokenPlan ? providerId.slice(0, -TOKEN_PLAN_PROVIDER_ID_SUFFIX.length) : providerId
  )
  if (!preset) return null
  const profiles = isTokenPlan
    ? preset.tokenPlan?.modelProfiles ?? preset.modelProfiles
    : preset.modelProfiles
  return profiles ?? null
}

function normalizeModelProviderModelProfiles(
  input: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined,
  models: readonly string[]
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return profiles
  const knownModelKeys = new Set(models.map(normalizeModelKey).filter(Boolean))
  for (const [rawModelId, rawProfile] of Object.entries(input)) {
    const modelId = normalizeModelKey(rawModelId)
    if (!modelId || rawProfile === null) continue
    if (knownModelKeys.size > 0 && !knownModelKeys.has(modelId)) {
      const aliases = normalizeProviderModels(rawProfile.aliases)
      if (!aliases.some((alias) => knownModelKeys.has(normalizeModelKey(alias)))) continue
    }
    profiles[modelId] = normalizeModelProviderModelProfile(rawProfile)
  }
  return profiles
}

function normalizeModelProviderModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeModelInputModalities(input?.inputModalities)
  const defaultMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = boundedPositiveInteger(input?.contextWindowTokens)
  const reasoning = normalizeModelReasoningCapability(input?.reasoning)
  return {
    ...(normalizeProviderModels(input?.aliases).length
      ? { aliases: normalizeProviderModels(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities,
    outputModalities: normalizeModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeModelMessageParts(input?.messageParts, defaultMessageParts),
    ...(reasoning ? { reasoning } : {})
  }
}

function normalizeModelReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeReasoningEffort(input.defaultEffort)
  const resolvedDefault = defaultEffort && supportedEfforts.includes(defaultEffort)
    ? defaultEffort
    : supportedEfforts[0]
  const requestProtocol = normalizeReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: resolvedDefault,
    requestProtocol
  }
}

function normalizeReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const out: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeReasoningEffort(item)
    if (effort && !out.includes(effort)) out.push(effort)
  }
  return out
}

function normalizeReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

function normalizeReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

function normalizeModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const out: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !out.includes(item)) out.push(item)
  }
  return out.length > 0 ? out : ['text']
}

function normalizeModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const out: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !out.includes(item)
    ) {
      out.push(item)
    }
  }
  return out.length > 0 ? out : [...fallback]
}

function boundedPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function normalizeModelProviderImageCapability(
  input: ModelProviderImageCapabilityPatchV1 | null | undefined
): ModelProviderImageCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeImageGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  return value === 'minimax-image' ? 'minimax-image' : DEFAULT_IMAGE_GENERATION_PROTOCOL
}

function normalizeModelProviderSpeechCapability(
  input: ModelProviderSpeechCapabilityPatchV1 | null | undefined
): ModelProviderSpeechCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeSpeechToTextProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  return value === 'mimo-asr' ? 'mimo-asr' : DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

function normalizeModelProviderTextToSpeechCapability(
  input: ModelProviderTextToSpeechCapabilityPatchV1 | null | undefined
): ModelProviderTextToSpeechCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeTextToSpeechProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

function normalizeModelProviderMusicCapability(
  input: ModelProviderMusicCapabilityPatchV1 | null | undefined
): ModelProviderMusicCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeMusicGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

function normalizeModelProviderVideoCapability(
  input: ModelProviderVideoCapabilityPatchV1 | null | undefined
): ModelProviderVideoCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.trim()
    ? normalizeDeepseekBaseUrl(input.baseUrl)
    : ''
  const models = normalizeProviderModels(input.models)
  if (!baseUrl && models.length === 0) return undefined
  return {
    protocol: normalizeVideoGenerationProtocol(input.protocol),
    baseUrl,
    models
  }
}

export function normalizeVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

function normalizeModelProviderBaseUrl(value: unknown, fallback = DEFAULT_DEEPSEEK_BASE_URL): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? normalizeDeepseekBaseUrl(trimmed) : ''
}

function normalizeProviderModels(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  const ids = new Set<string>()
  for (const model of models) {
    if (typeof model !== 'string') continue
    const trimmed = model.trim()
    if (trimmed) ids.add(trimmed)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function normalizeModelProviderId(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    : ''
}

function normalizeModelKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
