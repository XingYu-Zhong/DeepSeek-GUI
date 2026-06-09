# Kun cache optimization technical documentation

This article records the cache optimization design, implementation location, and implementation of the current Kun runtime of DeepSeek GUI.
Statistical caliber and subsequent evolution direction. The goal is not to simply "get the cache numbers high" but to keep the GUI and
the local agent's request prefix long-term stable, verifiable, and observable across Code, Write, and Connect phone.

## Target

Kun's cache optimization serves four goals:

- Make request prefixes sent to DeepSeek as byte stable as possible.
- Make cache hit statistics consistent with DeepSeek native fields instead of relying on guesswork.
- Let prefix drift and message history pollution be discovered during development.
- Let the GUI only bear the responsibility of HTTP/SSE calls, and consolidate the caching discipline inside Kun.

The higher-level product goal is to improve the ROI of every token.
The user's context budget should become useful reasoning, code changes,
requirement clarification, and executable conclusions, instead of being
spent on repeated tool schemas, oversized tool output, MCP catalogs,
useless retries, or history noise.

Kun therefore treats token optimization as a combined strategy, not a
single cache-hit metric:

- **Stable cacheable prefix**: system prompt, tool schemas, few-shots,
  and pinned constraints enter the immutable prefix and are verified with
  fingerprints.
- **Compressed dynamic history**: long threads use compaction that
  preserves goals, constraints, decisions, tool results, and unresolved
  next steps.
- **Bounded tool output**: long `tool_result` values, completed long
  arguments, base64 payloads, and repeated lines are compressed only at
  the model-request boundary; the on-disk log keeps the full history for
  replay and auditing.
- **Progressive MCP discovery**: when there are too many MCP tools,
  `mcp_search`, `mcp_describe`, and `mcp_call` let the model find
  relevant tools first, then request the full schema and call the exact
  tool, instead of sending every tool definition on every turn.
- **Observable savings**: usage events record cache hit/miss, token
  economy savings, and cost estimates so savings can be measured rather
  than guessed.

## General principles

Kun borrowed Reasonix’s cache-first design, but adapted it to the GUI scenario:

- The GUI does not spell prompt, and does not make cache judgments in renderer or main process.
- `kun serve` is the only request exit, and cache-related strategies are placed inside the runtime.
- Separation of stable prefixes and dynamic contexts: the stable part pursues reuse, and the dynamic part only allows appending.
- Statistics, verification, and regression testing are maintained together to avoid the illusion that "the implementation has changed, but the panel numbers still look good."

## Request prefix stabilization

### 1. Stable system prompt word

Kun uses a separate stable system prompt word file:

- `kun/src/prompt/kun-system-prompt.ts`

This prefix only carries long-term stable operation contracts, for example:

- Kun identity
- GUI call boundaries
- Tool behavior constraints
- Cache behavior constraints
- Reply style and quality requirements

The following content cannot enter the stable prefix:

- workspace path
- current time
- file fragment
- Select text
- Temporary plan
- One-time tool results
- User context that changes with turn

### 2. ImmutablePrefix fingerprint

Kun manages system prompts, tools, and pinned constraints through `ImmutablePrefix`
and few-shots, and generate stable fingerprints for these:

- `kun/src/cache/immutable-prefix.ts`

There are several key points in the current implementation:

- Tools will do canonical sort first and then enter fingerprint.
- The key order of JSON schema will be normalized to avoid object key order from disturbing the cache.
- few-shot fingerprint only calculates the content that will actually be sent to the model, not `id`,
  Storage layer dynamic fields such as `turnId`, `threadId`, timestamp, etc.
- `verifyImmutablePrefix()` will verify whether prefix is bypassed before each model step
  mutator directly modifies.

Verify access point:

- `kun/src/loop/agent-loop.ts`

This means that if prefix silently drifts during the development period, it will not only be reflected in "cache deterioration", but will
Throw drift errors directly to help locate them as early as possible.

### 3. Tool definition stabilization

The toolset itself is part of the prompt prefix. Kun will do the following before sending a request:

- Tools array sorted by `name`
- `inputSchema` recursively canonicalize
- Record canonical tool catalog fingerprint and tool count for each turn
- If the tool catalog fingerprint drifts under the same thread/mode/skill/tool-scope,
  turn metadata will mark `toolCatalogDrift`

Implementation location:

- `kun/src/adapters/model/deepseek-compat-model-client.ts`
- `kun/src/cache/tool-catalog-fingerprint.ts`
- `kun/src/loop/agent-loop.ts`

In this way, even if the registration order of the same set of tools is different, the tools payload finally sent to the model will remain stable.If a dynamic provider or skill causes the tool description/schema to change unexpectedly, you can also turn
The metadata directly locates which round started to disturb the cache prefix.

