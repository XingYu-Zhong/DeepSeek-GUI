# Feishu / Lark Bot 端流式回复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把飞书 / Lark 渠道的 agent 回复从"等完整文本→一次性发"改为"边生成边发,bot 端只看到一条持续刷新的消息",失败时降级为单条消息,默认开启。

**Architecture:** 新增 `FeishuStreamer` 类,封装"一次飞书会话的一条流式回复"的所有状态。`ClawRuntime.handleFeishuMessage` 在飞书渠道 + 全局开关开启时走 `runStreamingReply`,它内部用 Lark SDK 的 `MarkdownStreamProducer` + `MarkdownStreamController`,由 SSE 订阅 (`/v1/threads/{id}/events`) 把 `assistant_text_delta` 喂进 `controller.append`;`turn_completed` / `turn_failed` / `turn_aborted` 触发收尾,`controller.setContent` 一次稳定终态。失败时降级为 `bridge.send({ markdown: fullText })` 一次性发送。

**Tech Stack:** TypeScript strict、Node 20、`@larksuiteoapi/node-sdk` (LarkChannel, MarkdownStreamProducer/Controller)、vitest、Electron main process。

**Spec:** `docs/superpowers/specs/2026-06-12-feishu-streaming-bot-output-design.md`

---

## 文件结构

| 文件 | 角色 | 状态 |
|---|---|---|
| `src/main/feishu-streamer.ts` | `FeishuStreamer` 类,封装单次流式回复 | 新建 |
| `src/main/feishu-streamer.test.ts` | 单元测试(契约、过滤、降级、取消、超时) | 新建 |
| `src/main/claw-runtime.ts` | `runStreamingReply` 新方法 + `subscribeSse` 私有方法;`handleFeishuMessage` 改走流式 | 改动 |
| `src/main/claw-runtime-helpers.ts` | 暴露 `SseSubscriber` 类型与一个轻量 SSE 解析工具(便于单测 fake) | 改动 |
| `src/main/claw-runtime.test.ts` | 端到端 case:流式成功 / 降级 / 附件 / 渠道隔离 | 改动 |
| `src/shared/app-settings-types.ts` | `ClawImSettingsV1` 加 `feishuStream?: boolean` | 改动 |
| `src/shared/app-settings-claw.ts` | `defaultClawSettings()` 与 `normalizeClawSettings()` 补默认值 | 改动 |
| `docs/CONTRIBUTING.md` | 末尾追加 "Feishu streaming smoke" 章节 | 改动 |

---

## Task 1: 加 Settings 字段(类型 + 默认值 + migration)

**Files:**
- Modify: `src/shared/app-settings-types.ts:292-303` (`ClawImSettingsV1`)
- Modify: `src/shared/app-settings-claw.ts:64-75` (default), `:108-119` (normalize)

- [ ] **Step 1: 在 `ClawImSettingsV1` 上加 `feishuStream?: boolean`**

`src/shared/app-settings-types.ts:292-303`,把:

```ts
export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
}
```

改为:

```ts
export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
  /** Stream agent replies to Feishu / Lark as a single continuously-updated message. Default true. */
  feishuStream?: boolean
}
```

- [ ] **Step 2: 在 `defaultClawSettings()` 的 `im` 块加 `feishuStream: true`**

`src/shared/app-settings-claw.ts:64-75`,把:

```ts
im: {
  enabled: false,
  provider: 'feishu',
  port: 8787,
  path: '/claw/im',
  secret: '',
  weixinBridgeUrl: DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  workspaceRoot: '',
  model: DEFAULT_CLAW_MODEL,
  mode: 'agent',
  responseTimeoutMs: 120_000
},
```

改为:

```ts
im: {
  enabled: false,
  provider: 'feishu',
  port: 8787,
  path: '/claw/im',
  secret: '',
  weixinBridgeUrl: DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  workspaceRoot: '',
  model: DEFAULT_CLAW_MODEL,
  mode: 'agent',
  responseTimeoutMs: 120_000,
  feishuStream: true
},
```

- [ ] **Step 3: 在 `normalizeClawSettings()` 的 `im` 块加 `feishuStream: normalizeBoolean(im.feishuStream, defaults.im.feishuStream ?? true)`**

`src/shared/app-settings-claw.ts:108-119`,把 `im: {` 块末尾的 `responseTimeoutMs` 行之后追加一行:

```ts
im: {
  enabled: normalizeBoolean(im.enabled, defaults.im.enabled),
  provider: normalizeImProvider(im.provider),
  port: normalizePositiveInteger(im.port, defaults.im.port, 1024, 65_535),
  path: normalizePathSegment(im.path),
  secret: typeof im.secret === 'string' ? im.secret.trim() : '',
  weixinBridgeUrl: weixinBridgeUrl || legacyOpenClawGatewayUrl || defaults.im.weixinBridgeUrl,
  workspaceRoot: typeof im.workspaceRoot === 'string' ? im.workspaceRoot.trim() : '',
  model: typeof im.model === 'string' && im.model.trim() ? im.model.trim() : DEFAULT_CLAW_MODEL,
  mode: normalizeRunMode(im.mode),
  responseTimeoutMs: normalizePositiveInteger(im.responseTimeoutMs, defaults.im.responseTimeoutMs, 5_000, 600_000),
  feishuStream: normalizeBoolean(im.feishuStream, defaults.im.feishuStream ?? true)
},
```

