import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileAttachmentStore } from '../src/attachments/attachment-store.js'
import { CompatModelClient } from '../src/adapters/model/compat-model-client.js'
import type { ImageRecognizer } from '../src/adapters/tool/image-recognition-tool-provider.js'
import {
  KunCapabilitiesConfig,
  type AttachmentsCapabilityConfig,
  type ModelCapabilityMetadata
} from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'
import type { ModelClient, ModelRequest } from '../src/ports/model-client.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Attachment store and multimodal input', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-attachments-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores images outside session logs, deduplicates by hash, and enforces scope', async () => {
    const store = createStore()
    const data = png(2, 3)
    const first = await store.create({
      name: 'shot.png',
      data,
      mimeType: 'image/png',
      localFilePath: '/tmp/picked/shot.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const second = await store.create({
      name: 'shot-again.png',
      data,
      threadId: 'thr_1'
    })

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      mimeType: 'image/png',
      width: 2,
      height: 3,
      byteSize: data.byteLength,
      localFilePath: '/tmp/picked/shot.png'
    })
    await expect(store.resolveContent(first.id, { threadId: 'thr_2' })).rejects.toThrow(/not authorized/)
    await expect(store.resolveContent(first.id, { workspace: '/tmp/ws' })).resolves.toMatchObject({ id: first.id })
  })

  it('repairs missing content when a duplicate attachment is uploaded again', async () => {
    const store = createStore()
    const data = png(2, 3)
    const first = await store.create({
      name: 'shot.png',
      data,
      threadId: 'thr_1'
    })
    await rm(join(dir, 'attachments', `${first.id}.bin`), { force: true })

    const second = await store.create({
      name: 'shot-again.png',
      data,
      threadId: 'thr_1'
    })

    expect(second.id).toBe(first.id)
    await expect(store.resolveContent(first.id, { threadId: 'thr_1' })).resolves.toMatchObject({
      id: first.id,
      data
    })
  })

  it('rejects unsupported MIME, size, and dimensions', async () => {
    await expect(createStore().create({
      name: 'bad.txt',
      data: Buffer.from('nope'),
      mimeType: 'text/plain'
    })).rejects.toThrow(/unsupported/)

    await expect(createStore({ maxImageBytes: 10 }).create({
      name: 'large.png',
      data: png(1, 1)
    })).rejects.toThrow(/byte limit/)

    await expect(createStore({ maxImageDimension: 4 }).create({
      name: 'huge.png',
      data: png(5, 1)
    })).rejects.toThrow(/dimension/)

    await expect(createStore({ textFallbackMaxBase64Bytes: 4 }).create({
      name: 'fallback-large.png',
      data: png(1, 1),
      textFallback: {
        dataBase64: 'abcdefgh',
        mimeType: 'image/png',
        byteSize: 6,
        width: 1,
        height: 1
      }
    })).rejects.toThrow(/fallback image exceeds/)
  })

  it('serves authenticated upload, metadata, content, and diagnostics routes', async () => {
    const h = buildHarness()
    h.runtime.attachmentStore = createStore()
    const upload = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/attachments', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'shot.png',
          mimeType: 'image/png',
          dataBase64: png(1, 1).toString('base64'),
          localFilePath: '/tmp/picked/shot.png',
          threadId: 'thr_1',
          textFallback: {
            dataBase64: 'abcd',
            mimeType: 'image/png',
            byteSize: 3,
            width: 1,
            height: 1,
            wasCompressed: false
          }
        })
      })
    )

    expect(upload.status).toBe(201)
    const uploaded = await readJson(upload) as { attachment: { id: string } }
    const metadata = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/attachments/${uploaded.attachment.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(metadata.status).toBe(200)
    expect(await readJson(metadata)).toMatchObject({
      attachment: {
        localFilePath: '/tmp/picked/shot.png',
        textFallback: {
          dataBase64: 'abcd',
          mimeType: 'image/png'
        }
      }
    })
    const content = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/attachments/${uploaded.attachment.id}/content?thread_id=thr_1`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(content.status).toBe(200)
    expect((await readJson(content)) as { dataBase64?: string }).toMatchObject({
      dataBase64: expect.any(String)
    })
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/attachments/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ enabled: true, count: 1 })
  })

  it('resolves image attachments for vision models and text fallbacks for text-only models', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/shot.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => visionCapabilities()
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'vision-model' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.attachments?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/png',
      dataBase64: expect.any(String)
    })

    const textOnly = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'] })
    })
    await bootstrapThread(textOnly, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })
    expect(await textOnly.loop.runTurn(textOnly.threadId, textOnly.turnId)).toBe('completed')
    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/png',
      dataBase64: expect.any(String),
      localFilePath: '/tmp/picked/shot.png',
      wasCompressed: false
    })
  })

  it('routes built-in DeepSeek v4 image attachments as text fallbacks', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/shot.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: modelCapabilitiesForModel
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'deepseek-v4-pro' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    const userItem = (await h.sessionStore.loadItems(h.threadId))
      .find((item) => item.kind === 'user_message')
    expect(userItem).toMatchObject({ attachmentIds: [attachment.id] })
    await expect(h.turns.getTurn(h.threadId, h.turnId)).resolves.toMatchObject({
      attachmentIds: [attachment.id]
    })
    expect(seenRequests.at(-1)?.attachments).toBeUndefined()
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/png',
      dataBase64: expect.any(String),
      localFilePath: '/tmp/picked/shot.png',
      wasCompressed: false
    })
    const preSend = (await h.sessionStore.loadEventsSince(h.threadId, 0))
      .find((event): event is Extract<typeof event, { kind: 'pipeline_stage' }> =>
        event.kind === 'pipeline_stage' && event.stage === 'pre_send'
      )
    expect(preSend?.details).toMatchObject({
      attachmentIds: [attachment.id],
      modelInputModalities: ['text'],
      modelMessageParts: ['text'],
      imageAttachmentCount: 0,
      imageAttachmentBase64Bytes: 0,
      textFallbackCount: 1,
      textFallbackBase64Bytes: png(1, 1).toString('base64').length,
      textFallbackMimeTypes: ['image/png']
    })
  })

  it('recognizes multiple images concurrently for eligible text-only fallback turns', async () => {
    const store = createStore()
    const first = await store.create({
      name: 'first.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/first.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const second = await store.create({
      name: 'second.png',
      data: png(2, 3),
      localFilePath: '/tmp/picked/second.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    let inFlight = 0
    let maxInFlight = 0
    const recognizer: ImageRecognizer = {
      async recognize(input) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight -= 1
        return {
          text: `recognized ${input.name}`,
          model: 'vision-fallback',
          mimeType: input.mimeType ?? 'image/png'
        }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      imageRecognizer: recognizer,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'], messageParts: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      threadCreatedAt: '2026-06-13T08:00:01.000Z',
      request: { prompt: 'look', attachmentIds: [first.id, second.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    expect(maxInFlight).toBe(2)
    expect(seenRequests).toHaveLength(1)
    expect(seenRequests[0]?.attachments).toBeUndefined()
    const fallbacks = seenRequests[0]?.attachmentTextFallbacks ?? []
    expect(fallbacks).toHaveLength(2)
    const decoded = fallbacks.map((fallback) =>
      Buffer.from(fallback.dataBase64, 'base64').toString('utf8')
    )
    expect(decoded[0]).toContain('already-completed image recognition result')
    expect(decoded[0]).toContain('Do not call recognize_image')
    expect(decoded[0]).toContain('Name: first.png')
    expect(decoded[0]).toContain('FilePath: /tmp/picked/first.png')
    expect(decoded[0]).toContain('MIME: image/png')
    expect(decoded[0]).toContain('Dimensions: 1x1')
    expect(decoded[0]).toContain('RecognizedText:\nrecognized first.png')
    expect(decoded[0]).not.toContain('RecognitionModel:')
    expect(decoded[0]).not.toContain('```base64')
    expect(decoded[1]).toContain('Name: second.png')
    expect(decoded[1]).toContain('Dimensions: 2x3')
    expect(decoded[1]).toContain('RecognizedText:\nrecognized second.png')
    const progressEvents = (await h.sessionStore.loadEventsSince(h.threadId, 0))
      .filter((event) => event.kind === 'image_recognition_progress')
    expect(progressEvents.map((event) => ({
      status: event.status,
      recognizedCount: event.recognizedCount,
      totalCount: event.totalCount
    }))).toEqual([
      { status: 'running', recognizedCount: 0, totalCount: 2 },
      { status: 'running', recognizedCount: 1, totalCount: 2 },
      { status: 'completed', recognizedCount: 2, totalCount: 2 }
    ])
  })

  it('recognizes the first image turn in an old empty thread when the turn is after image recognition was enabled', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'first-turn.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/first-turn.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const recognizer: ImageRecognizer = {
      async recognize(input) {
        return {
          text: `recognized ${input.name}`,
          model: 'vision-fallback',
          mimeType: input.mimeType ?? 'image/png'
        }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      imageRecognizer: recognizer,
      imageRecognitionEnabledAt: '2000-01-01T00:00:00.000Z',
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'], messageParts: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      threadCreatedAt: '1999-12-31T23:59:59.000Z',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    const decoded = Buffer.from(
      seenRequests.at(-1)?.attachmentTextFallbacks?.[0]?.dataBase64 ?? '',
      'base64'
    ).toString('utf8')
    expect(decoded).toContain('Name: first-turn.png')
    expect(decoded).toContain('RecognizedText:\nrecognized first-turn.png')
    expect(decoded).not.toContain('```base64')
  })

  it('does not recognize images for historical text-only fallback threads created before image recognition was enabled', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'old.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/old.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const recognizer: ImageRecognizer = {
      async recognize() {
        throw new Error('recognizer should not be called for old threads')
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      imageRecognizer: recognizer,
      imageRecognitionEnabledAt: '2000-01-01T00:00:00.000Z',
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'], messageParts: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      threadCreatedAt: '1999-12-31T23:59:59.000Z',
      initialItems: [{
        id: 'item_old_user',
        threadId: 'thr_1',
        turnId: 'turn_old',
        role: 'user',
        status: 'completed',
        createdAt: '1999-12-31T23:59:59.500Z',
        finishedAt: '1999-12-31T23:59:59.500Z',
        kind: 'user_message',
        text: 'old message'
      }],
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    expect(seenRequests.at(-1)?.attachmentTextFallbacks?.[0]).toMatchObject({
      id: attachment.id,
      mimeType: 'image/png',
      localFilePath: '/tmp/picked/old.png'
    })
  })

  it('recognizes later image turns when the first user message is after image recognition was enabled', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'later.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/later.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const recognizer: ImageRecognizer = {
      async recognize(input) {
        return {
          text: `recognized ${input.name}`,
          model: 'vision-fallback',
          mimeType: input.mimeType ?? 'image/png'
        }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      imageRecognizer: recognizer,
      imageRecognitionEnabledAt: '2000-01-01T00:00:00.000Z',
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'], messageParts: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      threadCreatedAt: '1999-12-31T23:59:59.000Z',
      initialItems: [{
        id: 'item_first_user',
        threadId: 'thr_1',
        turnId: 'turn_first',
        role: 'user',
        status: 'completed',
        createdAt: '2000-01-01T00:00:01.000Z',
        finishedAt: '2000-01-01T00:00:01.000Z',
        kind: 'user_message',
        text: 'first message after image recognition'
      }],
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    const decoded = Buffer.from(
      seenRequests.at(-1)?.attachmentTextFallbacks?.[0]?.dataBase64 ?? '',
      'base64'
    ).toString('utf8')
    expect(decoded).toContain('RecognizedText:\nrecognized later.png')
  })

  it('fails text-only fallback turns when image recognition fails before calling the chat model', async () => {
    const store = createStore()
    const attachment = await store.create({
      name: 'broken.png',
      data: png(1, 1),
      localFilePath: '/tmp/picked/broken.png',
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream() {
        throw new Error('chat model should not be called')
      }
    }
    const recognizer: ImageRecognizer = {
      async recognize() {
        throw new Error('vision model unavailable')
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      imageRecognizer: recognizer,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'], messageParts: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      threadCreatedAt: '2026-06-13T08:00:01.000Z',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('failed')
    await expect(h.turns.getTurn(h.threadId, h.turnId)).resolves.toMatchObject({
      error: expect.stringMatching(/vision model unavailable/)
    })
  })

  it('fails text-only image turns when no bounded text fallback is available', async () => {
    const store = createStore({ textFallbackMaxBase64Bytes: 8 })
    const attachment = await store.create({
      name: 'shot.png',
      data: png(1, 1),
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    })
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream() {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      attachmentStore: store,
      modelCapabilities: () => ({ ...visionCapabilities(), inputModalities: ['text'] })
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: 'look', attachmentIds: [attachment.id], model: 'text-only' }
    })

    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('failed')
    await expect(h.turns.getTurn(h.threadId, h.turnId)).resolves.toMatchObject({
      error: expect.stringMatching(/missing a compressed text fallback/)
    })
  })

  it('maps image attachments to DeepSeek-compatible message parts', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } | undefined
    const client = new CompatModelClient({
      baseUrl: 'https://model.example.test',
      apiKey: '',
      model: 'vision-model',
      nonStreaming: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          id: 'cmpl_1',
          model: 'vision-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    for await (const _chunk of client.stream({
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'vision-model',
      prefix: [],
      history: [{
        id: 'item_user',
        threadId: 'thr_1',
        turnId: 'turn_1',
        role: 'user',
        status: 'completed',
        createdAt: 'now',
        finishedAt: 'now',
        kind: 'user_message',
        text: 'describe'
      }],
      attachments: [{
        id: 'att_1',
        name: 'shot.png',
        mimeType: 'image/png',
        dataBase64: png(1, 1).toString('base64')
      }],
      tools: [],
      abortSignal: new AbortController().signal
    })) {
      // drain stream
    }

    expect(body?.messages?.[0]?.content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
    ])
  })

  it('maps text attachment fallbacks to structured DeepSeek-compatible user text', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } | undefined
    const client = new CompatModelClient({
      baseUrl: 'https://model.example.test',
      apiKey: '',
      model: 'text-model',
      nonStreaming: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          id: 'cmpl_1',
          model: 'text-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    for await (const _chunk of client.stream({
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'text-model',
      prefix: [],
      history: [{
        id: 'item_user',
        threadId: 'thr_1',
        turnId: 'turn_1',
        role: 'user',
        status: 'completed',
        createdAt: 'now',
        finishedAt: 'now',
        kind: 'user_message',
        text: 'describe'
      }],
      attachmentTextFallbacks: [{
        id: 'att_1',
        name: 'shot.png',
        mimeType: 'image/webp',
        dataBase64: 'YWJj',
        byteSize: 3,
        width: 1280,
        height: 720,
        localFilePath: '/tmp/picked/shot.png',
        wasCompressed: true
      }],
      tools: [],
      abortSignal: new AbortController().signal
    })) {
      // drain stream
    }

    expect(body?.messages?.[0]?.content).toContain('describe')
    expect(body?.messages?.[0]?.content).toContain('[Attached image as base64 text]')
    expect(body?.messages?.[0]?.content).toContain('FilePath: /tmp/picked/shot.png')
    expect(body?.messages?.[0]?.content).toContain('MIME: image/webp')
    expect(body?.messages?.[0]?.content).toContain('Dimensions: 1280x720')
    expect(body?.messages?.[0]?.content).toContain('```base64\nYWJj\n```')
  })

  function createStore(overrides: Partial<AttachmentsCapabilityConfig> = {}) {
    return new FileAttachmentStore({
      rootDir: join(dir, 'attachments'),
      config: attachmentConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
  }

  function attachmentConfig(overrides: Partial<AttachmentsCapabilityConfig> = {}) {
    return KunCapabilitiesConfig.parse({
      attachments: {
        enabled: true,
        ...overrides
      }
    }).attachments
  }
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

function visionCapabilities(): ModelCapabilityMetadata {
  return {
    id: 'vision-model',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 128_000,
    messageParts: ['text', 'image_url']
  }
}
