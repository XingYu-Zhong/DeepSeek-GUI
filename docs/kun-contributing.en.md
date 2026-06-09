# Kun Contribution Guide: Architecture, design patterns and code organization ideas

> Applicable to: Any engineer who wants to contribute code to the `kun/` package.
> Reading path: For your first contribution, you can read the entire text in order; come back later to find specific chapters.
> Supporting documents:[`kun-architecture.md`](./kun-architecture.md)
> It talks about "why it is designed this way", and this article talks about "how to write code according to this design".

---

## 1. One sentence summary

**Kun is a strict implementation of Ports & Adapters + Functional Core / Imperative
TypeScript package for Shell**. Every modification should:

1. First use zod to write the schema in `contracts/` and export the type;
2. Then describe the abstract boundary (interface) in `ports/`;
3. Write pure functions and immutable data in `domain/`;
4. Write specific implementations in `adapters/` / `cache/` / `telemetry/`;
5. Write use case orchestration in `services/`;
6. Write the main behavior in `loop/` (only relies on ports and services);
7. Expose HTTP/SSE in `server/routes/`;
8. Write tests to cover every step.

Let’s expand this path with real code.

---

## 2. Overall architecture: Hexagonal (Hexagonal / Ports & Adapters)

Kun's directory itself is a hexagonal physical layout:

```text
                       ┌─────────────────────────────┐
                       │   server/routes (HTTP)      │   <- inbound adapter
                       │   cli/serve.ts (CLI)        │   <- inbound adapter
                       └──────────────┬──────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │   services/                 │   <- use-case orchestration
                       │     ThreadService           │     (transaction scripts)
                       │     TurnService             │
                       │     UsageService            │
                       └──────────────┬──────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │   loop/ (core)              │   <- domain behavior
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
   │ pure data + factories │ │ abstract interfaces │    │ pure primitives    │
   └────────┬────────┘    └──────────┬──────────┘    └─────────────────────┘
            │                         │
            ▼                         ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ adapters/  -- concrete implementations of ports                         │
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

Dependency direction (the top layer depends on the lower layer, and the lower layer never depends on the upper layer):
- `contracts/` does not depend on anything;
- `domain/` only depends on `contracts/`;
- `ports/` only depends on `contracts/`;
- `cache/`, `telemetry/` only depend on `contracts/`;
- `adapters/` depends on `ports/`, `domain/`, `cache/`, `telemetry/`, `contracts/`;
- `loop/` depends on `ports/`, `domain/`, `cache/`, `telemetry/`, `contracts/`;
- `services/` depends on `ports/`, `domain/`, `contracts/`;
- `server/` depends on `services/`, `adapters/` (assembled with specific implementation), `contracts/`;
- `cli/` depends on `contracts/`, and schedules `server/`.

Any PR that violates this direction will be rejected: for example, `domain/` refers to `ports/`,
`cache/` refers to `services/`, `contracts/` refers to `node:fs`, all break the hexagon.

### 2.1 Example: Add a new event type

To add a new event, change the files in hierarchical order:

```text
contracts/events.ts        -> add the zod variant and export the new RuntimeEvent kind
domain/event.ts            -> optional factory or group-by helper
ports/event-bus.ts         -> usually unchanged; the interface already uses the union
adapters/in-memory-event-bus.ts  -> publish/subscribe already use RuntimeEvent
loop/agent-loop.ts         -> emit the event
server/routes/events.ts    -> SSE serialization already uses encodeSseEvent
tests/contracts.test.ts    -> add a zod parsing test for the new variant

```

Every time you change a layer, run `npm test`. This is "increment by layer".

---

## 3. Core design patterns

Kun uses multiple classic patterns simultaneously, which reinforce each other rather than conflict.

### 3.1 Ports & Adapters (Hexagonal)

Each external dependency is a **port** (interface), and each production implementation is a
**adapter** (concrete class). `loop/` and `services/` will always see only ports, like this:

- Use in-memory fake instead of file-backed store when testing;
- Switch provider (from DeepSeek compatible to OpenAI compatible) only change adapter;
- The agent loop does not directly `import 'node:fs'`, all I/O passes through the port.

#### Real example: `ModelClient` port

Definition (`kun/src/ports/model-client.ts`):

```ts
export interface ModelClient {
  readonly provider: string
  readonly model: string
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}

