import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import { DEFAULT_KUN_MODEL } from '@shared/app-settings'
import type { ChatState, SideConversation, SidePanelState } from './chat-store-types'
import { upsertUserBlock } from './chat-store-runtime-helpers'

type SideContext = {
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  getProvider: () => AgentProvider
  /** i18n reference (kept loose; the host already imports the default). */
  t: (key: string) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
}

type ActiveSideAbort = {
  sideId: string
  abort: AbortController
}

const sideAbortControllers = new Map<string, AbortController>()

function compactTitlePrefix(value: string): string {
  return Array.from(value.trim()).slice(0, 5).join('')
}

function defaultSideTitle(parentTitle: string, parentThreadId: string): string {
  const trimmed = parentTitle.trim()
  if (trimmed) return `${compactTitlePrefix(trimmed)} · side`
  return `${parentThreadId.slice(0, 8)} · side`
}

function defaultSideModel(state: ChatState, parentThreadId: string): string {
  const parent = state.threads.find((thread) => thread.id === parentThreadId)
  if (parent?.model) return parent.model
  if (state.composerModel) return state.composerModel
  return DEFAULT_KUN_MODEL
}

function sideReasoningEffortRequestValue(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low') return 'off'
  if (normalized === 'medium' || normalized === 'high' || normalized === 'max') return normalized
  return undefined
}

function patchSide(
  state: ChatState,
  sideId: string,
  patch: (side: SideConversation) => SideConversation
): Partial<ChatState> {
  const current = state.sideConversations[sideId]
  if (!current) return {}
  return { sideConversations: { ...state.sideConversations, [sideId]: patch(current) } }
}

function setSidePanel(panel: SidePanelState, patch: Partial<SidePanelState>): SidePanelState {
  return { ...panel, ...patch }
}

function flushSideLiveBlocks(side: SideConversation): { side: SideConversation; blocks: ChatBlock[] } {
  let nextBlocks = side.blocks
  let nextLiveReasoning = side.liveReasoning
  let nextLiveAssistant = side.liveAssistant
  if (nextLiveReasoning) {
    const id = `live_reasoning_${side.lastSeq || Date.now()}`
    nextBlocks = [
      ...nextBlocks,
      { kind: 'reasoning', id, createdAt: new Date().toISOString(), text: nextLiveReasoning }
    ]
    nextLiveReasoning = ''
  }
  if (nextLiveAssistant) {
    const id = `live_assistant_${side.lastSeq || Date.now()}`
    nextBlocks = [
      ...nextBlocks,
      { kind: 'assistant', id, createdAt: new Date().toISOString(), text: nextLiveAssistant }
    ]
    nextLiveAssistant = ''
  }
  if (nextBlocks === side.blocks) return { side, blocks: nextBlocks }
  return {
    side: { ...side, blocks: nextBlocks, liveReasoning: nextLiveReasoning, liveAssistant: nextLiveAssistant },
    blocks: nextBlocks
  }
}