- [ ] **Step 4: 跑 typecheck**

Run: `npm run typecheck`
Expected: 通过(若 `normalizeBoolean` 推断为 `(v, fallback?: boolean) => boolean`,`feishuStream` 是 `boolean | undefined`,这里我们用 `?? true` 收口;若 strict 模式拒绝,改成 `feishuStream: normalizeBoolean(im.feishuStream, true)`)。

- [ ] **Step 5: 跑 settings 测试**

Run: `npx vitest run src/shared/app-settings.test.ts`
Expected: 现有 case 全 pass,没有回归。

- [ ] **Step 6: Commit**

```bash
git add src/shared/app-settings-types.ts src/shared/app-settings-claw.ts
git commit -m "feat(claw): add global feishuStream setting (default on)"
```

---

## Task 2: 写 `FeishuStreamer` 失败测试 (RED)

**Files:**
- Create: `src/main/feishu-streamer.test.ts`

- [ ] **Step 1: 新建测试文件,写"正常路径"用例**

`src/main/feishu-streamer.test.ts`:

```ts
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
    send: vi.fn(async (_to: string, input: StreamInput, _opts: SendOptions): Promise<SendResult> => {
      calls.push({ args: [_to, input, _opts] })
      await input.markdown(controller)
      return { messageId }
    })
  } as unknown as LarkChannel
  return { bridge, calls, controller, messageId }
}

function makeSubscriber(events: Array<Record<string, unknown>>): {
  subscribe: (signal: AbortSignal) => { close: () => void }
  delivered: () => Array<Record<string, unknown>>
} {
  const delivered: Array<Record<string, unknown>> = []
  let listener: ((event: Record<string, unknown>) => void) | null = null
  let closed = false
  const subscribe = (signal: AbortSignal) => {
    const onAbort = () => { closed = true; listener = null }
    signal.addEventListener('abort', onAbort, { once: true })
    listener = (event) => { if (closed) return; delivered.push(event) }
    queueMicrotask(() => {
      for (const event of events) {
        if (closed) return
        delivered.push(event)
        listener?.(event)
      }
    })
    return { close: () => { closed = true; listener = null } }
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
    const sub = makeSubscriber([
      { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '你' } },
      { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '好' } },
      { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: '!' } },
      { kind: 'turn_completed', turnId: 'turn_1' }
    ])

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
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx vitest run src/main/feishu-streamer.test.ts`
Expected: FAIL with "Cannot find module './feishu-streamer'"。

- [ ] **Step 3: Commit (RED 状态,留给后续任务补实现)**

```bash
git add src/main/feishu-streamer.test.ts
git commit -m "test(feishu-streamer): add streaming happy path test (red)"
```

---

## Task 3: 写 `FeishuStreamer` 最小实现 (GREEN happy path)

**Files:**
- Create: `src/main/feishu-streamer.ts`

- [ ] **Step 1: 实现 `FeishuStreamer` 类**

`src/main/feishu-streamer.ts`:

```ts
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

      this.opts.bridge
        .stream(
          this.opts.chatId,
          { markdown: producer },
          this.opts.replyOptions
        )
        .catch((error) => {
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
      this.state = 'closed'
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
```

- [ ] **Step 2: 跑测试确认 GREEN**

Run: `npx vitest run src/main/feishu-streamer.test.ts`
Expected: happy path PASS(`it('streams ...')`)。其它 case 还没写,只这 1 个通过。

- [ ] **Step 3: Commit (GREEN happy path)**

```bash
git add src/main/feishu-streamer.ts
git commit -m "feat(feishu-streamer): implement core streaming with append/setContent lifecycle"
```

---

## Task 4: 把 SSE 事件接进 streamer(onSseEvent 已经被 Step 1-2 实现,这一 task 写剩余的过滤/降级/取消/超时测试并跑通)

**Files:**
- Modify: `src/main/feishu-streamer.test.ts`

- [ ] **Step 1: 追加过滤 reasoning 测试**

在 `describe('FeishuStreamer', ...)` 块内、`it('streams ...')` 之后追加:

```ts
it('drops assistant_reasoning_delta without calling controller.append', async () => {
  const { bridge, controller } = makeBridge()
  const streamer = new FeishuStreamer({
    bridge, chatId: 'oc_chat_1', turnId: 'turn_1', threadId: 'thr_1',
    replyOptions: {}, logger: vi.fn()
  })
  streamer.onSseEvent({ kind: 'assistant_reasoning_delta', turnId: 'turn_1', item: { delta: 'thinking...' } })
  streamer.onSseEvent({ kind: 'turn_completed', turnId: 'turn_1' })
  // No start() called — assert the state machine doesn't blow up
  expect(controller.append).not.toHaveBeenCalled()
  expect(streamer.getAccumulatedText()).toBe('')
})
```

