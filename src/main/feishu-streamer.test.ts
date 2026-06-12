import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LarkChannel, MarkdownStreamController, NormalizedMessage, SendOptions, SendResult } from '@larksuiteoapi/node-sdk'
import { FeishuStreamer } from './feishu-streamer'

type StreamInput = { markdown: (controller: MarkdownStreamController) => Promise<void> }

function makeBridge(): {
  bridge: LarkChannel
  calls: { args: unknown[] }[]
  controller: MarkdownStreamController
  messageId: string
} {
  const calls: { args: unknown[] }[] = []
  const messageId = 'om_stream_1'
  const controller: MarkdownStreamController = {
    append: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    get messageId() { return messageId }
  }
  const bridge = {
    stream: vi.fn(async (_to: string, input: StreamInput, _opts: SendOptions): Promise<SendResult> => {
      calls.push({ args: [_to, input, _opts] })
      await input.markdown(controller)
      return { messageId }
    })
  } as unknown as LarkChannel
  return { bridge, calls, controller, messageId }
}

function makeSubscriber(events: Array<Record<string, unknown>>, onEvent: (event: Record<string, unknown>) => void): {
  subscribe: (signal: AbortSignal) => { close: () => void }
  delivered: () => Array<Record<string, unknown>>
} {
  const delivered: Array<Record<string, unknown>> = []
  let closed = false
  const subscribe = (signal: AbortSignal) => {
    const onAbort = () => { closed = true }
    signal.addEventListener('abort', onAbort, { once: true })
    queueMicrotask(() => {
      for (const event of events) {
        if (closed) return
        delivered.push(event)
        onEvent(event)
      }
    })
    return { close: () => { closed = true } }
  }
  return { subscribe, delivered: () => delivered }
}

describe('FeishuStreamer', () => {
  it('streams assistant_text_delta in order, calls setContent once on turn_completed, resolves with messageId', async () => {
    const { bridge, controller } = makeBridge()
    const streamer = new FeishuStreamer({
      bridge,
      chatId: 'oc_chat_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      replyOptions: { replyTo: 'om_in_1' },
      logger: vi.fn()
    })
    const sub = makeSubscriber(
      [
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '你' } },
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '好' } },
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '!' } },
        { kind: 'turn_completed', turnId: 'turn_1' }
      ],
      (event) => streamer.onSseEvent(event)
    )

    const result = await streamer.start({ subscribe: sub.subscribe })

    expect(controller.append).toHaveBeenCalledTimes(3)
    expect(controller.append).toHaveBeenNthCalledWith(1, '你')
    expect(controller.append).toHaveBeenNthCalledWith(2, '好')
    expect(controller.append).toHaveBeenNthCalledWith(3, '!')
    expect(controller.setContent).toHaveBeenCalledTimes(1)
    expect(controller.setContent).toHaveBeenCalledWith('你好!')
    expect(result).toEqual({ ok: true, messageId: 'om_stream_1', finalText: '你好!', fellBack: false })
  })
})