function buildSideSink(sideId: string, ctx: SideContext): ThreadEventSink {
  return {
    onSeq: (seq) => {
      ctx.set((s) => patchSide(s, sideId, (side) => ({ ...side, lastSeq: Math.max(side.lastSeq, seq) })))
    },
    onUserMessage: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const blocks = upsertUserBlock(flushed.blocks, ev)
          return {
            ...flushed.side,
            blocks,
            busy: true,
            turnId: ev.turnId ?? side.turnId,
            userItemId: ev.itemId
          }
        })
      )
    },
    onDeltas: (deltas) => {
      if (deltas.length === 0) return
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const seqs = deltas
            .map((delta) => delta.seq)
            .filter((value): value is number => typeof value === 'number')
          const lastSeq = seqs.length > 0 ? Math.max(side.lastSeq, ...seqs) : side.lastSeq
          let liveReasoning = side.liveReasoning
          let liveAssistant = side.liveAssistant
          for (const delta of deltas) {
            if (delta.kind === 'agent_reasoning') liveReasoning += delta.text
            else liveAssistant += delta.text
          }
          return {
            ...side,
            lastSeq,
            liveReasoning,
            liveAssistant,
            busy: true
          }
        })
      )
    },
    onTool: (ev: ToolEventPayload) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const idx = flushed.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
          let blocks: ChatBlock[]
          if (idx >= 0) {
            const cur = flushed.blocks[idx]
            if (cur.kind !== 'tool') return flushed.side
            const next: ToolBlock = {
              ...cur,
              summary: ev.summary || cur.summary,
              status: ev.status,
              toolKind: ev.toolKind ?? cur.toolKind,
              detail: ev.detail ?? cur.detail,
              filePath: ev.filePath ?? cur.filePath,
              meta: ev.meta ?? cur.meta
            }
            blocks = [...flushed.blocks]
            blocks[idx] = next
          } else {
            const block: ToolBlock = {
              kind: 'tool',
              id: ev.itemId,
              createdAt: new Date().toISOString(),
              summary: ev.summary,
              status: ev.status,
              toolKind: ev.toolKind,
              detail: ev.detail,
              filePath: ev.filePath,
              meta: ev.meta
            }
            blocks = [...flushed.blocks, block]
          }
          return { ...flushed.side, blocks, busy: true }
        })
      )
    },
    onCompaction: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const block: CompactionBlock = {
            kind: 'compaction',
            id: ev.itemId,
            createdAt: ev.createdAt ?? new Date().toISOString(),
            summary: ev.summary,
            status: ev.status,
            detail: ev.detail,
            auto: ev.auto
          }
          return { ...flushed.side, blocks: [...flushed.blocks, block] }
        })
      )
    },
    onApproval: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: [
            ...side.blocks,
            {
              kind: 'approval',
              id: `appr_${Date.now()}`,
              createdAt: new Date().toISOString(),
              approvalId: req.approvalId,
              summary: req.summary,
              toolName: req.toolName,
              status: 'pending',
              ...(req.meta ? { meta: req.meta } : {})
            }
          ]
        }))
      )
    },
    onUserInput: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: [
            ...side.blocks,
            {
              kind: 'user_input',
              id: `ui_${Date.now()}`,
              createdAt: new Date().toISOString(),
              requestId: req.requestId,
              questions: req.questions,
              status: 'pending'
            }
          ]
        }))
      )
    },
    onUserInputStatus: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: side.blocks.map((block) =>
            block.kind === 'user_input' && block.requestId === ev.itemId
              ? { ...block, status: ev.status }
              : block
          )
        }))
      )
    },
    onGoal: () => {
      // Side conversations do not render goal chips yet.
    },
    onTodos: () => {
      // Side conversations do not render runtime todo chips yet.
    },
    onTurnComplete: () => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          return { ...flushed.side, busy: false, turnId: null }
        })
      )
    },
    onError: (err) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          busy: false,
          error: ctx.formatRuntimeError(err)
        }))
      )
    },
    onUsage: (usage) => {
      // Side usage is reported only to keep lastSeq cursors consistent;
      // a per-thread usage counter can be wired here in the future.
      void usage
    }
  }
}

function teardownSideSubscription(sideId: string): void {
  const ac = sideAbortControllers.get(sideId)
  if (ac) {
    ac.abort()
    sideAbortControllers.delete(sideId)
  }
}

function startSideSubscription(sideId: string, sinceSeq: number, ctx: SideContext): void {
  teardownSideSubscription(sideId)
  const ac = new AbortController()
  sideAbortControllers.set(sideId, ac)
  const sink = buildSideSink(sideId, ctx)
  const provider = ctx.getProvider()
  void provider.subscribeThreadEvents(sideId, sinceSeq, sink, ac.signal)
}

export function createSideActions(ctx: SideContext): Pick<
  ChatState,
  | 'spawnSideConversation'
  | 'openSideConversationDraft'
  | 'sendSideMessage'
  | 'interruptSide'
  | 'setSideInput'
  | 'setSideModel'
  | 'setSideReasoningEffort'
  | 'selectSideConversation'
  | 'setSidePanelOpen'
  | 'closeSideConversation'
  | 'discardSideConversation'
  | 'promoteSideConversation'