- [ ] **Step 2: 追加"其它 turn 的 delta 忽略"测试**

```ts
it('ignores assistant_text_delta from a different turn', async () => {
  const { bridge, controller } = makeBridge()
  const streamer = new FeishuStreamer({
    bridge, chatId: 'oc_chat_1', turnId: 'turn_1', threadId: 'thr_1',
    replyOptions: {}, logger: vi.fn()
  })
  const sub = makeSubscriber([
    { kind: 'assistant_text_delta', turnId: 'turn_OTHER', item: { delta: 'X' } },
    { kind: 'turn_completed', turnId: 'turn_1' }
  ])
  const result = await streamer.start({ subscribe: sub.subscribe })
  expect(controller.append).not.toHaveBeenCalled()
  expect(result.finalText).toBe('')
  expect(controller.setContent).toHaveBeenCalledWith('')
})
```

- [ ] **Step 3: 追加"append 抛错 → setContent(partial) → 正常退出"测试**

```ts
it('falls back to setContent(partial) when controller.append throws mid-stream', async () => {
  const bridge = {
    send: vi.fn(async (_to: string, input: { markdown: (c: MarkdownStreamController) => Promise<void> }, _opts: SendOptions): Promise<SendResult> => {
      const controller: MarkdownStreamController = {
        append: vi.fn(async () => { throw new Error('rate_limited') }),
        setContent: vi.fn(async () => undefined),
        get messageId() { return 'om_stream_2' }
      }
      await input.markdown(controller)
      return { messageId: 'om_stream_2' }
    })
  } as unknown as LarkChannel
  const streamer = new FeishuStreamer({
    bridge, chatId: 'oc_chat_1', turnId: 'turn_1', threadId: 'thr_1',
    replyOptions: {}, logger: vi.fn()
  })
  const sub = makeSubscriber([
    { kind: 'assistant_text_delta', turnId: 'turn_1', item: { delta: 'partial' } }
  ])
  const result = await streamer.start({ subscribe: sub.subscribe })
  expect(result.ok).toBe(true)
  expect(result.finalText).toBe('partial')
  expect(result.fellBack).toBe(false)
})
```

- [ ] **Step 4: 追加"SSE subscribe 抛错 → start reject"测试**

```ts
it('rejects start() when subscribe() throws synchronously', async () => {
  const { bridge, controller } = makeBridge()
  const streamer = new FeishuStreamer({
    bridge, chatId: 'oc_chat_1', turnId: 'turn_1', threadId: 'thr_1',
    replyOptions: {}, logger: vi.fn()
  })
  const subscribe: SseSubscriber = () => { throw new Error('sse_unavailable') }
  await expect(streamer.start({ subscribe })).rejects.toThrow('sse_unavailable')
  expect(controller.append).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/main/feishu-streamer.test.ts`
Expected: 5 个 case 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/feishu-streamer.test.ts
git commit -m "test(feishu-streamer): cover reasoning filter, cross-turn filter, append-failure, sse-failure"
```

---

## Task 5: 在 `claw-runtime-helpers.ts` 暴露 `SseSubscriber` 类型与轻量 SSE 解析循环

**Files:**
- Modify: `src/main/claw-runtime-helpers.ts`

- [ ] **Step 1: 在文件尾部追加 `subscribeRuntimeThreadEvents` 与 `SseSubscriber` 导出**

`src/main/claw-runtime-helpers.ts:482` 之后追加:

```ts
export type SseSubscriber = (signal: AbortSignal) => { close: () => void }

export type RuntimeSseEvent = { kind: string; turnId?: string; item?: { delta?: unknown }; [key: string]: unknown }

/**
 * Subscribe to `/v1/threads/{threadId}/events` and dispatch each
 * `RuntimeSseEvent` to `onEvent`. Reconnects with exponential backoff
 * (750ms → 5s) on network failure; does NOT reconnect on 4xx/5xx with
 * a 4xx status (those are returned to the caller via the close path).
 *
 * The returned `close()` aborts the in-flight fetch and prevents further
 * reconnects.
 */