```

Implementation (`kun/src/adapters/model/deepseek-compat-model-client.ts`)
Parse HTTP+SSE into a sequence of `ModelStreamChunk`.

Tests (`kun/tests/ports.test.ts`) are injected directly with `makeFakeModel`
loop; no network required.

**Contribution Rules**:
- When adding an interface to `ports/`, the `@param` and `@returns` documents must indicate "The caller owns
  What, what the caller promises". For example, the `ModelClient.stream` document should state
  `request.abortSignal` is caller controlled.
- Do not introduce specific dependencies (such as `zod`, `node:fs`, specific model) in `ports/`
  client). `ports/` should be a pure TypeScript type.

### 3.2 Functional Core, Imperative Shell

**Functional Core**: `domain/`, `cache/`, `telemetry/`, `loop/`
Internal algorithms are all pure functions, accepting immutable data and returning new data.

**Imperative Shell**: `services/`, `server/`, do I/O, assembly objects,
Call ports, allowing side effects.

This line cleanly separates the "testable" and "must have side effects" parts.

#### Real example: `ImmutablePrefix` is functional core

```ts
// kun/src/cache/immutable-prefix.ts
export function setSystemPrompt(prefix: ImmutablePrefix, systemPrompt: string): ImmutablePrefix {
  return mutate(prefix, { systemPrompt })
}

```

The input parameter `prefix` is not modified, and the function returns a new `ImmutablePrefix` whose
`fingerprint` is recalculated, `revision++`. This function can be called arbitrarily and tested.
Requires mocking and can be shared by multiple turns concurrently.

#### Real example: `TurnService.applyItem` is imperative shell

```ts
// kun/src/services/turn-service.ts
async applyItem(threadId: string, item: TurnItem): Promise<void> {
  await this.deps.sessionStore.appendItem(threadId, item)
  await this.upsertThread(threadId, (current) => {
    const turn = current.turns.find((t) => t.id === item.turnId)
    if (!turn) return current
    const nextTurn = appendTurnItem(turn, item)        // functional core call
    const turns = current.turns.map((t) => (t.id === item.turnId ? nextTurn : t))
    return { ...current, turns }
  })
}

```

This method does I/O (`appendItem` writes to disk), but it is new to use functional core.
turn state**. `appendTurnItem` itself is a pure function, in `domain/turn.ts`:

```ts
export function appendTurnItem(turn: TurnEntity, item: TurnItem): TurnEntity {
  if (turn.items.some((existing) => existing.id === item.id)) {
    return turn
  }
  return { ...turn, items: [...turn.items, item] }
}

