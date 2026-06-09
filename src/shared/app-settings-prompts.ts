import {
  type AppSettingsV1,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImConversationV1,
  type ClawImPlatformCredentialV1,
  type ClawImRemoteSessionV1
} from './app-settings-types'

export const CLAW_CURRENT_USER_REQUEST_HEADING = '[Current user request]'
export const CLAW_MANAGED_INSTRUCTIONS_HEADING = '[Claw managed instructions]'
export const CLAW_IM_AGENT_INSTRUCTIONS_HEADING = '[Claw IM agent instructions]'
export const CLAW_FEISHU_INBOUND_MESSAGE_HEADING = '[Feishu / Lark inbound message]'
export const SCHEDULE_CURRENT_USER_REQUEST_HEADING = '[Current scheduled task]'
export const SCHEDULE_MANAGED_INSTRUCTIONS_HEADING = '[Schedule managed instructions]'

export type ClawUserPromptDisplay = {
  text: string
  managed: boolean
  inbound: boolean
  sourceLabel?: string
  sender?: string
  chatType?: string
  messageType?: string
  mentions?: string
}

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
  if (raw.kind === 'weixin') {
    const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim() : ''
    if (!accountId) return undefined
    return {
      kind: raw.kind,
      accountId,
      sessionKey: typeof raw.sessionKey === 'string' ? raw.sessionKey.trim() : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
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

/**
 * Read the Kun thread id from a legacy `agentThreadIds` record.
 * Returns the empty string when no candidate is present.
 */
export function readLegacyAgentThreadId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const raw = input as Record<string, unknown>
  const candidates = [
    typeof raw.kun === 'string' ? raw.kun.trim() : '',
    typeof raw.codewhale === 'string' ? raw.codewhale.trim() : '',
    typeof raw.reasonix === 'string' ? raw.reasonix.trim() : ''
  ]
  return candidates.find((value) => value) ?? ''
}

export function normalizeClawImConversation(input: unknown): ClawImConversationV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const latestMessageId = typeof raw.latestMessageId === 'string' ? raw.latestMessageId.trim() : ''
  const directLocalThreadId = typeof raw.localThreadId === 'string' ? raw.localThreadId.trim() : ''
  const legacyAgentThreadId = readLegacyAgentThreadId(raw.agentThreadIds)
  const localThreadId = directLocalThreadId || legacyAgentThreadId
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
  const prefix = skills.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  const channelInstructions = buildClawImAgentInstructions(options.channel)
  if (channelInstructions) instructions.push(channelInstructions)
  if (instructions.length === 0) return prompt
  return `${CLAW_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${CLAW_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function buildScheduleRuntimePrompt(
  settings: Pick<AppSettingsV1, 'schedule'>,
  prompt: string
): string {
  const schedule = settings.schedule
  const instructions: string[] = []
  if (schedule.skills.defaultNames.length > 0) {
    instructions.push(`Schedule skill policy: prefer these configured skills when relevant: ${schedule.skills.defaultNames.join(', ')}.`)
  }
  if (schedule.skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${schedule.skills.extraDirs.join(', ')}.`)
  }
  const prefix = schedule.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  if (instructions.length === 0) return prompt
  return `${SCHEDULE_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${SCHEDULE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
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
  return parseClawUserPromptForDisplay(text).text
}

export function parseClawUserPromptForDisplay(text: string): ClawUserPromptDisplay {
  const unwrapped = unwrapClawRuntimePromptForDisplay(text)
  const managed = unwrapped !== text
  if (!unwrapped.startsWith(CLAW_FEISHU_INBOUND_MESSAGE_HEADING)) {
    return unwrapped
      ? { text: unwrapped, managed, inbound: false }
      : { text, managed: false, inbound: false }
  }
  const splitIndex = unwrapped.indexOf('\n\n')
  if (splitIndex < 0) {
    return {
      text: unwrapped,
      managed,
      inbound: true,
      sourceLabel: 'Feishu / Lark'
    }
  }
  const metadata = parseClawInboundMetadata(unwrapped.slice(0, splitIndex))
  const message = unwrapped.slice(splitIndex + 2).trim()
  return {
    text: message || unwrapped,
    managed,
    inbound: true,
    sourceLabel: 'Feishu / Lark',
    ...metadata
  }
}

function parseClawInboundMetadata(header: string): Partial<ClawUserPromptDisplay> {
  const out: Partial<ClawUserPromptDisplay> = {}
  for (const line of header.split('\n').slice(1)) {
    const index = line.indexOf(':')
    if (index < 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    if (key === 'sender') out.sender = value
    if (key === 'chat type') out.chatType = value
    if (key === 'message type') out.messageType = value
    if (key === 'mentions') out.mentions = value
  }
  return out
}