## Historical message cleaning

In addition to prefix stability, historical messages themselves also affect caching and availability.

Kun currently performs a shared model history repair on messages at the model request boundary:

- Orphan `tool_result` is not uploaded
- The `tool_call` corresponding to result is missing and will not be uploaded.
- Multiple `tool_call` in the same model response will be reassembled into a valid assistant
  `tool_calls` message, followed by the corresponding `tool_result`
- streaming tool-call delta will be merged by provider `id` / `index` to avoid subsequent fragments
  When `id` is missing, it is misinterpreted as a new tool call.
- If there is assistant text, reasoning, approval or
  GUI-only bridge items such as user_input still maintain legal pairings when sent to the model
- The repaired history will enter token estimation, compaction and request hygiene in AgentLoop
  Use before use to avoid deformed tool history pollution summary and cache hot prefix ratio

Implementation location:

- `kun/src/domain/model-history-repair.ts`
- `kun/src/adapters/model/deepseek-compat-model-client.ts`
- `kun/src/loop/agent-loop.ts`

Kun will also do a layer of Reasonix-style history hygiene at model request boundaries:

- Only the history sent to the model is compressed, and the complete tool results saved in the disk/session are not changed.
- Extra large `tool_result` will retain head,
  tail and error/warning signal lines.
- For `tool_call` that already has result matching, its long string parameters will be replaced with placeholder instructions.
- The base64 payload will be replaced with a short placeholder to prevent image/binary content from contaminating subsequent requests.

Implementation location:

- `kun/src/loop/request-history-hygiene.ts`
- `kun/src/loop/agent-loop.ts`

Repeat-loop guard is also enabled within the same turn:

- The third identical `(toolName, arguments)` will be suppressed.
- Kun will write an error `tool_result` to let the model converge to a narrower query or explain the reason.
- File change tools will clear previous read-only call records to avoid misjudgment of "reread after editing".

Consecutive calls to the built-in read-only utility do conservative concurrency:

- Only the four built-in `tool_call` of `read`, `grep`, `find` and `ls` are concurrent.
- Maximum 3 per batch, encounter write class, command execution, `untrusted` / `never`
  Runtime policy or non-built-in provider will fall back to sequential execution.
- Tools can be executed concurrently, but the final `tool_result` is still written to the history in the call order given by the model,
  Avoid completion order jitter causing instability in the dynamic history of the next request.

Implementation location:

- `kun/src/loop/tool-storm-breaker.ts`
- `kun/src/loop/agent-loop.ts`

Fork / resume also fixes the clone history when creating a new thread:

- Orphaned `tool_result` is not copied to new threads.
- `tool_call` without matching result is not copied to new thread.
- The subset that can be completed in the same tool-call block will be retained, and bad pairs will not drag out good pairs.
- The original thread is not modified, and repairs only apply to the replayable history of the new fork/resume.

Implementation location:

- `kun/src/domain/model-history-repair.ts`- `kun/src/services/thread-service.ts`

There are several direct benefits to doing this:

- Prevent DeepSeek from returning 400 due to illegal message structure
- Avoid lowering the cache hot prefix ratio due to retry, historical pollution or large tool results
- Avoid repeated tool loops that continue to expand dynamic history and create meaningless cache misses
- Avoid inheriting malformed tool history for the first request after fork/resume

## Cache statistics caliber

Kun's cache hit statistics preferentially use DeepSeek's native usage field:

- `prompt_cache_hit_tokens`
- `prompt_cache_miss_tokens`

Only when the native field is missing will it fall back to the compatible field:

- `prompt_tokens_details.cached_tokens`
- `cache_read_input_tokens`

Implementation location:

- `kun/src/adapters/model/deepseek-compat-model-client.ts`

The hit rate formula uses:

```text
cacheHitRate = hit / (hit + miss)

```

instead of:

```text
cacheHitRate = hit / prompt_tokens

```

The reason is that DeepSeek's native miss caliber is not guaranteed to be equal to `prompt_tokens - hit`. If the denominator is wrong,
Panels that look "high" or "low" could just be statistical distortions.

The cumulative statistics use the same formula simultaneously to avoid inconsistency between the caliber of a single round and the cumulative panel:

- `kun/src/telemetry/usage-counter.ts`
- `kun/src/domain/usage.ts`

Kun will also use a single round of real `prompt_tokens` as the compaction pressure for the next request.
If the number of prompt tokens reported by the provider has reached the current model soft threshold, the next time
The model step will trigger compaction first; this is more efficient than relying solely on local estimates of 4 characters/token.
Close to the actual context pressure of DeepSeek, it can also maintain the proportion of hot prefixes before tool continuation.

