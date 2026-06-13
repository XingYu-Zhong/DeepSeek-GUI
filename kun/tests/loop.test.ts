import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { CREATE_PLAN_TOOL_NAME } from '../src/adapters/tool/create-plan-tool.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../src/adapters/tool/goal-tools.js'
import { FileThreadStore, FileSessionStore } from '../src/adapters/file/index.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { resolveModelContextProfile } from '../src/loop/model-context-profile.js'
import {
  makeApprovalItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../src/domain/item.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { createImmutablePrefix, setSystemPrompt } from '../src/cache/immutable-prefix.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { TurnService } from '../src/services/turn-service.js'
import type { TurnItem } from '../src/contracts/items.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness,
  makeSilentModel,
  resolveNextUserInput
} from './loop-test-harness.js'

describe('AgentLoop', () => {
  it('finishes a silent model run as completed', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    expect(h.inflight.size()).toBe(0)
  })

  it('injects the current shell runtime when bash is available', async () => {
    let observedRequest: ModelRequest | null = null
    const h = makeHarness({
      provider: 'shell-context',
      model: 'shell-context',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const request = observedRequest as ModelRequest | null
    if (!request) throw new Error('expected model request')
    expect(request.tools.map((tool) => tool.name)).toContain('bash')
    expect(request.contextInstructions?.join('\n')).toContain('<shell_environment>')
    expect(request.contextInstructions?.join('\n')).toContain('<syntax>')
  })

  it('records elapsed seconds for active goals after a turn finishes', async () => {
    let nowMs = 1_000
    const h = makeHarness(
      {
        provider: 'goal-timer',
        model: 'goal-timer',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          nowMs = 4_700
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { nowMs: () => nowMs }
    )
    await bootstrapThread(h)
    await h.threads.setGoal(h.threadId, { objective: 'ship the feature' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const goal = await h.threads.getGoal(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('completed')
    expect(goal?.timeUsedSeconds).toBe(3)
    expect(events.some((event) =>
      event.kind === 'goal_updated' && event.goal?.timeUsedSeconds === 3
    )).toBe(true)
  })

  it('includes the failure reason on turn_failed events', async () => {
    const h = makeHarness({
      provider: 'throwing',
      model: 'throwing',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        const chunks: ModelStreamChunk[] = []
        for (const chunk of chunks) yield chunk
        throw new Error('model stream exploded')
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const failed = events.find((event) => event.kind === 'turn_failed')

    expect(status).toBe('failed')
    expect(failed).toMatchObject({
      kind: 'turn_failed',
      message: expect.stringContaining('model stream exploded')
    })
    expect(failed?.kind === 'turn_failed' ? failed.message : '').toContain('[Kun turn failed]')
  })

  it('fails the turn when the model stream yields an error chunk', async () => {
    const h = makeHarness({
      provider: 'error-chunk',
      model: 'error-chunk',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'model request failed with status 400', code: 'http_400' }
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('failed')
    expect(events.some((event) =>
      event.kind === 'error' &&
      event.message === 'model request failed with status 400' &&
      event.code === 'http_400'
    )).toBe(true)
    const failed = events.find((event) => event.kind === 'turn_failed')
    expect(failed).toMatchObject({
      kind: 'turn_failed',
      message: 'model request failed with status 400',
      code: 'http_400',
      severity: 'error'
    })
  })

  it('emits named pipeline lifecycle stages for a model request', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const stages = events
      .filter((event) => event.kind === 'pipeline_stage')
      .map((event) => event.kind === 'pipeline_stage' ? event.stage : '')

    expect(stages).toEqual([
      'setup',
      'pre_start',
      'post_start',
      'input_received',
      'input_cached',
      'input_routed',
      'input_compressed',
      'input_remembered',
      'pre_send',
      'post_send',
      'response_received'
    ])
  })

  it('records provider endpoint diagnostics for model send stages', async () => {
    const model = {
      provider: 'compat',
      model: 'MiniMax-M2',
      config: {
        baseUrl: 'https://user:secret@api.minimaxi.com/anthropic?token=hidden#debug',
        endpointFormat: 'messages',
        model: 'MiniMax-M2'
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model)
    await bootstrapThread(h, {
      request: { prompt: 'hello', model: 'mimo-v2.5-pro-ultraspeed' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const preSend = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'pre_send'
    )
    const postSend = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'post_send'
    )

    expect(preSend).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'pre_send',
      details: {
        model: 'mimo-v2.5-pro-ultraspeed',
        provider: 'compat',
        providerBaseUrl: 'https://api.minimaxi.com/anthropic',
        endpointFormat: 'messages',
        configuredModel: 'MiniMax-M2'
      }
    })
    expect(postSend).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'post_send',
      details: {
        model: 'mimo-v2.5-pro-ultraspeed',
        providerBaseUrl: 'https://api.minimaxi.com/anthropic'
      }
    })
  })

  it('aborts the turn when the abort signal fires', async () => {
    const h = makeHarness({
      provider: 'blocker',
      model: 'blocker',
      async *stream({ abortSignal }): AsyncIterable<ModelStreamChunk> {
        await new Promise<void>((resolve) => {
          if (abortSignal.aborted) return resolve()
          abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { kind: 'error', message: 'aborted' }
      }
    })
    await bootstrapThread(h)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    h.turns['inflightTurns'].set(h.turnId, controller)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status === 'aborted' || status === 'failed').toBe(true)
    expect(h.inflight.size()).toBe(0)
  })

  it('can discard generated items when interrupting a foreground turn', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    await h.turns.applyItem(
      h.threadId,
      makeAssistantTextItem({
        id: 'partial_answer',
        turnId: h.turnId,
        threadId: h.threadId,
        text: 'partial',
        status: 'running'
      })
    )

    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId, discard: true })
    const sessionItems = await h.sessionStore.loadItems(h.threadId)
    const thread = await h.threadStore.get(h.threadId)
    const turnItems = thread?.turns.find((turn) => turn.id === h.turnId)?.items ?? []

    expect(sessionItems.filter((item) => item.turnId === h.turnId).map((item) => item.kind))
      .toEqual(['user_message'])
    expect(turnItems.map((item) => item.kind)).toEqual(['user_message'])
  })

  it('keeps partial assistant text when interrupting a foreground turn', async () => {
    let resolveDelta: (() => void) | undefined
    const sawDelta = new Promise<void>((resolve) => {
      resolveDelta = resolve
    })
    const h = makeHarness({
      provider: 'partial-abort',
      model: 'partial-abort',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'assistant_text_delta', text: 'partial answer' }
        resolveDelta?.()
        await new Promise<void>((resolve) => {
          if (request.abortSignal.aborted) {
            resolve()
            return
          }
          request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    const run = h.loop.runTurn(h.threadId, h.turnId)
    await sawDelta
    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })
    const status = await run
    const sessionItems = await h.sessionStore.loadItems(h.threadId)
    const thread = await h.threadStore.get(h.threadId)
    const turnItems = thread?.turns.find((turn) => turn.id === h.turnId)?.items ?? []

    expect(status).toBe('aborted')
    expect(sessionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_text',
          text: 'partial answer',
          status: 'completed'
        })
      ])
    )
    expect(turnItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_text',
          text: 'partial answer',
          status: 'completed'
        })
      ])
    )
  })

  it('runs a tool call and surfaces its result item', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'fake',
      model: 'fake',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_echo',
            toolName: 'echo',
            arguments: { text: 'hi' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const items = await h.sessionStore.loadItems(h.threadId)
    const result = items.find((item) => item.kind === 'tool_result')
    expect(result).toBeDefined()
    if (result?.kind === 'tool_result') {
      expect(result.toolName).toBe('echo')
    }
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'tool_call_ready' && event.readyCount === 1)).toBe(true)
    expect(events.some((event) =>
      event.kind === 'tool_result_upload_wait' && event.toolResultCount === 1
    )).toBe(true)
    const thread = await h.threadStore.get(h.threadId)
    const toolCall = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_call' && item.callId === 'call_echo')
    expect(toolCall).toMatchObject({ kind: 'tool_call', status: 'completed' })
  })

  it('keeps running past the legacy eight-step ceiling until the model stops', async () => {
    let calls = 0
    const h = makeHarness(
      {
        provider: 'long-runner',
        model: 'long-runner',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls <= 9) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_ls_${calls}`,
              toolName: 'ls',
              arguments: { path: '.' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'done' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools(), toolStorm: { enabled: false } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(calls).toBe(10)
    expect(items.some((item) => item.kind === 'assistant_text' && item.text === 'done')).toBe(true)
  })

  it('replaces live partial tool results with final tool results in the thread snapshot', async () => {
    const partialTool = LocalToolHost.defineTool({
      name: 'partial_bash',
      description: 'Emit a partial update then a final result',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: true }, isError: false })
        return { output: { exit_code: 127 }, isError: true }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'fake',
        model: 'fake',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_partial',
              toolName: 'partial_bash',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [partialTool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const thread = await h.threadStore.get(h.threadId)
    const result = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_result' && item.callId === 'call_partial')

    expect(status).toBe('completed')
    expect(result).toMatchObject({
      kind: 'tool_result',
      status: 'completed',
      isError: true,
      output: { exit_code: 127 }
    })
  })

  it('surfaces tool catalog drift to the UI and next model request', async () => {
    const seenInstructions: string[][] = []
    let modelCalls = 0
    let advertiseExtra = false
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async () => {
        advertiseExtra = true
        return { output: { ok: true } }
      }
    })
    const extraTool = LocalToolHost.defineTool({
      name: 'extra_tool',
      description: 'Appears after the first tool call',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      shouldAdvertise: () => advertiseExtra,
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(
      {
        provider: 'catalog-drift',
        model: 'catalog-drift',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          seenInstructions.push(request.contextInstructions ?? [])
          modelCalls += 1
          if (modelCalls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_echo',
              toolName: 'echo',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [echoTool, extraTool] }
    )
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const items = await h.sessionStore.loadItems(h.threadId)

	    expect(events.some((event) => event.kind === 'tool_catalog_changed')).toBe(true)
	    expect(events.find((event) => event.kind === 'tool_catalog_changed')).toMatchObject({
	      kind: 'tool_catalog_changed',
	      changeKind: 'additive'
	    })
	    expect(items.some((item) => item.kind === 'error' && item.code === 'tool_catalog_changed')).toBe(true)
	    expect(seenInstructions[1]?.some((text) => text.includes('Tool catalog changed'))).toBe(true)
	  })

	  it('stops the turn when an existing tool schema mutates in-place', async () => {
	    let modelCalls = 0
	    const inputSchema: Record<string, unknown> = {
	      type: 'object',
	      properties: { text: { type: 'string' } },
	      required: ['text']
	    }
	    const echoTool = LocalToolHost.defineTool({
	      name: 'echo',
	      description: 'Echo text.',
	      inputSchema,
	      policy: 'auto',
	      execute: async () => {
	        inputSchema.properties = {
	          text: { type: 'string' },
	          unexpected: { type: 'boolean' }
	        }
	        return { output: { ok: true } }
	      }
	    })
	    const h = makeHarness(
	      {
	        provider: 'catalog-breaking-drift',
	        model: 'catalog-breaking-drift',
	        async *stream(): AsyncIterable<ModelStreamChunk> {
	          modelCalls += 1
	          yield {
	            kind: 'tool_call_complete',
	            callId: 'call_echo',
	            toolName: 'echo',
	            arguments: { text: 'hi' }
	          }
	          yield { kind: 'completed', stopReason: 'tool_calls' }
	        }
	      },
	      { tools: [echoTool] }
	    )
	    await bootstrapThread(h)

	    const status = await h.loop.runTurn(h.threadId, h.turnId)
	    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
	    const items = await h.sessionStore.loadItems(h.threadId)

	    expect(status).toBe('completed')
	    expect(modelCalls).toBe(1)
	    expect(events.find((event) => event.kind === 'tool_catalog_changed')).toMatchObject({
	      kind: 'tool_catalog_changed',
	      changeKind: 'breaking'
	    })
	    expect(items.find((item) => item.kind === 'error' && item.code === 'tool_catalog_changed'))
	      .toMatchObject({
	        kind: 'error',
	        message: expect.stringContaining('Kun stopped this turn')
	      })
	  })

	  it('runs consecutive built-in read-only tool calls in a deterministic parallel batch', async () => {
    const started: string[] = []
    let resolveBothStarted!: () => void
    let releaseTools!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseTools = resolve
    })
    const makeReadOnlyTool = (name: 'read' | 'grep') =>
      LocalToolHost.defineTool({
        name,
        description: `${name} test tool`,
        inputSchema: {
          type: 'object',
          properties: {}
        },
        policy: 'auto',
        execute: async () => {
          started.push(name)
          if (started.length === 2) resolveBothStarted()
          await release
          return { output: { name } }
        }
      })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'parallel-model',
        model: 'parallel-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_read',
              toolName: 'read',
              arguments: {}
            }
            yield {
              kind: 'tool_call_complete',
              callId: 'call_grep',
              toolName: 'grep',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [makeReadOnlyTool('read'), makeReadOnlyTool('grep')] }
    )
    await bootstrapThread(h)

    const run = h.loop.runTurn(h.threadId, h.turnId)
    let startupError: Error | undefined
    try {
      await Promise.race([
        bothStarted,
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`only started ${started.join(',') || 'none'}`)), 100)
        })
      ])
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error))
    } finally {
      releaseTools()
    }
    const status = await run
    if (startupError) throw startupError

    const resultCallIds = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'tool_result')
      .map((item) => item.kind === 'tool_result' ? item.callId : '')

    expect(status).toBe('completed')
    expect(started).toEqual(['read', 'grep'])
    expect(resultCallIds).toEqual(['call_read', 'call_grep'])
  })

	  it('repairs wrapped tool arguments before persisting and dispatching calls', async () => {
	    let observedArguments: Record<string, unknown> | null = null
	    let calls = 0
	    const h = makeHarness(
	      {
	        provider: 'wrapped-tool-args',
	        model: 'wrapped-tool-args',
	        async *stream(): AsyncIterable<ModelStreamChunk> {
	          calls += 1
	          if (calls > 1) {
	            yield { kind: 'completed', stopReason: 'stop' }
	            return
	          }
	          yield {
	            kind: 'tool_call_complete',
            callId: 'call_wrapped',
            toolName: 'capture_args',
            arguments: {
              tool_name: 'capture_args',
              arguments: '{"path":"src/main.ts"}'
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        }
      },
      {
        tools: [
          LocalToolHost.defineTool({
            name: 'capture_args',
            description: 'Capture repaired args.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: true },
            policy: 'auto',
            execute: async (args) => {
              observedArguments = { ...args }
              return { output: { ok: true } }
            }
          })
        ]
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(observedArguments).toEqual({ path: 'src/main.ts' })
    const items = await h.sessionStore.loadItems(h.threadId)
    const toolCall = items.find((item) => item.kind === 'tool_call' && item.callId === 'call_wrapped')
    expect(toolCall).toMatchObject({
      arguments: { path: 'src/main.ts' },
      summary: expect.stringContaining('flattened arguments wrapper')
    })
  })

	  it('suppresses repeated identical tool calls within a turn', async () => {
	    let executions = 0
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async () => {
        executions += 1
        return { output: { ok: executions } }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'storm-model',
        model: 'storm-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls <= 3) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_echo_${calls}`,
              toolName: 'echo',
              arguments: { text: 'repeat me' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [echoTool] }
    )
    await bootstrapThread(h)

	    const status = await h.loop.runTurn(h.threadId, h.turnId)
	    const items = await h.sessionStore.loadItems(h.threadId)
	    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
	    const stormResult = items.find(
	      (item) => item.kind === 'tool_result' && item.callId === 'call_echo_3'
	    )
    const thirdCall = items.find(
      (item) => item.kind === 'tool_call' && item.callId === 'call_echo_3'
    )

    expect(status).toBe('completed')
    expect(executions).toBe(2)
    expect(thirdCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
	    expect(stormResult?.kind === 'tool_result' ? stormResult.isError : false).toBe(true)
	    expect(stormResult?.kind === 'tool_result' ? JSON.stringify(stormResult.output) : '')
	      .toContain('repeat-loop guard suppressed')
	    expect(events.find((event) => event.kind === 'tool_storm_suppressed')).toMatchObject({
	      kind: 'tool_storm_suppressed',
	      callId: 'call_echo_3',
	      toolName: 'echo'
	    })
	  })

	  it('can disable the storm breaker through loop config', async () => {
	    let executions = 0
	    const echoTool = LocalToolHost.defineTool({
	      name: 'echo',
	      description: 'Echo text',
	      inputSchema: {
	        type: 'object',
	        properties: { text: { type: 'string' } },
	        required: ['text']
	      },
	      policy: 'auto',
	      execute: async () => {
	        executions += 1
	        return { output: { ok: executions } }
	      }
	    })
	    let calls = 0
	    const h = makeHarness(
	      {
	        provider: 'storm-disabled-model',
	        model: 'storm-disabled-model',
	        async *stream(): AsyncIterable<ModelStreamChunk> {
	          calls += 1
	          if (calls <= 3) {
	            yield {
	              kind: 'tool_call_complete',
	              callId: `call_echo_${calls}`,
	              toolName: 'echo',
	              arguments: { text: 'repeat me' }
	            }
	            yield { kind: 'completed', stopReason: 'tool_calls' }
	            return
	          }
	          yield { kind: 'completed', stopReason: 'stop' }
	        }
	      },
	      { tools: [echoTool], toolStorm: { enabled: false } }
	    )
	    await bootstrapThread(h)

	    const status = await h.loop.runTurn(h.threadId, h.turnId)
	    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

	    expect(status).toBe('completed')
	    expect(executions).toBe(3)
	    expect(events.some((event) => event.kind === 'tool_storm_suppressed')).toBe(false)
	  })

	  it('uses compact tool history for model requests without mutating persisted results', async () => {
    const longOutput = Array.from({ length: 600 }, (_, index) =>
      index === 320 ? 'ERROR auth middleware failed hard' : `plain output line ${index}`
    ).join('\n')
    const observedRequests: ModelRequest[] = []
    const bashTool = LocalToolHost.defineTool({
      name: 'bash',
      description: 'Execute command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      },
      policy: 'auto',
      execute: async () => ({
        output: {
          command: 'npm test',
          cwd: '/tmp',
          exit_code: 1,
          output: longOutput,
          full_output_path: '/tmp/full-output.log'
        },
        isError: true
      })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'capture',
        model: 'capture',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_bash',
              toolName: 'bash',
              arguments: { command: 'npm test' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        tools: [bashTool],
        compactor: new ContextCompactor({ softThreshold: 1_000_000, hardThreshold: 1_100_000 }),
        tokenEconomy: { enabled: true }
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const persisted = (await h.sessionStore.loadItems(h.threadId)).find((item) => item.kind === 'tool_result')
    const secondRequestResult = observedRequests[1]?.history.find((item) => item.kind === 'tool_result')
    const usageEvents = (await h.sessionStore.loadEventsSince(h.threadId, 0))
      .filter((event) => event.kind === 'usage')

    expect(status).toBe('completed')
    expect(persisted?.kind === 'tool_result' ? JSON.stringify(persisted.output) : '').toContain('plain output line 599')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output) : '').not.toContain('plain output line 300')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output).length : 0)
      .toBeLessThan(JSON.stringify(persisted?.kind === 'tool_result' ? persisted.output : '').length)
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output) : '').toContain('token economy')
    expect(usageEvents.some((event) =>
      event.kind === 'usage' && (event.usage.tokenEconomySavingsTokens ?? 0) > 0
    )).toBe(true)
  })

  it('bounds tool history for model requests even when token economy is disabled', async () => {
    const longOutput = Array.from({ length: 700 }, (_, index) =>
      index === 350 ? 'ERROR default history hygiene caught this line' : `verbose output line ${index}`
    ).join('\n')
    const observedRequests: ModelRequest[] = []
    const bashTool = LocalToolHost.defineTool({
      name: 'bash',
      description: 'Execute command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      },
      policy: 'auto',
      execute: async () => ({
        output: {
          command: 'npm test',
          output: longOutput
        },
        isError: true
      })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'capture',
        model: 'capture',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_bash',
              toolName: 'bash',
              arguments: { command: 'npm test', transcript: 'x'.repeat(12_000) }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        tools: [bashTool],
        compactor: new ContextCompactor({ softThreshold: 1_000_000, hardThreshold: 1_100_000 })
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const persisted = (await h.sessionStore.loadItems(h.threadId)).find((item) => item.kind === 'tool_result')
    const secondRequestCall = observedRequests[1]?.history.find((item) => item.kind === 'tool_call')
    const secondRequestResult = observedRequests[1]?.history.find((item) => item.kind === 'tool_result')

    expect(status).toBe('completed')
    expect(persisted?.kind === 'tool_result' ? JSON.stringify(persisted.output) : '').toContain('verbose output line 699')
    expect(secondRequestCall?.kind === 'tool_call' ? String(secondRequestCall.arguments.transcript) : '')
      .toContain('cache hygiene')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output) : '')
      .toContain('ERROR default history hygiene caught this line')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output) : '')
      .toContain('verbose output line 699')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output) : '')
      .toContain('cache hygiene')
    expect(secondRequestResult?.kind === 'tool_result' ? JSON.stringify(secondRequestResult.output).length : 0)
      .toBeLessThan(JSON.stringify(persisted?.kind === 'tool_result' ? persisted.output : '').length)
  })

  it('uses per-turn model from startTurn request', async () => {
    let seenModel = ''
    const h = makeHarness({
      provider: 'selector',
      model: 'fallback',
      async *stream({ model }: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenModel = model
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'thread-model'
      })
    )
    const { turnId } = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello', model: 'deepseek-v4-pro' }
    })
    const status = await h.loop.runTurn(h.threadId, turnId)
    const thread = await h.threadStore.get(h.threadId)
    expect(status).toBe('completed')
    expect(seenModel).toBe('deepseek-v4-pro')
    expect(thread?.turns.find((turn) => turn.id === turnId)?.model).toBe('deepseek-v4-pro')
  })

  it('propagates partial tool updates through item_updated before final completion', async () => {
    const streamingTool = LocalToolHost.defineTool({
      name: 'streamer',
      description: 'stream',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: 'hello' } })
        return { output: { done: true } }
      }
    })
    let calls = 0
    const h = makeHarness({
      provider: 'streaming-tool',
      model: 'streaming-tool',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_streamer',
            toolName: 'streamer',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [streamingTool] })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const partialUpdate = events.find(
      (event) =>
        (event.kind === 'item_created' || event.kind === 'item_updated') &&
        event.item.kind === 'tool_result' &&
        event.item.status === 'running' &&
        (event.item.output as { partial?: string }).partial === 'hello'
    )
    expect(partialUpdate).toBeDefined()
    const thread = await h.threadStore.get(h.threadId)
    const finalResult = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_result' && item.callId === 'call_streamer')
    expect(finalResult).toMatchObject({
      kind: 'tool_result',
      status: 'completed',
      output: { done: true }
    })
  })

  it('waits for GUI user input tool responses and resumes the turn', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'input-model',
      model: 'input-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_input',
            toolName: 'request_user_input',
            arguments: {
              prompt: 'Pick one',
              questions: [
                {
                  header: 'Decision',
                  id: 'choice',
                  question: 'Pick one',
                  options: [
                    { label: 'Yes', description: 'Continue' },
                    { label: 'No', description: 'Stop' }
                  ]
                }
              ]
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const resolver = resolveNextUserInput(h, [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    await resolver

    expect(status).toBe('completed')
    const thread = await h.threadStore.get(h.threadId)
    const inputItem = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'user_input')
    expect(inputItem).toMatchObject({
      kind: 'user_input',
      status: 'submitted',
      questions: [
        {
          header: 'Decision',
          id: 'choice',
          question: 'Pick one',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ]
    })
    const result = (await h.sessionStore.loadItems(h.threadId)).find((item) => item.kind === 'tool_result')
    expect(result).toMatchObject({
      kind: 'tool_result',
      toolName: 'request_user_input',
      isError: false
    })
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'user_input_requested')).toBe(true)
    expect(events.some((event) => event.kind === 'user_input_resolved')).toBe(true)
  })

  it('uses the thread approval policy when executing auto tools', async () => {
    const approvalDecisions: string[] = []
    const tool = LocalToolHost.defineTool({
      name: 'dangerous_auto',
      description: 'Auto tool that should still prompt in untrusted mode.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async (args) => ({ output: { echoed: args.text ?? '' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'approval-check',
        model: 'approval-check',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_danger',
              toolName: 'dangerous_auto',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'fake',
        approvalPolicy: 'untrusted'
      })
    )
    const response = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello' }
    })
    h.turnId = response.turnId
    h.approvalGate.request = async (approval) => {
      approvalDecisions.push(approval.toolName)
      return 'allow'
    }

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(approvalDecisions).toEqual(['dangerous_auto'])
  })

  it('persists toolKind from the advertised tool metadata', async () => {
    const tool = LocalToolHost.defineTool({
      name: 'write_file',
      description: 'Write a file.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      policy: 'auto',
      execute: async () => ({ output: { path: '/tmp/demo.ts' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'file-tool',
        model: 'file-tool',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_file',
              toolName: 'write_file',
              arguments: { path: '/tmp/demo.ts' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const toolCall = items.find((item) => item.kind === 'tool_call')
    const toolResult = items.find((item) => item.kind === 'tool_result')

    expect(status).toBe('completed')
    expect(toolCall).toMatchObject({ kind: 'tool_call', toolKind: 'file_change' })
    expect(toolResult).toMatchObject({ kind: 'tool_result', toolKind: 'file_change' })
  })

  it('omits create_plan from normal agent model requests', async () => {
    const observedTools: string[] = []
    const h = makeHarness(
      {
        provider: 'capture',
        model: 'capture',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedTools.push(...request.tools.map((tool) => tool.name))
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools() }
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(observedTools).not.toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('continues after a normal agent turn attempts a non-advertised create_plan call', async () => {
    const observedRequests: ModelRequest[] = []
    let calls = 0
    const h = makeHarness(
      {
        provider: 'overeager-planner',
        model: 'overeager-planner',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_plan',
              toolName: CREATE_PLAN_TOOL_NAME,
              arguments: {
                markdown: '# Plan',
                operation: 'draft'
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'I will continue without the plan tool.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools() }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const planCall = items.find(
      (item) => item.kind === 'tool_call' && item.toolName === CREATE_PLAN_TOOL_NAME
    )
    const planResult = items.find(
      (item) => item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
    )

    expect(status).toBe('completed')
    expect(observedRequests[0]?.tools.map((tool) => tool.name)).not.toContain(CREATE_PLAN_TOOL_NAME)
    expect(observedRequests.length).toBe(2)
    expect(planCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
    expect(planResult).toMatchObject({ kind: 'tool_result', isError: true })
    expect(planResult?.kind === 'tool_result' ? JSON.stringify(planResult.output) : '')
      .toContain('not advertised in this turn context')
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'tool_dispatch_rejected'
    )).toBe(true)
  })

  it('injects active goal guidance and goal status tools into model requests', async () => {
    const observedRequests: ModelRequest[] = []
    const goalTools = [GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME].map((name) =>
      LocalToolHost.defineTool({
        name,
        description: name,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        policy: 'auto',
        execute: async () => ({ output: { ok: true } })
      })
    )
    const h = makeHarness(
      {
        provider: 'capture-goal',
        model: 'capture-goal',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...goalTools] }
    )
    await bootstrapThread(h, { request: { prompt: 'check current memory usage' } })
    await h.threads.setGoal(h.threadId, {
      objective: 'check current memory usage',
      status: 'active'
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const [request] = observedRequests
    if (!request) throw new Error('expected model request')
    expect(request.contextInstructions?.join('\n')).toContain('Continue working toward the active thread goal.')
    expect(request.contextInstructions?.join('\n')).toContain('check current memory usage')
    expect(request.tools.map((tool) => tool.name)).toContain(GET_GOAL_TOOL_NAME)
    expect(request.tools.map((tool) => tool.name)).toContain(UPDATE_GOAL_TOOL_NAME)
  })

  it('continues an active goal after no-tool model turns until update_goal completes it', async () => {
    let h: ReturnType<typeof makeHarness>
    const goalTools = [
      LocalToolHost.defineTool({
        name: GET_GOAL_TOOL_NAME,
        description: 'Get goal',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (_args, context) => ({ output: { goal: await h.threads.getGoal(context.threadId) } })
      }),
      LocalToolHost.defineTool({
        name: UPDATE_GOAL_TOOL_NAME,
        description: 'Update goal',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['complete', 'blocked'] }
          },
          required: ['status'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const status = args.status
          if (status !== 'complete' && status !== 'blocked') {
            return { output: { error: 'invalid status' }, isError: true }
          }
          const goal = await h.threads.setGoal(context.threadId, { status })
          return { output: { goal } }
        }
      })
    ]
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-continuation',
        model: 'goal-continuation',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield { kind: 'assistant_text_delta', text: 'Draft ready.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 2) {
            yield { kind: 'assistant_text_delta', text: 'Still working.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete_goal',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Goal complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...goalTools] }
    )
    await bootstrapThread(h, { request: { prompt: 'write a benchmark note' } })
    await h.threads.setGoal(h.threadId, {
      objective: 'write a benchmark note',
      status: 'active'
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    const texts = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_text')
      .map((item) => item.kind === 'assistant_text' ? item.text : '')
    expect(texts).toEqual(['Draft ready.', 'Still working.', 'Goal complete.'])
  })

  it('persists the canonical tool catalog fingerprint on each turn', async () => {
    const h = makeHarness(makeSilentModel(), { tools: buildDefaultLocalTools() })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const turn = await h.turns.getTurn(h.threadId, h.turnId)
    expect(turn?.toolCatalogFingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(turn?.toolCatalogToolCount).toBeGreaterThan(0)
    expect(turn?.toolCatalogDrift).toBe(false)
  })

  it('uses persisted GUI plan context to advertise and execute create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-'))
    const observedToolLists: string[][] = []
    const observedRequiredToolNames: Array<string | undefined> = []
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedToolLists.push(request.tools.map((tool) => tool.name))
            observedRequiredToolNames.push(request.requiredToolName)
            if (observedToolLists.length === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_plan',
                toolName: CREATE_PLAN_TOOL_NAME,
                arguments: {
                  markdown: '# Generated plan',
                  operation: 'draft',
                  source_request: 'Add auth'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        }
      })
      const status = await h.loop.runTurn(h.threadId, h.turnId)
      expect(status).toBe('completed')
      expect(observedToolLists[0]).toContain(CREATE_PLAN_TOOL_NAME)
      expect(observedRequiredToolNames).toEqual([CREATE_PLAN_TOOL_NAME, undefined])
      await expect(readFile(join(workspace, '.kunsdd/plan/auth.md'), 'utf8')).resolves.toBe('# Generated plan')
      const turn = await h.turns.getTurn(h.threadId, h.turnId)
      expect(turn?.guiPlan?.relativePath).toBe('.kunsdd/plan/auth.md')
      const items = await h.sessionStore.loadItems(h.threadId)
      const result = items.find((item) => item.kind === 'tool_result' && item.callId === 'call_plan')
      expect(result).toBeDefined()
      if (result?.kind === 'tool_result') {
        expect(result.toolName).toBe(CREATE_PLAN_TOOL_NAME)
        expect(result.output).toMatchObject({
          relative_path: '.kunsdd/plan/auth.md',
          workspace_root: workspace,
          operation: 'draft'
        })
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text when a GUI plan turn misses create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-missing-tool-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)

      expect(status).toBe('completed')
      await expect(readFile(join(workspace, '.kunsdd/plan/auth.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth.'
      )
      expect(items.some((item) =>
        item.kind === 'tool_result' &&
        item.toolName === CREATE_PLAN_TOOL_NAME &&
        item.isError !== true
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text for plan-mode turns without a reserved context', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-free-form-text-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nPolish the sidebar footer.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan sidebar footer polish',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const planResult = items.find((item) =>
        item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
      )

      expect(status).toBe('completed')
      expect(planResult?.kind === 'tool_result' && planResult.isError).not.toBe(true)
      expect(
        planResult?.kind === 'tool_result' &&
        (planResult.output as { relative_path?: string }).relative_path
      ).toBe('.kunsdd/plan/plan-sidebar-footer-polish.md')
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-sidebar-footer-polish.md'), 'utf8')).resolves.toBe(
        '## Plan\nPolish the sidebar footer.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects forged write calls during plan mode without touching workspace files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-forged-write-'))
    const observedToolLists: string[][] = []
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedToolLists.push(request.tools.map((tool) => tool.name))
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_write',
                toolName: 'write',
                arguments: {
                  path: 'forbidden.txt',
                  content: 'should not exist'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nStay read-only until build mode.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan a safe change',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const writeCall = items.find((item) => item.kind === 'tool_call' && item.toolName === 'write')
      const writeResult = items.find((item) => item.kind === 'tool_result' && item.toolName === 'write')

      expect(status).toBe('completed')
      expect(observedToolLists[0]).not.toEqual(expect.arrayContaining(['write', 'edit', 'bash']))
      expect(writeCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
      expect(writeResult).toMatchObject({ kind: 'tool_result', isError: true })
      expect(writeResult?.kind === 'tool_result' ? JSON.stringify(writeResult.output) : '')
        .toContain('not advertised by active tool policy')
      await expect(readFile(join(workspace, 'forbidden.txt'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-a-safe-change.md'), 'utf8')).resolves.toBe(
        '## Plan\nStay read-only until build mode.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects forged bash calls during plan mode without running mutating commands', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-forged-bash-'))
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_bash',
                toolName: 'bash',
                arguments: {
                  command: 'touch forbidden.txt'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nUse read-only inspection only.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan without shell mutations',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const bashCall = items.find((item) => item.kind === 'tool_call' && item.toolName === 'bash')
      const bashResult = items.find((item) => item.kind === 'tool_result' && item.toolName === 'bash')

      expect(status).toBe('completed')
      expect(bashCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
      expect(bashResult).toMatchObject({ kind: 'tool_result', isError: true })
      expect(bashResult?.kind === 'tool_result' ? JSON.stringify(bashResult.output) : '')
        .toContain('not advertised by active tool policy')
      await expect(readFile(join(workspace, 'forbidden.txt'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-without-shell-mutations.md'), 'utf8')).resolves.toBe(
        '## Plan\nUse read-only inspection only.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('fails GUI plan turns only when neither create_plan nor plan text is returned', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-empty-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

      expect(status).toBe('failed')
      expect(items.some((item) =>
        item.kind === 'error' && item.code === 'required_tool_missing'
      )).toBe(true)
      expect(events.some((event) =>
        event.kind === 'error' && event.code === 'required_tool_missing'
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps requiring create_plan after unrelated tool calls in a GUI plan turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-other-tool-'))
    const observedRequiredToolNames: Array<string | undefined> = []
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedRequiredToolNames.push(request.requiredToolName)
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_echo',
                toolName: 'echo',
                arguments: { text: 'not a plan' }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth after checking context.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)

      expect(status).toBe('completed')
      expect(observedRequiredToolNames).toEqual([CREATE_PLAN_TOOL_NAME, CREATE_PLAN_TOOL_NAME, undefined])
      await expect(readFile(join(workspace, '.kunsdd/plan/auth.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth after checking context.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('steers the turn and injects user messages', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    h.steering.enqueue(h.turnId, 'follow up')
    await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const user = items.find((item) => item.kind === 'user_message' && item.text === 'follow up')
    expect(user).toBeDefined()
  })

  it('cleans up inflight ids after success and error', async () => {
    const h = makeHarness({
      provider: 'flaky',
      model: 'flaky',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'boom' }
        yield { kind: 'completed', stopReason: 'error' }
      }
    })
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(h.inflight.size()).toBe(0)
  })

  it('keeps the prefix stable when the system prompt does not change', () => {
    const a = createImmutablePrefix({ systemPrompt: 'be brief' })
    const b = createImmutablePrefix({ systemPrompt: 'be brief' })
    expect(a.fingerprint).toBe(b.fingerprint)
    const drifted = setSystemPrompt(a, 'be thorough')
    expect(drifted.fingerprint).not.toBe(a.fingerprint)
  })

  it('uses 1M context thresholds for DeepSeek v4 models and compatibility aliases', () => {
    const compactor = new ContextCompactor()
    const items = [
      makeUserItem({
        id: 'long_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'x'.repeat(80_000)
      })
    ]

    expect(resolveModelContextProfile('deepseek-v4-pro')?.contextWindowTokens).toBe(1_000_000)
    expect(resolveModelContextProfile('provider/deepseek-v4-flash')?.contextWindowTokens).toBe(1_000_000)
    expect(resolveModelContextProfile('deepseek-chat')?.canonicalModel).toBe('deepseek-v4-flash')
    expect(resolveModelContextProfile('deepseek-reasoner')?.canonicalModel).toBe('deepseek-v4-flash')
    expect(compactor.shouldCompact(items)).toBe(true)
    expect(compactor.shouldCompact(items, { model: 'deepseek-v4-pro' })).toBe(false)
    expect(compactor.shouldCompact(items, { model: 'deepseek-v4-flash' })).toBe(false)
    expect(compactor.hardCap('deepseek-v4-flash')).toBe(990_000)
  })

  it('uses reported prompt tokens as a compaction pressure signal', () => {
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const tinyHistory = [
      makeUserItem({
        id: 'tiny_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'short'
      })
    ]

    expect(compactor.shouldCompact(tinyHistory)).toBe(false)
    expect(compactor.shouldCompact(tinyHistory, { promptTokens: 120 })).toBe(true)
  })

  it('plans normal, aggressive, and force compaction levels', () => {
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const tinyHistory = [
      makeUserItem({
        id: 'tiny_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'short'
      })
    ]

    expect(compactor.planCompaction(tinyHistory, { promptTokens: 120 })).toMatchObject({
      mode: 'normal',
      keepRecent: 4
    })
    expect(compactor.planCompaction(tinyHistory, { promptTokens: 160 })).toMatchObject({
      mode: 'aggressive',
      keepRecent: 2
    })
    expect(compactor.planCompaction(tinyHistory, { promptTokens: 220 })).toMatchObject({
      mode: 'force',
      keepRecent: 1
    })
  })

  it('trims trailing tool calls and preserves skill pins in compaction summaries', () => {
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const prefix = createImmutablePrefix({ systemPrompt: 'system' })
    const result = compactor.compact({
      threadId: 'thr_1',
      turnId: 'turn_1',
      prefix,
      keepRecent: 1,
      history: [
        makeUserItem({ id: 'u1', turnId: 'turn_1', threadId: 'thr_1', text: 'first request' }),
        makeAssistantTextItem({
          id: 'a1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Active Skill: documents (documents)',
          status: 'completed'
        }),
        makeToolCallItem({
          id: 'call_trailing',
          turnId: 'turn_1',
          threadId: 'thr_1',
          callId: 'call_trailing',
          toolName: 'read',
          arguments: { path: 'a.txt' }
        })
      ]
    })

    expect(result.next.some((item) => item.kind === 'tool_call')).toBe(false)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '')
      .toContain('Active Skill: documents (documents)')
  })

  it('embeds a digest marker and skips frozen messages when compacting history', () => {
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const prefix = createImmutablePrefix({ systemPrompt: 'system' })
    const result = compactor.compact({
      threadId: 'thr_1',
      turnId: 'turn_1',
      prefix,
      keepRecent: 1,
      frozenMessageCount: 1,
      history: [
        makeUserItem({ id: 'frozen', turnId: 'turn_1', threadId: 'thr_1', text: 'already processed upstream' }),
        makeUserItem({ id: 'u1', turnId: 'turn_1', threadId: 'thr_1', text: 'fold alpha' }),
        makeAssistantTextItem({
          id: 'a1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'fold beta',
          status: 'completed'
        }),
        makeUserItem({ id: 'u2', turnId: 'turn_1', threadId: 'thr_1', text: 'keep gamma' })
      ]
    })
    const summary = result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : ''

    expect(result.next.map((item) => item.id)).toEqual(['frozen', result.summaryItem.id, 'u2'])
    expect(summary).toContain('fold alpha')
    expect(summary).not.toContain('already processed upstream')
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceDigest : '')
      .toMatch(/^[0-9a-f]{16}$/)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.digestMarker : '')
      .toBe(`<kun:tool_digest sha256="${result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceDigest : ''}">`)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceItemIds : [])
      .toEqual(['u1', 'a1'])
    expect(summary).toContain(result.summaryItem.kind === 'compaction' ? result.summaryItem.digestMarker : '')
  })

  it('accepts configured context compaction thresholds and model profiles', () => {
    const compactor = new ContextCompactor({
      contextCompaction: {
        defaultSoftThreshold: 123,
        defaultHardThreshold: 456,
        modelProfiles: {
          'custom-model': {
            aliases: ['vendor/custom-model'],
            softThreshold: 1_000,
            hardThreshold: 2_000
          }
        }
      }
    })

    expect(compactor.thresholds()).toEqual({ softThreshold: 123, hardThreshold: 456 })
    expect(compactor.thresholds('vendor/custom-model')).toEqual({
      softThreshold: 1_000,
      hardThreshold: 2_000
    })
  })

  it('compacts the history when the soft threshold is reached', async () => {
    const h = makeHarness(makeSilentModel(), {
      compactor: new ContextCompactor({ softThreshold: 8, hardThreshold: 16 })
    })
    await bootstrapThread(h)
    for (let i = 0; i < 10; i += 1) {
      await h.sessionStore.appendItem(
        h.threadId,
        makeUserItem({ id: `hist_${i}`, turnId: h.turnId, threadId: h.threadId, text: 'x'.repeat(20) })
      )
    }
    await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.some((item) => item.kind === 'compaction')).toBe(true)
  })

  it('can use a model summary for history compaction while reusing the main prefix', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness(
      {
        provider: 'fold-summary',
        model: 'fold-summary',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          const isSummaryRequest = request.tools.length === 0 &&
            request.contextInstructions?.some((text) => text.includes('history fold'))
          if (isSummaryRequest) {
            yield {
              kind: 'usage',
              usage: {
                promptTokens: 22,
                completionTokens: 7,
                totalTokens: 29,
                cachedTokens: 0,
                cacheHitTokens: 0,
                cacheMissTokens: 22,
                cacheHitRate: 0,
                turns: 1
              }
            }
            yield {
              kind: 'assistant_text_delta',
              text: 'Model summary: preserve alpha.txt and continue with beta.'
            }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        compactor: new ContextCompactor({ softThreshold: 8, hardThreshold: 16 }),
        contextCompaction: {
          summaryMode: 'model',
          summaryTimeoutMs: 5_000,
          summaryMaxTokens: 333,
          summaryInputMaxBytes: 4_096
        }
      }
    )
    await bootstrapThread(h)
    for (let i = 0; i < 10; i += 1) {
      await h.sessionStore.appendItem(
        h.threadId,
        makeUserItem({
          id: `model_summary_hist_${i}`,
          turnId: h.turnId,
          threadId: h.threadId,
          text: `alpha.txt observation ${i}; next step beta ${'x'.repeat(24)}`
        })
      )
    }

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const [summaryRequest, mainRequest] = requests
    if (!summaryRequest || !mainRequest) throw new Error('expected summary and main model requests')
    const summaryPromptItem = summaryRequest.history[0]
    const persisted = await h.sessionStore.loadItems(h.threadId)
    const persistedSummary = persisted.find((item) => item.kind === 'compaction')
    const mainSummary = mainRequest.history.find((item) => item.kind === 'compaction')

    expect(status).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(summaryRequest.systemPrompt).toBe('be brief')
    expect(summaryRequest.prefix).toBe(h.prefix.fewShots)
    expect(summaryRequest.tools).toEqual([])
    expect(summaryRequest.maxTokens).toBe(333)
    expect(summaryRequest.temperature).toBe(0)
    expect(summaryRequest.reasoningEffort).toBe('off')
    expect(summaryRequest.contextInstructions?.join('\n')).toContain('history fold')
    expect(summaryPromptItem?.kind).toBe('user_message')
    expect(summaryPromptItem?.kind === 'user_message' ? summaryPromptItem.text : '')
      .toContain('History excerpt to fold')
    expect(mainSummary?.kind === 'compaction' ? mainSummary.summary : '')
      .toContain('Model summary: preserve alpha.txt')
    expect(persistedSummary?.kind === 'compaction' ? persistedSummary.summary : '')
      .toContain('Model summary: preserve alpha.txt')
  })

  it('records a visible fallback event when configured model compaction summaries fail', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness(
      {
        provider: 'fold-summary-fails',
        model: 'fold-summary-fails',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          const isSummaryRequest = request.tools.length === 0 &&
            request.contextInstructions?.some((text) => text.includes('history fold'))
          if (isSummaryRequest) {
            yield { kind: 'error', message: 'summary model unavailable', code: 'summary_down' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        compactor: new ContextCompactor({ softThreshold: 8, hardThreshold: 16 }),
        contextCompaction: {
          summaryMode: 'model',
          summaryTimeoutMs: 5_000
        }
      }
    )
    await bootstrapThread(h)
    for (let i = 0; i < 10; i += 1) {
      await h.sessionStore.appendItem(
        h.threadId,
        makeUserItem({
          id: `fallback_hist_${i}`,
          turnId: h.turnId,
          threadId: h.threadId,
          text: `fallback observation ${i} ${'x'.repeat(24)}`
        })
      )
    }

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const fallback = events.find(
      (event) => event.kind === 'error' && event.code === 'compaction_summary_fallback'
    )
    const persisted = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(fallback?.kind === 'error' ? fallback.message : '').toContain('summary model unavailable')
    expect(persisted.some((item) =>
      item.kind === 'compaction' &&
      item.summary.includes('Conversation and work summary:') &&
      item.summary.includes('<kun:tool_digest sha256=')
    )).toBe(true)
  })

  it('compacts on the next step when provider usage reports high prompt tokens', async () => {
    const seenHistory: TurnItem[][] = []
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async () => ({ output: 'tool result from high usage turn' })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'usage-pressure',
        model: 'usage-pressure',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          seenHistory.push(request.history)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'usage',
              usage: {
                promptTokens: 12,
                completionTokens: 1,
                totalTokens: 13,
                cachedTokens: 0,
                cacheHitTokens: 0,
                cacheMissTokens: 12,
                cacheHitRate: 0,
                turns: 1
              }
            }
            yield {
              kind: 'tool_call_complete',
              callId: 'call_echo',
              toolName: 'echo',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        tools: [echoTool],
        compactor: new ContextCompactor({ softThreshold: 10, hardThreshold: 20 })
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const secondHistory = seenHistory[1] ?? []
    const persisted = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(seenHistory[0]?.some((item) => item.kind === 'compaction')).toBe(false)
    expect(secondHistory[0]?.kind).toBe('compaction')
    expect(secondHistory.some((item) => item.kind === 'tool_result')).toBe(true)
    expect(
      secondHistory.some((item) =>
        item.kind === 'compaction' && item.summary.includes('compaction threshold')
      )
    ).toBe(true)
    expect(persisted.some((item) => item.kind === 'compaction')).toBe(true)
  })

  it('warns once near the thread cost budget and blocks when exhausted', async () => {
    let modelCalls = 0
    const h = makeHarness({
      provider: 'budget',
      model: 'budget',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelCalls += 1
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    await h.threadStore.upsert({ ...thread!, costBudgetUsd: 10 })
    h.usage.record(h.threadId, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitRate: null,
      turns: 0,
      costUsd: 8
    })

    await h.loop.runTurn(h.threadId, h.turnId)
    const warnedThread = await h.threadStore.get(h.threadId)
    expect(modelCalls).toBe(1)
    expect(warnedThread?.costBudgetWarningSent).toBe(true)
    expect((await h.sessionStore.loadItems(h.threadId)).some((item) =>
      item.kind === 'error' && item.code === 'budget_warning'
    )).toBe(true)

    const second = await h.turns.startTurn({ threadId: h.threadId, request: { prompt: 'again' } })
    h.turnId = second.turnId
    h.usage.record(h.threadId, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitRate: null,
      turns: 0,
      costUsd: 2
    })
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(modelCalls).toBe(1)
    expect((await h.sessionStore.loadItems(h.threadId)).some((item) =>
      item.kind === 'error' && item.code === 'budget_limited'
    )).toBe(true)
  })

  it('does not auto-compact DeepSeek v4 turns at the legacy threshold', async () => {
    const h = makeHarness(makeSilentModel(), {
      compactor: new ContextCompactor()
    })
    await bootstrapThread(h, { request: { prompt: 'hello', model: 'deepseek-v4-flash' } })
    await h.sessionStore.appendItem(
      h.threadId,
      makeUserItem({
        id: 'legacy_threshold_sized_history',
        turnId: h.turnId,
        threadId: h.threadId,
        text: 'x'.repeat(80_000)
      })
    )

    await h.loop.runTurn(h.threadId, h.turnId)

    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.some((item) => item.kind === 'compaction')).toBe(false)
  })

  it('routes turn model auto before sending the real model request', async () => {
    const seenModels: string[] = []
    const h = makeHarness({
      provider: 'router-recorder',
      model: 'fallback',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenModels.push(request.model)
        if (request.turnId.endsWith('_auto_router')) {
          expect(request.stream).toBe(false)
          expect(request.maxTokens).toBe(96)
          yield { kind: 'assistant_text_delta', text: '{"model":"deepseek-v4-pro","thinking":"max"}' }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        expect(request.reasoningEffort).toBe('max')
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'deepseek-v4-flash'
      })
    )
    const { turnId } = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello', model: 'auto' }
    })

    await h.loop.runTurn(h.threadId, turnId)

    expect(seenModels).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('keeps explicit turn reasoning effort when auto routing chooses the model', async () => {
    const seenModels: string[] = []
    const h = makeHarness({
      provider: 'router-reasoning-override',
      model: 'fallback',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenModels.push(request.model)
        if (request.turnId.endsWith('_auto_router')) {
          yield { kind: 'assistant_text_delta', text: '{"model":"deepseek-v4-pro","thinking":"max"}' }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        expect(request.reasoningEffort).toBe('low')
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'auto'
      })
    )
    const { turnId } = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello', model: 'auto', reasoningEffort: 'low' }
    })

    await h.loop.runTurn(h.threadId, turnId)

    expect(seenModels).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('falls back to a concrete heuristic model when auto router fails', async () => {
    let realRequestModel = ''
    const h = makeHarness({
      provider: 'router-failure',
      model: 'auto',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        if (request.turnId.endsWith('_auto_router')) {
          yield { kind: 'error', message: 'router unavailable' }
          return
        }
        realRequestModel = request.model
        expect(request.reasoningEffort).toBe('high')
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'auto'
      })
    )
    const { turnId } = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello' }
    })

    await h.loop.runTurn(h.threadId, turnId)

    expect(realRequestModel).toBe('deepseek-v4-flash')
  })

  it('uses the latest compaction item as the effective history boundary', async () => {
    const seenHistory: ModelRequest['history'][] = []
    const h = makeHarness({
      provider: 'recorder',
      model: 'recorder',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenHistory.push(request.history)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      compactor: new ContextCompactor({ softThreshold: 100_000, hardThreshold: 120_000 })
    })
    await bootstrapThread(h)
    await h.turns.finishTurn({ threadId: h.threadId, turnId: h.turnId, status: 'completed' })
    for (let i = 0; i < 8; i += 1) {
      await h.sessionStore.appendItem(
        h.threadId,
        makeUserItem({
          id: `manual_hist_${i}`,
          turnId: h.turnId,
          threadId: h.threadId,
          text: i === 0 ? 'original requirement alpha' : `old detail ${i}`
        })
      )
    }

    const compacted = await h.turns.compact({
      threadId: h.threadId,
      request: { reason: 'manual test' }
    })
    expect(compacted.summary).toContain('original requirement alpha')

    const next = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'continue after compact' }
    })
    h.turnId = next.turnId
    await h.loop.runTurn(h.threadId, h.turnId)

    const history = seenHistory[0] ?? []
    expect(history[0]?.kind).toBe('compaction')
    expect(
      history.some((item) => item.kind === 'user_message' && item.text === 'original requirement alpha')
    ).toBe(false)
    expect(
      history.some((item) => item.kind === 'user_message' && item.text === 'continue after compact')
    ).toBe(true)
    expect(
      history.some((item) => item.kind === 'compaction' && item.summary.includes('original requirement alpha'))
    ).toBe(true)
  })

  it('records usage and emits a usage event', async () => {
    const h = makeHarness(
      makeFakeModel([
        {
          kind: 'usage',
          usage: {
            promptTokens: 12,
            completionTokens: 4,
            totalTokens: 16,
            cachedTokens: 6,
            cacheHitTokens: 6,
            cacheMissTokens: 6,
            cacheHitRate: 0.5,
            turns: 1
          }
        },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    const seen: number[] = []
    h.bus.subscribe(h.threadId, (event) => {
      if (event.kind === 'usage') seen.push(event.seq)
    })
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(seen.length).toBeGreaterThan(0)
    const replay = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(replay.some((event) => event.kind === 'usage')).toBe(true)
  })

  it('persists assistant text deltas for SSE replay before the final item', async () => {
    const h = makeHarness(
      makeFakeModel([
        { kind: 'assistant_text_delta', text: 'he' },
        { kind: 'assistant_text_delta', text: 'llo' },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    const replay = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const deltas = replay.filter((event) => event.kind === 'assistant_text_delta')
    expect(deltas).toHaveLength(2)
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.some((item) => item.kind === 'assistant_text' && item.text === 'hello')).toBe(true)
  })

  it('persists completed reasoning before completed assistant text', async () => {
    const h = makeHarness(
      makeFakeModel([
        { kind: 'assistant_reasoning_delta', text: 'thinking' },
        { kind: 'assistant_text_delta', text: 'answer' },
        { kind: 'completed', stopReason: 'stop' }
      ])
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)

    const itemKinds = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_reasoning' || item.kind === 'assistant_text')
      .map((item) => item.kind)

    expect(itemKinds).toEqual(['assistant_reasoning', 'assistant_text'])
  })
})

describe('FileSessionStore', () => {
  let dataDir = ''
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-test-'))
    await mkdir(dataDir, { recursive: true })
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('persists events and items as JSONL with atomic index writes', async () => {
    const threadStore = new FileThreadStore({ dataDir })
    const sessionStore = new FileSessionStore({ dataDir })
    await threadStore.upsert(
      createThreadRecord({ id: 'thr_x', title: 'demo', workspace: '/tmp', model: 'm' })
    )
    await sessionStore.appendEvent('thr_x', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: new Date().toISOString(),
      threadId: 'thr_x'
    })
    const events = await sessionStore.loadEventsSince('thr_x', 0)
    expect(events).toHaveLength(1)
    const content = await readFile(join(dataDir, 'threads', 'thr_x', 'events.jsonl'), 'utf-8')
    expect(content.endsWith('\n')).toBe(true)
    const index = JSON.parse(
      await readFile(join(dataDir, 'threads', 'index.json'), 'utf-8')
    ) as { order: string[] }
    expect(index.order).toContain('thr_x')
  })

  it('handles concurrent file thread index writes in the same millisecond', async () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const threadStore = new FileThreadStore({
        dataDir,
        now: () => new Date('2026-06-03T00:00:00.000Z')
      })
      const threads = Array.from({ length: 20 }, (_, index) =>
        createThreadRecord({
          id: `thr_concurrent_${index}`,
          title: `demo ${index}`,
          workspace: '/tmp',
          model: 'm'
        })
      )

      await expect(Promise.all(threads.map((thread) => threadStore.upsert(thread))))
        .resolves.toHaveLength(20)
      const index = JSON.parse(
        await readFile(join(dataDir, 'threads', 'index.json'), 'utf-8')
      ) as { order: string[] }

      expect(index.order).toEqual(expect.arrayContaining(threads.map((thread) => thread.id)))
    } finally {
      spy.mockRestore()
    }
  })

  it('continues event sequence numbers after a file-backed restart', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await sessionStore.appendEvent('thr_seq', {
      kind: 'heartbeat',
      seq: 7,
      timestamp: new Date().toISOString(),
      threadId: 'thr_seq'
    })
    const bus = new InMemoryEventBus()
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => new Date().toISOString()
    })
    const event = await recorder.record({ kind: 'heartbeat', threadId: 'thr_seq' })
    expect(event.seq).toBe(8)
  })

  it.each([
    ['aborted', 'aborted'],
    ['failed', 'failed']
  ] as const)('finalizes open turn items in messages.jsonl when a turn is %s', async (finalStatus, expectedToolStatus) => {
    const nowIso = () => '2026-06-05T00:00:00.000Z'
    const threadId = `thr_finalize_${finalStatus}`
    const threadStore = new FileThreadStore({ dataDir, now: () => new Date(nowIso()) })
    const sessionStore = new FileSessionStore({ dataDir })
    const bus = new InMemoryEventBus()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus: bus,
        sessionStore,
        allocateSeq: (id) => bus.allocateSeq(id),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor({ softThreshold: 64, hardThreshold: 128 }),
      ids: new SequentialIdGenerator(),
      nowIso
    })

    await threadStore.upsert(
      createThreadRecord({ id: threadId, title: 'demo', workspace: '/tmp', model: 'm' })
    )
    const { turnId } = await turns.startTurn({
      threadId,
      request: { prompt: 'run a tool' }
    })
    await turns.applyItem(
      threadId,
      makeToolCallItem({
        id: 'item_tool_open',
        turnId,
        threadId,
        callId: 'call_open',
        toolName: 'echo',
        arguments: { text: 'hi' }
      })
    )
    await turns.applyItem(
      threadId,
      makeToolResultItem({
        id: 'item_result_open',
        turnId,
        threadId,
        callId: 'call_open',
        toolName: 'echo',
        output: { partial: true },
        status: 'running'
      })
    )
    await turns.applyItem(
      threadId,
      makeApprovalItem({
        id: 'item_approval_open',
        turnId,
        threadId,
        approvalId: 'approval_open',
        toolName: 'echo',
        summary: 'Approve echo'
      })
    )
    await turns.applyItem(
      threadId,
      makeUserInputItem({
        id: 'item_input_open',
        turnId,
        threadId,
        inputId: 'input_open',
        prompt: 'Need input'
      })
    )

    if (finalStatus === 'aborted') {
      await turns.interruptTurn({ threadId, turnId })
    } else {
      await turns.finishTurn({ threadId, turnId, status: 'failed', error: 'boom' })
    }

    const latestById = new Map((await sessionStore.loadItems(threadId)).map((item) => [item.id, item]))
    expect(latestById.get('item_tool_open')?.status).toBe(expectedToolStatus)
    expect(latestById.get('item_result_open')?.status).toBe(expectedToolStatus)
    expect(latestById.get('item_approval_open')?.status).toBe('expired')
    expect(latestById.get('item_input_open')?.status).toBe('cancelled')
    expect(
      [...latestById.values()].some((item) =>
        item.turnId === turnId && (item.status === 'pending' || item.status === 'running')
      )
    ).toBe(false)

    const rawMessages = await readFile(join(dataDir, 'threads', threadId, 'messages.jsonl'), 'utf-8')
    const messageLines = rawMessages
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as TurnItem)
    expect(messageLines.filter((item) => item.id === 'item_tool_open').map((item) => item.status))
      .toEqual(['pending', expectedToolStatus])
    expect(messageLines.filter((item) => item.id === 'item_result_open').map((item) => item.status))
      .toEqual(['running', expectedToolStatus])
  })

  it('survives a malformed JSONL line', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await mkdir(join(dataDir, 'threads', 'thr_y'), { recursive: true })
    await appendFile(
      join(dataDir, 'threads', 'thr_y', 'events.jsonl'),
      '{"kind":"heartbeat","seq":1,"timestamp":"t","threadId":"thr_y"}\n',
      'utf-8'
    )
    const events = await sessionStore.loadEventsSince('thr_y', 0)
    expect(events).toHaveLength(1)
  })

  it('compacts usage events by retention window while preserving a carryover baseline', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      usageEventCompaction: {
        maxBytes: 1,
        retentionDays: 365,
        nowIso: () => '2026-06-03T00:00:00.000Z'
      }
    })
    const usage = (tokens: number) => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: tokens
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact'
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 2,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(2)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 3,
      timestamp: '2025-06-02T23:59:59.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(3)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 4,
      timestamp: '2025-06-04T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(4)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 5,
      timestamp: '2025-06-04T01:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(5)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 6,
      timestamp: '2025-06-04T02:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-reasoner',
      usage: usage(6)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 7,
      timestamp: '2026-06-02T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-reasoner',
      usage: usage(7)
    })

    const events = await sessionStore.loadEventsSince('thr_usage_compact', 0)
    expect(events.map((event) => event.seq)).toEqual([1, 3, 5, 6, 7])
    expect(await sessionStore.highestSeq('thr_usage_compact')).toBe(7)
  })
})
