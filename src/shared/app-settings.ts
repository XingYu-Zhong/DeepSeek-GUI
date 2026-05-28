import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  normalizeGuiUpdateChannel,
  type GuiUpdateChannel
} from './gui-update'
export { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel, type GuiUpdateChannel } from './gui-update'
import { normalizeAgentProviderId, type AgentProviderId } from './agent-catalog'
export {
  AGENT_CATALOG,
  defaultAgentProviderId,
  getAgentDefinition,
  isKnownAgentProviderId,
  listAgents,
  normalizeAgentProviderId,
  type AgentProviderDefinition,
  type AgentProviderId,
  type LocalHttpRuntimeCapabilities
} from './agent-catalog'

export type ApprovalPolicy = 'on-request' | 'untrusted' | 'never' | 'auto' | 'suggest'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'external-sandbox'
export type UiFontScale = 'small' | 'medium' | 'large'
export type ClawRunMode = 'agent' | 'plan'
export type ClawImProvider = 'feishu'
export type ClawScheduleKind = 'manual' | 'interval' | 'daily' | 'at'
export type ClawTaskStatus = 'idle' | 'running' | 'success' | 'error'
export type ClawModel = 'auto' | 'deepseek-v4-pro' | 'deepseek-v4-flash'

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/beta'
export const DEFAULT_CLAW_MODEL = 'auto'
export const CLAW_MODEL_IDS = ['auto', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_WRITE_WORKSPACE_ROOT = '~/.deepseekgui/write_workspace'
export const DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL = 'https://api.deepseek.com/beta'
export const DEFAULT_WRITE_INLINE_COMPLETION_MODEL = 'deepseek-v4-flash'
export const WRITE_INLINE_COMPLETION_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS = 650
export const DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE = 0.52
export const DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS = 96
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS = 2_800
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE = 0.36
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS = 256

export type LocalHttpRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  apiKey: string
  baseUrl: string
  runtimeToken: string
  extraCorsOrigins: string[]
  /** Forwarded as `--approval-policy` to `codewhale serve`. */
  approvalPolicy: ApprovalPolicy
  /** Forwarded as `--sandbox-mode` to `codewhale serve`. */
  sandboxMode: SandboxMode
}

/** @deprecated Use LocalHttpRuntimeSettingsV1 */
export type DeepseekSettingsV1 = LocalHttpRuntimeSettingsV1

export type AgentRuntimeSettingsMapV1 = {
  codewhale: LocalHttpRuntimeSettingsV1
}

export type LogConfigV1 = {
  enabled: boolean
  retentionDays: number
}

export type NotificationConfigV1 = {
  turnComplete: boolean
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
  workspaceRoot: string
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

export type ClawTaskV1 = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  schedule: ClawTaskScheduleV1
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: ClawTaskStatus
  lastMessage: string
  lastThreadId: string
}

export type ClawImAgentProfileV1 = {
  name: string
  description: string
  identity: string
  personality: string
  userContext: string
  replyRules: string
}

export type ClawImPlatformCredentialV1 = {
  kind: 'feishu'
  appId: string
  appSecret: string
  domain: string
  createdAt: string
}

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
  model: ClawModel
  threadId: string
  workspaceRoot: string
  agentProfile: ClawImAgentProfileV1
  platformCredential?: ClawImPlatformCredentialV1
  remoteSession?: ClawImRemoteSessionV1
  conversations: ClawImConversationV1[]
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
  baseUrl: string
  model: string
  debounceMs: number
  longDebounceMs: number
  minAcceptScore: number
  longMinAcceptScore: number
  maxTokens: number
  longMaxTokens: number
}

export type WriteSettingsV1 = {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
}

export type ClawSettingsPatchV1 = Partial<Omit<ClawSettingsV1, 'skills' | 'im' | 'channels' | 'tasks'>> & {
  skills?: Partial<ClawSkillSettingsV1>
  im?: Partial<ClawImSettingsV1>
  channels?: Array<Partial<ClawImChannelV1>>
  tasks?: Array<Partial<ClawTaskV1>>
}