```

**Contribution Rules**:
- When writing a new algorithm in `loop/`, first think "Can this be written as a pure function?". Get it if you can
  `loop/` (inner layer) or `cache/` / `telemetry/`; if not possible, keep it
  `async`, but pushes I/O to ports.

### 3.3 Discriminated Union + type guard (zod union)

Each "kind" object uses `z.discriminatedUnion('kind', [...])`
Modeling, export `type X = z.infer<typeof XSchema>`. This gives us:

- **Runtime verification**: Each input parameter will be parsed by zod, and invalid data will be immediately rejected at the boundary;
- **Type guard**: `switch (item.kind)` automatically narrows and misses words in TypeScript
  case compiler reports an error immediately;
- **Same truth**: `contracts/items.ts` is SSE event, HTTP body,
  Disk JSON in three places in the same format.

#### Real example: TurnItem

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

`RuntimeEvent` also has the same pattern (22 kinds, see
`kun/src/contracts/events.ts`). This discipline allows SSE
Replay, disk replay, and HTTP body parsing share the same code.

**Contribution Rules**:
- To add any "multiple form" objects, first write zod schema, then write `type` derivation;
- Do not "re-write" the type in domain or adapters, use them uniformly
  `z.infer` alias;
- When adding a new variant, no changes are required on the SSE routing and disk reader sides - these two
  If you are already using `RuntimeEvent.parse(...)`, the new kind will be automatically accepted.

### 3.4 Dependency Injection (explicit construction parameter)

`AgentLoop`, `TurnService`, `RuntimeEventRecorder`, etc. are all common classes,
Dependencies are injected through construction parameters, no IoC container, no decorator, no magic. This is
For:

- **One line of code can create a complete loop during testing**;
- **bundler does not require magic parsing** (only tsc compilation);
- **The new dependency is an explicit patch review**, not a configuration file change.

#### Real example: `AgentLoop` construct

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

Test case (`kun/tests/loop.test.ts`):

```ts
function makeHarness(model: ModelClient) {
  const bus = new InMemoryEventBus()
  const approvalGate = new InMemoryApprovalGate()
  const threadStore = new InMemoryThreadStore()
  // ... assemble all in-memory fakes
  return new AgentLoop({
    threadStore, sessionStore, approvalGate, model, toolHost,
    usage, events, turns, inflight, steering, compactor, prefix, ids, nowIso
  })
}

```

**Contribution Rules**:
- When adding a new dependency, only add fields to `XxxOptions` / `XxxDeps`, do not do it
  `singleton` / `globalThis`;
- In core classes such as `agent-loop.ts`, do not call `new` other classes;
- The test must be able to create a loop in one line. If it cannot, it means that the ports design is insufficient.

### 3.5 Event Sourcing (simplified version)

The entire runtime is "event-based". `RuntimeEventRecorder` is
The **only** exit:

- Give the event `seq` + `timestamp`;
- check(zod);
- Push to `EventBus`(memory fanout, to SSE subscribers);
- Persist to `SessionStore` (disk JSONL append).

`ThreadStore` does not directly know that the event exists; `AgentLoop` does not directly know the disk
Layout;`Server` does not directly know SSE protocol details. Each component only sees
`RuntimeEventRecorder.publish({...})`.

#### Real example: `RuntimeEventRecorder.record`

```ts
// kun/src/services/runtime-event-recorder.ts (excerpt)
async record(event: RuntimeEvent): Promise<void> {
  const stamped: RuntimeEvent = { ...event, seq: this.deps.bus.allocateSeq(event.threadId), timestamp: this.deps.nowIso() }
  RuntimeEvent.parse(stamped) // boundary validation
  this.deps.bus.publish(stamped) // ← fanout
  await this.deps.sessionStore.appendEvent(stamped.threadId, stamped) // persistence
}

