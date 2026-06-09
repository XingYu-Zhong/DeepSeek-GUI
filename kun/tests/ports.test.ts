import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemoryApprovalGate } from '../src/adapters/in-memory-approval-gate.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { LocalToolHost, defaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { createApprovalRequest } from '../src/domain/approval.js'
import { createThreadRecord } from '../src/domain/thread.js'

describe('InMemoryEventBus', () => {
  it('publishes and replays events per thread', () => {
    const bus = new InMemoryEventBus()
    bus.publish({ kind: 'heartbeat', seq: 1, timestamp: 't', threadId: 'a' })
    bus.publish({ kind: 'heartbeat', seq: 2, timestamp: 't', threadId: 'b' })
    expect(bus.snapshotSince('a', 0)).toHaveLength(1)
    expect(bus.highestSeq('a')).toBe(1)
  })

  it('delivers events to subscribers and unsubscribes cleanly', () => {
    const bus = new InMemoryEventBus()
    const received: number[] = []
    const unsubscribe = bus.subscribe('a', (event) => {
      received.push(event.seq)
    })
    bus.publish({ kind: 'heartbeat', seq: 1, timestamp: 't', threadId: 'a' })
    unsubscribe()
    bus.publish({ kind: 'heartbeat', seq: 2, timestamp: 't', threadId: 'a' })
    expect(received).toEqual([1])
  })
})

describe('InMemoryApprovalGate', () => {
  it('awaits a decision and resolves the gate', async () => {
    const gate = new InMemoryApprovalGate()
    const approval = createApprovalRequest({
      id: 'a',
      threadId: 't',
      turnId: 'tu',
      toolName: 'echo',
      summary: 's'
    })
    const pending = gate.request(approval)
    expect(gate.pending()).toHaveLength(1)
    expect(gate.decide('a', 'allow')).toBe(true)
    await expect(pending).resolves.toBe('allow')
    expect(gate.pending()).toHaveLength(0)
  })

  it('returns false when deciding an unknown approval', () => {
    const gate = new InMemoryApprovalGate()
    expect(gate.decide('missing', 'deny')).toBe(false)
  })

  it('filters pending by thread', () => {
    const gate = new InMemoryApprovalGate()
    gate.request(
      createApprovalRequest({ id: 'a', threadId: 'th1', turnId: 't', toolName: 'x', summary: 's' })
    )
    gate.request(
      createApprovalRequest({ id: 'b', threadId: 'th2', turnId: 't', toolName: 'x', summary: 's' })
    )
    expect(gate.pending('th1')).toHaveLength(1)
  })
})

describe('InMemoryThreadStore', () => {
  it('upserts and lists threads by updatedAt', async () => {
    const store = new InMemoryThreadStore()
    const a = createThreadRecord({ id: 'a', title: 'a', workspace: '/tmp', model: 'm' })
    const b = createThreadRecord({ id: 'b', title: 'b', workspace: '/tmp', model: 'm' })
    await store.upsert({ ...a, updatedAt: '2025-01-01T00:00:00.000Z' })
    await store.upsert({ ...b, updatedAt: '2025-02-01T00:00:00.000Z' })
    const list = await store.list()
    expect(list[0].id).toBe('b')
    expect(await store.get('a')).not.toBeNull()
  })

  it('deletes a thread', async () => {
    const store = new InMemoryThreadStore()
    await store.upsert(createThreadRecord({ id: 'a', title: 'a', workspace: '/tmp', model: 'm' }))
    expect(await store.delete('a')).toBe(true)
    expect(await store.get('a')).toBeNull()
  })
})

describe('InMemorySessionStore', () => {
  it('appends events and items without duplicates', async () => {
    const store = new InMemorySessionStore()
    await store.appendEvent('th', { kind: 'heartbeat', seq: 1, timestamp: 't', threadId: 'th' })
    await store.appendEvent('th', { kind: 'heartbeat', seq: 1, timestamp: 't', threadId: 'th' })
    expect(await store.loadEventsSince('th', 0)).toHaveLength(1)
    expect(await store.highestSeq('th')).toBe(1)
  })

  it('upserts and reads back a session', async () => {
    const store = new InMemorySessionStore()
    await store.upsertSession({
      threadId: 'th',
      turnId: 'tu',
      startedAt: 't',
      updatedAt: 't',
      items: [],
      events: [{ kind: 'heartbeat', seq: 1, timestamp: 't', threadId: 'th' }],
      closed: false
    })
    const session = await store.loadSession('th')
    expect(session?.events).toHaveLength(1)
  })
})