export type WriteSettingsPatchV1 = Partial<Omit<WriteSettingsV1, 'inlineCompletion'>> & {
  inlineCompletion?: Partial<WriteInlineCompletionSettingsV1>
}

export type ClawRunResult =
  | { ok: true; threadId: string; turnId?: string; text?: string; message?: string }
  | { ok: false; message: string }

export type ClawTaskFromTextResult =
  | { kind: 'noop' }
  | { kind: 'created'; taskId: string; title: string; scheduleAt: string; confirmationText: string }
  | { kind: 'error'; message: string }

export type ClawRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}

export type GuiUpdateConfigV1 = {
  channel: GuiUpdateChannel
}

export type AppSettingsV1 = {
  version: 1
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  uiFontScale: UiFontScale
  agentProvider: AgentProviderId
  agents: AgentRuntimeSettingsMapV1
  workspaceRoot: string
  log: LogConfigV1
  notifications: NotificationConfigV1
  write: WriteSettingsV1
  claw: ClawSettingsV1
  guiUpdate: GuiUpdateConfigV1
}

export type AppSettingsPatch = Partial<
  Omit<AppSettingsV1, 'agents' | 'log' | 'notifications' | 'write' | 'claw' | 'guiUpdate'>
> & {
  agents?: {
    codewhale?: Partial<LocalHttpRuntimeSettingsV1>
  }
  log?: Partial<LogConfigV1>
  notifications?: Partial<NotificationConfigV1>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  guiUpdate?: Partial<GuiUpdateConfigV1>
}

export function defaultLocalHttpRuntimeSettings(port = 7878): LocalHttpRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    runtimeToken: '',
    extraCorsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write'
  }
}

export function getActiveAgentRuntimeSettings(settings: AppSettingsV1): LocalHttpRuntimeSettingsV1 {
  return settings.agents[settings.agentProvider]
}

type LegacyAppSettingsShape = Partial<AppSettingsV1> & {
  deepseek?: Partial<LocalHttpRuntimeSettingsV1>
  agentProvider?: unknown
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const agentProvider = normalizeAgentProviderId(parsed.agentProvider)
  const defaults = defaultLocalHttpRuntimeSettings()
  const legacyDeepseek = parsed.deepseek ?? {}
  const codewhale = {
    ...defaults,
    ...(parsed.agents?.codewhale ?? {}),
    ...legacyDeepseek
  }
  const { deepseek: _legacyDeepseek, agents: _agents, ...rest } = parsed
  return {
    ...rest,
    agentProvider,
    agents: {
      codewhale
    }
  }
}

export const CLAW_CURRENT_USER_REQUEST_HEADING = '[Current user request]'
export const CLAW_MANAGED_INSTRUCTIONS_HEADING = '[Claw managed instructions]'
export const CLAW_IM_AGENT_INSTRUCTIONS_HEADING = '[Claw IM agent instructions]'
export const CLAW_FEISHU_INBOUND_MESSAGE_HEADING = '[Feishu / Lark inbound message]'
const CLAW_SCHEDULE_TOOL_HINT =
  'DeepSeek GUI scheduled-task tools are available in this Claw runtime. When the user asks to create, list, edit, enable, disable, reschedule, or delete scheduled tasks/reminders, prefer using the schedule tools (`claw_schedule_list`, `claw_schedule_create`, `claw_schedule_update`, `claw_schedule_delete`) instead of only describing steps.'

