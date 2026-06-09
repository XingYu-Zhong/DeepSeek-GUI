# Kun 贡献指南:架构、设计模式与代码组织思想

> 适用对象:任何想向 `kun/` 包贡献代码的工程师。
> 阅读路径:第一次贡献可以按顺序读完全文;之后再回来查找具体章节。
> 配套文档:[`kun-architecture.md`](./kun-architecture.md)
> 讲的是"为什么这样设计",本文讲的是"如何按这种设计写代码"。

---

## 1. 一句话总结

**Kun 是一个严格执行 Ports & Adapters + Functional Core / Imperative
Shell 的 TypeScript 包**。每个修改都应当:

1. 先在 `contracts/` 用 zod 写 schema,导出类型;
2. 再在 `ports/` 描述抽象边界(接口);
3. 在 `domain/` 写纯函数和不可变数据;
4. 在 `adapters/` / `cache/` / `telemetry/` 写具体实现;
5. 在 `services/` 写用例编排;
6. 在 `loop/` 写主体行为(只依赖 ports 和 services);
7. 在 `server/routes/` 暴露 HTTP/SSE;
8. 写测试覆盖每一步。

下面把这条路径用真实代码展开。

---

## 2. 整体架构:六边形 (Hexagonal / Ports & Adapters)

Kun 的目录本身就是六边形的物理布局:

```text
                       ┌─────────────────────────────┐
                       │   server/routes (HTTP)      │   ← 入站适配器
                       │   cli/serve.ts (CLI)        │   ← 入站适配器
                       └──────────────┬──────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │   services/                 │   ← 用例编排
                       │     ThreadService           │     (transaction scripts)
                       │     TurnService             │
                       │     UsageService            │
                       └──────────────┬──────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │   loop/ (核心)              │   ← 领域行为
                       │     AgentLoop               │     (stateful coordinator)
                       │     ContextCompactor        │
                       │     SteeringQueue           │
                       │     InflightTracker         │
                       └──────────────┬──────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
   ┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
   │ domain/         │    │ ports/              │    │ cache/, telemetry/  │
   │ 纯数据 + 工厂    │    │ 抽象接口(零实现)   │    │ 纯原语             │
   └────────┬────────┘    └──────────┬──────────┘    └─────────────────────┘
            │                         │
            ▼                         ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ adapters/  ──  ports 的具体实现                                        │
   │   model/deepseek-compat-model-client.ts                                │
   │   tool/local-tool-host.ts                                              │
   │   in-memory-event-bus / in-memory-approval-gate / in-memory-thread-…  │
   │   file/file-thread-store / file-session-store                         │
   │   workspace/local-workspace-inspector                                  │
   └──────────────────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ contracts/  ──  zod schema + inferred TypeScript types                  │
   │   threads, turns, items, events, approvals, usage, runtime,            │
   │   workspace, errors                                                    │
   └──────────────────────────────────────────────────────────────────────────┘
```

依赖方向(顶层依赖下层,下层绝不依赖上层):
- `contracts/` 不依赖任何东西;
- `domain/` 只依赖 `contracts/`;
- `ports/` 只依赖 `contracts/`;
- `cache/`, `telemetry/` 只依赖 `contracts/`;
- `adapters/` 依赖 `ports/`, `domain/`, `cache/`, `telemetry/`, `contracts/`;
- `loop/` 依赖 `ports/`, `domain/`, `cache/`, `telemetry/`, `contracts/`;
- `services/` 依赖 `ports/`, `domain/`, `contracts/`;
- `server/` 依赖 `services/`, `adapters/`(用具体实现组装), `contracts/`;
- `cli/` 依赖 `contracts/`, 调度 `server/`。

任何违反这个方向的 PR 都会被拒:例如 `domain/` 引用 `ports/`、
`cache/` 引用 `services/`、`contracts/` 引用 `node:fs`,都打破六边形。

### 2.1 例子:加一个新事件类型

