import type { LarkChannel, SendOptions, MarkdownStreamController } from '@larksuiteoapi/node-sdk'

export type FeishuStreamLogger = (category: string, message: string, detail?: unknown) => void

export type SseSubscriber = (signal: AbortSignal) => { close: () => void }

export type FeishuStreamerOptions = {
  bridge: LarkChannel
  chatId: string
  turnId: string
  threadId: string
  replyOptions: SendOptions
  logger: FeishuStreamLogger
}

export type FeishuStreamerResult = {
  ok: boolean
  messageId: string
  finalText: string
  fellBack: boolean
}

export class FeishuStreamer {
  private readonly opts: FeishuStreamerOptions
  private readonly outbox: Array<string | null> = []
  private readonly waiters: Array<(chunk: string | null) => void> = []
  private state: 'pending' | 'streaming' | 'closed' = 'pending'
  private accumulatedText = ''
  private subscription: { close: () => void } | null = null

  constructor(opts: FeishuStreamerOptions) {
    this.opts = opts
  }

  start(input: { subscribe: SseSubscriber }): Promise<FeishuStreamerResult> {
    return new Promise<FeishuStreamerResult>((resolve, reject) => {
      const controller = new AbortController()
      let resolved = false
      const onComplete = (result: FeishuStreamerResult): void => {
        if (resolved) return
        resolved = true
        resolve(result)
      }
      const onError = (error: Error): void => {
        if (resolved) return
        resolved = true
        reject(error)
      }

      const producer = async (streamController: MarkdownStreamController): Promise<void> => {
        this.state = 'streaming'
        try {
          while (this.state === 'streaming') {
            const chunk = await this.nextDelta()
            if (chunk === null) break
            this.accumulatedText += chunk
            try {
              await streamController.append(chunk)
            } catch (error) {
              this.opts.logger('claw-feishu-stream', 'append failed; saving accumulated text and finalizing', {
                message: error instanceof Error ? error.message : String(error)
              })
              try {
                await streamController.setContent(this.accumulatedText)
              } catch (finalError) {
                this.opts.logger('claw-feishu-stream', 'setContent on append-failure also failed', {
                  message: finalError instanceof Error ? finalError.message : String(finalError)
                })
              }
              onComplete({
                ok: true,
                messageId: streamController.messageId,
                finalText: this.accumulatedText,
                fellBack: false
              })
              return
            }
          }
          try {
            await streamController.setContent(this.accumulatedText)
          } catch (error) {
            this.opts.logger('claw-feishu-stream', 'final setContent failed; returning accumulated text as-is', {
              message: error instanceof Error ? error.message : String(error)
            })
          }
          onComplete({
            ok: true,
            messageId: streamController.messageId,
            finalText: this.accumulatedText,
            fellBack: false
          })
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)))
        }
      }

      this.subscription = input.subscribe(controller.signal)
      const onAbort = (): void => {
        this.state = 'closed'
        this.subscription?.close()
        this.subscription = null
        while (this.waiters.length > 0) {
          const w = this.waiters.shift()!
          w(null)
        }
        if (!resolved) onError(new Error('aborted'))
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })

      // Lark SDK exposes a dedicated `stream` method for markdown streaming
      // (SendInput.markdown is a string; StreamInput.markdown is a producer
      // function). Call the streaming variant directly — `send` would not
      // accept a producer.
      const streamPromise: Promise<{ messageId: string }> = this.opts.bridge.stream(
        this.opts.chatId,
        { markdown: producer },
        this.opts.replyOptions
      )
      void streamPromise.catch((error: unknown) => {
        this.state = 'closed'
        controller.abort()
        onError(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /** Public hook called by the SSE consumer (Task 4) for each RuntimeEvent. */
  onSseEvent(event: Record<string, unknown>): void {
    if (this.state !== 'streaming') return
    const kind = event.kind
    if (kind === 'assistant_text_delta' && event.turnId === this.opts.turnId) {
      const item = (event as { item?: { delta?: unknown } }).item
      const delta = typeof item?.delta === 'string' ? item.delta : ''
      if (delta) this.push(delta)
      return
    }
    if (kind === 'assistant_reasoning_delta') {
      this.opts.logger('claw-feishu-stream-debug', 'drop reasoning delta', { turnId: this.opts.turnId })
      return
    }
    if (
      (kind === 'turn_completed' || kind === 'turn_failed' || kind === 'turn_aborted') &&
      event.turnId === this.opts.turnId
    ) {
      this.subscription?.close()
      this.subscription = null
      this.push(null)
    }
  }

  private push(chunk: string | null): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter(chunk)
      return
    }
    this.outbox.push(chunk)
  }

  private nextDelta(): Promise<string | null> {
    if (this.outbox.length > 0) {
      return Promise.resolve(this.outbox.shift() ?? null)
    }
    return new Promise<string | null>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  getAccumulatedText(): string {
    return this.accumulatedText
  }

  abort(): void {
    this.state = 'closed'
    this.subscription?.close()
    this.subscription = null
  }

  dispose(): void {
    this.abort()
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!
      w(null)
    }
  }
}