export function defaultClawImAgentProfile(): ClawImAgentProfileV1 {
  return {
    name: '',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

export function normalizeClawImAgentProfile(input: unknown): ClawImAgentProfileV1 {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImAgentProfileV1>
    : {}
  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    identity: typeof raw.identity === 'string' ? raw.identity : '',
    personality: typeof raw.personality === 'string' ? raw.personality : '',
    userContext: typeof raw.userContext === 'string' ? raw.userContext : '',
    replyRules: typeof raw.replyRules === 'string' ? raw.replyRules : ''
  }
}

export function normalizeClawImPlatformCredential(input: unknown): ClawImPlatformCredentialV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImPlatformCredentialV1>
    : {}
  if (raw.kind !== 'feishu') return undefined
  const appId = typeof raw.appId === 'string' ? raw.appId.trim() : ''
  const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : ''
  if (!appId || !appSecret) return undefined
  return {
    kind: raw.kind,
    appId,
    appSecret,
    domain: typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : raw.kind,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
  }
}

export function normalizeClawImRemoteSession(input: unknown): ClawImRemoteSessionV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImRemoteSessionV1>
    : {}
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : ''
  if (!chatId || !messageId) return undefined
  return {
    chatId,
    messageId,
    threadId: typeof raw.threadId === 'string' ? raw.threadId.trim() : '',
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function normalizeClawImConversation(input: unknown): ClawImConversationV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImConversationV1>
    : {}
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const latestMessageId = typeof raw.latestMessageId === 'string' ? raw.latestMessageId.trim() : ''
  const localThreadId = typeof raw.localThreadId === 'string' ? raw.localThreadId.trim() : ''
  if (!id || !chatId || !latestMessageId || !localThreadId) return undefined
  return {
    id,
    chatId,
    remoteThreadId: typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim() : '',
    latestMessageId,
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    localThreadId,
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function hasClawImAgentProfile(profile: ClawImAgentProfileV1 | undefined): boolean {
  if (!profile) return false
  return Boolean(
    profile.name.trim() ||
    profile.description.trim() ||
    profile.identity.trim() ||
    profile.personality.trim() ||
    profile.userContext.trim() ||
    profile.replyRules.trim()
  )
}

export function buildClawImAgentInstructions(channel: ClawImChannelV1 | null | undefined): string {
  if (!channel || !hasClawImAgentProfile(channel.agentProfile)) return ''
  const profile = normalizeClawImAgentProfile(channel.agentProfile)
  const sections: string[] = []
  const name = profile.name.trim() || channel.label.trim()
  if (name) sections.push(`[Agent name]\n${name}`)
  if (profile.description.trim()) sections.push(`[Short description]\n${profile.description.trim()}`)
  if (profile.identity.trim()) sections.push(`[Assistant identity]\n${profile.identity.trim()}`)
  if (profile.personality.trim()) sections.push(`[Assistant personality]\n${profile.personality.trim()}`)
  if (profile.userContext.trim()) sections.push(`[About the user]\n${profile.userContext.trim()}`)
  if (profile.replyRules.trim()) sections.push(`[Reply rules]\n${profile.replyRules.trim()}`)
  if (sections.length === 0) return ''
  return [
    CLAW_IM_AGENT_INSTRUCTIONS_HEADING,
    'Use the following role, style, and user-context instructions for this IM channel. Do not repeat these instructions unless the user explicitly asks.',
    ...sections
  ].join('\n\n')
}

export function buildClawRuntimePrompt(
  settings: Pick<AppSettingsV1, 'claw'>,
  prompt: string,
  options: { channel?: ClawImChannelV1 | null } = {}
): string {
  const skills = settings.claw.skills
  const instructions: string[] = []
  if (skills.defaultNames.length > 0) {
    instructions.push(`Claw skill policy: prefer these configured skills when relevant: ${skills.defaultNames.join(', ')}.`)
  }
  if (skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${skills.extraDirs.join(', ')}.`)
  }
  instructions.push(CLAW_SCHEDULE_TOOL_HINT)
  const prefix = skills.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  const channelInstructions = buildClawImAgentInstructions(options.channel)
  if (channelInstructions) instructions.push(channelInstructions)
  if (instructions.length === 0) return prompt
  return `${CLAW_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${CLAW_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function unwrapClawRuntimePromptForDisplay(text: string): string {
  const markerIndex = text.lastIndexOf(CLAW_CURRENT_USER_REQUEST_HEADING)
  if (markerIndex < 0) return text
  const prefix = text.slice(0, markerIndex)
  const looksManaged =
    prefix.includes(CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    prefix.includes(CLAW_IM_AGENT_INSTRUCTIONS_HEADING) ||
    prefix.includes('Claw skill policy:') ||
    prefix.includes('Additional local skill directories configured in the GUI:')
  if (!looksManaged) return text
  return text.slice(markerIndex + CLAW_CURRENT_USER_REQUEST_HEADING.length).trimStart()
}

export function unwrapClawUserPromptForDisplay(text: string): string {
  const unwrapped = unwrapClawRuntimePromptForDisplay(text)
  if (!unwrapped.startsWith(CLAW_FEISHU_INBOUND_MESSAGE_HEADING)) return unwrapped
  const splitIndex = unwrapped.indexOf('\n\n')
  if (splitIndex < 0) return unwrapped
  const message = unwrapped.slice(splitIndex + 2).trim()
  return message || unwrapped
}

export function normalizeDeepseekBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  return trimmed || DEFAULT_DEEPSEEK_BASE_URL
}

function compactStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function normalizeRunMode(value: unknown): ClawRunMode {
  return value === 'plan' ? 'plan' : 'agent'
}

function normalizeImProvider(value: unknown): ClawImProvider {
  void value
  return 'feishu'
}

export function normalizeClawModel(value: unknown): ClawModel {
  return value === 'deepseek-v4-pro' || value === 'deepseek-v4-flash' ? value : 'auto'
}

function normalizeScheduleKind(value: unknown): ClawScheduleKind {
  if (value === 'interval' || value === 'daily' || value === 'at') return value
  return 'manual'
}

function normalizeTimeOfDay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '09:00'
}

function normalizeAtTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

function normalizePathSegment(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '/claw/im'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function normalizeStatus(value: unknown): ClawTaskStatus {
  if (value === 'running' || value === 'success' || value === 'error') return value
  return 'idle'
}

export function defaultClawSettings(): ClawSettingsV1 {
  return {
    enabled: false,
    skills: {
      defaultNames: [],
      extraDirs: [],
      promptPrefix: ''
    },
    im: {
      enabled: false,
      provider: 'feishu',
      port: 8787,
      path: '/claw/im',
      secret: '',
      workspaceRoot: '',
      model: DEFAULT_CLAW_MODEL,
      mode: 'agent',
      responseTimeoutMs: 120_000
    },
    channels: [],
    tasks: []
  }
}

export function normalizeClawSettings(input: ClawSettingsPatchV1 | undefined): ClawSettingsV1 {
  const defaults = defaultClawSettings()
  const source = input ?? {}
  const skills = source.skills ?? defaults.skills
  const im = source.im ?? defaults.im
  const rawChannels = Array.isArray(source.channels)
    ? source.channels.filter((channel) => {
        const raw = channel as Partial<ClawImChannelV1>
        return raw.provider === undefined || raw.provider === null || raw.provider === 'feishu'
      })
    : []
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    skills: {
      defaultNames: compactStrings(skills.defaultNames),
      extraDirs: compactStrings(skills.extraDirs),
      promptPrefix: typeof skills.promptPrefix === 'string' ? skills.promptPrefix : ''
    },
    im: {
      enabled: normalizeBoolean(im.enabled, defaults.im.enabled),
      provider: normalizeImProvider(im.provider),
      port: normalizePositiveInteger(im.port, defaults.im.port, 1024, 65_535),
      path: normalizePathSegment(im.path),
      secret: typeof im.secret === 'string' ? im.secret.trim() : '',
      workspaceRoot: typeof im.workspaceRoot === 'string' ? im.workspaceRoot.trim() : '',
      model: typeof im.model === 'string' && im.model.trim() ? im.model.trim() : DEFAULT_CLAW_MODEL,
      mode: normalizeRunMode(im.mode),
      responseTimeoutMs: normalizePositiveInteger(im.responseTimeoutMs, defaults.im.responseTimeoutMs, 5_000, 600_000)
    },
    channels: rawChannels
      .map((channel, index): ClawImChannelV1 => {
          const raw = channel as Partial<ClawImChannelV1>
          const provider = normalizeImProvider(raw.provider)
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `im-${index + 1}`,
            provider,
            label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : provider,
            enabled: normalizeBoolean(raw.enabled, true),
            model: normalizeClawModel(raw.model),
            threadId: typeof raw.threadId === 'string' ? raw.threadId.trim() : '',
            workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
            agentProfile: normalizeClawImAgentProfile(raw.agentProfile),
            platformCredential: normalizeClawImPlatformCredential(raw.platformCredential),
            remoteSession: normalizeClawImRemoteSession(raw.remoteSession),
            conversations: Array.isArray(raw.conversations)
              ? raw.conversations
                  .map((conversation) => normalizeClawImConversation(conversation))
                  .filter((conversation): conversation is ClawImConversationV1 => conversation != null)
              : [],
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now
          }
        }),
    tasks: Array.isArray(source.tasks)
      ? source.tasks.map((task, index): ClawTaskV1 => {
          const raw = task as Partial<ClawTaskV1>
          const schedule = raw.schedule ?? defaults.tasks[index]?.schedule
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `task-${index + 1}`,
            title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `Task ${index + 1}`,
            enabled: normalizeBoolean(raw.enabled, true),
            prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
            workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
            model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_CLAW_MODEL,
            mode: normalizeRunMode(raw.mode),
            schedule: {
              kind: normalizeScheduleKind(schedule?.kind),
              everyMinutes: normalizePositiveInteger(schedule?.everyMinutes, 60, 1, 10_080),
              timeOfDay: normalizeTimeOfDay(schedule?.timeOfDay),
              atTime: normalizeAtTime(schedule?.atTime)
            },
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
            lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : '',
            nextRunAt: typeof raw.nextRunAt === 'string' ? raw.nextRunAt : '',
            lastStatus: normalizeStatus(raw.lastStatus),
            lastMessage: typeof raw.lastMessage === 'string' ? raw.lastMessage : '',
            lastThreadId: typeof raw.lastThreadId === 'string' ? raw.lastThreadId : ''
          }
        })
      : []
  }
}

export function mergeClawSettings(
  current: ClawSettingsV1,
  patch: ClawSettingsPatchV1 | undefined
): ClawSettingsV1 {
  if (!patch) return normalizeClawSettings(current)
  return normalizeClawSettings({
    ...current,
    ...patch,
    skills: {
      ...current.skills,
      ...(patch.skills ?? {})
    },
    im: {
      ...current.im,
      ...(patch.im ?? {})
    },
    channels: patch.channels ?? current.channels,
    tasks: patch.tasks ?? current.tasks
  })
}

export function defaultWriteSettings(): WriteSettingsV1 {
  return {
    defaultWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    activeWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
    workspaces: [DEFAULT_WRITE_WORKSPACE_ROOT],
    inlineCompletion: {
      enabled: true,
      retrievalEnabled: true,
      longCompletionEnabled: true,
      baseUrl: DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
      model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
      debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
      longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
      longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
      maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
      longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
    }
  }
}

function normalizeWriteInlineCompletionSettings(
  input: Partial<WriteInlineCompletionSettingsV1> | undefined
): WriteInlineCompletionSettingsV1 {
  const defaults = defaultWriteSettings().inlineCompletion
  const debounceMs = Number(input?.debounceMs)
  const longDebounceMs = Number(input?.longDebounceMs)
  const minAcceptScore = Number(input?.minAcceptScore)
  const longMinAcceptScore = Number(input?.longMinAcceptScore)
  const maxTokens = Number(input?.maxTokens)
  const longMaxTokens = Number(input?.longMaxTokens)
  return {
    enabled: input?.enabled !== false,
    retrievalEnabled: input?.retrievalEnabled !== false,
    longCompletionEnabled: input?.longCompletionEnabled !== false,
    baseUrl:
      typeof input?.baseUrl === 'string' && input.baseUrl.trim()
        ? input.baseUrl.trim()
        : defaults.baseUrl,
    model:
      typeof input?.model === 'string' && input.model.trim()
        ? normalizeWriteInlineCompletionModel(input.model)
        : defaults.model,
    debounceMs:
      Number.isFinite(debounceMs)
        ? Math.max(150, Math.min(5_000, Math.round(debounceMs)))
        : defaults.debounceMs,
    longDebounceMs:
      Number.isFinite(longDebounceMs)
        ? Math.max(1_000, Math.min(15_000, Math.round(longDebounceMs)))
        : defaults.longDebounceMs,
    minAcceptScore:
      Number.isFinite(minAcceptScore)
        ? Math.max(0.1, Math.min(0.95, minAcceptScore))
        : defaults.minAcceptScore,
    longMinAcceptScore:
      Number.isFinite(longMinAcceptScore)
        ? Math.max(0.1, Math.min(0.95, longMinAcceptScore))
        : defaults.longMinAcceptScore,
    maxTokens:
      Number.isFinite(maxTokens)
        ? Math.max(16, Math.min(512, Math.round(maxTokens)))
        : defaults.maxTokens,
    longMaxTokens:
      Number.isFinite(longMaxTokens)
        ? Math.max(64, Math.min(1_024, Math.round(longMaxTokens)))
        : defaults.longMaxTokens
  }
}

export function normalizeWriteInlineCompletionModel(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || trimmed === 'auto') return DEFAULT_WRITE_INLINE_COMPLETION_MODEL
  return trimmed
}

export function normalizeWriteSettings(input: WriteSettingsPatchV1 | undefined): WriteSettingsV1 {
  const defaults = defaultWriteSettings()
  const source = input ?? {}
  const defaultWorkspaceRoot =
    typeof source.defaultWorkspaceRoot === 'string' && source.defaultWorkspaceRoot.trim()
      ? source.defaultWorkspaceRoot.trim()
      : defaults.defaultWorkspaceRoot
  const activeWorkspaceRoot =
    typeof source.activeWorkspaceRoot === 'string' && source.activeWorkspaceRoot.trim()
      ? source.activeWorkspaceRoot.trim()
      : defaultWorkspaceRoot
  const workspaces = compactStrings([
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    ...(Array.isArray(source.workspaces) ? source.workspaces : [])
  ])
  return {
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    workspaces: workspaces.length > 0 ? workspaces : [defaultWorkspaceRoot],
    inlineCompletion: normalizeWriteInlineCompletionSettings(source.inlineCompletion)
  }
}

export function mergeWriteSettings(
  current: WriteSettingsV1,
  patch: WriteSettingsPatchV1 | undefined
): WriteSettingsV1 {
  return normalizeWriteSettings({
    ...current,
    ...(patch ?? {}),
    inlineCompletion: {
      ...current.inlineCompletion,
      ...(patch?.inlineCompletion ?? {})
    }
  })
}

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const maybeSettings = settings as AppSettingsV1 & {
    notifications?: Partial<NotificationConfigV1>
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
  }
  return {
    ...settings,
    agentProvider: normalizeAgentProviderId(settings.agentProvider),
    agents: {
      codewhale: {
        ...settings.agents.codewhale,
        baseUrl: normalizeDeepseekBaseUrl(settings.agents.codewhale.baseUrl)
      }
    },
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    write: normalizeWriteSettings(maybeSettings.write),
    claw: normalizeClawSettings(maybeSettings.claw),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    }
  }
}
