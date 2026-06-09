import {
  CLAW_MANAGED_INSTRUCTIONS_HEADING,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider,
  type ClawImSettingsV1,
  type ClawModel
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import { clawThreadTitleLooksManaged, clawThreadIdsFromChannels } from './chat-store-helpers'

type ClawAgentProviderLike = {
  createThread: (input: { workspace: string; title: string; mode: 'agent' | 'plan' }) => Promise<NormalizedThread>
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
  deleteThread: (threadId: string) => Promise<void>
}

type CreateClawActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: { t: (key: string, options?: Record<string, unknown>) => string }
  getProvider: () => ClawAgentProviderLike
  newClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1
  ) => ClawImChannelV1
  normalizeClawComposerModel: (raw: string) => string
  activeClawChannel: (state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>) => ClawImChannelV1 | null
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
  clearedThreadSelection: () => Pick<
    ChatState,
    | 'activeThreadId'
    | 'blocks'
    | 'liveReasoning'
    | 'liveAssistant'
    | 'busy'
    | 'lastSeq'
    | 'currentTurnId'
    | 'currentTurnUserId'
    | 'inspectorSelectedId'
  >
  sseAbortRef: { current: AbortController | null }
  clearBusyWatchdog: () => void
}

function clawThreadPlaceholder(
  channel: ClawImChannelV1,
  threadId: string,
  workspaceRoot: string
): NormalizedThread {
  return {
    id: threadId,
    title: `[Claw:${channel.label}]`,
    updatedAt: channel.updatedAt,
    model: channel.model,
    mode: 'agent',
    workspace: workspaceRoot
  }
}

export function clawThreadIdForProvider(
  channel: ClawImChannelV1,
  conversation?: ClawImChannelV1['conversations'][number] | null
): string {
  if (conversation) {
    const mapped = conversation.localThreadId.trim()
    if (mapped) return mapped
  }
  const mapped = channel.threadId.trim()
  if (mapped) return mapped
  return ''
}

function clawChannelTitle(channel: ClawImChannelV1): string {
  return `[Claw:${channel.label}]`
}

function clawImChannelTitle(channel: ClawImChannelV1): string {
  return `[Claw IM:${channel.label}]`
}

function titleMatchesClawChannel(thread: Pick<NormalizedThread, 'title'>, channel: ClawImChannelV1): boolean {
  const title = thread.title.trim()
  return title.startsWith(clawChannelTitle(channel)) || title.startsWith(clawImChannelTitle(channel))
}

function updatedAtMs(thread: Pick<NormalizedThread, 'updatedAt'>): number {
  const value = Date.parse(thread.updatedAt)
  return Number.isFinite(value) ? value : 0
}

export function findRecoverableClawThread(
  threads: NormalizedThread[],
  channels: ClawImChannelV1[],
  channel: ClawImChannelV1
): NormalizedThread | null {
  const knownThreadIds = clawThreadIdsFromChannels(channels)
  const candidates = threads
    .filter((thread) => thread.archived !== true)
    .filter((thread) => !knownThreadIds.has(thread.id))
    .filter((thread) => clawThreadTitleLooksManaged(thread.title))
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
  return (
    candidates.find((thread) => thread.title.trim().startsWith(CLAW_MANAGED_INSTRUCTIONS_HEADING)) ??
    candidates.find((thread) => titleMatchesClawChannel(thread, channel)) ??
    null
  )
}

export function resolveClawThreadId(input: {
  configuredThreadId: string
  recoveredThreadId?: string | null
  configuredThreadExists: boolean
  configuredThreadHasUserMessages: boolean
}): string {
  const configured = input.configuredThreadId.trim()
  const recovered = input.recoveredThreadId?.trim() ?? ''
  if (!configured) return recovered
  if (!input.configuredThreadExists) return recovered
  if (recovered && !input.configuredThreadHasUserMessages) return recovered
  return configured
}

async function threadExists(provider: ClawAgentProviderLike, threadId: string): Promise<boolean> {
  try {
    await provider.getThreadDetail(threadId)
    return true
  } catch {
    return false
  }
}

async function threadHasUserMessages(provider: ClawAgentProviderLike, threadId: string): Promise<boolean> {
  try {
    const detail = await provider.getThreadDetail(threadId)
    return detail.blocks.some((block) => block.kind === 'user')
  } catch {
    return true
  }
}