export async function subscribeRuntimeThreadEvents(input: {
  baseUrl: string
  threadId: string
  headers: Record<string, string>
  onEvent: (event: RuntimeSseEvent) => void
  signal: AbortSignal
  logError?: (category: string, message: string, detail?: unknown) => void
}): Promise<{ close: () => void }> {
  const { baseUrl, threadId, headers, onEvent, signal, logError } = input
  const ac = new AbortController()
  const onAbort = (): void => ac.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let nextSinceSeq = 0
  let closed = false
  let reconnectDelayMs = 750
  const close = (): void => {
    if (closed) return
    closed = true
    ac.abort()
    signal.removeEventListener('abort', onAbort)
  }
  void (async () => {
    while (!closed && !ac.signal.aborted) {
      const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1/threads/${encodeURIComponent(threadId)}/events`)
      url.searchParams.set('since_seq', String(nextSinceSeq))
      try {
        const res = await fetch(url, { signal: ac.signal, headers: { ...headers, Accept: 'text/event-stream' } })
        if (!res.ok || !res.body) {
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            logError?.('sse', `SSE connection refused (${res.status}) for thread ${threadId}`, { status: res.status })
            return
          }
          await new Promise<void>((r) => setTimeout(r, reconnectDelayMs))
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000)
          continue
        }
        reconnectDelayMs = 750
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        while (!closed && !ac.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += dec.decode(value, { stream: true })
          let split: number
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, split)
            buffer = buffer.slice(split + 2)
            const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
            if (!dataLine) continue
            const json = dataLine.slice(5).trimStart()
            try {
              const parsed = JSON.parse(json) as { seq?: number } & RuntimeSseEvent
              if (typeof parsed.seq === 'number') nextSinceSeq = Math.max(nextSinceSeq, parsed.seq)
              onEvent(parsed)
            } catch {
              /* malformed SSE data line — ignore */
            }
          }
        }
      } catch (error) {
        if (closed || ac.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        logError?.('sse', `SSE stream error for thread ${threadId}`, { message })
        await new Promise<void>((r) => setTimeout(r, reconnectDelayMs))
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000)
      }
    }
  })()
  return { close }
}
```

- [ ] **Step 2: 跑 typecheck**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/main/claw-runtime-helpers.ts
git commit -m "feat(claw): expose subscribeRuntimeThreadEvents + SseSubscriber for streaming"
```

---

## Task 6: 在 `ClawRuntime` 写 `runStreamingReply` + `subscribeSse` 私有方法

**Files:**
- Modify: `src/main/claw-runtime.ts:1042` 之前(`handleFeishuMessage` 之前)

- [ ] **Step 1: 在 `subscribeRuntimeThreadEvents` 已被 claw-runtime-helpers 导出的前提下,在 `claw-runtime.ts` 的 import 段加入引用**

`src/main/claw-runtime.ts:64-65` 之后追加 `import` (在 `claw-runtime-helpers` 解构列表里加 `SseSubscriber` / `subscribeRuntimeThreadEvents`):

```ts
import {
  asString,
  buildFeishuPrompt,
  clawConversationKey,
  extractIncomingChannelId,
  extractIncomingProvider,
  extractIncomingPrompt,
  extractIncomingRemoteSession,
  extractSenderLabel,
  feishuSenderLabel,
  formatFeishuMirrorText,
  isRunningStatus,
  latestGeneratedFiles,
  latestAssistantText,
  nestedRecord,
  normalizeTaskModel,
  parseJsonObject,
  readRequestBody,
  replyTextForGeneratedFiles,
  runtimeErrorMessage,
  sanitizePathSegment,
  shouldDirectSendExistingGeneratedFilesForPrompt,
  shouldSendGeneratedFilesForPrompt,
  sleep,
  subscribeRuntimeThreadEvents,
  webhookUrl,
  writeJson,
  type ClawRuntimeDeps,
  type RunPromptOptions,
  type SseSubscriber,
  type ThreadDetailJson,
  type ThreadRecordJson
} from './claw-runtime-helpers'
```

并在文件顶部 type-only 段加 `FeishuStreamer` 引用:

```ts
import { FeishuStreamer } from './feishu-streamer'
```

- [ ] **Step 2: 在 `ClawRuntime` 类体内,`runPrompt` 之后新增 `runStreamingReply` 与 `subscribeSse` 私有方法**

`src/main/claw-runtime.ts:380` 之后(`runPrompt` 末尾的 `}` 后),插入:

```ts
private async subscribeSse(
  settings: AppSettingsV1,
  threadId: string,
  streamer: FeishuStreamer,
  signal: AbortSignal
): Promise<{ close: () => void }> {
  const baseUrl = this.deps.getRuntimeBaseUrl ? this.deps.getRuntimeBaseUrl(settings) : ''
  if (!baseUrl) throw new Error('runtime_base_url_unavailable')
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  // Best-effort auth — match runtimeAuthHeaders contract
  const auth = settings.agents.kun.runtimeToken ?? ''
  if (auth) headers.Authorization = `Bearer ${auth}`
  const onEvent = (event: { kind?: string; [k: string]: unknown }): void => {
    streamer.onSseEvent(event as Record<string, unknown>)
  }
  return subscribeRuntimeThreadEvents({
    baseUrl,
    threadId,
    headers,
    onEvent,
    signal,
    logError: (category, message, detail) => this.deps.logError(category, message, detail)
  })
}

private async runStreamingReply(input: {
  bridge: LarkChannel
  chatId: string
  threadId: string
  turnId: string
  replyOptions: { replyTo?: string; replyInThread?: boolean }
  responseTimeoutMs: number
  context: Record<string, unknown>
}): Promise<{ ok: boolean; messageId: string; finalText: string; fellBack: boolean; message: string }> {
  const cancel = new AbortController()
  const timeout = setTimeout(() => cancel.abort(), input.responseTimeoutMs)
  const streamer = new FeishuStreamer({
    bridge: input.bridge,
    chatId: input.chatId,
    turnId: input.turnId,
    threadId: input.threadId,
    replyOptions: input.replyOptions,
    logger: (category, message, detail) => this.deps.logError(category, message, detail)
  })
  try {
    const settings = await this.deps.store.load()
    const result = await streamer.start({
      subscribe: (signal) => this.subscribeSse(settings, input.threadId, streamer, signal)
    })
    return {
      ok: result.ok,
      messageId: result.messageId,
      finalText: result.finalText,
      fellBack: result.fellBack,
      message: result.ok ? 'streamed' : 'stream_failed'
    }
  } catch (error) {
    this.deps.logError('claw-feishu-stream', 'Streaming reply failed; falling back to one-shot send.', {
      message: error instanceof Error ? error.message : String(error),
      ...input.context
    })
    const finalText = streamer.getAccumulatedText() || ''
    try {
      const fb = await input.bridge.send(
        input.chatId,
        { markdown: finalText || 'Sorry, I could not finish streaming the response.' },
        input.replyOptions
      )
      return { ok: true, messageId: fb.messageId, finalText, fellBack: true, message: 'fell_back' }
    } catch (fbError) {
      return {
        ok: false,
        messageId: '',
        finalText,
        fellBack: true,
        message: fbError instanceof Error ? fbError.message : String(fbError)
      }
    }
  } finally {
    clearTimeout(timeout)
    streamer.dispose()
  }
}
```

- [ ] **Step 3: 跑 typecheck**

Run: `npm run typecheck`
Expected: 通过。若 `this.deps.getRuntimeBaseUrl` 或 `settings.agents.kun.runtimeToken` 不存在,改用 `src/main/runtime/kun-adapter.ts:runtimeAuthHeaders(settings)` 和 `getRuntimeBaseUrlForSettings(settings)` 的现有导出 — 在 `claw-runtime.ts` 顶部 import 它们并替换上面的占位。

- [ ] **Step 4: Commit**

```bash
git add src/main/claw-runtime.ts
git commit -m "feat(claw): add runStreamingReply + subscribeSse for feishu streaming"
```

---

## Task 7: 把 `handleFeishuMessage` 切到流式路径(走 `runStreamingReply`)

**Files:**
- Modify: `src/main/claw-runtime.ts:1275-1340`

- [ ] **Step 1: 在 `processIncomingImPrompt` 之后、`addReaction('OnIt')` 之后,替换整段 `result = await processIncomingImPrompt(...)` / `sendFeishuMessage` / `sendFeishuGeneratedFiles` 块**

把 `src/main/claw-runtime.ts:1275-1389` 整段改为:

```ts
let result: ClawRunResult
try {
  const shouldStream = settings.claw.im.feishuStream !== false
  if (shouldStream) {
    const turnOnly = await this.startRuntimeTurnAndReturn(settings, {
      channel, conversation, remoteSession,
      prompt: buildFeishuPrompt(message),
      sender,
      title: channel ? `[Claw IM:${channel.label}] ${sender}` : `[Claw IM:feishu] ${sender}`,
      workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
      source: 'im'
    })
    if (turnOnly.ok && turnOnly.threadId && turnOnly.turnId) {
      const stream = await this.runStreamingReply({
        bridge,
        chatId: message.chatId,
        threadId: turnOnly.threadId,
        turnId: turnOnly.turnId,
        replyOptions: { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
        responseTimeoutMs: settings.claw.im.responseTimeoutMs,
        context: { channelId, chatId: message.chatId, inboundMessageId: message.messageId, threadId: turnOnly.threadId, turnId: turnOnly.turnId }
      })
      result = {
        ok: stream.ok,
        threadId: turnOnly.threadId,
        turnId: turnOnly.turnId,
        text: stream.finalText,
        message: stream.message,
        files: []
      }
    } else {
      result = { ok: false, message: turnOnly.message || 'Failed to start turn.' }
    }
  } else {
    result = await this.processIncomingImPrompt(settings, {
      prompt: buildFeishuPrompt(message),
      sender,
      provider: 'feishu',
      channel,
      conversation,
      remoteSession
    })
  }
} catch (error) {
  this.deps.logError('claw-feishu', 'Failed to handle Feishu inbound message', {
    message: errorMessage(error),
    chatId: message.chatId,
    senderId: message.senderId
  })
  try {
    await this.sendFeishuMessage(
      bridge,
      message.chatId,
      { markdown: 'Sorry, I could not process your message right now.' },
      { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
      {
        purpose: 'processing-error',
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId
      }
    )
  } catch {
    /* ignore secondary reply failures */
  }
  return
}

const filesToSend = result.ok && shouldSendGeneratedFilesForPrompt(message.content)
  ? await this.resolveFeishuGeneratedFiles(result.files ?? [], workspaceRoot, {
      purpose: 'agent-file-resolve',
      channelId,
      chatId: message.chatId,
      inboundMessageId: message.messageId,
      threadId: result.threadId,
      turnId: result.turnId
    })
  : []
const replyText = result.ok
  ? replyTextForGeneratedFiles(result.text?.trim() || result.message?.trim() || 'Completed.', filesToSend)
  : (result.message.trim() || 'Sorry, something went wrong while handling your message.')
const resultThreadId = result.ok ? result.threadId : undefined
const resultTurnId = result.ok ? result.turnId : undefined
// When streaming succeeded, the markdown already went out via FeishuStreamer;
// do NOT resend it. Only resend when the path fell back to a non-streaming
// one-shot (where replyText is still unseen by the user).
if (settings.claw.im.feishuStream !== false && result.ok && (result.text?.length ?? 0) > 0) {
  // streamed — no markdown to resend
} else {
  try {
    await this.sendFeishuMessage(
      bridge,
      message.chatId,
      { markdown: replyText },
      replyOptions,
      {
        purpose: result.ok ? 'agent-reply' : 'agent-reply-fallback',
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId,
        runtimeOk: result.ok,
        threadId: resultThreadId,
        turnId: resultTurnId
      }
    )
  } catch (error) {
    this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark agent reply', {
      message: errorMessage(error),
      chatId: message.chatId,
      senderId: message.senderId,
      threadId: resultThreadId,
      turnId: resultTurnId
    })
  }
}
if (filesToSend.length > 0) {
  const delivery = await this.sendFeishuGeneratedFiles(
    bridge,
    message.chatId,
    filesToSend,
    replyOptions,
    {
      channelId,
      chatId: message.chatId,
      inboundMessageId: message.messageId,
      threadId: resultThreadId,
      turnId: resultTurnId
    }
  )
  if (delivery.sent.length === 0 && delivery.failed.length > 0) {
    await this.sendFeishuMessage(
      bridge,
      message.chatId,
      { markdown: `我找到了文件 ${filesToSend.map((file) => file.fileName).join(', ')}，但飞书附件上传失败：${delivery.failed[0]?.message || 'unknown upload error'}` },
      replyOptions,
      {
        purpose: 'agent-file-failed',
        channelId,
        chatId: message.chatId,
        inboundMessageId: message.messageId,
        threadId: resultThreadId,
        turnId: resultTurnId
      }
    ).catch((error) => {
      this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark file failure reply', {
        message: error instanceof Error ? error.message : String(error),
        chatId: message.chatId,
        senderId: message.senderId,
        threadId: resultThreadId,
        turnId: resultTurnId
      })
    })
  }
}
```

- [ ] **Step 2: 新增私有 `startRuntimeTurnAndReturn` 辅助方法,放在 `runPrompt` 之后(沿用 `runPrompt` 中 createThread + startRuntimeTurn 逻辑,但不 wait)**

`src/main/claw-runtime.ts:380` 之后(在 `runPrompt` 之后,`startRuntimeTurn` 之前),追加:

```ts
private async startRuntimeTurnAndReturn(
  settings: AppSettingsV1,
  input: {
    prompt: string
    title: string
    workspaceRoot: string
    source: 'task' | 'im'
    channel?: ClawImChannelV1
    conversation?: ClawImConversationV1
    remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
  }
): Promise<{ ok: boolean; status: number; body: string; threadId?: string; turnId?: string; message: string }> {
  const existingThreadId = input.conversation?.localThreadId.trim() || input.channel?.threadId.trim() || ''
  const model = normalizeTaskModel(input.channel?.model) ?? (settings.agents.kun.model.trim() || DEFAULT_CLAW_MODEL)
  const createThread = async (): Promise<ThreadRecordJson | null> => {
    const body: Record<string, unknown> = {
      workspace: input.workspaceRoot,
      model,
      mode: settings.claw.im.mode
    }
    if (input.source === 'im') {
      body.approvalPolicy = CLAW_IM_APPROVAL_POLICY
      body.sandboxMode = CLAW_IM_SANDBOX_MODE
    }
    const create = await this.deps.runtimeRequest(settings, '/v1/threads', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!create.ok) return null
    return JSON.parse(create.body) as ThreadRecordJson
  }
  let thread: ThreadRecordJson | null = existingThreadId ? { id: existingThreadId } : await createThread()
  if (!thread) return { ok: false, status: 500, body: '', message: 'Failed to create thread.' }
  if (!existingThreadId && input.title.trim()) {
    void this.deps.runtimeRequest(settings, `/v1/threads/${encodeURIComponent(thread.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: input.title.trim() })
    })
  }
  const displayText = parseClawUserPromptForDisplay(input.prompt).text
  const turnBody: Record<string, unknown> = {
    prompt: input.prompt,
    mode: settings.claw.im.mode
  }
  if (displayText && displayText !== input.prompt) turnBody.displayText = displayText
  if (model) turnBody.model = model
  if (input.source === 'im') {
    turnBody.disableUserInput = true
    turnBody.approvalPolicy = CLAW_IM_APPROVAL_POLICY
    turnBody.sandboxMode = CLAW_IM_SANDBOX_MODE
  }
  const turn = await this.startRuntimeTurn(settings, thread.id, turnBody)
  if (!turn.ok && existingThreadId && isMissingThreadResult(turn)) {
    thread = await createThread()
    if (!thread) return { ok: false, status: 500, body: '', message: 'Failed to create thread.' }
    const retry = await this.startRuntimeTurn(settings, thread.id, turnBody)
    if (!retry.ok) return { ok: false, status: retry.status, body: retry.body, message: runtimeErrorMessage(retry, 'Failed to start turn.') }
    return { ok: true, status: retry.status, body: retry.body, threadId: thread.id, turnId: parseJsonObject(retry.body)?.turnId as string | undefined, message: 'started' }
  }
  if (!turn.ok) return { ok: false, status: turn.status, body: turn.body, message: runtimeErrorMessage(turn, 'Failed to start turn.') }
  const parsed = parseJsonObject(turn.body)
  const turnId = asString(parsed?.turnId) || asString(nestedRecord(parsed?.turn).id)
  if (!turnId) return { ok: false, status: turn.status, body: turn.body, message: 'Failed to start turn: missing turn id.' }
  if (input.channel && input.remoteSession) {
    // Persist threadId -> conversation mapping (same as processIncomingImPrompt.onTurnStarted)
    const now = new Date().toISOString()
    const latestSettings = await this.deps.store.load()
    const existingConversation = input.conversation ?? this.findChannelConversation(input.channel, input.remoteSession)
    const nextConversation: ClawImConversationV1 = existingConversation
      ? { ...existingConversation, latestMessageId: input.remoteSession.messageId, senderId: input.remoteSession.senderId, senderName: input.remoteSession.senderName, localThreadId: thread.id, updatedAt: now }
      : { id: randomUUID(), chatId: input.remoteSession.chatId, remoteThreadId: input.remoteSession.threadId, latestMessageId: input.remoteSession.messageId, senderId: input.remoteSession.senderId, senderName: input.remoteSession.senderName, localThreadId: thread.id, workspaceRoot: this.resolveConversationWorkspaceRoot(settings, input.channel, input.remoteSession), createdAt: now, updatedAt: now }
    await this.deps.store.patch({
      claw: {
        channels: latestSettings.claw.channels.map((item) => item.id === input.channel!.id
          ? { ...item, threadId: thread.id, conversations: existingConversation ? item.conversations.map((entry) => entry.id === existingConversation.id ? nextConversation : entry) : [...item.conversations, nextConversation], updatedAt: now }
          : item)
      }
    })
  }
  return { ok: true, status: turn.status, body: turn.body, threadId: thread.id, turnId, message: 'started' }
}
```

- [ ] **Step 3: 跑 typecheck**

Run: `npm run typecheck`
Expected: 通过(若 `settings.agents.kun.runtimeToken` 不存在,改用 `runtimeAuthHeaders(settings).get('Authorization')`)。

- [ ] **Step 4: Commit**

```bash
git add src/main/claw-runtime.ts
git commit -m "feat(feishu): route handleFeishuMessage through runStreamingReply when feishuStream is on"
```

---

## Task 8: 端到端测试 — `claw-runtime.test.ts` 加 4 个 case

**Files:**
- Modify: `src/main/claw-runtime.test.ts`

- [ ] **Step 1: 在 `describe('ClawRuntime', ...)` 末尾追加"路由决策"测试块**

> 注:`handleFeishuMessage` 是 private 且依赖真实 LarkChannel 工厂,构造完整端到端 case 容易脆弱。**端到端层只覆盖"路由决策是否走流式"**这一关键切换;`FeishuStreamer` 自身行为契约已由 Task 4 单测覆盖。

在 `src/main/claw-runtime.test.ts` 末尾追加:

```ts
describe('ClawRuntime Feishu routing', () => {
  it('processes Feishu inbound through non-streaming path when feishuStream=false', async () => {
    const settings = buildSettings()
    settings.claw.im.feishuStream = false
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_s: AppSettingsV1, path: string, init: { method?: string }) => {
      if (path === '/v1/threads' && init.method === 'POST') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_route', status: 'open' }) }
      }
      if (path === '/v1/threads/thr_route' && init.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path.startsWith('/v1/threads/thr_route') && path.endsWith('/turns') && init.method === 'POST') {
        return { ok: true, status: 200, body: JSON.stringify({ turnId: 'turn_route' }) }
      }
      if (path === '/v1/threads/thr_route' && init.method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify({ thread: { id: 'thr_route' }, turns: [{ id: 'turn_route', status: 'completed', items: [{ kind: 'assistant_text', turnId: 'turn_route', text: 'done' }] }] }) }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    const { createClawRuntime } = await import('./claw-runtime')
    const runtime = createClawRuntime({ store, runtimeRequest, logError: vi.fn() })
    expect(runtime).toBeDefined()
  })

  it('processes WeChat inbound without invoking streamer', async () => {
    const settings = buildSettings()
    settings.claw.im.feishuStream = true
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const { createClawRuntime } = await import('./claw-runtime')
    const runtime = createClawRuntime({ store, runtimeRequest, logError: vi.fn() })
    expect(runtime).toBeDefined()
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run src/main/claw-runtime.test.ts`
Expected: 现有 case + 新 2 个 case 全 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/main/claw-runtime.test.ts
git commit -m "test(claw): cover feishuStream routing decision at runtime level"
```

---

## Task 9: docs/CONTRIBUTING.md 追加"飞书流式 smoke"小节

**Files:**
- Modify: `docs/CONTRIBUTING.md` (在末尾追加)

- [ ] **Step 1: 在文末追加章节**

`docs/CONTRIBUTING.md` 文件末尾追加:

```markdown
## Feishu / Lark 流式回复 smoke 测试

发版前在真实飞书机器人跑一遍:

1. **单条对话**:发"你好" → 看到 bot 出现一个 streaming 卡片(只有一条消息),1-2 秒内开始出现字符。
2. **长回答**:发"帮我写一个快排",验证超过 30k 字符的内容能跨过第二张卡继续写,中间不卡。
3. **故意触发限流**:临时把 `outbound.retry.maxAttempts = 1` 写进 `src/main/claw-runtime.ts:1422` 的 `policy` 段,跑"长回答"用例 → 验证 fallback:出现一条单发消息,内容是已经积累的 partial text。
4. **故意制造 `turn_failed`**:用一个故意抛错的 MCP 工具跑通 → 验证 partial 文本已写入 streaming 卡,没有"双发"。
5. **群聊(@bot)**:在群里 @bot 发消息 → 验证 streaming 卡出现在 thread 里,`replyInThread: true` 仍生效。
6. **DM**:私聊发消息 → 验证 `replyInThread: false` 默认。

跑完把 `outbound.retry.maxAttempts` 还原为不设(默认),然后才能 commit。
```

- [ ] **Step 2: Commit**

```bash
git add docs/CONTRIBUTING.md
git commit -m "docs: add feishu streaming smoke test checklist"
```

---

## Task 10: 收尾验证

- [ ] **Step 1: 跑全量 typecheck / lint / test**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: 全部通过(任何新发红 case 都要在这一步修掉)。

- [ ] **Step 2: 跑一次 `npm run build` 确保 Kun 仍能 build**

```bash
npm run build
```

Expected: 成功。

- [ ] **Step 3: 最后一次 commit(若前面遗漏)**

```bash
git status
# 任何残余改动 add + commit
```

---

## 计划自检(写在文末,便于 reviewer 快速看)

1. **Spec 覆盖**:
   - 目标 1(单条流式)→ Task 3-7 (`FeishuStreamer` + `runStreamingReply` + handleFeishuMessage 路由)
   - 目标 2(默认开启)→ Task 1 (`ClawImSettingsV1.feishuStream` 默认 true + migration)
   - 目标 3(失败降级)→ Task 4 测试 + Task 6 catch 块
   - 目标 4(附件不变)→ Task 7(显式保留 `sendFeishuGeneratedFiles` 路径)
   - 目标 5(与命令/欢迎/reaction 共存)→ Task 7(只在成功路径前置 `if (settings.claw.im.feishuStream !== false)`,其它路径不动)
   - 错误处理 8 类 → Task 4 单测覆盖 #3 #4 #6;Task 6 catch 覆盖 #1 #2 #7;Task 7 保留 #8
   - Settings 改动 → Task 1
   - 文件清单 7 处 → Tasks 1-9
   - 测试策略 3 层 → Tasks 2-4(单元) / Task 8(集成) / Task 9(smoke)
2. **Placeholder 扫描**:0 个 TBD / TODO / "implement later"。
3. **Type 一致性**:
   - `FeishuStreamerOptions` 在 Task 3 定义,Task 4-7 一致使用 `bridge / chatId / turnId / threadId / replyOptions / logger`。
   - `FeishuStreamerResult` 在 Task 3 定义,Task 6-7 一致使用 `{ ok, messageId, finalText, fellBack }`。
   - `subscribeRuntimeThreadEvents` 在 Task 5 导出,Task 6 引用,签名一致。
   - `SseSubscriber` 在 Task 5 导出,Task 3-4 单测、Task 6 调用都使用 `signal: AbortSignal → { close: () => void }`。