```

Anywhere you want to emit an event, go to this place instead of spreading it across N files.
Send `bus.publish` + `store.appendEvent`. The result is:

- Single test can replace recorder to verify which events are triggered by a certain action;
- The disk format change only affects the recorder and does not affect the 22 emit codes;
- The replay test only replays persisted events. The events obtained by the SSE consumer are processed by the bus.
  Push, both are consistent.

**Contribution Rules**:
- Never call `bus.publish` or `store.appendEvent` directly from `loop/`;
  Always pass `events.record(...)`;
- If you need to add an event, add zod to `contracts/events.ts` first
  variant, and then use `events.record({ kind: 'new_kind', ... })` in the loop.

### 3.6 Append-Only Log + Atomic Index

`FileThreadStore` and `FileSessionStore` are typical log + snapshot
Combination:

- `events.jsonl` / `messages.jsonl` append only;
- `index.json` / `thread.json` / `session.json` are written using atomic rename;
- List/detail reading relies on index, and real-time event/historical playback relies on JSONL.

This is a design directly inherited from Reasonix, making "recovery after crash" a natural result.
of `kun/src/adapters/file/file-thread-store.ts`
`atomicWrite` uses tmp + rename to ensure that readers never see half-written files.

**Contribution Rules**:
- Any new write logic must use `atomicWrite`(`tmp.PID.DATE.tmp` → `rename`);
- List/search is always based on index, do not scan disk;
- Don't do `unlink` / `truncate` on events.jsonl / messages.jsonl,
  Append only; if you want to "delete", add the `deleted` field.

### 3.7 Saga-like Idempotency

`appendItem`, `appendEvent`, `upsertSession` are all designed to be idempotent:

- `appendEvent` uses `seq` to remove duplicates. The same event is transmitted twice and only persisted once;
- `appendItem` uses `id` to remove duplicates;
- Repeated `upsertSession` overrides directly.

This allows "network retry + server replay" without special processing, and the client can rest assured
retry.

### 3.8 Composition Root mode

Each package has a unique assembly point:

- `kun/src/server/routes/index.ts`:`buildRouter(runtime)`
  Routing table + authentication + handlers are installed together;
- serve startup files such as `kun/src/server/serve.ts`: put all
  The port implementation (in-memory or file-backed) is installed and plugged into `buildRouter`.
- `kun/src/cli/serve.ts` is the composition root of CLI and is only responsible for
  Parse argv + call `buildRouter`.

**Contribution Rules**:
- Do not use `new` specific adapter in `server/routes/xxx.ts` (for example
  `new FileThreadStore(...)`). routes only receive `ServerRuntime`
  Type, all specific objects are installed in the composition root;
- Added service / loop tool, must be in `server/routes/server-runtime.ts`
  Add fields to the `ServerRuntime` type, and then add fields to the composition rootinjection.

---

## 4. Behavior-driven design thinking

The following are not "code patterns", but criteria that you should mentally recite when writing code.

### 4.1 Treat immutability as the default and only allow explicit method changes

`ImmutablePrefix` use `setSystemPrompt(prefix, newValue)` instead
`prefix.systemPrompt = newValue`. The latter will break "prefix is immutable"
commitment, the former:

- Internal automatic recalculation of `fingerprint` and increment of `revision`;
- The caller passes in an object, the function returns the new object, and the old object is fully available (can be
  Other turn sharing/rollback/debugging);
- Compiler help: no one can "forget" to update fingerprint.

Similar disciplines:
- `Turn.items` always use `appendTurnItem(turn, item)` and the like, don’t
  `turn.items.push(item)`;
- `UsageSnapshot` is a plain object, but merging must be done through `addUsage(a, b)`.

### 4.2 Distinguish between "safe failure" and "fast failure"

- `RuntimeEventRecorder` validation failure → throw → test can detect immediately (fail quickly).
- `local-tool-host.execute` is handled by abort → throw → caller.
- `LruCache.set` is full → Silent evict to prevent cache from becoming an availability bottleneck.
- `WebSocket-like SSE` was interrupted → silently clean up the subscription and wait for reconnection.

Judgment criteria: Will this failure cause problems with "user experience" or "system consistency"?
- will → throw / return an error result.
- No, it's just a performance issue → Silent degradation.

### 4.3 Separate "what to do now" and "what to do in the future"

`AgentLoop.modelStep` is currently a sequential flow: wait for model → run tool → wait for model.
Only connect ports in front of it, do not connect "RAG to be added next step" and "RAG to be added next step"
cache route".

**Contribution Rules**:
- A PR changes a clear concept;
- Don't just "if you change this, fix X too";
- `loop/agent-loop.ts` do not import `node:fs`, do not perform git operations,
  Even if "it seems convenient now".

### 4.4 Testing covers every level

Every new feature should have at least these tests:

| Hierarchy | Test Type | File |
| --- | --- | --- |
| contracts (zod) | Schema parsing and validation failed | `kun/tests/contracts.test.ts` |
| domain/cache | Pure functional behavior | `kun/tests/cache.test.ts` |
| ports (in-memory) | interface contract | `kun/tests/ports.test.ts` |
| loop | Run full loop with in-memory fakes | `kun/tests/loop.test.ts` |
| server | Use ephemeral port + fetch / EventSource to run HTTP contract | `kun/tests/http-server.test.ts` |
| adapters (file) | tmp directory, append / atomic / corrupted JSONL fault tolerance | `kun/tests/loop.test.ts` (FileSessionStore part) |

If a change is not covered in a certain layer, first ask "which layer should be changed" and then test.

### 4.5 Documentation precedes code, but is synchronized with code

- `docs/kun-architecture.md` describes "why it is designed this way";
- `kun/README.md` description CLI/env/data dir;
- `docs/kun-contributing.md` (this article) describes "how to contribute";
- `docs/AGENTS.md` describes which files should be changed when extending.

**Contribution Rules**:

- Any new/modified contract must update the `kun/README.md` side at the same time
  point table;
- For any changes/references/acknowledgments, update `README.md` and `README.en.md`
  Thanks chapter;
- Inconsistent doc/code is worse than missing - the PR should change both.

---

## 5. Step template for typical contribution scenarios

The following four scenarios cover 90% of the PR, each following the above pattern.

### Scenario A: Add a new tool (such as shell exec)

1. **contracts**:`kun/src/contracts/items.ts` is already supported
   `tool_call` / `tool_result`, **No need to change**.
2. **domain**:`kun/src/domain/item.ts` already exists
   `makeToolCallItem` / `makeToolResultItem`, **no need to change**.
3. **adapters**: in `kun/src/adapters/tool/local-tool-host.ts`
   Add a `LocalTool`:

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

4. **adapters barrel**: in `kun/src/adapters/tool/local-tool-host.ts`
   Barrel already exists; just append `shellTool` to the `defaultLocalTools` array.
5. **Test**: Add one to `kun/tests/ports.test.ts`
   `runs a shell tool with approval` test.
6. **Documentation**: Described in the default tools list of `kun/README.md`.

Does not involve `loop/`, `server/`, `services/`. Changes are isolated to a small area.

### Scenario B: Add a new model provider (such as OpenAI compatible)

1. **ports**:`ModelClient` is already an abstract interface, **no need to change**.
2. **adapters**:`kun/src/adapters/model/openai-compat-model-client.ts`
   Create a new one (refer to the SSE parsing logic of `deepseek-compat-model-client.ts`).
3. **adapters barrel**:`kun/src/adapters/index.ts` exports new classes.
4. **settings**: in `kun/src/contracts/...` or the caller
   `ServeOptionsSchema` adds `modelProvider` field (if you need to switch).
5. **composition root**: serve in `kun/src/server/...`
   Which adapter to inject is selected according to the settings in bootstrap.
6. **Test**: `kun/tests/ports.test.ts` Add model behavior test;
   `kun/tests/http-server.test.ts` adds end-to-end testing.
7. **Document**: `kun/README.md` The endpoint table remains unchanged, but
   The "model" field is semantically rich.

Does not involve `domain/`, `loop/`, `contracts/`.

### Scenario C: Add a new SSE event type (such as "compaction_progress")

1. **contracts**:`kun/src/contracts/events.ts`:

```ts
   export const CompactionProgressEvent = RuntimeEventBase.extend({
     kind: z.literal('compaction_progress'),
     progress: z.number().min(0).max(1),
     note: z.string().optional()
   })
   // add it to RuntimeEvent z.discriminatedUnion