要加一个新事件,改的文件按层次顺序:

```text
contracts/events.ts        → 加 zod 变体,导出新 RuntimeEvent kind
domain/event.ts           → (可选) 写一个工厂函数或 group-by 工具
ports/event-bus.ts        → (不需要改,接口已用 discriminated union)
adapters/in-memory-event-bus.ts  → publish/subscribe 已用 RuntimeEvent 联合类型
loop/agent-loop.ts        → 实际 emit
server/routes/events.ts   → SSE 序列化(已用 encodeSseEvent)
tests/contracts.test.ts   → 新增一个 variant 的 zod 解析测试
```

每改一层,跑一次 `npm test`。这就是"按层增量"。

---

## 3. 核心设计模式

Kun 同时使用了多个经典模式,它们互相加强而不是冲突。

### 3.1 Ports & Adapters (Hexagonal)

每个外部依赖都是一个 **port**(接口),每个生产实现都是一个
**adapter**(具体类)。`loop/` 与 `services/` 永远只看见 port,这样:

- 测试时用 in-memory fake 替代 file-backed store;
- 切换 provider(从 DeepSeek 兼容到 OpenAI 兼容)只换 adapter;
- agent loop 不直接 `import 'node:fs'`,所有 I/O 通过 port。

#### 真实例子: `ModelClient` 端口

定义 (`kun/src/ports/model-client.ts`):

```ts
export interface ModelClient {
  readonly provider: string
  readonly model: string
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}
```

实现 (`kun/src/adapters/model/deepseek-compat-model-client.ts`)
把 HTTP+SSE 解析为 `ModelStreamChunk` 序列。

测试 (`kun/tests/ports.test.ts`) 直接 `makeFakeModel` 注入
loop;无需任何网络。

**贡献规则**:
- 在 `ports/` 新增接口时,`@param`、`@returns` 文档要写明"调用者拥有
  什么、调用方承诺什么"。比如 `ModelClient.stream` 文档里要写明
  `request.abortSignal` 是调用方控制的。
- 不要在 `ports/` 引入具体依赖(比如 `zod`、`node:fs`、具体 model
  client)。`ports/` 应该是纯 TypeScript 类型。

### 3.2 Functional Core, Imperative Shell

**Functional Core**:`domain/`、`cache/`、`telemetry/`、`loop/`
内部算法都是纯函数,接受不可变数据、返回新数据。

**Imperative Shell**:`services/`、`server/`,做 I/O、装配对象、
调用 ports,允许副作用。

这条线把"可测试"和"必须存在副作用"的部分干净分开。

#### 真实例子: `ImmutablePrefix` 是 functional core

```ts
// kun/src/cache/immutable-prefix.ts
export function setSystemPrompt(prefix: ImmutablePrefix, systemPrompt: string): ImmutablePrefix {
  return mutate(prefix, { systemPrompt })
}
```

入参 `prefix` 不被修改,函数返回一个新的 `ImmutablePrefix`,其
`fingerprint` 被重算、`revision++`。这个函数可以任意调用、测试不
需要 mock、可以被并发的多 turn 共享。

#### 真实例子: `TurnService.applyItem` 是 imperative shell

```ts
// kun/src/services/turn-service.ts
async applyItem(threadId: string, item: TurnItem): Promise<void> {
  await this.deps.sessionStore.appendItem(threadId, item)
  await this.upsertThread(threadId, (current) => {
    const turn = current.turns.find((t) => t.id === item.turnId)
    if (!turn) return current
    const nextTurn = appendTurnItem(turn, item)        // ← functional core 调用
    const turns = current.turns.map((t) => (t.id === item.turnId ? nextTurn : t))
    return { ...current, turns }
  })
}
```

这个方法做 I/O(`appendItem` 写磁盘),但**用 functional core 算新的
turn state**。`appendTurnItem` 本身是纯函数,在 `domain/turn.ts`:

