import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildImageRecognitionToolProviders, buildRecognitionPrompt } from './image-recognition-tool-provider.js'

function context(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: process.cwd(),
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny'
  }
}

describe('image recognition tool provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose tools when disabled', () => {
    const built = buildImageRecognitionToolProviders({
      enabled: false,
      protocol: 'openai-chat-completions',
      timeoutMs: 120000,
      maxDownloadBytes: 1024,
      prompt: 'Describe image text.'
    })
    expect(built.providers).toEqual([])
    expect(built.available).toBe(false)
  })

  it('reports unavailable when required provider fields are missing', () => {
    const built = buildImageRecognitionToolProviders({
      enabled: true,
      protocol: 'openai-chat-completions',
      timeoutMs: 120000,
      maxDownloadBytes: 1024,
      prompt: 'Describe image text.'
    })
    expect(built.available).toBe(false)
    expect(built.providers[0]?.tools).toEqual([])
    expect(built.diagnostics[0]?.reason).toContain('missing baseUrl, apiKey, model')
  })

  it('exposes recognize_image and surfaces URL download failures as tool errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const built = buildImageRecognitionToolProviders({
      enabled: true,
      protocol: 'openai-chat-completions',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'sk-test',
      model: 'vision-test',
      prompt: 'Describe image text.',
      timeoutMs: 120000,
      maxDownloadBytes: 1024
    })
    expect(built.available).toBe(true)
    const tool = built.providers[0]?.tools[0]
    expect(tool?.name).toBe('recognize_image')
    expect(tool?.inputSchema.properties).toHaveProperty('prompt')
    expect(tool?.inputSchema.required).toEqual(['source'])
    const result = await tool!.execute({ source: 'https://images.example.test/missing.png' }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toEqual({ error: 'image download failed: HTTP 404' })
  })

  it('wraps tool-call prompt additions in an XML marker', () => {
    expect(buildRecognitionPrompt('Base prompt.', 'Focus on table headers.')).toBe([
      'Base prompt.',
      '',
      '<additional_instruction>',
      'Focus on table headers.',
      '</additional_instruction>'
    ].join('\n'))
    expect(buildRecognitionPrompt('Base prompt.', '  ')).toBe('Base prompt.')
  })
})
