import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import {
  buildTodoLocalTools,
  TODO_LIST_TOOL_NAME,
  TODO_WRITE_TOOL_NAME
} from '../src/adapters/tool/todo-tools.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { ThreadService } from '../src/services/thread-service.js'

function buildService(): {
  service: ThreadService
  sessionStore: InMemorySessionStore
} {
  const bus = new InMemoryEventBus()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const ids = new SequentialIdGenerator()
  let now = 1_700_000_000_000
  const nowIso = () => new Date((now += 1000)).toISOString()
  const events = new RuntimeEventRecorder({
    eventBus: bus,
    sessionStore,
    allocateSeq: (threadId) => bus.allocateSeq(threadId),
    nowIso
  })
  return {
    service: new ThreadService({ threadStore, sessionStore, events, ids, nowIso }),
    sessionStore
  }
}

function toolContext(threadId: string): ToolHostContext {
  return {
    threadId,
    turnId: 'turn_todo',
    workspace: '/tmp',
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('todo local tools', () => {
  it('advertises todo tools and replaces the thread todo list', async () => {
    const { service, sessionStore } = buildService()
    await service.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_todo', title: 'Todo thread' }
    )
    const host = new LocalToolHost({ tools: buildTodoLocalTools(service) })
    const names = (await host.listTools(toolContext('thr_todo'))).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([TODO_LIST_TOOL_NAME, TODO_WRITE_TOOL_NAME]))

    const write = await host.execute({
      callId: 'call_todo_write',
      toolName: TODO_WRITE_TOOL_NAME,
      arguments: {
        todos: [
          { content: 'Wire provider', status: 'completed' },
          { content: 'Build panel', status: 'in_progress' }
        ]
      }
    }, toolContext('thr_todo'))

    expect(write.item.kind).toBe('tool_result')
    if (write.item.kind !== 'tool_result') return
    expect(write.item.isError).toBeFalsy()
    expect(write.item.output).toMatchObject({
      todos: {
        threadId: 'thr_todo',
        items: [
          { content: 'Wire provider', status: 'completed' },
          { content: 'Build panel', status: 'in_progress' }
        ]
      }
    })

    const read = await host.execute({
      callId: 'call_todo_list',
      toolName: TODO_LIST_TOOL_NAME,
      arguments: {}
    }, toolContext('thr_todo'))
    expect(read.item.kind).toBe('tool_result')
    if (read.item.kind !== 'tool_result') return
    expect((read.item.output as { todos?: { items?: Array<{ content?: string }> } }).todos?.items?.[0]?.content)
      .toBe('Wire provider')
    const events = await sessionStore.loadEventsSince('thr_todo', 0)
    expect(events.some((event) => event.kind === 'todos_updated')).toBe(true)
  })

  it('normalizes duplicate in_progress items from model writes', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_todo_multi_active', title: 'Todo thread' }
    )
    const host = new LocalToolHost({ tools: buildTodoLocalTools(service) })

    const write = await host.execute({
      callId: 'call_todo_write_multi_active',
      toolName: TODO_WRITE_TOOL_NAME,
      arguments: {
        todos: [
          { content: 'First active', status: 'in_progress' },
          { content: 'Second active', status: 'in_progress' },
          { content: 'Done item', status: 'completed' }
        ]
      }
    }, toolContext('thr_todo_multi_active'))

    expect(write.item.kind).toBe('tool_result')
    if (write.item.kind !== 'tool_result') return
    expect(write.item.isError).toBeFalsy()
    expect(write.item.output).toMatchObject({
      todos: {
        items: [
          { content: 'First active', status: 'in_progress' },
          { content: 'Second active', status: 'pending' },
          { content: 'Done item', status: 'completed' }
        ]
      }
    })
  })
})
