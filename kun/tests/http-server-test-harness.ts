import { buildRouter } from '../src/server/routes/index.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemoryApprovalGate } from '../src/adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../src/adapters/in-memory-user-input-gate.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { LocalToolHost, defaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { LocalWorkspaceInspector } from '../src/adapters/workspace/local-workspace-inspector.js'
import { TurnService } from '../src/services/turn-service.js'
import { ThreadService } from '../src/services/thread-service.js'
import { UsageService } from '../src/services/usage-service.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { createImmutablePrefix } from '../src/cache/immutable-prefix.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import type { ServerRuntime } from '../src/server/routes/server-runtime.js'
import { AgentLoop } from '../src/loop/agent-loop.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { createApprovalRequest } from '../src/domain/approval.js'
import { encodeSseEvent } from '../src/server/sse.js'
import type { UsageSnapshot } from '../src/contracts/usage.js'
import { buildRuntimeCapabilityManifest } from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'

function makeModel(chunks: ModelStreamChunk[]): ModelClient {
  return {
    provider: 'fake',
    model: 'fake',
    async *stream(): AsyncIterable<ModelStreamChunk> {
      for (const chunk of chunks) yield chunk
    }
  }
}

export function usageSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  const promptTokens = overrides.promptTokens ?? 10
  const completionTokens = overrides.completionTokens ?? 5
  const snapshot: UsageSnapshot = {
    promptTokens,
    completionTokens,
    totalTokens: overrides.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: overrides.cachedTokens ?? 2,
    cacheHitTokens: overrides.cacheHitTokens ?? 2,
    cacheMissTokens: overrides.cacheMissTokens ?? Math.max(promptTokens - 2, 0),
    cacheHitRate: 'cacheHitRate' in overrides ? overrides.cacheHitRate ?? null : (promptTokens > 0 ? 2 / promptTokens : null),
    turns: overrides.turns ?? 1
  }
  if (overrides.costUsd !== undefined) snapshot.costUsd = overrides.costUsd
  if (overrides.costCny !== undefined) snapshot.costCny = overrides.costCny
  if (overrides.cacheSavingsUsd !== undefined) snapshot.cacheSavingsUsd = overrides.cacheSavingsUsd
  if (overrides.cacheSavingsCny !== undefined) snapshot.cacheSavingsCny = overrides.cacheSavingsCny
  if (overrides.tokenEconomySavingsTokens !== undefined) {
    snapshot.tokenEconomySavingsTokens = overrides.tokenEconomySavingsTokens
  }
  if (overrides.tokenEconomySavingsUsd !== undefined) {
    snapshot.tokenEconomySavingsUsd = overrides.tokenEconomySavingsUsd
  }
  if (overrides.tokenEconomySavingsCny !== undefined) {
    snapshot.tokenEconomySavingsCny = overrides.tokenEconomySavingsCny
  }
  if (overrides.hasError !== undefined) snapshot.hasError = overrides.hasError
  return snapshot
}

type Harness = {
  runtime: ServerRuntime
  approvalGate: InMemoryApprovalGate
  userInputGate: InMemoryUserInputGate
  router: ReturnType<typeof buildRouter>
  threadService: ThreadService
  turnService: TurnService
  bus: InMemoryEventBus
  sessionStore: InMemorySessionStore
  loop: AgentLoop
  threadStore: InMemoryThreadStore
  inflight: InflightTracker
  steering: SteeringQueue
  nowIso: () => string
}

export function buildHarness(): Harness {
  const bus = new InMemoryEventBus()
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor()
  const toolHost = new LocalToolHost({ tools: defaultLocalTools })
  const usage = new UsageService()
  const prefix = createImmutablePrefix({ systemPrompt: 'be brief' })
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => bus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq, nowIso })
  const ids = new SequentialIdGenerator()
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  const model = makeModel([{ kind: 'completed', stopReason: 'stop' }])
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model,
    toolHost,
    usage,
    events,
    turns: turnService,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso
  })
  const startedAt = nowIso()
  const modelId = 'deepseek-chat'
  const capabilities = buildRuntimeCapabilityManifest({
    model: modelCapabilitiesForModel(modelId)
  })
  const runtime: ServerRuntime = {
    threadService,
    turnService,
    usageService: usage,
    eventBus: bus,
    sessionStore,
    events,
    approvalGate,
    userInputGate,
    workspaceInspector: new LocalWorkspaceInspector(),
    runTurn: (threadId, turnId) => {
      void loop.runTurn(threadId, turnId)
    },
    runtimeToken: 'tok-1',
    insecure: false,
    allocateSeq,
    nowIso,
    info: () => ({
      host: '127.0.0.1',
      port: 0,
      dataDir: '/tmp/kun',
      model: modelId,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      insecure: false,
      startedAt,
      capabilities
    })
  }
  return {
    runtime,
    approvalGate,
    userInputGate,
    router: buildRouter(runtime),
    threadService,
    turnService,
    bus,
    sessionStore,
    loop,
    threadStore,
    inflight,
    steering,
    nowIso
  }
}

export async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text())
}

export async function readSseEvents(response: Response, options: { idleMs?: number } = {}): Promise<string[]> {
  const reader = response.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  let buffer = ''
  const events: string[] = []
  let lastChunkAt = Date.now()
  const idleMs = options.idleMs ?? 50
  while (true) {
    const timeout = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), idleMs)
    )
    const next = await Promise.race([reader.read(), timeout])
    if (!next || next.done) break
    if (next.value) {
      lastChunkAt = Date.now()
      buffer += decoder.decode(next.value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        events.push(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
    } else if (Date.now() - lastChunkAt > idleMs) {
      break
    }
  }
  try {
    reader.releaseLock()
  } catch {
    // ignore
  }
  return events
}
