import { AgentLoop } from '../src/loop/agent-loop.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemoryApprovalGate } from '../src/adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../src/adapters/in-memory-user-input-gate.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { LocalToolHost, defaultLocalTools, type LocalTool } from '../src/adapters/tool/local-tool-host.js'
import { TurnService } from '../src/services/turn-service.js'
import { ThreadService } from '../src/services/thread-service.js'
import { UsageService } from '../src/services/usage-service.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { createImmutablePrefix } from '../src/cache/immutable-prefix.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import type { SkillRuntime } from '../src/skills/skill-runtime.js'
import type { AttachmentStore } from '../src/attachments/attachment-store.js'
import type { ModelCapabilityMetadata } from '../src/contracts/capabilities.js'
import type { MemoryStore } from '../src/memory/memory-store.js'
import type { TokenEconomyConfig } from '../src/loop/token-economy.js'
import type { ToolStormBreakerOptions } from '../src/loop/tool-storm-breaker.js'
import type { ContextCompactionConfig } from '../src/loop/model-context-profile.js'

export type Harness = {
  threadId: string
  turnId: string
  bus: InMemoryEventBus
  approvalGate: InMemoryApprovalGate
  userInputGate: InMemoryUserInputGate
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  toolHost: LocalToolHost
  turns: TurnService
  threads: ThreadService
  usage: UsageService
  loop: AgentLoop
  prefix: ReturnType<typeof createImmutablePrefix>
  threadStore: InMemoryThreadStore
  sessionStore: InMemorySessionStore
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  nowMs: () => number
  events: RuntimeEventRecorder
  ids: SequentialIdGenerator
}

export function makeFakeModel(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'fake',
    model: 'fake',
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      for (const chunk of chunks) yield chunk
    }
  }
}

export function makeSilentModel(): ModelClient {
  return {
    provider: 'silent',
    model: 'silent',
    async *stream(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
}

export function makeHarness(
  model: ModelClient,
  options: {
    compactor?: ContextCompactor
    tools?: LocalTool[]
    skillRuntime?: SkillRuntime
    attachmentStore?: AttachmentStore
    memoryStore?: MemoryStore
    modelCapabilities?: (model: string) => ModelCapabilityMetadata
    tokenEconomy?: TokenEconomyConfig
    contextCompaction?: ContextCompactionConfig
    toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
    nowMs?: () => number
    toolArgumentRepair?: {
      maxStringBytes?: number
    }
  } = {}
): Harness {
  const bus = new InMemoryEventBus()
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = options.compactor ?? new ContextCompactor({ softThreshold: 64, hardThreshold: 128 })
  const toolHost = new LocalToolHost({ tools: options.tools ?? defaultLocalTools })
  const usage = new UsageService()
  const nowIso = () => new Date().toISOString()
  const nowMs = options.nowMs ?? (() => Date.now())
  const allocateSeq = (threadId: string) => bus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq, nowIso })
  const ids = new SequentialIdGenerator()
  const prefix = createImmutablePrefix({ systemPrompt: 'be brief' })
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
  const threads = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model,
    toolHost,
    usage,
    events,
    turns,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso,
    nowMs,
    ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
    ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
    ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
    ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(options.toolStorm ? { toolStorm: options.toolStorm } : {}),
    ...(options.toolArgumentRepair ? { toolArgumentRepair: options.toolArgumentRepair } : {})
  })

  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    bus,
    approvalGate,
    userInputGate,
    inflight,
    steering,
    compactor,
    toolHost,
    turns,
    threads,
    usage,
    loop,
    prefix,
    threadStore,
    sessionStore,
    allocateSeq,
    nowIso,
    nowMs,
    events,
    ids
  }
}

export async function bootstrapThread(
  h: Harness,
  options: {
    workspace?: string
    request?: Parameters<TurnService['startTurn']>[0]['request']
  } = {}
): Promise<void> {
  await h.threadStore.upsert(
    createThreadRecord({ id: h.threadId, title: 'demo', workspace: options.workspace ?? '/tmp', model: 'fake' })
  )
  const response = await h.turns.startTurn({
    threadId: h.threadId,
    request: options.request ?? { prompt: 'hello' }
  })
  h.turnId = response.turnId
}

export async function resolveNextUserInput(
  h: Harness,
  answers: Array<{ id: string; label: string; value: string }>
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = h.userInputGate.pending(h.threadId)[0]
    if (pending) {
      h.userInputGate.resolve(pending.id, { status: 'submitted', answers })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for user input')
}
