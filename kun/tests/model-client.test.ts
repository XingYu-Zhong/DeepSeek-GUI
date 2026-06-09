import { describe, expect, it } from 'vitest'
import { DeepseekCompatModelClient } from '../src/adapters/model/deepseek-compat-model-client.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeCompactionItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../src/domain/item.js'
import type { ModelRequest } from '../src/ports/model-client.js'

function buildRequest(abortSignal: AbortSignal): ModelRequest {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    model: 'deepseek-chat',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [
      {
        name: 'echo',
        description: 'Echo a string back to the model.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }
      }
    ],
    abortSignal
  }
}

describe('DeepseekCompatModelClient', () => {
  it('uses request.model over client default model', async () => {
    const response = {
      id: 'r2',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'done'
          }
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }
    const sentBodies: Array<{ model?: string }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.model).toBe('deepseek-v4-pro')
  })

  it('sends per-request router controls when requested', async () => {
    const response = {
      id: 'router',
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '{"model":"deepseek-v4-pro","thinking":"max"}'
          }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const sentAccept: string[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      sentAccept.push(String((init?.headers as Record<string, string>).Accept ?? ''))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-flash'
    request.tools = []
    request.stream = false
    request.maxTokens = 96
    request.temperature = 0
    request.responseFormat = 'json_object'
    request.reasoningEffort = 'off'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentAccept[0]).toBe('application/json')
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      max_tokens: 96,
      temperature: 0,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    })
  })

  it('keeps requiredToolName as loop metadata instead of sending provider tool_choice', async () => {
    const response = {
      id: 'required-tool-metadata',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.requiredToolName = 'echo'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]).toHaveProperty('tools')
    expect(sentBodies[0]).not.toHaveProperty('tool_choice')
  })

  it('passes the request abort signal to fetch', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const fetchImpl: typeof fetch = async (_url, init) => {
      seenSignal = init?.signal as AbortSignal | undefined
      return new Response(JSON.stringify({
        id: 'signal',
        model: 'deepseek-chat',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    for await (const _chunk of client.stream(buildRequest(controller.signal))) {
      // drain
    }
    expect(seenSignal).toBe(controller.signal)
  })

  it('strips DeepSeek thinking payload for Azure OpenAI-compatible endpoints', async () => {
    const response = {
      id: 'azure',
      model: 'gpt-4.1',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.openai.azure.com/openai/deployments/demo',
      apiKey: 'k',
      model: 'gpt-4.1',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'gpt-4.1'
    request.reasoningEffort = 'high'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.reasoning_effort).toBe('high')
    expect(sentBodies[0]).not.toHaveProperty('thinking')
  })

  it('parses a non-streaming JSON response into chunks', async () => {
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: 'I will run the tool.',
            reasoning_content: 'I should call echo.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'echo',
                  arguments: JSON.stringify({ text: 'hi' })
                }
              }
            ]
          }
        }
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
        total_tokens: 60,
        prompt_tokens_details: { cached_tokens: 30 }
      }
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const textChunk = chunks.find((c) => c.kind === 'assistant_text_delta')
    const reasoningChunk = chunks.find((c) => c.kind === 'assistant_reasoning_delta')
    const callChunk = chunks.find((c) => c.kind === 'tool_call_complete')
    const usageChunk = chunks.find((c) => c.kind === 'usage')
    const completionChunk = chunks.find((c) => c.kind === 'completed')
    expect(textChunk && textChunk.kind === 'assistant_text_delta' ? textChunk.text : '').toBe(
      'I will run the tool.'
    )
    expect(
      reasoningChunk && reasoningChunk.kind === 'assistant_reasoning_delta' ? reasoningChunk.text : ''
    ).toBe('I should call echo.')
    expect(
      callChunk && callChunk.kind === 'tool_call_complete' ? callChunk.arguments : {}
    ).toEqual({ text: 'hi' })
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitTokens : 0).toBe(30)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costUsd : 0).toBeGreaterThan(0)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costCny : 0).toBeGreaterThan(0)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheSavingsUsd : 0).toBeGreaterThan(0)
    expect(
      completionChunk && completionChunk.kind === 'completed' ? completionChunk.stopReason : ''
    ).toBe('tool_calls')
  })

  it('repairs fenced non-streaming tool arguments', async () => {
    const response = {
      id: 'repair',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_repair',
                type: 'function',
                function: {
                  name: 'echo',
                  arguments: '```json\n{"text":"repaired"}\n```'
                }
              }
            ]
          }
        }
      ]
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const callChunk = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(callChunk && callChunk.kind === 'tool_call_complete' ? callChunk.arguments : {})
      .toEqual({ text: 'repaired' })
  })

  it('prefers DeepSeek native prompt cache hit and miss counters', async () => {
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_cache_hit_tokens: 930,
        prompt_cache_miss_tokens: 70,
        prompt_tokens_details: { cached_tokens: 123 }
      }
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find((c) => c.kind === 'usage')
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitTokens : 0).toBe(930)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheMissTokens : 0).toBe(70)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitRate : 0).toBeCloseTo(0.93)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costUsd : 0).toBeCloseTo(0.000015204)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costCny : 0).toBeCloseTo(0.0001086)
  })

  it('sends tools in a canonical order for a stable cache prefix', async () => {
    const sentBodies: Array<{ tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.tools = [
      { name: 'zeta', description: 'z', inputSchema: { required: ['b'], properties: { b: { type: 'string' }, a: { type: 'number' } }, type: 'object' } },
      { name: 'alpha', description: 'a', inputSchema: { type: 'object', properties: { z: { type: 'string' }, a: { type: 'string' } } } }
    ]
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const sentBody = sentBodies[0]
    expect(sentBody?.tools?.map((tool) => tool.function?.name)).toEqual(['alpha', 'zeta'])
    expect(Object.keys((sentBody?.tools?.[1]?.function?.parameters as { properties?: Record<string, unknown> }).properties ?? {})).toEqual(['a', 'b'])
  })

  it('heals incomplete tool-call pairs before sending history upstream', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolResultItem({
        id: 'orphan_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_orphan',
        toolName: 'echo',
        output: 'orphan'
      }),
      makeToolCallItem({
        id: 'missing_result_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_missing',
        toolName: 'echo',
        arguments: { text: 'missing' }
      }),
      makeUserItem({ id: 'user_after_missing', turnId: 'turn_1', threadId: 'thr_1', text: 'continue' }),
      makeToolCallItem({
        id: 'valid_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_ok',
        toolName: 'echo',
        arguments: { text: 'ok' }
      }),
      makeToolResultItem({
        id: 'valid_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_ok',
        toolName: 'echo',
        output: 'ok'
      })
    ]
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages.some((message) => message.tool_call_id === 'call_orphan')).toBe(false)
    expect(JSON.stringify(messages)).not.toContain('call_missing')
    expect(messages.some((message) => message.role === 'user' && message.content === 'continue')).toBe(true)
    expect(
      messages.some((message) =>
        Array.isArray(message.tool_calls) &&
        message.tool_calls.some((call: { id?: string }) => call.id === 'call_ok')
      )
    ).toBe(true)
    expect(messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_ok')).toBe(true)
  })

  it('groups completed multi-tool blocks into one assistant tool_calls message', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolCallItem({
        id: 'call_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        arguments: { text: 'b' }
      }),
      makeAssistantTextItem({
        id: 'assistant_bridge',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will run both checks.',
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      }),
      makeToolResultItem({
        id: 'result_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        output: 'b'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))
    const toolMessages = messages.filter((message) => message.role === 'tool')

    expect(assistantToolMessage).toMatchObject({
      role: 'assistant',
      content: 'I will run both checks.'
    })
    expect((assistantToolMessage?.tool_calls as Array<{ id?: string }> | undefined)?.map((call) => call.id))
      .toEqual(['call_a', 'call_b'])
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_a', 'call_b'])
  })

  it('preserves thinking reasoning_content for completed tool-call blocks', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolCallItem({
        id: 'call_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        arguments: { text: 'b' }
      }),
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_bridge',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I need to inspect the current changes before writing the commit message.',
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      }),
      makeToolResultItem({
        id: 'result_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        output: 'b'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))

    expect(assistantToolMessage?.reasoning_content).toBe(
      'I need to inspect the current changes before writing the commit message.'
    )
    expect(assistantToolMessage?.content).toBe('')
    expect((assistantToolMessage?.tool_calls as Array<{ id?: string }> | undefined)?.map((call) => call.id))
      .toEqual(['call_a', 'call_b'])
    expect(messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id))
      .toEqual(['call_a', 'call_b'])
  })

  it('uses a single space for empty thinking reasoning_content', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantTextMessage = messages.find((message) => message.role === 'assistant' && message.content === 'Done.')
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))

    expect(assistantTextMessage?.reasoning_content).toBe(' ')
    expect(assistantToolMessage?.reasoning_content).toBe(' ')
    expect(assistantToolMessage?.content).toBe('')
  })

  it('treats fixed DeepSeek v4 models as thinking producers', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; thinking?: unknown; reasoning_effort?: unknown }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = sentBodies[0]
    const assistantMessage = body?.messages?.find((message) => message.role === 'assistant')

    expect(body?.thinking).toEqual({ type: 'enabled' })
    expect(body?.reasoning_effort).toBeUndefined()
    expect(assistantMessage?.reasoning_content).toBe(' ')
  })

  it('preserves thinking reasoning_content that appears before tool calls', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I should inspect git status before answering.',
        status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'assistant_text_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will inspect the changes.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantToolMessage = sentBodies[0]?.messages?.find((message) => Array.isArray(message.tool_calls))
    const assistantMessages = sentBodies[0]?.messages?.filter((message) => message.role === 'assistant') ?? []

    expect(assistantMessages).toHaveLength(1)
    expect(assistantToolMessage?.content).toBe('I will inspect the changes.')
    expect(assistantToolMessage?.reasoning_content).toBe('I should inspect git status before answering.')
  })

  it('serializes undefined tool outputs as empty string content', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: undefined
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const toolMessage = sentBodies[0]?.messages?.find((message) => message.role === 'tool')

    expect(toolMessage?.content).toBe('')
  })

  it('sends compaction summaries as mutable system messages', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'User wants the login feature finished. Keep the auth files in scope.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'user_after_compact', turnId: 'turn_2', threadId: 'thr_1', text: 'continue' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages[0]).toMatchObject({ role: 'system', content: 'You are a helpful assistant.' })
    expect(messages[1]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('User wants the login feature finished')
    })
    expect(messages[2]).toMatchObject({ role: 'user', content: 'continue' })
  })

  it('preserves the latest compaction summary when applying history limits', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true,
      historyLimit: 2
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'Keep original requirement beta.',
        replacedTokens: 50,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'old_1', turnId: 'turn_2', threadId: 'thr_1', text: 'old detail one' }),
      makeUserItem({ id: 'old_2', turnId: 'turn_3', threadId: 'thr_1', text: 'old detail two' }),
      makeUserItem({ id: 'latest', turnId: 'turn_4', threadId: 'thr_1', text: 'latest question' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(JSON.stringify(messages)).toContain('Keep original requirement beta')
    expect(JSON.stringify(messages)).not.toContain('old detail two')
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: 'latest question' })
  })

  it('reports an error when the HTTP response is not OK', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('upstream failure', { status: 500 })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    expect(chunks[0].kind).toBe('error')
  })

  it('parses streamed SSE events with tool call deltas', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hi\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(text).toBe('Hello world')
    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.callId : '').toBe('call_1')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.arguments : {}).toEqual({ text: 'hi' })
    expect(chunks.find((c) => c.kind === 'usage')).toBeDefined()
  })

  it('merges streamed tool-call deltas by index when the provider id arrives later', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_provider","function":{"arguments":"\\"late-id\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.callId : '').toBe('call_provider')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.arguments : {}).toEqual({ text: 'late-id' })
  })

  it('fails a streamed response that goes idle without DONE', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      streamIdleTimeoutMs: 5
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(chunks.find((chunk) => chunk.kind === 'assistant_text_delta')).toMatchObject({
      text: 'partial'
    })
    expect(chunks.find((chunk) => chunk.kind === 'error')).toMatchObject({
      code: 'stream_idle_timeout'
    })
    expect(chunks.find((chunk) => chunk.kind === 'completed')).toBeUndefined()
  })
})