```ts
export function appendTurnItem(turn: TurnEntity, item: TurnItem): TurnEntity {
  if (turn.items.some((existing) => existing.id === item.id)) {
    return turn
  }
  return { ...turn, items: [...turn.items, item] }
}
```

**贡献规则**:
- 在 `loop/` 写新算法时,先想"这个能写成纯函数吗?"。能就抽到
  `loop/`(更内层)或 `cache/` / `telemetry/`;不能就保留
  `async`,但把 I/O 推到 ports。

### 3.3 Discriminated Union + 类型守卫(zod 联合)

每个"多种形态"的对象都用 `z.discriminatedUnion('kind', [...])`
建模,导出 `type X = z.infer<typeof XSchema>`。这给我们:

- **运行时校验**:每个入参都会被 zod 解析,无效数据立即在边界被拒;
- **类型守卫**:`switch (item.kind)` 在 TypeScript 里自动收窄,漏写
  case 编译器立刻报错;
- **同一份真理**:`contracts/items.ts` 是 SSE 事件、HTTP body、
  磁盘 JSON 三处的同一种格式。

#### 真实例子: TurnItem

```ts
// kun/src/contracts/items.ts
export const TurnItem = z.discriminatedUnion('kind', [
  UserTurnItem,         // kind: 'user_message'
  AssistantTextTurnItem,// kind: 'assistant_text'
  AssistantReasoningTurnItem, // kind: 'assistant_reasoning'
  ToolCallTurnItem,     // kind: 'tool_call'
  ToolResultTurnItem,   // kind: 'tool_result'
  ApprovalTurnItem,     // kind: 'approval'
  UserInputTurnItem,    // kind: 'user_input'
  CompactionTurnItem,   // kind: 'compaction'
  ErrorTurnItem         // kind: 'error'
])
export type TurnItem = z.infer<typeof TurnItem>
```

`RuntimeEvent` 也是同样模式(22 种 kind,见
`kun/src/contracts/events.ts`)。这种纪律让 SSE
replay、磁盘重放、HTTP body 解析三处共享同一份代码。

**贡献规则**:
- 新增任何"多种形态"的对象,先写 zod schema,再写 `type` 推导;
- 不要在 domain 或 adapters 里"重新"写一遍 type,统一用
  `z.infer` 别名;
- 加新 variant 时,在 SSE 路由和磁盘 reader 端不需要改动——这两
  者已经在用 `RuntimeEvent.parse(...)`,会自动接受新 kind。

### 3.4 Dependency Injection(显式构造参数)

`AgentLoop`、`TurnService`、`RuntimeEventRecorder` 等都是普通 class,
依赖通过构造参数注入,无 IoC 容器、无 decorator、无 magic。这是
为了:

- **测试时一行代码就能造一个完整 loop**;
- **bundler 不需要 magic 解析**(只走 tsc 编译);
- **新依赖是显式 patch review**,不是配置文件改动。

#### 真实例子: `AgentLoop` 构造

```ts
// kun/src/loop/agent-loop.ts
export class AgentLoop {
  private readonly opts: AgentLoopOptions
  constructor(opts: AgentLoopOptions) {
    this.opts = opts
  }
  // ...
}
```

测试用例 (`kun/tests/loop.test.ts`):

```ts
function makeHarness(model: ModelClient) {
  const bus = new InMemoryEventBus()
  const approvalGate = new InMemoryApprovalGate()
  const threadStore = new InMemoryThreadStore()
  // ... 装配所有 in-memory fakes
  return new AgentLoop({
    threadStore, sessionStore, approvalGate, model, toolHost,
    usage, events, turns, inflight, steering, compactor, prefix, ids, nowIso
  })
}
```

**贡献规则**:
- 新增依赖时,只往 `XxxOptions` / `XxxDeps` 加字段,不要做
  `singleton` / `globalThis`;
- 在 `agent-loop.ts` 这种核心类里,不要调用 `new` 别的 class;
- 测试要可以一行造出 loop,如果不能,说明 ports 设计不充分。

