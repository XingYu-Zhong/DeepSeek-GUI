# Kun GUI single-runtime architecture

This document describes how DeepSeek GUI should now be organized around one dedicated runtime,
`Kun`, that serves the GUI through a single HTTP/SSE boundary.
The conclusion is clear up front: the GUI keeps one agent with the only ID
`kun`; Code, Write, and Connect phone all flow through the same `kun serve`
HTTP/SSE boundary.
CodeWhale, Reasonix, painting/design entry points, runtime diagnostics panel,
and agent switching are no longer shown as primary product surfaces.

## Target boundary

```text
Renderer (React + Zustand)
  Code / Write / Connect phone UI
        |
        | window.dsGui.runtimeRequest(path, method, body)
        | window.dsGui.startSse(threadId, sinceSeq)
        v
Preload IPC bridge
        |
        v
Main process
  RuntimeHost -> kunRuntimeAdapter
  process/config/port/token management only
        |
        v
kun serve (TypeScript package)
  /health
  /v1/threads
  /v1/threads/{id}/turns
  /v1/threads/{id}/events
  /v1/threads/{id}/fork
  /v1/sessions/{id}/resume-thread
  /v1/approvals/{id}
  /v1/user-inputs/{id}
  /v1/usage
  /v1/workspace/status
```

This boundary follows the HTTP architecture used by TUI/CodeWhale: GUI never embeds the agent loop,
does not juggle multiple state machines through stdio/RPC, and treats the local
HTTP server as the stable API boundary.
Inside `kun`, the cache-first agent loop is adopted from Reasonix (`immutable` prompt
prefix, append-only log, bounded LRU/TTL cache, inflight cleanup, steering queue,
context compaction, usage/cache telemetry).

## Cache-hit optimization

Kun cache-hit metrics should be computed and optimized using DeepSeek native fields first:

- Model client prefers native fields:
  `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
  Only when those are missing should it fall back to compatibility fields
  such as `prompt_tokens_details.cached_tokens` and `cache_read_input_tokens`.
- Use hit rate as `hit / (hit + miss)`, not `hit / prompt_tokens`.
  DeepSeek native misses are not always equal to `prompt_tokens - hit`; Reasonix also uses
  the `hit + miss` denominator.
- `kun/src/prompt/kun-system-prompt.ts` is the stable prefix.
  It may only contain long-lived Kun run contract content and must not include
  workspace names, timestamps, file snippets, selected text, user dynamic state,
or one-off tool outputs.
- `ImmutablePrefix` must run `verifyImmutablePrefix()` before each model step.
  If `setSystemPrompt` / `setTools` / `setFewShots` bypasses this contract,
developer/runtime checks should surface fingerprint drift immediately instead of
quietly reducing cache behavior.
- Few-shot fingerprint only includes payload actually sent to the model.
  It should not include dynamic GUI/storage fields like `item id`, `turn id`, `thread id`,
or timestamps.
- Tool schema is canonicalized before sending to the model.
  Stable ordering avoids prefix churn caused by schema reordering.
- Each turn persists a canonical tool-catalog fingerprint and count.
  If a scope detects tool-definition drift, `toolCatalogDrift` is recorded to aid cache debugging.
- Before sending historical messages to DeepSeek, repair message history:
  no orphaned `tool_result`, no `tool_call` whose result is missing.
  Multiple tool calls in one response are reorganized into a single legal
  assistant `tool_calls` message to reduce 400/retry loops.
- Consecutive built-in read-only tools (`read` / `grep` / `find` / `ls`) in one model turn
  are executed in small concurrent batches, while `tool_result` entries are still written
  in tool-call order to avoid ordering noise in replay history.
- Serve runtime restores cumulative cache hit/miss counters from persisted usage events.
  After restart/resume, usage totals do not restart from zero.
- Dynamic context must be appended **after** stable prefix.
  `compaction`, `resume`, `fork`, and plan context must not rewrite the stable prefix.

Cold-start hit rate can be low (or zero) on the first round because the service has no prior
matching prefix yet. Once warmed up, hit rate should stably exceed 90%.
Observed temporary-thread verification on `2026-06-02`:

- 12 short-message turns: hot hit `94.7%` after excluding first-start warm-up rounds,
  latest round `93.6%`.
- 24 short-message turns after warming with the same stable prefix:
  overall (including warm-up) `95.2%`, latest round `98.1%`.

Pre-existing usage events persisted before optimization cannot be rewritten because
DeepSeek native cache fields were not recorded then; they only reflect old behavior and
should not be treated as evidence that current hit rates are lower.

Reasonix findings still useful as future references:

- Tool-collection mutation policy: adding tools should be append-only; edit/reorder/remove
  requires either restart or a new session boundary to avoid sudden cache misses.
  Current Kun canonicalizes schema, but this mutation policy still needs explicit product-level
  enforcement.
- LLM fold summarizer: `ContextCompactor` is currently local summary logic with no extra
  model call. If model-based summarization is introduced later, it should reuse
  main-agent `system`/`tools`/`few-shot` prefix so summary calls can share cache.
- Large tool-result bounds and long-argument markerization: current outputs are smaller;
  if shell/file-fulltext/web-scraping tools are added, tool results should be token
  bounded or tokenized before entering history to avoid log bloat.
- Volatile scratch boundary: assistant reasoning is not sent back to the model by default
  but can still appear in GUI history. For future internal plans, temporary scratchpads,
or sub-agent scratch, keep “displayable” and “replayable to model” separated.

## Renderer-side removal items

Renderer should only expose Kun. The UI sections listed below should be removed or
kept removed:

- Agent switcher: `AgentSwitcher` is no longer shown; `AGENT_CATALOG` only includes `kun`.
- Top connection status + runtime diagnostics entry: runtime detection is no longer the
  user entrypoint.
- Runtime insights / right panel: retain only `Changes`, `Preview`, `Plan`, and GUI workspace
  views (`File`, etc.); remove runtime/usage control surfaces.
- Slash menu commands `/usage`, `/runtime`: these imply switchable runtimes and should be removed.
- Settings provider selector: `Settings -> Agents` directly edits Kun config including:
  `binaryPath`, `port`, `autoStart`, `apiKey`, `baseUrl`, `runtimeToken`, `dataDir`,
  `model`, `approvalPolicy`, `sandboxMode`, `insecure`.
- Painting/Design starter card is removed; only Code, Write, and Connect phone remain.

## Main / preload responsibilities to remove

Main process and preload no longer expose old provider IPC:

- Remove `deepseek:spawn-if-needed`, `deepseek:update-*`, `deepseek:diagnostics`.
- Remove `reasonix:rpc-send`, `reasonix:spawn-if-needed`, and the `reasonix` RPC bridge.
- Remove CodeWhale adapter, Reasonix adapter, Reasonix HTTP bridge,
  DeepSeek/CodeWhale updater, legacy binary resolver, and old process manager.
- Remove diagnostic/importer modules unrelated to Kun.

Main process now only needs:

- `kunRuntimeAdapter`: start/stop `kun serve`, sync config, calculate base URL,
and append auth headers.
- `runtimeRequestViaHost`: forward `/v1/*` after ensuring Kun is running.
- `startSse` / `stopSse`: forward Kun SSE streams keyed by `threadId + sinceSeq`.

## Settings / migration

Saved settings should now be just:

```json
{
  "agentProvider": "kun",
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 8899,
      "autoStart": true,
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/beta",
      "runtimeToken": "",
      "dataDir": "~/.deepseekgui/kun",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "insecure": false
    }
  }
}
```

The only reason strings `codewhale` and `reasonix` remain in code is for one-time
migration from old settings:

- `agentProvider: codewhale | reasonix | deepseek-runtime` normalizes to `kun`.
- Old `agents.deepseek` / `agents.codewhale` values for `port`, `autoStart`, `apiKey`,
  `baseUrl`, `runtimeToken`, `approvalPolicy`, and `sandboxMode` are migrated into
  `agents.kun`.
- Old `agents.reasonix` values for `apiKey`, `baseUrl`, `model`, and `autoStart`
  are also migrated to `agents.kun`.
- Persisted files after migration no longer retain `agents.codewhale` / `agents.reasonix`.
- Legacy Connect phone fields (internally still named Claw) `agentThreadIds.codewhale` and `agentThreadIds.reasonix` are collapsed
  to `agentThreadIds.kun`; per-provider maps are not retained.

## Code / Write / Connect phone flows under Kun

- Code: `KunRuntimeProvider` handles list/create thread, send turn,
  steer, interrupt, compact, approval, and SSE mapping.
  Chat UI does not directly know about old providers.
- Write: writing assistant and inline completion share the same Kun API key/base URL.
  Write thread registry identifies write threads as Kun threads only, with no Reasonix distinction.
- Connect phone: scheduled tasks, Feishu/Lark/WeChat, and IM webhooks create or reuse Kun threads.
  The codebase still uses the internal `claw` route, settings key, and runtime file names for legacy-name compatibility.
  `threadId` / `localThreadId` remain only for legacy settings compatibility;
  canonical mapping is written to `agentThreadIds.kun`.

## Functional parity from CodeWhale in GUI HTTP path

Replacing CodeWhale is not only preserving chat.
Kun GUI HTTP must expose the same capabilities previously exposed through CodeWhale:

- `GET /v1/threads` supports `limit`, `search`, `include_archived`, `archived_only`.
  Archived/deleted threads are hidden by default; session search and archive views
  should not depend on GUI-level guessing.
- `POST /v1/threads/{id}/fork` duplicates thread history, records fork lineage,
  and writes historical items back into the new thread's session store.
  During copy, pending `approval` / `user-input` states are rewritten to history-only
  states to prevent hanging gates in new sessions.
- `POST /v1/sessions/{id}/resume-thread` follows the previous CodeWhale resume path.
  Kun should first attempt same-name thread restore, then session snapshot/JSONL reconstruction,
and return `404` when not found.
- Both `POST /v1/user-inputs/{id}` and legacy `POST /v1/user-input/{id}` are accepted,
  with `{ answers }` or `{ cancelled: true }`.
  `request_user_input` / `user_input` tool pauses a turn and resumes after GUI answer.
- `POST /v1/approvals/{id}` continues tool approval. Both approval and user-input flows
  use gate/route/service layering; no agent logic is implemented in renderer.
- `GET /v1/usage?group_by=thread|day` returns accumulated token/turn/cache-hit counters.
  Workbench home and composer footer consume Kun usage only and do not open runtime
  insight panels.

## Paths that must remain removed

Legacy runtime paths should not reappear:

- `src/renderer/src/agent/codewhale-runtime.ts`
- `src/renderer/src/agent/reasonix-runtime.ts`
- `src/renderer/src/agent/reasonix-event-mapper.ts`
- `src/main/runtime/codewhale-adapter.ts`
- `src/main/runtime/reasonix-adapter.ts`
- `src/main/runtime/reasonix-http-bridge.ts`
- `src/main/deepseek-process.ts`
- `src/main/resolve-deepseek-binary.ts`
- `src/main/deepseek-updater.ts`
- `src/main/reasonix-process.ts`
- `src/main/reasonix-config.ts`
- `src/main/resolve-reasonix-binary.ts`
- `src/shared/reasonix-protocol.ts`
- `src/shared/deepseek-update.ts`
- Diagnostic/importer modules for old runtime paths.

Legacy UI entrypoints should not reappear:

- `AgentSwitcher`
- `ConnectionStatusBar`
- `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- `ReasonixInsightsPanel`
- Design/Painting starter card

## Design constraints

Kun packages are organized by ports & adapters:

- `contracts/`: HTTP/SSE DTOs and zod schemas.
- `ports/`: ModelClient, ToolHost, ThreadStore, SessionStore,
  ApprovalGate, EventBus, WorkspaceInspector, Clock.
- `adapters/`: DeepSeek-compatible model client, local tool host,
  file/in-memory stores, workspace inspector.
- `loop/`: AgentLoop, InflightTracker, SteeringQueue, ContextCompactor.
- `cache/`: ImmutablePrefix, LRU, TTL-LRU.
- `server/`: Router, auth, SSE, routes.

Renderer should never implement agent business logic; it only maps HTTP client/SSE state
and forwards results. When adding capability, add Kun tool or HTTP endpoint first,
and only then add renderer wiring if needed (not both).

## Verification list

Any change touching the architecture should run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke checks:

1. Open DeepSeek GUI.
2. Code can create a new session, send messages, stream output, and use approval/interruption.
3. Write opens writing space; inline completion and inline selected-text assistant share API key.
4. Connect phone can save settings, run manual tasks, and write thread IDs back to Kun mapping.
5. `Settings -> Agents` shows only Kun, with no provider switch and no runtime diagnostics/
   CodeWhale/Reasonix blocks.
6. If `GET /v1/usage?group_by=thread` returns history, home and footer no longer show
   blank “No usage yet”, but show token, turn, cache-hit indicators.
7. Thread search, archive, fork/resume, and request_user_input answer/cancel flows all operate
   through Kun HTTP paths.