Implementation location:

- `kun/src/loop/agent-loop.ts`
- `kun/src/loop/context-compactor.ts`

When the Serve runtime starts, it will also restore the accumulation from the latest persisted usage event of each thread.
usage/cache counters：

- After restart or resume, `/v1/usage` in runtime mode will not accumulate cache hit/miss values
  Start over from 0.
- Only restore `cacheHitTokens` / `cacheMissTokens` that have been explicitly saved in the event, and will not
  Only old events compatible with `cachedTokens` are guessed as hits.
- The aggregation bucket of `/v1/usage?group_by=thread|day|model` can only be used explicitly
  `cacheHitTokens` / `cacheMissTokens` cumulative `cached_tokens` and
  `cache_miss_tokens`; When old events only have `cachedTokens`, the hit rate remains unknown.
- Renderer's realtime usage mapper and thread usage hook also remain unknown:
  Do not re-derive hit/miss or hit rate when only seeing old event/aggregation buckets compatible with `cachedTokens`.

Implementation location:

- `kun/src/services/usage-service.ts`
- `kun/src/server/runtime-factory.ts`
- `src/renderer/src/agent/kun-mapper.ts`
- `src/renderer/src/hooks/use-thread-usage.ts`

## Observability and verification

Cache optimization must be verifiable and not just a design slogan.

There are currently three layers of verification:

### 1. Unit testing

Kun has covered these key behaviors:

- Native `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` are parsed first
- tools canonical sorting and schema key stabilization
- few-shot dynamic id should not perturb fingerprint
- Illegal prefix directly triggers drift verification
- Incomplete tool pairs should not be sent to the model

Main testing locations:

- `kun/tests/cache.test.ts`
- `kun/tests/model-client.test.ts`

### 2. Runtime usage API

The GUI uses a unified interface to read usage through Kun:

- `GET /v1/usage?group_by=thread`
- `GET /v1/usage?group_by=day`

Current product expectations are:

- Cold start first round may be close to 0
- After the prefix becomes popular, the short-round dialogue should maintain a stable and high hit rate.

### 3. Real thread warm-up verification

Kun actual measurement results on 2026-06-02:

- 12 rounds of short messages: the hot hit after removing the cold start is about `94.7%`
- 24 rounds of short messages after warm-up with the same stable prefix: overall about `95.2%`
- The latest single round can reach `98.1%`Need to pay attention to:

- usage events written during the old implementation cannot be repaired afterwards
- If the old thread did not save the native hit/miss field at that time, the history panel will continue to reflect the old caliber.

## Boundary to GUI

This document emphasizes a production-level constraint: cache optimization belongs to Kun, not the GUI.

The GUI side should only do:

- runtimeRequest
- SSE Subscription
- usage display
- Approval interacts with user input

The GUI should not do:

- Dynamically rewrite system prompts
- Local assembly tools schema sequence
- Guess the cache hit rate formula
- Temporarily correct usage statistics for display effect

In this way, the Code / Write / Connect phone entry points can share the same set of caching disciplines.

## Current referenced and unfinished items

Reasonix ideas that have been implemented:

- Stable prefix file
- immutable prefix fingerprint
- Tool schema canonical sorting
- tool catalog fingerprint / drift metadata
- DeepSeek native cache fields are given priority
- tool-call / tool-result pairing fix
- multi-tool call block reorganization and complete subset salvage
- streamed tool-call delta press `index` to continue
- Request bounds for large tool results and long tool args hygiene
- True `usage.prompt_tokens` drives next compaction
- Restore persisted cache token carryover at runtime startup
- Repeat tool call storm breaker with turn
- The built-in read-only tool in turn can be used concurrently in small batches and placed in the order in which it is called.
- fork/resume fix tool pairing when cloning history

Points worth learning from in the next stage:

- Tool collection mutation gate: It is acceptable to add new tools, but it is best to have them when editing, rearranging, and deleting tools.
  Explicit restart or new session boundaries
- LLM fold summarizer: If you use the model for compaction in the future, you should reuse the main prefix to avoid
  The summarizer turns itself into a cold request
- Big tool result token cap: Currently lightweight token-aware estimation has been added; DeepSeek will be built-in in the future
  tokenizer, which can be changed to the precise upper limit of tokens like Reasonix
- Volatile scratch boundary: continue to separate "the thinking displayed to the user" and the "history replayed to the model"

## Related documents

- Architecture overview: `docs/kun-architecture.md`
- Kun Contributing Guide: `docs/kun-contributing.md`
- Kun usage instructions: `kun/README.md`