### 3.5 Event Sourcing(简化版)

整个 runtime 是"以事件为真相"。`RuntimeEventRecorder` 是
**唯一**的出口:

- 给事件打 `seq` + `timestamp`;
- 校验(zod);
- 推到 `EventBus`(内存 fanout,给 SSE 订阅者);
- 持久化到 `SessionStore`(磁盘 JSONL 追加)。

`ThreadStore` 不直接知道事件存在;`AgentLoop` 不直接知道磁盘
布局;`Server` 不直接知道 SSE 协议细节。每个组件只看见
`RuntimeEventRecorder.publish({...})`。

#### 真实例子: `RuntimeEventRecorder.record`

```ts
// kun/src/services/runtime-event-recorder.ts(摘要)
async record(event: RuntimeEvent): Promise<void> {
  const stamped: RuntimeEvent = { ...event, seq: this.deps.bus.allocateSeq(event.threadId), timestamp: this.deps.nowIso() }
  RuntimeEvent.parse(stamped) // ← 边界校验
  this.deps.bus.publish(stamped) // ← fanout
  await this.deps.sessionStore.appendEvent(stamped.threadId, stamped) // ← 持久化
}
```

任何想 emit 一个事件的位置都走这一处,而不是分散到 N 个文件各自
发 `bus.publish` + `store.appendEvent`。结果是:

- 单测可以替换 recorder,验证某个动作触发了哪些事件;
- 磁盘格式变化只影响 recorder,不影响 22 处 emit 代码;
- 重放测试只 replay 持久化的事件,SSE consumer 拿到的事件由 bus
  推送,二者一致。

**贡献规则**:
- 永远不要在 `loop/` 直接调用 `bus.publish` 或 `store.appendEvent`;
  一律通过 `events.record(...)`;
- 如果你需要新增一个事件,先在 `contracts/events.ts` 加 zod
  variant,然后在 loop 里用 `events.record({ kind: 'new_kind', ... })`。

### 3.6 Append-Only Log + Atomic Index

`FileThreadStore` 和 `FileSessionStore` 是典型的 log + snapshot
组合:

- `events.jsonl` / `messages.jsonl` 只追加;
- `index.json` / `thread.json` / `session.json` 用 atomic rename 写入;
- 列表/详情读取靠 index,实时事件/历史回放靠 JSONL。

这是 Reasonix 直接沿用过来的设计,让"崩溃后能恢复"成为自然结果。
`kun/src/adapters/file/file-thread-store.ts` 的
`atomicWrite` 用 tmp + rename 保证读者永远不会看到半写文件。

**贡献规则**:
- 任何新写盘逻辑必须用 `atomicWrite`(`tmp.PID.DATE.tmp` → `rename`);
- 列表/搜索永远基于 index,不要扫 disk;
- 不要在 events.jsonl / messages.jsonl 上做 `unlink` / `truncate`,
  只追加;若要"删除",加 `deleted` 字段即可。

### 3.7 Saga-like Idempotency

`appendItem`、`appendEvent`、`upsertSession` 都被设计成幂等:

- `appendEvent` 用 `seq` 去重,同一个事件传两次只持久化一次;
- `appendItem` 用 `id` 去重;
- 重复的 `upsertSession` 直接覆盖。

这让"网络重试 + 服务端重放"无需特殊处理,客户端可以放心
retry。

### 3.8 Composition Root 模式

每个包有**唯一一个**组装点:

- `kun/src/server/routes/index.ts`:`buildRouter(runtime)` 把
  路由表 + 鉴权 + handlers 装到一起;
- `kun/src/server/serve.ts` 之类的 serve 启动文件:把所有
  port 的实现(in-memory 或 file-backed)装好,塞给 `buildRouter`。
- `kun/src/cli/serve.ts` 是 CLI 的 composition root,只负责
  解析 argv + 调用 `buildRouter`。