describe('LocalToolHost', () => {
  it('runs an auto tool without approval', async () => {
    const host = new LocalToolHost({ tools: defaultLocalTools })
    const result = await host.execute(
      { callId: 'c1', toolName: 'echo', arguments: { text: 'hi' } },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'on-request',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      }
    )
    expect(result.approved).toBe(true)
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.toolName).toBe('echo')
    }
  })

  it('blocks auto tools when the thread policy is never', async () => {
    const host = new LocalToolHost({ tools: defaultLocalTools })
    const result = await host.execute(
      { callId: 'c1', toolName: 'echo', arguments: { text: 'hi' } },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'never',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      }
    )
    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'echo',
      isError: true
    })
  })

  it('respects abort signals', async () => {
    const host = new LocalToolHost({ tools: defaultLocalTools })
    const controller = new AbortController()
    controller.abort()
    await expect(
      host.execute(
        { callId: 'c1', toolName: 'echo', arguments: { text: 'hi' } },
        {
          threadId: 'th',
          turnId: 'tu',
          workspace: '/tmp',
          approvalPolicy: 'on-request',
          abortSignal: controller.signal,
          awaitApproval: async () => 'allow'
        }
      )
    ).rejects.toThrow(/aborted/)
  })

  it('returns an error result for user_input when no GUI gate is available', async () => {
    const host = new LocalToolHost({ tools: defaultLocalTools })
    const result = await host.execute(
      { callId: 'c1', toolName: 'user_input', arguments: { prompt: '?' } },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'on-request',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      }
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'user_input',
      isError: true
    })
  })

  it('updates in-memory session items in place', async () => {
    const store = new InMemorySessionStore()
    await store.appendItem('th', {
      id: 'item_1',
      threadId: 'th',
      turnId: 'tu',
      role: 'tool',
      status: 'pending',
      createdAt: 't',
      kind: 'tool_result',
      toolName: 'echo',
      callId: 'c1',
      toolKind: 'tool_call',
      output: { partial: true },
      isError: false
    })
    const updated = await store.updateItem('th', 'item_1', {
      status: 'completed',
      output: { done: true }
    })
    expect(updated).toMatchObject({
      status: 'completed',
      output: { done: true }
    })
    const loaded = await store.loadItems('th')
    expect(loaded[0]).toMatchObject({
      status: 'completed',
      output: { done: true }
    })
  })

  it('replaces in-memory session items when appending the same id', async () => {
    const store = new InMemorySessionStore()
    await store.appendItem('th', {
      id: 'item_text',
      threadId: 'th',
      turnId: 'tu',
      role: 'assistant',
      status: 'running',
      createdAt: 't',
      kind: 'assistant_text',
      text: 'partial'
    })
    await store.appendItem('th', {
      id: 'item_text',
      threadId: 'th',
      turnId: 'tu',
      role: 'assistant',
      status: 'completed',
      createdAt: 't',
      finishedAt: 't2',
      kind: 'assistant_text',
      text: 'complete'
    })

    const loaded = await store.loadItems('th')
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      status: 'completed',
      text: 'complete'
    })
  })

  it('streams partial tool result updates when a tool emits onUpdate', async () => {
    const streamingTool = LocalToolHost.defineTool({
      name: 'streamer',
      description: 'stream',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: 'one' } })
        await onUpdate?.({ output: { partial: 'two' } })
        return { output: { done: true } }
      }
    })
    const host = new LocalToolHost({ tools: [streamingTool] })
    const updates: Array<Record<string, unknown>> = []
    const result = await host.execute(
      { callId: 'c_stream', toolName: 'streamer', arguments: {} },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'on-request',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      },
      async (item) => {
        if (item.kind === 'tool_result') {
          updates.push(item.output as Record<string, unknown>)
        }
      }
    )
    expect(updates).toEqual([{ partial: 'one' }, { partial: 'two' }])
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'streamer'
    })
  })

  it('lets hooks rewrite arguments and post-process tool output', async () => {
    const host = new LocalToolHost({
      tools: defaultLocalTools,
      hooks: [
        {
          phase: 'PreToolUse',
          toolNames: ['echo'],
          run: () => ({ arguments: { text: 'patched' } })
        },
        {
          phase: 'PostToolUse',
          toolNames: ['echo'],
          run: ({ result }) => ({ output: { wrapped: result?.output } })
        }
      ]
    })
    const result = await host.execute(
      { callId: 'c_hook', toolName: 'echo', arguments: { text: 'original' } },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'on-request',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      }
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      output: { wrapped: { echoed: 'patched' } }
    })
  })

  it('normalizes rate-limited tool outputs into structured errors', async () => {
    const limited = LocalToolHost.defineTool({
      name: 'limited',
      description: 'limited',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async () => ({ output: { message: 'rate limited, retry-after: 2s' } })
    })
    const host = new LocalToolHost({ tools: [limited] })
    const result = await host.execute(
      { callId: 'c_limited', toolName: 'limited', arguments: {} },
      {
        threadId: 'th',
        turnId: 'tu',
        workspace: '/tmp',
        approvalPolicy: 'on-request',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      }
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'rate_limited',
        rate_limited: true,
        retry_after_seconds: 2
      }
    })
  })

  it('enforces read-before-edit within the same turn', async () => {
    const read = LocalToolHost.defineTool({
      name: 'read',
      description: 'read',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      policy: 'auto',
      execute: async (args) => ({
        output: {
          path: args.path,
          relative_path: args.path,
          content: 'hello old text'
        }
      })
    })
    const edit = LocalToolHost.defineTool({
      name: 'edit',
      description: 'edit',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async () => ({ output: { edited: true } })
    })
    const host = new LocalToolHost({ tools: [read, edit], readTracker: true })
    const context = {
      threadId: 'th',
      turnId: 'tu',
      workspace: '/tmp',
      approvalPolicy: 'on-request' as const,
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const
    }
    const blocked = await host.execute(
      { callId: 'c_edit_1', toolName: 'edit', arguments: { path: 'a.txt', oldText: 'old text' } },
      context
    )
    expect(blocked.item).toMatchObject({
      kind: 'tool_result',
      isError: true
    })
    await host.execute(
      { callId: 'c_read', toolName: 'read', arguments: { path: 'a.txt' } },
      context
    )
    const allowed = await host.execute(
      { callId: 'c_edit_2', toolName: 'edit', arguments: { path: 'a.txt', oldText: 'old text' } },
      context
    )
    expect(allowed.item).toMatchObject({
      kind: 'tool_result',
      isError: false,
      output: { edited: true }
    })
  })
})