export function channelWithClawThreadMapping(
  channel: ClawImChannelV1,
  threadId: string,
  now: string,
  conversationId?: string
): ClawImChannelV1 {
  const next: ClawImChannelV1 = {
    ...channel,
    threadId,
    updatedAt: now
  }
  if (!conversationId) return next
  return {
    ...next,
    conversations: channel.conversations.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, localThreadId: threadId, updatedAt: now }
        : conversation
    )
  }
}

export function createClawActions(options: CreateClawActionsOptions): Pick<
  ChatState,
  | 'appendLocalClawTurn'
  | 'refreshClawChannels'
  | 'addClawChannel'
  | 'selectClawChannel'
  | 'selectClawConversation'
  | 'deleteClawChannel'
  | 'resetClawChannelSession'
  | 'setClawChannelModel'
> {
  const {
    set,
    get,
    i18n,
    getProvider,
    newClawChannel,
    normalizeClawComposerModel,
    activeClawChannel,
    normalizeWorkspaceRoot,
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  } = options

  return {
    appendLocalClawTurn: (userText, replyText) =>
      set((state) => {
        const now = Date.now()
        return {
          blocks: [
            ...state.blocks,
            {
              kind: 'user',
              id: `local-user-${now}`,
              createdAt: new Date(now).toISOString(),
              text: userText
            },
            {
              kind: 'assistant',
              id: `local-assistant-${now}`,
              createdAt: new Date(now + 1).toISOString(),
              text: replyText
            }
          ],
          liveReasoning: '',
          liveAssistant: '',
          error: null
        }
      }),

    refreshClawChannels: async () => {
      if (typeof window.dsGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.claw.channels
      const current = get().activeClawChannelId
      const activeId = current && channels.some((channel) => channel.id === current && channel.enabled)
        ? current
        : channels.find((channel) => channel.enabled)?.id ?? ''
      set({ clawChannels: channels, activeClawChannelId: activeId })
      if (get().route === 'claw' && !activeId) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
        set({ ...clearedThreadSelection(), route: 'claw', clawChannels: channels, activeClawChannelId: '' })
        return
      }
      if (get().route === 'claw' && activeId) {
        void get().selectClawChannel(activeId)
      }
    },

    addClawChannel: async (provider, agentProfile, platformCredential, optionsArg) => {
      if (typeof window.dsGui === 'undefined') return
      const preserveRoute = optionsArg?.preserveRoute === true
      const settings = await rendererRuntimeClient.getSettings()
      const targetChannelId = optionsArg?.channelId?.trim() ?? ''
      const existing = targetChannelId
        ? settings.claw.channels.find((channel) => channel.id === targetChannelId)
        : null
      if (existing) {
        const now = new Date().toISOString()
        const profileName = agentProfile?.name?.trim() ?? ''
        const updatedChannel: ClawImChannelV1 = {
          ...existing,
          label: profileName || existing.label,
          model: optionsArg?.model ?? existing.model,
          workspaceRoot: optionsArg?.workspaceRoot?.trim() ?? existing.workspaceRoot,
          enabled: optionsArg?.enabled ?? existing.enabled,
          agentProfile: {
            name: profileName,
            description: agentProfile?.description?.trim() ?? '',
            identity: agentProfile?.identity ?? '',
            personality: agentProfile?.personality ?? '',
            userContext: agentProfile?.userContext ?? '',
            replyRules: agentProfile?.replyRules ?? ''
          },
          platformCredential: platformCredential ?? existing.platformCredential,
          updatedAt: now
        }
        const channels = settings.claw.channels.map((channel) =>
          channel.id === existing.id ? updatedChannel : channel
        )
        const saved = await rendererRuntimeClient.setSettings({
          claw: {
            enabled: true,
            im: {
              enabled: true,
              provider,
              ...(optionsArg?.im ?? {})
            },
            channels
          }
        })
        set({
          clawChannels: saved.claw.channels,
          activeClawChannelId: existing.id,
          ...(preserveRoute ? {} : { route: 'claw' as const })
        })
        if (!preserveRoute) await get().selectClawChannel(existing.id)
        return
      }
      const duplicateProvider = settings.claw.channels.find((channel) => channel.provider === provider)
      if (duplicateProvider) {
        const providerLabel = provider === 'weixin' ? 'WeChat' : 'Feishu / Lark'
        throw new Error(i18n.t('common:connectPhoneProviderAlreadyConnected', { provider: providerLabel }))
      }

      const channel = newClawChannel(provider, agentProfile, platformCredential)
      const nextChannel: ClawImChannelV1 = {
        ...channel,
        model: optionsArg?.model ?? channel.model,
        workspaceRoot: optionsArg?.workspaceRoot?.trim() ?? channel.workspaceRoot,
        enabled: optionsArg?.enabled ?? channel.enabled
      }
      const channels = [...settings.claw.channels, nextChannel]
      const saved = await rendererRuntimeClient.setSettings({
        claw: {
          enabled: true,
          im: {
            enabled: true,
            provider,
            ...(optionsArg?.im ?? {})
          },
          channels
        }
      })
      set({
        clawChannels: saved.claw.channels,
        activeClawChannelId: nextChannel.id,
        ...(preserveRoute ? {} : { route: 'claw' as const })
      })
      if (!preserveRoute) await get().selectClawChannel(nextChannel.id)
    },

    selectClawChannel: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeClawChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.claw.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ clawChannels: channels, activeClawChannelId: '' })
        return
      }
      set({ route: 'claw', clawChannels: channels, activeClawChannelId: channel.id, composerModel: channel.model })
      const provider = getProvider()
      const latestConversation =
        [...channel.conversations]
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
      const desiredWorkspaceRoot = normalizeWorkspaceRoot(
        latestConversation?.workspaceRoot
        || channel.workspaceRoot
        || settings.claw.im.workspaceRoot
        || settings.workspaceRoot
      )
      let threadId = clawThreadIdForProvider(channel, latestConversation)
      const recoveredThread = findRecoverableClawThread(get().threads, channels, channel)
      const configuredThreadExists = threadId ? await threadExists(provider, threadId) : false
      const configuredThreadHasUserMessages =
        threadId && configuredThreadExists ? await threadHasUserMessages(provider, threadId) : false
      const configuredThreadId = threadId
      threadId = resolveClawThreadId({
        configuredThreadId,
        recoveredThreadId: recoveredThread?.id ?? '',
        configuredThreadExists,
        configuredThreadHasUserMessages
      })
      let createdThread: NormalizedThread | null = null
      if (!threadId) {
        if (!latestConversation) {
          if (configuredThreadId) {
            const now = new Date().toISOString()
            const nextChannels = channels.map((item) =>
              item.id === channel.id ? { ...item, threadId: '', updatedAt: now } : item
            )
            const saved = await rendererRuntimeClient.setSettings({ claw: { channels: nextChannels } })
            set({ clawChannels: saved.claw.channels })
          }
          sseAbortRef.current?.abort()
          sseAbortRef.current = null
          clearBusyWatchdog()
          set({
            ...clearedThreadSelection(),
            route: 'claw',
            activeClawChannelId: channel.id,
            composerModel: channel.model,
            error: null
          })
          return
        }
        try {
          const thread = await provider.createThread({
            workspace: desiredWorkspaceRoot,
            title: clawChannelTitle(channel),
            mode: 'agent'
          })
          threadId = thread.id
          createdThread = thread
        } catch (error) {
          set({
            error: formatRuntimeError(error),
            ...(shouldOpenSettingsForError(error)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return
        }
      }
      if (
        !channel.threadId.trim() ||
        (latestConversation && !latestConversation.localThreadId.trim()) ||
        threadId !== configuredThreadId
      ) {
        const now = new Date().toISOString()
        const nextChannels = channels.map((item) =>
          item.id === channel.id
            ? channelWithClawThreadMapping(item, threadId, now, latestConversation?.id)
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ claw: { channels: nextChannels } })
        set({ clawChannels: saved.claw.channels })
      }
      const placeholder = clawThreadPlaceholder(channel, threadId, desiredWorkspaceRoot)
      set((state) => ({
        threads: state.threads.some((thread) => thread.id === threadId)
          ? state.threads
          : [createdThread ?? recoveredThread ?? placeholder, ...state.threads]
      }))
      await get().selectThread(threadId)
      set({ route: 'claw', activeClawChannelId: channel.id })
    },

    selectClawConversation: async (channelId, threadId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeClawChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channels = settings.claw.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ clawChannels: channels, activeClawChannelId: '' })
        return
      }
      const requestedThreadId = threadId.trim()
      const conversation = channel.conversations.find((item) =>
        item.localThreadId.trim() === requestedThreadId
      )
      if (!conversation) {
        await get().selectClawChannel(channelId)
        return
      }
      set({
        route: 'claw',
        clawChannels: channels,
        activeClawChannelId: channel.id,
        composerModel: channel.model
      })
      const provider = getProvider()
      const workspaceRoot = normalizeWorkspaceRoot(
        conversation.workspaceRoot ||
        channel.workspaceRoot ||
        settings.claw.im.workspaceRoot ||
        settings.workspaceRoot
      )
      let targetThreadId = clawThreadIdForProvider(channel, conversation)
      const configuredThreadId = targetThreadId
      const configuredThreadExists = targetThreadId ? await threadExists(provider, targetThreadId) : false
      if (!configuredThreadExists) {
        targetThreadId = ''
      }
      if (!targetThreadId) {
        try {
          const thread = await provider.createThread({
            workspace: workspaceRoot,
            title: clawChannelTitle(channel),
            mode: 'agent'
          })
          targetThreadId = thread.id
          set((state) => ({
            threads: state.threads.some((item) => item.id === thread.id)
              ? state.threads
              : [thread, ...state.threads]
          }))
        } catch (error) {
          set({
            error: formatRuntimeError(error),
            ...(shouldOpenSettingsForError(error)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return
        }
      }
      const placeholder = clawThreadPlaceholder(channel, targetThreadId, workspaceRoot)
      set((state) => ({
        threads: state.threads.some((thread) => thread.id === targetThreadId)
          ? state.threads
          : [placeholder, ...state.threads]
      }))
      if (!conversation.localThreadId.trim() || targetThreadId !== configuredThreadId) {
        const now = new Date().toISOString()
        const nextChannels = channels.map((item) =>
          item.id === channel.id
            ? channelWithClawThreadMapping(item, targetThreadId, now, conversation.id)
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ claw: { channels: nextChannels } })
        set({ clawChannels: saved.claw.channels })
      }
      await get().selectThread(targetThreadId)
      set({ route: 'claw', activeClawChannelId: channel.id })
    },

    deleteClawChannel: async (channelId) => {
      if (typeof window.dsGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channel = settings.claw.channels.find((item) => item.id === channelId)
      const channels = settings.claw.channels.filter((item) => item.id !== channelId)
      const saved = await rendererRuntimeClient.setSettings({ claw: { channels } })
      const nextChannel = saved.claw.channels.find((item) => item.enabled) ?? null
      set({
        clawChannels: saved.claw.channels,
        activeClawChannelId: nextChannel?.id ?? ''
      })
      if (channel && get().runtimeConnection === 'ready') {
        const threadId = clawThreadIdForProvider(channel)
        if (threadId) {
          const provider = getProvider()
          await provider.deleteThread(threadId).catch(() => undefined)
        }
      }
      if (nextChannel) {
        await get().selectClawChannel(nextChannel.id)
      } else {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
        set({ ...clearedThreadSelection(), route: 'claw' })
      }
    },

    resetClawChannelSession: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings()
      const channel = settings.claw.channels.find((item) => item.id === channelId)
      if (!channel) return
      const provider = getProvider()
      const oldThreadId = clawThreadIdForProvider(channel)
      try {
        const thread = await provider.createThread({
          workspace: normalizeWorkspaceRoot(
            channel.workspaceRoot || settings.claw.im.workspaceRoot || settings.workspaceRoot
          ),
          title: clawChannelTitle(channel),
          mode: 'agent'
        })
        const now = new Date().toISOString()
        const channels = settings.claw.channels.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                threadId: thread.id,
                conversations: item.conversations.map((conversation) => ({
                  ...conversation,
                  localThreadId: thread.id,
                  updatedAt: now
                })),
                updatedAt: now
              }
            : item
        )
        const saved = await rendererRuntimeClient.setSettings({ claw: { channels } })
        set((state) => ({
          route: 'claw',
          activeClawChannelId: channel.id,
          clawChannels: saved.claw.channels,
          threads: state.threads.some((item) => item.id === thread.id)
            ? state.threads
            : [thread, ...state.threads]
        }))
        await get().selectThread(thread.id)
        if (oldThreadId && oldThreadId !== thread.id) {
          await provider.deleteThread(oldThreadId).catch(() => undefined)
          await get().refreshThreads()
        }
        set({ error: i18n.t('common:clawSessionCleared') })
      } catch (error) {
        set({
          error: formatRuntimeError(error),
          ...(shouldOpenSettingsForError(error)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    },

    setClawChannelModel: async (channelId, model) => {
      if (typeof window.dsGui === 'undefined') return
      const normalized = normalizeClawComposerModel(model)
      const settings = await rendererRuntimeClient.getSettings()
      const now = new Date().toISOString()
      const channels = settings.claw.channels.map((channel) =>
        channel.id === channelId ? { ...channel, model: normalized, updatedAt: now } : channel
      )
      const saved = await rendererRuntimeClient.setSettings({ claw: { channels } })
      set({
        clawChannels: saved.claw.channels,
        composerModel: normalized,
        error: i18n.t('common:clawModelChanged', { model: normalized })
      })
    }
  }
}