**贡献规则**:
- 不要在 `server/routes/xxx.ts` 里 `new` 具体 adapter(比如
  `new FileThreadStore(...)`)。routes 只接收 `ServerRuntime`
  类型,所有具体对象在 composition root 装好;
- 新增 service / loop 工具,必须在 `server/routes/server-runtime.ts`
  的 `ServerRuntime` 类型里加字段,再在 composition root
  注入。

---

## 4. 行为驱动的设计思想

下面这些不是"代码模式",而是写代码时在心里默念的判断标准。

### 4.1 把不可变当作默认,只让显式方法变更

`ImmutablePrefix` 用 `setSystemPrompt(prefix, newValue)` 而不是
`prefix.systemPrompt = newValue`。后者会破坏"prefix 是不可变"
的承诺,前者:

- 内部自动重算 `fingerprint` 和递增 `revision`;
- 调用方传进来一个对象,函数返回新对象,旧对象完全可用(可被
  其他 turn 共享 / 回滚 / 调试);
- 编译器帮助:没有人能"忘记"更新 fingerprint。

类似的纪律:
- `Turn.items` 永远用 `appendTurnItem(turn, item)` 之类,不要
  `turn.items.push(item)`;
- `UsageSnapshot` 是 plain object,但合并必须走 `addUsage(a, b)`。

### 4.2 把"安全失败"和"快速失败"分清

- `RuntimeEventRecorder` 校验失败 → 抛 → 测试能立即发现(快速失败)。
- `local-tool-host.execute` 被 abort → 抛 → caller 处理。
- `LruCache.set` 满了 → 静默 evict,不让 cache 成为可用性瓶颈。
- `WebSocket-like SSE` 中断了 → 静默清理订阅,等待重连。

判断标准:这次失败是否会让"用户体验"或"系统一致性"出问题?
- 会 → 抛 / 返回错误结果。
- 不会,只是性能问题 → 静默退化。

### 4.3 把"现在做什么"和"以后做什么"分离

`AgentLoop.modelStep` 当前是顺序流:等模型 → 跑 tool → 等模型。
在它前面只接 ports,不接"下一步要加的 RAG"、"下一步要加的
cache 路由"。

**贡献规则**:
- 一个 PR 改一个清晰的概念;
- 不要顺手"既然改这里,就把 X 也修了";
- `loop/agent-loop.ts` 不要 import `node:fs`、不要做 git 操作,
  即使"现在看起来很方便"。

### 4.4 测试覆盖每个层次

每个新功能应当至少有这些测试:

| 层次 | 测试类型 | 文件 |
| --- | --- | --- |
| contracts (zod) | schema 解析、validation 失败 | `kun/tests/contracts.test.ts` |
| domain / cache | 纯函数行为 | `kun/tests/cache.test.ts` |
| ports (in-memory) | 接口契约 | `kun/tests/ports.test.ts` |
| loop | 用 in-memory fakes 跑全 loop | `kun/tests/loop.test.ts` |
| server | 用 ephemeral 端口 + fetch / EventSource 跑 HTTP 合约 | `kun/tests/http-server.test.ts` |
| adapters (file) | tmp 目录,append / atomic / 损坏 JSONL 容错 | `kun/tests/loop.test.ts` (FileSessionStore 部分) |

如果一个改动没在某一层有覆盖,先问"该改哪一层"再加测试。

### 4.5 文档先于代码,但和代码同步

- `docs/kun-architecture.md` 描述"为什么这样设计";
- `kun/README.md` 描述 CLI / env / data dir;
- `docs/kun-contributing.md`(本文)描述"如何贡献";
- `docs/AGENTS.md` 描述扩展时该改哪些文件。

**贡献规则**:
- 任何新增/修改的 contract,必须同时更新 `kun/README.md` 端
  点表;
- 任何借鉴/参考/致谢变化,更新 `README.md` 和 `README.en.md` 的
  Thanks 章节;
- doc/code 不一致比缺失更糟——PR 应当同时改两者。

