import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { buildReadOnlyBuiltinLocalTools } from '../adapters/tool/builtin-tools.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import type { ReviewTarget } from '../contracts/review.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import type { ContextCompactionConfig, ModelConfig } from '../loop/model-context-profile.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { TurnService } from './turn-service.js'
import { UsageService } from './usage-service.js'
import { resolveReviewTargetPrompt } from '../review/git-review-target.js'
import { parseReviewOutput, renderReviewOutput } from '../review/review-output.js'
import { KUN_REVIEW_PROMPT } from '../review/review-prompt.js'

export type ReviewServiceDeps = {
  threadStore: ThreadStore
  turns: TurnService
  model: ModelClient
  defaultModel: string
  nowIso: () => string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
}

export class ReviewService {
  private readonly deps: ReviewServiceDeps

  constructor(deps: ReviewServiceDeps) {
    this.deps = deps
  }

  async runReview(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
  }): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.deps.turns.getAbortController(input.turnId)
    if (!signal) {
      await this.failReview(input, 'no abort controller for review turn')
      return 'failed'
    }
    if (signal.aborted) {
      await this.abortReview(input)
      return 'aborted'
    }
    try {
      const thread = await this.deps.threadStore.get(input.threadId)
      if (!thread) throw new Error(`thread not found: ${input.threadId}`)
      const resolved = await resolveReviewTargetPrompt({
        target: input.target,
        workspace: thread.workspace ?? ''
      })
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const rawReviewText = await this.runIsolatedReviewer({
        prompt: resolved.prompt,
        workspace: thread.workspace ?? '',
        model: input.model?.trim() || thread.model || this.deps.defaultModel,
        signal
      })
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const output = parseReviewOutput(rawReviewText)
      const reviewText = renderReviewOutput(output)
      await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
        status: 'completed',
        title: resolved.title,
        output,
        reviewText,
        finishedAt: this.deps.nowIso()
      } as Partial<TurnItem>)
      await this.deps.turns.finishTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        status: 'completed'
      })
      return 'completed'
    } catch (error) {
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.failReview(input, message)
      return 'failed'
    }
  }

  private async runIsolatedReviewer(input: {
    prompt: string
    workspace: string
    model: string
    signal: AbortSignal
  }): Promise<string> {
    const nowIso = this.deps.nowIso
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: this.deps.contextCompaction,
      models: this.deps.models
    })
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: this.deps.model,
      toolHost: new LocalToolHost({
        tools: buildReadOnlyBuiltinLocalTools(),
        readTracker: true
      }),
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: createImmutablePrefix({
        systemPrompt: KUN_REVIEW_PROMPT,
        pinnedConstraints: ['system: review mode is read-only and must output strict JSON']
      }),
      ids,
      nowIso,
      modelCapabilities: (model) =>
        this.deps.modelCapabilities?.(model) ?? modelCapabilitiesForModel(model),
      ...(this.deps.contextCompaction ? { contextCompaction: this.deps.contextCompaction } : {}),
      ...(this.deps.tokenEconomy ? { tokenEconomy: this.deps.tokenEconomy } : {}),
      ...(this.deps.runtime?.toolStorm ? { toolStorm: this.deps.runtime.toolStorm } : {}),
      ...(this.deps.runtime?.toolArgumentRepair ? { toolArgumentRepair: this.deps.runtime.toolArgumentRepair } : {})
    })

    const childThread = await threads.create({
      title: 'Review',
      workspace: input.workspace || '~',
      model: input.model,
      mode: 'agent',
      approvalPolicy: 'auto'
    })
    const started = await turns.startTurn({
      threadId: childThread.id,
      request: {
        prompt: input.prompt,
        model: input.model,
        mode: 'agent'
      }
    })
    const abortChild = (): void => {
      void turns.interruptTurn({
        threadId: childThread.id,
        turnId: started.turnId
      }).catch(() => undefined)
    }
    if (input.signal.aborted) abortChild()
    else input.signal.addEventListener('abort', abortChild, { once: true })
    try {
      const status = await loop.runTurn(childThread.id, started.turnId)
      const runtimeError = (await sessionStore.loadEventsSince(childThread.id, 0))
        .find((event) => event.kind === 'error' && event.turnId === started.turnId)
      if (runtimeError?.kind === 'error') throw new Error(runtimeError.message)
      const items = await sessionStore.loadItems(childThread.id)
      const text = summarizeReviewTurn(items, started.turnId)
      if (status !== 'completed') throw new Error(text || `reviewer ${status}`)
      return text
    } finally {
      input.signal.removeEventListener('abort', abortChild)
    }
  }

  private async failReview(
    input: { threadId: string; turnId: string; reviewItemId: string },
    message: string
  ): Promise<void> {
    await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
      status: 'failed',
      reviewText: message,
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.finishTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      status: 'failed',
      error: message
    })
  }

  private async abortReview(input: {
    threadId: string
    turnId: string
    reviewItemId: string
  }): Promise<void> {
    await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
      status: 'aborted',
      reviewText: 'Review aborted.',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.finishTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      status: 'aborted'
    })
  }
}

function summarizeReviewTurn(items: readonly TurnItem[], turnId: string): string {
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> =>
      item.turnId === turnId && item.kind === 'assistant_text' && item.text.trim().length > 0
    )
    .map((item) => item.text.trim())
    .join('\n\n')
    .trim()
}