```

2. **services**:`RuntimeEventRecorder` has been accepted
   `RuntimeEvent` discriminated union, **no need to change**.
3. **loop**: in `kun/src/loop/context-compactor.ts` or
   The appropriate location for `agent-loop.ts` is `await this.opts.events.record({ kind: 'compaction_progress', ... })`.
4. **server**: SSE of `kun/src/server/routes/events.ts`
   The encoder is already based on `RuntimeEvent.kind` routing and does not need to be changed.
5. **renderer mapping** (GUI side): `src/renderer/src/agent/kun-runtime.ts`
   Dispatch to `sink.onCompactionProgress(...)` in `subscribeThreadEvents`
   (if needed). **This is a GUI package, not kun**.
6. **Test**:
   - `kun/tests/contracts.test.ts`: Add variant parsing test;
   - `kun/tests/loop.test.ts`: Add emit assertion.
7. **Document**:`kun/README.md` The endpoint table remains unchanged, only SSE events
   Add a row to the list.

Just change contracts + loop + tests. server/composition root/domain
No need to touch.

### Scenario D: Add a new persistence layer (such as SQLite)

1. **ports**:`ThreadStore` / `SessionStore` is already an interface,
   **No changes required**.
2. **adapters**:`kun/src/adapters/sqlite/sqlite-thread-store.ts`
   Create new and implement `ThreadStore`.
3. **adapters barrel** + **composition root** in serve bootstrap
   Switch store type.
4. **Test**: `kun/tests/ports.test.ts` Add a copy for SQLite
   Contract testing (using temporary database).

Does not involve `domain/`, `loop/`, `services/`, `server/`, `contracts/`.
Fully pluggable, that's how Ports & Adapters should be.

---

## 6. PR Checklist

Before submitting a PR, confirm each item:

### 6.1 Must do

- [ ] Write new code at the appropriate layer (compare the table of contents in §2)
- [ ] Any "multiple form" objects are derived from the zod schema, do not write another `type`
- [ ] All public functions have JSDoc, indicating input/output/failure modes
- [ ] New ports/contracts/loop functions have at least 1 test
- [ ] run `cd kun && npm run typecheck && npm test`
- [ ] run `cd .. && npm run typecheck && npm test`
- [ ] Do not modify any files other than those described in `docs/kun-architecture.md`
      to "bypass" typecheck

### 6.2 Recommended

- [ ] Complex design decisions (why ports work like this, why use a certain event stream)
      Write it in the PR description
- [ ] When the public contract is changed, update the `kun/README.md` endpoint table
- [ ] When references/acknowledgments change, update root directories `README.md` and `README.en.md`
- [ ] When adding a new SSE event, add a line to `docs/kun-architecture.md`- [ ] in the borrow map of `docs/kun-architecture.md` (as in the future
      Add OpenAI-style reference) to explain the design source

### 6.3 Don’t do it

- Do not reference ports, node:* API in domain/cache/telemetry
- Do not call `bus.publish` directly in `loop/agent-loop.ts` /
  `store.appendEvent`(must go to `events.record`)
- Do not use `new` specific adapter in server routes (use injected
  `ServerRuntime`)
- Don't hardcode the time (use `Clock` or `nowIso()`)
- Don't hardcode the id namespace (use `IdGenerator`)
- Don't delete legacy annotations/old APIs "by the way" because of a PR

---

## 7. What to do if you encounter problems

- **Not familiar with zod discriminated union**: refer to `kun/src/contracts/items.ts`
  And `kun/src/contracts/events.ts`, see how to write the existing variant.
- **I don’t know which kind of event should go**: first discriminated in `RuntimeEvent`
  Add variant to union, and then use `loop` to emit using `events.record({...})`
  it. SSE routing will find it automatically.
- **Test cannot be written**:
  - If you need I/O like `node:fs`, your function should be in services/
    or server/ instead of loop/;
  - If you need a specific model, you should use in-memory fake;
  - If you need to see the time, you should inject `Clock` or `nowIso()`.
- **Want to read git/file system in loop**: Add a new method to port (for example
  `WorkspaceInspector.status`), and then inject it when `AgentLoop` is constructed.

---

## 8. Summary

Back to the "one sentence summary" at the beginning:

> **Kun is a strict implementation of Ports & Adapters + Functional Core /
> TypeScript package for Imperative Shell**.

Every new PR follows this diagram: define contract → describe port → write functional
core → write imperative shell → write adapter → write server route → write
Test → Sync Documents. Discipline is better than cleverness, simplicity is better than fancy, testability is better than "fast"
Speed".
