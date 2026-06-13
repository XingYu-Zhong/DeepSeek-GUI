import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import {
  buildImageGenToolProviders,
  mapImageSize,
  MiniMaxImageClient,
  minimaxImageDimensionFields,
  openAiCompatImageUrl,
  type ImageGenClient
} from '../src/adapters/tool/image-gen-tool-provider.js'
import { FileAttachmentStore } from '../src/attachments/attachment-store.js'
import {
  buildRuntimeCapabilityManifest,
  KunCapabilitiesConfig
} from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

let workspace: string

function buildContext(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function imageGenConfig(overrides: Record<string, unknown> = {}) {
  return KunCapabilitiesConfig.parse({
    imageGen: {
      enabled: true,
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-test',
      model: 'test-image-model',
      ...overrides
    }
  }).imageGen
}

function fakeClient(image = png(1024, 576)): ImageGenClient & { generateCalls: unknown[]; editCalls: unknown[] } {
  const calls = { generateCalls: [] as unknown[], editCalls: [] as unknown[] }
  return {
    id: 'fake',
    ...calls,
    async generate(request) {
      calls.generateCalls.push(request)
      return { data: image, mimeType: 'image/png' }
    },
    async edit(request) {
      calls.editCalls.push(request)
      return { data: image, mimeType: 'image/png' }
    }
  }
}

function attachmentStore(rootDir: string, overrides: Record<string, unknown> = {}) {
  return new FileAttachmentStore({
    rootDir,
    config: KunCapabilitiesConfig.parse({ attachments: { enabled: true, ...overrides } }).attachments,
    nowIso: () => '2026-06-10T00:00:00.000Z'
  })
}

function hostFor(client: ImageGenClient, store?: FileAttachmentStore) {
  return new LocalToolHost({
    registry: new CapabilityRegistry(
      buildImageGenToolProviders(imageGenConfig(), {
        client,
        attachmentStore: store,
        nowIso: () => '2026-06-10T00:00:00.000Z'
      }).providers
    )
  })
}

describe('Image gen tool provider', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-imagegen-'))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(workspace, { recursive: true, force: true })
  })

  it('does not build providers when image generation is disabled', () => {
    const config = KunCapabilitiesConfig.parse({})
    const built = buildImageGenToolProviders(config.imageGen)
    expect(built.providers).toEqual([])
    expect(built.diagnostics).toEqual([])
    expect(built.available).toBe(false)
  })

  it('reports an unavailable provider without tools when configuration is incomplete', async () => {
    const config = KunCapabilitiesConfig.parse({
      imageGen: { enabled: true, baseUrl: 'https://images.example.test/v1', model: 'test-image-model' }
    })
    const built = buildImageGenToolProviders(config.imageGen)
    expect(built.available).toBe(false)
    expect(built.providers).toHaveLength(1)
    expect(built.providers[0]).toMatchObject({ id: 'imageGen', enabled: true, available: false })
    expect(built.providers[0].reason).toMatch(/missing apiKey/)
    expect(built.providers[0].tools).toHaveLength(0)
    expect(built.diagnostics[0]).toMatchObject({ enabled: true, available: false })
  })

  it('maps aspect ratio and size tier to provider sizes', () => {
    expect(mapImageSize(undefined, undefined, undefined)).toBeUndefined()
    expect(mapImageSize(undefined, undefined, '1536x1024')).toBe('1536x1024')
    expect(mapImageSize(undefined, undefined, 'auto')).toBe('auto')
    expect(mapImageSize('1:1', undefined, undefined)).toBe('1024x1024')
    expect(mapImageSize('1:1', '2K', undefined)).toBe('2048x2048')
    expect(mapImageSize('16:9', '1K', undefined)).toBe('1024x576')
    expect(mapImageSize('9:16', '2K', undefined)).toBe('1152x2048')
    expect(mapImageSize('21:9', '1K', undefined)).toBe('1024x448')
    expect(mapImageSize('3:2', '1K', undefined)).toBe('1024x704')
    // Unknown ratios fall back to a square at the requested tier.
    expect(mapImageSize('7:5', '2K', undefined)).toBe('2048x2048')
    expect(mapImageSize(undefined, '2K', undefined)).toBe('2048x2048')
  })

  it('keeps explicit width/height for MiniMax image-01 only', () => {
    expect(minimaxImageDimensionFields('image-01', '768x1024')).toEqual({ width: 768, height: 1024 })
    expect(minimaxImageDimensionFields(' image-01 ', '1024x576')).toEqual({ width: 1024, height: 576 })
  })

  it('maps sizes to the nearest aspect_ratio for other MiniMax models', () => {
    // image-01-live rejects width/height with status 2013.
    expect(minimaxImageDimensionFields('image-01-live', '768x1024')).toEqual({ aspect_ratio: '3:4' })
    expect(minimaxImageDimensionFields('image-01-live', '1024x1024')).toEqual({ aspect_ratio: '1:1' })
    expect(minimaxImageDimensionFields('image-01-live', '1024x576')).toEqual({ aspect_ratio: '16:9' })
    // mapImageSize rounds edges to multiples of 64, so snap to the nearest ratio.
    expect(minimaxImageDimensionFields('image-01-live', '1024x704')).toEqual({ aspect_ratio: '3:2' })
    expect(minimaxImageDimensionFields('image-01-live', '1152x2048')).toEqual({ aspect_ratio: '9:16' })
    // 21:9 is image-01 only; ultra-wide degrades to the closest supported ratio.
    expect(minimaxImageDimensionFields('image-01-live', '1024x448')).toEqual({ aspect_ratio: '16:9' })
  })

  it('omits MiniMax dimension fields for non-WxH sizes', () => {
    expect(minimaxImageDimensionFields('image-01-live', undefined)).toEqual({})
    expect(minimaxImageDimensionFields('image-01-live', 'auto')).toEqual({})
    expect(minimaxImageDimensionFields('image-01', '0x0')).toEqual({})
  })

  it('enables MiniMax prompt optimization for image requests', async () => {
    const requests: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body) })
      return new Response(JSON.stringify({
        data: { image_base64: [png(8, 8).toString('base64')] },
        base_resp: { status_code: 0 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const client = new MiniMaxImageClient('https://api.minimaxi.com', 'sk-test')

    await client.generate({
      prompt: 'short prompt',
      model: 'image-01',
      size: '1024x768',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(requests[0].url).toBe('https://api.minimaxi.com/v1/image_generation')
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: 'image-01',
      prompt: 'short prompt',
      width: 1024,
      height: 768,
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    })
  })

  it('inserts /v1 into unversioned OpenAI-compat image base urls like the chat client', () => {
    // ZenMux-style API root without a version segment.
    expect(openAiCompatImageUrl('https://zenmux.ai/api', 'generations'))
      .toBe('https://zenmux.ai/api/v1/images/generations')
    expect(openAiCompatImageUrl('https://zenmux.ai/api/', 'edits'))
      .toBe('https://zenmux.ai/api/v1/images/edits')
    expect(openAiCompatImageUrl('https://example.test', 'generations'))
      .toBe('https://example.test/v1/images/generations')
  })

  it('keeps versioned and fully-qualified OpenAI-compat image base urls', () => {
    expect(openAiCompatImageUrl('https://api.openai.com/v1', 'generations'))
      .toBe('https://api.openai.com/v1/images/generations')
    expect(openAiCompatImageUrl('https://ark.example.test/api/v3', 'edits'))
      .toBe('https://ark.example.test/api/v3/images/edits')
    expect(openAiCompatImageUrl('https://x.test/v1/images/generations', 'generations'))
      .toBe('https://x.test/v1/images/generations')
    // A fully-qualified generations URL still routes the edits call.
    expect(openAiCompatImageUrl('https://x.test/v1/images/generations', 'edits'))
      .toBe('https://x.test/v1/images/edits')
  })

  it('generates an image, saves it to the workspace, and scopes the attachment', async () => {
    const client = fakeClient()
    const store = attachmentStore(join(workspace, 'attachments'))
    const host = hostFor(client, store)

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['generate_image'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'a sunset over the sea', aspect_ratio: '16:9', image_size: '1K' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind !== 'tool_result') return
    const output = result.item.output as {
      files: Array<{ relativePath: string; absolutePath: string; mimeType: string; width: number; height: number }>
      attachments: Array<{ id: string; mimeType: string }>
      model: string
      size: string
      endpoint: string
      warnings: string[]
    }
    expect(output.endpoint).toBe('generations')
    expect(output.model).toBe('test-image-model')
    expect(output.size).toBe('1024x576')
    expect(output.warnings).toEqual([])
    expect(output.files[0]).toMatchObject({ mimeType: 'image/png', width: 1024, height: 576 })
    expect(output.files[0].relativePath.startsWith('.deepseekgui-images/')).toBe(true)
    expect(existsSync(output.files[0].absolutePath)).toBe(true)
    expect(JSON.stringify(output)).not.toMatch(/base64|b64_json/)
    expect(client.generateCalls[0]).toMatchObject({ prompt: 'a sunset over the sea', size: '1024x576' })

    expect(output.attachments).toHaveLength(1)
    const id = output.attachments[0].id
    await expect(store.resolveContent(id, { threadId: 'thr_1' })).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(store.resolveContent(id, { threadId: 'thr_other' })).rejects.toThrow(/not authorized/)
  })

  it('posts generations as JSON and decodes b64_json responses', async () => {
    const requests: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body) })
      return new Response(JSON.stringify({ data: [{ b64_json: png(8, 8).toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildImageGenToolProviders(imageGenConfig()).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'tiny square' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://images.example.test/v1/images/generations')
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: 'test-image-model',
      prompt: 'tiny square',
      n: 1,
      response_format: 'b64_json'
    })
  })

  it('downloads url responses and retries once without response_format when rejected', async () => {
    let posts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/images/generations')) {
        posts += 1
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (posts === 1) {
          expect(body.response_format).toBe('b64_json')
          return new Response(JSON.stringify({ error: { message: 'Unknown parameter: response_format' } }), { status: 400 })
        }
        expect(body.response_format).toBeUndefined()
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/img.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      expect(href).toBe('https://cdn.example.test/img.png')
      return new Response(new Uint8Array(png(8, 8)), { status: 200, headers: { 'content-type': 'image/png' } })
    }))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildImageGenToolProviders(imageGenConfig()).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'legacy provider' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(posts).toBe(2)
  })

  it('sends reference images as multipart form data to /images/edits', async () => {
    await writeFile(join(workspace, 'ref.png'), png(16, 16))
    await writeFile(join(workspace, 'ref2.png'), png(16, 16))
    const captured: Array<{ url: string; body: FormData }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.push({ url: String(url), body: init?.body as FormData })
      return new Response(JSON.stringify({ data: [{ b64_json: png(8, 8).toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildImageGenToolProviders(imageGenConfig()).providers)
    })

    const single = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'restyle', reference_image_paths: ['ref.png'] }
    }, buildContext())
    expect(single.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (single.item.kind === 'tool_result') {
      expect((single.item.output as { endpoint: string }).endpoint).toBe('edits')
    }
    expect(captured[0].url).toBe('https://images.example.test/v1/images/edits')
    expect(captured[0].body).toBeInstanceOf(FormData)
    expect(captured[0].body.get('prompt')).toBe('restyle')
    expect(captured[0].body.get('model')).toBe('test-image-model')
    expect(captured[0].body.get('image')).toBeInstanceOf(Blob)
    expect(captured[0].body.getAll('image[]')).toHaveLength(0)

    const multi = await host.execute({
      callId: 'call_2',
      toolName: 'generate_image',
      arguments: { prompt: 'restyle', reference_image_paths: ['ref.png', 'ref2.png'] }
    }, buildContext())
    expect(multi.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(captured[1].body.getAll('image[]')).toHaveLength(2)
  })

  it('rejects reference paths that escape the workspace or are not images', async () => {
    const client = fakeClient()
    const host = hostFor(client)

    for (const badPath of ['../outside.png', '/etc/hosts']) {
      const result = await host.execute({
        callId: 'call_1',
        toolName: 'generate_image',
        arguments: { prompt: 'escape', reference_image_paths: [badPath] }
      }, buildContext())
      expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
      if (result.item.kind === 'tool_result') {
        expect(result.item.output).toMatchObject({ error: { code: 'invalid_reference_path' } })
      }
    }

    const missing = await host.execute({
      callId: 'call_2',
      toolName: 'generate_image',
      arguments: { prompt: 'missing', reference_image_paths: ['nope.png'] }
    }, buildContext())
    expect(missing.item).toMatchObject({ kind: 'tool_result', isError: true })

    await writeFile(join(workspace, 'notes.txt'), 'plain text')
    const wrongType = await host.execute({
      callId: 'call_3',
      toolName: 'generate_image',
      arguments: { prompt: 'wrong type', reference_image_paths: ['notes.txt'] }
    }, buildContext())
    expect(wrongType.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (wrongType.item.kind === 'tool_result') {
      expect(wrongType.item.output).toMatchObject({
        error: { code: 'invalid_reference_path', message: expect.stringContaining('png, jpeg, or webp') }
      })
    }
    expect(client.editCalls).toHaveLength(0)
  })

  it('maps 404 from /images/edits to an actionable edits_unsupported error', async () => {
    await writeFile(join(workspace, 'ref.png'), png(16, 16))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildImageGenToolProviders(imageGenConfig()).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'restyle', reference_image_paths: ['ref.png'] }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: {
          code: 'edits_unsupported',
          message: expect.stringContaining('retry generate_image without reference_image_paths')
        }
      })
    }
  })

  it('keeps the full provider HTTP error body in image generation errors', async () => {
    const providerMessage = `Not supported model ${'mimo-v2.5-pro-ultraspeed'.repeat(40)}`
    const body = JSON.stringify({ error: { code: '400', message: providerMessage } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 400 })))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildImageGenToolProviders(imageGenConfig()).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'draw a poster' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { error: { message: string } }
      expect(output.error.message).toBe(`HTTP 400: ${body}`)
      expect(output.error.message).toContain(providerMessage)
    }
  })

  it('keeps the generated file and degrades to a warning when the attachment store rejects', async () => {
    const client = fakeClient()
    const store = attachmentStore(join(workspace, 'attachments'), { maxImageBytes: 16 })
    const host = hostFor(client, store)

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'too large for previews' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind !== 'tool_result') return
    const output = result.item.output as { files: Array<{ absolutePath: string }>; attachments: unknown[]; warnings: string[] }
    expect(output.files).toHaveLength(1)
    expect(existsSync(output.files[0].absolutePath)).toBe(true)
    expect(output.attachments).toEqual([])
    expect(output.warnings[0]).toMatch(/inline preview unavailable/)
  })

  it('reports image generation availability in the runtime capability manifest', () => {
    const config = KunCapabilitiesConfig.parse({
      imageGen: {
        enabled: true,
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-test',
        model: 'test-image-model'
      }
    })
    const built = buildImageGenToolProviders(config.imageGen, { client: fakeClient() })
    const manifest = buildRuntimeCapabilityManifest({
      config,
      model: modelCapabilitiesForModel('deepseek-chat'),
      imageGen: { available: built.available }
    })

    expect(manifest.imageGen.available).toBe(true)
    expect(manifest.imageGen.model).toBe('test-image-model')
  })
})

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer[4] = 0x0d
  buffer[5] = 0x0a
  buffer[6] = 0x1a
  buffer[7] = 0x0a
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}
