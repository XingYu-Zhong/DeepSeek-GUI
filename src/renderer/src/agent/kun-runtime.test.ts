import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { KunRuntimeProvider } from './kun-runtime'
import { getProvider, resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    backgroundImage: { dataUrl: '', opacity: 0.15, blur: 0 },
    guiUpdate: { channel: 'stable' }
  }
}

function installDsGui(overrides: Partial<Window['dsGui']>): void {
  vi.stubGlobal('window', {
    dsGui: {
      getSettings: vi.fn(async () => settings()),
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{}' })),
      startSse: vi.fn(async (_threadId: string, _sinceSeq: number, streamId?: string) => ({
        streamId: streamId ?? 'stream-1'
      })),
      stopSse: vi.fn(async () => true),
      onSseEvent: vi.fn(() => () => undefined),
      onSseEnd: vi.fn(() => () => undefined),
      onSseError: vi.fn(() => () => undefined),
      ...overrides
    }
  })
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider', () => {
  it('reports the kun id and Kun display name', () => {
    const provider = new KunRuntimeProvider()
    expect(provider.id).toBe('kun')
    expect(provider.displayName).toBe('Kun')
  })

  it('exposes the local HTTP/SSE capabilities', () => {
    const provider = new KunRuntimeProvider()
    const caps = provider.getCapabilities()
    expect(caps.stream).toBe(true)
    expect(caps.interrupt).toBe(true)
    expect(caps.approvals).toBe(true)
  })

  it('reports invalid runtime JSON responses with a stable error message', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: '{not-json'
      }))
    })
    const provider = new KunRuntimeProvider()

    await expect(provider.listThreads()).rejects.toThrow(
      'runtime returned an invalid thread list response'
    )
  })

  it('maps Kun thread items into chat blocks', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_1',
          title: 'Demo',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 9,
          turns: [
            {
              id: 'turn_1',
              threadId: 'thr_1',
              status: 'completed',
              prompt: 'hi',
              createdAt: 't0',
              items: [
                {
                  id: 'item_user',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't0',
                  kind: 'user_message',
                  text: 'hi'
                },
                {
                  id: 'item_answer',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'completed',
                  createdAt: 't1',
                  kind: 'assistant_text',
                  text: 'hello'
                }
              ]
            }
          ]
        })
      }))
    })
    const provider = new KunRuntimeProvider()
    const detail = await provider.getThreadDetail('thr_1')
    expect(detail.blocks.map((block) => block.kind)).toEqual(['user', 'assistant'])
    expect(detail.latestSeq).toBe(9)
    expect(detail.latestTurnId).toBe('turn_1')
    expect(detail.latestUserMessageId).toBe('item_user')
  })

  it('coalesces tool_call and tool_result pairs into one tool block on thread load', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_1',
          title: 'Demo',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 9,
          turns: [
            {
              id: 'turn_1',
              threadId: 'thr_1',
              status: 'completed',
              prompt: 'run echo',
              createdAt: 't0',
              items: [
                {
                  id: 'item_call',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'pending',
                  createdAt: 't0',
                  kind: 'tool_call',
                  toolName: 'echo',
                  callId: 'call_1',
                  arguments: { text: 'hi' }
                },
                {
                  id: 'item_result',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'completed',
                  createdAt: 't1',
                  kind: 'tool_result',
                  toolName: 'echo',
                  callId: 'call_1',
                  output: { echoed: 'hi' }
                }
              ]
            }
          ]
        })
      }))
    })
    const provider = new KunRuntimeProvider()
    const detail = await provider.getThreadDetail('thr_1')
    expect(detail.blocks).toHaveLength(1)
    expect(detail.blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_call_1',
      status: 'success'
    })
  })

  it('posts Kun turn requests and returns the deterministic user item id', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    const result = await provider.sendUserMessage('thr_1', 'hello')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({ prompt: 'hello' })
    )
    expect(result.userMessageItemId).toBe('item_user_real')
  })

  it('posts attachment ids with Kun turn requests when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_img', userMessageItemId: 'item_user_img' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'describe this', { attachmentIds: ['att_1'] })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({ prompt: 'describe this', attachmentIds: ['att_1'] })
    )
  })

  it('posts explicit reasoning effort with Kun turn requests', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_reason', userMessageItemId: 'item_user_reason' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'think harder', {
      model: 'auto',
      reasoningEffort: 'max'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({ prompt: 'think harder', model: 'auto', reasoningEffort: 'max' })
    )
  })

  it('posts GUI plan context with Kun plan turn requests', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_plan', userMessageItemId: 'item_user_plan' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'refine the plan', {
      mode: 'plan',
      displayText: 'Generate implementation plan',
      guiPlan: {
        operation: 'refine',
        workspaceRoot: '/workspace/deepseek-gui',
        relativePath: '.kunsdd/plan/auth.md',
        planId: '/workspace/deepseek-gui:.kunsdd/plan/auth.md',
        sourceRequest: 'Add auth',
        title: 'auth'
      }
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'refine the plan',
        displayText: 'Generate implementation plan',
        mode: 'plan',
        guiPlan: {
          operation: 'refine',
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/auth.md',
          planId: '/workspace/deepseek-gui:.kunsdd/plan/auth.md',
          sourceRequest: 'Add auth',
          title: 'auth'
        }
      })
    )
  })

  it('posts interrupt requests with the discard option when requested', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: '{}'
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.interruptTurn('thr_1', 'turn_1', { discard: true })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns/turn_1/interrupt',
      'POST',
      JSON.stringify({ discard: true })
    )
  })

  it('loads runtime diagnostics and uploads image attachments through Kun endpoints', async () => {
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path === '/v1/runtime/info') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            host: '127.0.0.1',
            port: 17878,
            dataDir: '/tmp/kun',
            startedAt: '2024-01-01T00:00:00.000Z',
            capabilities: {
              contractVersion: 1,
              model: {
                id: 'deepseek-chat',
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                supportsToolCalling: true,
                messageParts: ['text', 'image_url']
              },
              cli: {
                serve: { status: 'available', enabled: true, available: true },
                run: { status: 'available', enabled: true, available: true },
                chat: { status: 'available', enabled: true, available: true },
                exec: { status: 'available', enabled: true, available: true }
              },
              mcp: { status: 'disabled', enabled: false, available: false, configuredServers: 0, connectedServers: 0, toolCount: 0 },
              web: {
                status: 'available',
                enabled: true,
                available: true,
                fetch: { status: 'available', enabled: true, available: true },
                search: { status: 'disabled', enabled: false, available: false }
              },
              skills: { status: 'disabled', enabled: false, available: false, configuredRoots: 0, discoveredSkills: 0 },
              subagents: { status: 'disabled', enabled: false, available: false, maxParallel: 0, maxChildRuns: 0 },
              attachments: {
                status: 'available',
                enabled: true,
                available: true,
                maxImageBytes: 5242880,
                maxImageDimension: 4096,
                allowedMimeTypes: ['image/png'],
                textFallbackMaxBase64Bytes: 524288,
                textFallbackMaxImageDimension: 1280,
                textFallbackPreferredMimeType: 'image/webp'
              },
              memory: { status: 'disabled', enabled: false, available: false, scopes: ['user'], maxInjectedRecords: 8 }
            }
          })
        }
      }
      if (path === '/v1/runtime/tools') {
        return { ok: true, status: 200, body: JSON.stringify({ providers: [{ id: 'web' }] }) }
      }
      if (path === '/v1/skills') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            skills: [{
              id: 'review',
              name: 'Review',
              description: 'Review changes'
            }]
          })
        }
      }
      if (path === '/v1/attachments') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            attachment: {
              id: 'att_1',
              name: 'shot.png',
              mimeType: 'image/png',
              byteSize: 3,
              hash: 'hash',
              createdAt: 't0',
              updatedAt: 't0'
            }
          })
        }
      }
      if (path === '/v1/attachments/att_1/content?thread_id=thr_1') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            attachment: {
              id: 'att_1',
              name: 'shot.png',
              mimeType: 'image/png',
              byteSize: 3,
              hash: 'hash',
              createdAt: 't0',
              updatedAt: 't0'
            },
            dataBase64: 'abc'
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.getRuntimeInfo()).resolves.toMatchObject({
      capabilities: { attachments: { available: true } }
    })
    await expect(provider.getToolDiagnostics()).resolves.toMatchObject({
      providers: [{ id: 'web' }]
    })
    await expect(provider.listSkills()).resolves.toEqual([
      expect.objectContaining({
        id: 'review',
        name: 'Review',
        description: 'Review changes'
      })
    ])
    await expect(provider.uploadAttachment({
      name: 'shot.png',
      mimeType: 'image/png',
      dataBase64: 'abc',
      textFallback: {
        dataBase64: 'xyz',
        mimeType: 'image/webp',
        byteSize: 2,
        width: 1,
        height: 1,
        wasCompressed: true
      },
      threadId: 'thr_1'
    })).resolves.toMatchObject({ id: 'att_1', name: 'shot.png' })
    await expect(provider.getAttachmentContent('att_1', { threadId: 'thr_1' })).resolves.toMatchObject({
      attachment: { id: 'att_1', mimeType: 'image/png' },
      dataBase64: 'abc'
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/attachments',
      'POST',
      JSON.stringify({
        name: 'shot.png',
        mimeType: 'image/png',
        dataBase64: 'abc',
        textFallback: {
          dataBase64: 'xyz',
          mimeType: 'image/webp',
          byteSize: 2,
          width: 1,
          height: 1,
          wasCompressed: true
        },
        threadId: 'thr_1'
      })
    )
  })

  it('lists, disables, and deletes memory records through Kun endpoints', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/memory?workspace=%2Ftmp%2Fworkspace&include_deleted=false') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memories: [{
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              workspace: '/tmp/workspace',
              tags: ['tooling'],
              confidence: 0.9,
              createdAt: 't0',
              updatedAt: 't0'
            }]
          })
        }
      }
      if (path === '/v1/memory/mem_1' && method === 'PATCH') {
        expect(body).toBe(JSON.stringify({ disabled: true }))
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memory: {
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              disabledAt: 't1',
              createdAt: 't0',
              updatedAt: 't1'
            }
          })
        }
      }
      if (path === '/v1/memory/mem_1' && method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memory: {
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              deletedAt: 't2',
              createdAt: 't0',
              updatedAt: 't2'
            }
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.listMemories({ workspace: '/tmp/workspace', includeDeleted: false })).resolves.toHaveLength(1)
    await expect(provider.updateMemory('mem_1', { disabled: true })).resolves.toMatchObject({
      id: 'mem_1',
      disabledAt: 't1'
    })
    await expect(provider.deleteMemory('mem_1')).resolves.toMatchObject({
      id: 'mem_1',
      deletedAt: 't2'
    })
  })

  it('calls Kun fork and user-input compatibility endpoints', async () => {
    const runtimeRequest = vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      body: path.includes('/fork')
        ? JSON.stringify({
            id: 'thr_fork',
            title: 'Forked',
            workspace: '/tmp/workspace',
            model: 'deepseek-chat',
            mode: 'agent',
            status: 'idle',
            forkedFromThreadId: 'thr_parent',
            createdAt: 't0',
            updatedAt: 't1'
          })
        : '{}'
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    const forked = await provider.forkThread('thr_parent')
    await provider.submitUserInputResponse('input_1', [{ id: 'choice', label: 'Yes', value: 'yes' }])
    await provider.cancelUserInput('input_2')

    expect(forked).toMatchObject({ id: 'thr_fork', forkedFromThreadId: 'thr_parent' })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/threads/thr_parent/fork', 'POST')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/user-inputs/input_1',
      'POST',
      JSON.stringify({ answers: [{ id: 'choice', label: 'Yes', value: 'yes' }] })
    )
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/user-inputs/input_2',
      'POST',
      JSON.stringify({ cancelled: true })
    )
  })

  it('resumes a session through the Kun HTTP runtime', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 201,
      body: JSON.stringify({ thread_id: 'thr_resumed', session_id: 'sess_1' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    const result = await provider.resumeSession('sess_1', { mode: 'plan' })

    expect(result).toEqual({ threadId: 'thr_resumed', sessionId: 'sess_1' })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/sessions/sess_1/resume-thread',
      'POST',
      JSON.stringify({
        workspace: '/tmp/workspace',
        model: defaultKunRuntimeSettings().model,
        mode: 'plan'
      })
    )
  })

  it('maps Kun SSE deltas into the thread event sink', async () => {
    let onData: ((payload: { streamId: string; data: unknown }) => void) | null = null
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(() => ac.abort()),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            data: {
              kind: 'assistant_text_delta',
              seq: 3,
              item: {
                id: 'item_text',
                turnId: 'turn_1',
                threadId: 'thr_1',
                role: 'assistant',
                status: 'running',
                createdAt: 't1',
                kind: 'assistant_text',
                text: 'he'
              }
            }
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 2, sink, ac.signal)
    expect(sink.onSeq).toHaveBeenCalledWith(3)
    expect(sink.onDeltas).toHaveBeenCalledWith([{ text: 'he', kind: 'agent_message', seq: 3 }])
  })

  it('auto-approves approval requests when policy is auto', async () => {
    let onData: ((payload: { streamId: string; data: unknown }) => void) | null = null
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(() => ac.abort()),
      onError: vi.fn()
    }
    const autoSettings: AppSettingsV1 = {
      ...settings(),
      agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: 'auto' } }
    }
    installDsGui({
      getSettings: vi.fn(async () => autoSettings),
      runtimeRequest,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            data: { kind: 'approval_requested', seq: 4, approvalId: 'appr_auto', summary: 'Need approval' }
          })
          onData?.({
            streamId: streamId ?? 'stream-1',
            data: { kind: 'turn_completed', seq: 5 }
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/approvals/appr_auto',
      'POST',
      JSON.stringify({ decision: 'allow' })
    )
    expect(sink.onApproval).not.toHaveBeenCalled()
  })

  it('renders approval cards for suggest and untrusted policies', async () => {
    for (const policy of ['suggest', 'untrusted'] as const) {
      let onData: ((payload: { streamId: string; data: unknown }) => void) | null = null
      const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
      const ac = new AbortController()
      const sink: ThreadEventSink = {
        onSeq: vi.fn(),
        onDeltas: vi.fn(),
        onUserMessage: vi.fn(),
        onTool: vi.fn(),
        onCompaction: vi.fn(),
        onApproval: vi.fn(),
        onUserInput: vi.fn(),
        onUserInputStatus: vi.fn(),
        onGoal: vi.fn(),
        onTodos: vi.fn(),
        onTurnComplete: vi.fn(() => ac.abort()),
        onError: vi.fn()
      }
      const policySettings: AppSettingsV1 = {
        ...settings(),
        agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: policy } }
      }
      installDsGui({
        getSettings: vi.fn(async () => policySettings),
        runtimeRequest,
        onSseEvent: vi.fn((handler) => {
          onData = handler
          return () => undefined
        }),
        startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
          queueMicrotask(() => {
            onData?.({
              streamId: streamId ?? 'stream-1',
              data: {
                kind: 'approval_requested',
                seq: 6,
                approvalId: `appr_${policy}`,
                summary: `${policy} approval`
              }
            })
            onData?.({
              streamId: streamId ?? 'stream-1',
              data: { kind: 'turn_completed', seq: 7 }
            })
          })
          return { streamId: streamId ?? 'stream-1' }
        })
      })
      const provider = new KunRuntimeProvider()
      await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
      expect(sink.onApproval).toHaveBeenCalledWith({
        approvalId: `appr_${policy}`,
        summary: `${policy} approval`,
        toolName: undefined
      })
      expect(runtimeRequest).not.toHaveBeenCalledWith(
        `/v1/approvals/appr_${policy}`,
        'POST',
        expect.any(String)
      )
    }
  })
})

describe('registry', () => {
  it('returns a cached provider for the kun id', () => {
    resetProviderCacheForTests()
    const first = getProvider()
    const second = getProvider()
    expect(first).toBe(second)
  })

})