---

## 5. 典型贡献场景的步骤模板

下面四个场景覆盖了 90% 的 PR,每个都按上面的模式走一遍。

### 场景 A:加一个新工具(比如 shell exec)

1. **contracts**:`kun/src/contracts/items.ts` 已经支持
   `tool_call` / `tool_result`,**不需要改**。
2. **domain**:`kun/src/domain/item.ts` 已有
   `makeToolCallItem` / `makeToolResultItem`,**不需要改**。
3. **adapters**:在 `kun/src/adapters/tool/local-tool-host.ts`
   加一个 `LocalTool`:
   ```ts
   export const shellTool: LocalTool = LocalToolHost.defineTool({
     name: 'shell',
     description: 'Run a shell command in the thread workspace.',
     inputSchema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
     policy: 'on-request',
     execute: async (args, context) => {
       if (context.abortSignal.aborted) throw new Error('aborted')
       // ... child_process spawn, capture stdout
       return { output: { stdout, exitCode } }
     }
   })
   ```
4. **adapters barrel**:在 `kun/src/adapters/tool/local-tool-host.ts`
   已有 barrel;只需在 `defaultLocalTools` 数组里追加 `shellTool`。
5. **测试**:在 `kun/tests/ports.test.ts` 加一个
   `runs a shell tool with approval` 测试。
6. **文档**:在 `kun/README.md` 的 default tools 列表里说明。

不涉及 `loop/`、`server/`、`services/`。改动隔离在小范围。

### 场景 B:加一个新的 model provider(比如 OpenAI 兼容)

1. **ports**:`ModelClient` 已经是抽象接口,**不需要改**。
2. **adapters**:`kun/src/adapters/model/openai-compat-model-client.ts`
   新建(参考 `deepseek-compat-model-client.ts` 的 SSE 解析逻辑)。
3. **adapters barrel**:`kun/src/adapters/index.ts` 导出新类。
4. **settings**:在 `kun/src/contracts/...` 或调用方
   `ServeOptionsSchema` 加 `modelProvider` 字段(若需要切换)。
5. **composition root**:在 `kun/src/server/...` 的 serve
   bootstrap 里根据设置选择哪个 adapter 注入。
6. **测试**:`kun/tests/ports.test.ts` 加 model 行为测试;
   `kun/tests/http-server.test.ts` 加端到端测试。
7. **文档**:`kun/README.md` 端点表不变,只是
   "model" 字段语义丰富。

不涉及 `domain/`、`loop/`、`contracts/`。

### 场景 C:加一个新的 SSE 事件类型(比如 "compaction_progress")

1. **contracts**:`kun/src/contracts/events.ts`:
   ```ts
   export const CompactionProgressEvent = RuntimeEventBase.extend({
     kind: z.literal('compaction_progress'),
     progress: z.number().min(0).max(1),
     note: z.string().optional()
   })
   // 加入 RuntimeEvent z.discriminatedUnion
   ```
2. **services**:`RuntimeEventRecorder` 已经接受
   `RuntimeEvent` discriminated union,**不需要改**。
3. **loop**:在 `kun/src/loop/context-compactor.ts` 或
   `agent-loop.ts` 的合适位置 `await this.opts.events.record({ kind: 'compaction_progress', ... })`。
4. **server**:`kun/src/server/routes/events.ts` 的 SSE
   encoder 已经基于 `RuntimeEvent.kind` 路由,**不需要改**。
5. **renderer 映射**(GUI 端):`src/renderer/src/agent/kun-runtime.ts`
   在 `subscribeThreadEvents` 里给 `sink.onCompactionProgress(...)` 派发
   (若需要)。**这是 GUI 包,不是 kun**。
6. **测试**:
   - `kun/tests/contracts.test.ts`:加 variant 解析测试;
   - `kun/tests/loop.test.ts`:加 emit 断言。
7. **文档**:`kun/README.md` 端点表不变,只是 SSE events
   列表里加一行。