> {
  const actions: Pick<
    ChatState,
    | 'spawnSideConversation'
    | 'openSideConversationDraft'
    | 'sendSideMessage'
    | 'interruptSide'
    | 'setSideInput'
    | 'setSideModel'
    | 'setSideReasoningEffort'
    | 'selectSideConversation'
    | 'setSidePanelOpen'
    | 'closeSideConversation'
    | 'discardSideConversation'
    | 'promoteSideConversation'
  > = {
    spawnSideConversation: async (seedText) => {
      const state = ctx.get()
      const parentId = state.activeThreadId
      if (!parentId) {
        ctx.set({ error: ctx.t('common:sideConversationNeedsActiveThread') })
        return null
      }
      if (state.runtimeConnection !== 'ready') {
        ctx.set({ error: ctx.t('common:runtimeActionNeedsConnection') })
        return null
      }
      const provider = ctx.getProvider()
      if (typeof provider.forkThread !== 'function') {
        ctx.set({ error: ctx.t('common:runtimeFeatureUnsupported') })
        return null
      }
      const parentThread = state.threads.find((thread) => thread.id === parentId)
      const title = defaultSideTitle(parentThread?.title ?? '', parentId)
      let forked
      try {
        forked = await provider.forkThread(parentId, { relation: 'side', title })
      } catch (e) {
        ctx.set({
          error: ctx.formatRuntimeError(e),
          ...(ctx.shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return null
      }
      const now = new Date().toISOString()
      const inheritedAt = new Date().toISOString()
      const side: SideConversation = {
        threadId: forked.id,
        parentThreadId: parentId,
        title: forked.title ?? title,
        createdAt: now,
        inheritedAt,
        blocks: [],
        liveReasoning: '',
        liveAssistant: '',
        lastSeq: 0,
        input: '',
        model: defaultSideModel(state, parentId),
        reasoningEffort: 'max',
        busy: false,
        turnId: null,
        userItemId: null,
        error: null
      }
      ctx.set((s) => ({
        sideConversations: { ...s.sideConversations, [forked.id]: side },
        sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: forked.id })
      }))
      // Start a dedicated SSE subscription for this side thread. The
      // main `activeThreadId` and main subscription are untouched.
      startSideSubscription(forked.id, 0, ctx)
      if (seedText && seedText.trim()) {
        // Call the side action directly through the closure we are
        // currently building so store-level `state.sendSideMessage`
        // shims (e.g. test harnesses) cannot swallow the seed send.
        const started = await actions.sendSideMessage(forked.id, seedText.trim())
        if (!started) return forked.id
      }
      return forked.id
    },

    openSideConversationDraft: () => {
      ctx.set((s) => ({
        sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: null })
      }))
    },

    sendSideMessage: async (sideId, text) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return false
      if (side.busy) return false
      const trimmed = text.trim()
      if (!trimmed) return false
      const provider = ctx.getProvider()
      const reasoningEffort = sideReasoningEffortRequestValue(side.reasoningEffort)
      try {
        const { turnId } = await provider.sendUserMessage(sideId, trimmed, {
          model: side.model,
          ...(reasoningEffort ? { reasoningEffort } : {})
        })
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            input: '',
            busy: true,
            turnId,
            error: null
          }))
        )
        // Re-attach the subscription from the last seen seq so we don't
        // miss items emitted between the previous reconnect and the new
        // turn creation.
        startSideSubscription(sideId, side.lastSeq, ctx)
        return true
      } catch (e) {
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
        return false
      }
    },

    interruptSide: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side || !side.turnId) return
      const provider = ctx.getProvider()
      try {
        await provider.interruptTurn(sideId, side.turnId)
        ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, busy: false })))
      } catch (e) {
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
      }
    },

    setSideInput: (sideId, text) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, input: text })))
    },

    setSideModel: (sideId, model) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, model })))
    },

    setSideReasoningEffort: (sideId, effort) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, reasoningEffort: effort })))
    },

    selectSideConversation: (sideId) => {
      ctx.set((s) => {
        if (!s.sideConversations[sideId]) return {}
        return { sidePanel: setSidePanel(s.sidePanel, { activeSideId: sideId, open: true }) }
      })
    },

    setSidePanelOpen: (open) => {
      ctx.set((s) => ({ sidePanel: setSidePanel(s.sidePanel, { open }) }))
    },

    closeSideConversation: async (sideId) => {
      const state = ctx.get()
      const closingSide = state.sideConversations[sideId] ?? null
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && closingSide
            ? Object.values(next).find((side) => side.parentThreadId === closingSide.parentThreadId)?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        return { sideConversations: next, sidePanel: nextPanel }
      })
    },

    discardSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && side
            ? Object.values(next).find((candidate) => candidate.parentThreadId === side.parentThreadId)?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        return { sideConversations: next, sidePanel: nextPanel }
      })
      if (side) {
        const provider = ctx.getProvider()
        try {
          await provider.deleteThread(sideId)
        } catch (e) {
          ctx.set({
            error: ctx.formatRuntimeError(e),
            ...(ctx.shouldOpenSettingsForError(e)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
        }
      }
    },

    promoteSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return
      // Use the provider's renameThread surface to clear the relation by
      // PATCHing the thread. The HTTP client encodes relation='primary'
      // as a generic runtimeRequest body — we use a direct request here
      // because the rename surface is title-only.
      try {
        const response = await window.dsGui.runtimeRequest(
          `/v1/threads/${encodeURIComponent(sideId)}`,
          'PATCH',
          JSON.stringify({ relation: 'primary' })
        )
        if (!response.ok) {
          ctx.set({ error: ctx.formatRuntimeError(new Error(response.body || 'promote failed')) })
          return
        }
      } catch (e) {
        ctx.set({ error: ctx.formatRuntimeError(e) })
        return
      }
      await ctx.get().refreshThreads()
      // Closing is a structural teardown; call directly so a stubbed
      // `state.closeSideConversation` (e.g. in tests) cannot swallow it.
      await actions.closeSideConversation(sideId)
    }
  }
  return actions
}

/**
 * Internal helper: tear down all side subscriptions. Used by the
 * `boot`/`unmount` path to avoid dangling SSE streams on app shutdown.
 */
export function teardownAllSideSubscriptions(): void {
  for (const ac of sideAbortControllers.values()) ac.abort()
  sideAbortControllers.clear()
}