只改 contracts + loop + tests。server / composition root / domain
不需要碰。

### 场景 D:加一个新的持久化层(比如 SQLite)

1. **ports**:`ThreadStore` / `SessionStore` 已经是接口,
   **不需要改**。
2. **adapters**:`kun/src/adapters/sqlite/sqlite-thread-store.ts`
   新建,实现 `ThreadStore`。
3. **adapters barrel** + **composition root** 在 serve bootstrap 里
   切换 store 类型。
4. **测试**:`kun/tests/ports.test.ts` 加一份针对 SQLite 的
   合约测试(用临时数据库)。

不涉及 `domain/`、`loop/`、`services/`、`server/`、`contracts/`。
完全可插拔,这是 Ports & Adapters 应有的样子。

---

## 6. PR Checklist

提交 PR 前,逐项确认:

### 6.1 必做

- [ ] 在合适的层写新代码(对照 §2 的目录图)
- [ ] 任何"多种形态"对象都从 zod schema 推导,不要另写 `type`
- [ ] 所有 public function 都有 JSDoc,说明入参/出参/失败模式
- [ ] 新增 ports/contracts/loop 函数都至少有 1 个测试
- [ ] 跑 `cd kun && npm run typecheck && npm test`
- [ ] 跑 `cd .. && npm run typecheck && npm test`
- [ ] 不修改任何 `docs/kun-architecture.md` 描述以外的文件
      来"绕过" typecheck

### 6.2 推荐

- [ ] 复杂的设计决策(为什么 ports 这样切、为什么用某种事件流)
      写在 PR 描述里
- [ ] 改了 public contract 时,更新 `kun/README.md` 端点表
- [ ] 借鉴/致谢有变化时,更新根目录 `README.md` 和 `README.en.md`
- [ ] 新增 SSE 事件时,给 `docs/kun-architecture.md` 加一行
- [ ] 在 `docs/kun-architecture.md` 的 borrow map 中(如未来
      添加 OpenAI-style 借鉴)说明设计来源

### 6.3 不做

- 不要在 domain/cache/telemetry 引用 ports、node:* API
- 不要在 `loop/agent-loop.ts` 直接调用 `bus.publish` /
  `store.appendEvent`(必须走 `events.record`)
- 不要在 server routes 里 `new` 具体 adapter(用注入的
  `ServerRuntime`)
- 不要 hardcode 时间(用 `Clock` 或 `nowIso()`)
- 不要 hardcode id 命名空间(用 `IdGenerator`)
- 不要因为一个 PR "顺便"删除 legacy 注释 / 旧 API

---

## 7. 遇到问题怎么办

- **不熟悉 zod discriminated union**:参考 `kun/src/contracts/items.ts`
  和 `kun/src/contracts/events.ts`,看已有 variant 怎么写。
- **不知道事件该走哪个 kind**:先在 `RuntimeEvent` discriminated
  union 里加 variant,再让 `loop` 用 `events.record({...})` emit
  它。SSE 路由会**自动**找到它。
- **测试写不出来**:
  - 如果你需要 `node:fs` 之类的 I/O,你的函数应该在 services/
    或 server/ 而不是 loop/;
  - 如果你需要具体 model,你应该用 in-memory fake;
  - 如果你需要看 time,你应该注入 `Clock` 或 `nowIso()`。
- **想在 loop 里读 git / 文件系统**:在 port 里加一个新方法(比如
  `WorkspaceInspector.status`),然后在 `AgentLoop` 构造时注入。

---

## 8. 总结

回到开头的"一句话总结":

> **Kun 是一个严格执行 Ports & Adapters + Functional Core /
> Imperative Shell 的 TypeScript 包**。

每个新 PR 都按这个图走:定义 contract → 描述 port → 写 functional
core → 写 imperative shell → 写 adapter → 写 server route → 写
测试 → 同步文档。纪律性大于聪明,简洁大于花哨,可测试大于"快
速"。
