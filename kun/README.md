# Kun

Kun is the local HTTP/SSE agent runtime for DeepSeek-GUI. It exposes a
TypeScript-typed agent loop with a stable, GUI-friendly contract:

- `kun serve` starts a local HTTP server with `/v1/*` routes.
- Threads, turns, events, approvals, and usage are persisted as append-only
  JSONL logs with atomic index updates.
- The loop is cache-first by construction: immutable prompt prefix, bounded
  TTL/LRU caches, inflight tracking, and explicit context compaction.

The name Kun is inspired by the great fish in Zhuangzi's line,
"In the northern sea there is a fish; its name is Kun." In
DeepSeek-GUI, it means a deeper local runtime rather than a thin model
UI: one agent loop that can carry project context, call tools
reliably, resume sessions, and serve desktop chat, writing, phone
connections, and scheduled tasks.

Kun's core goal is to improve the ROI of every token. Tokens should be
spent on user requirements, code, decisions, and results, not repeated
tool schemas, runaway tool output, malformed history, useless retries,
or stable prefixes that could have been reused from cache.

## Layout

```
kun/
  src/
    cli/         Command-line entrypoints (serve, run, chat, exec)
    contracts/   Zod schemas and inferred types for the HTTP/SSE contract
    domain/      Thread, Turn, Item, Event, Approval, Usage entities
    ports/       ModelClient, ToolHost, stores, EventBus, ApprovalGate, ...
    adapters/    DeepSeek-compatible model client, local tool host,
                 in-memory and file-backed stores, workspace inspector
    services/    Thread and turn orchestration services
    loop/        The cache-first agent loop and inflight helpers
    cache/       LRU / TTL caches and immutable prefix utilities
    telemetry/   Usage, cache, and cost counters
    server/      HTTP routing, auth, SSE, response helpers
  tests/         Cross-cutting contract tests
  dist/          Build output (gitignored)
```

## Scripts

Run from the `kun/` directory.

- `npm run typecheck` – run the package typecheck (no emit).
- `npm run test` – run Vitest unit and contract tests.
- `npm run build` – emit ESM JavaScript and type declarations into `dist/`.
- `npm run serve` – start the runtime after a build.
- `npm run dev` – rebuild in watch mode.

## CLI

`kun serve` accepts the following flags:

| Flag | Description | Default |
| --- | --- | --- |
| `--config` | JSON config file. If omitted, Kun reads `{--data-dir}/config.json` when present | optional |
| `--host` | Bind address | `127.0.0.1` |
| `--port` | HTTP port | `8899` |
| `--data-dir` | Root directory for threads, events, and usage | required |
| `--runtime-token` | Bearer token for `/v1/*` requests | empty |
| `--api-key` | DeepSeek-compatible API key | empty |
| `--base-url` | DeepSeek-compatible model API base URL | `https://api.deepseek.com/beta` |
| `--model` | Default model id | `deepseek-v4-pro` |
| `--approval-policy` | `on-request` \| `untrusted` \| `never` \| `auto` \| `suggest` | `auto` |
| `--sandbox-mode` | `read-only` \| `workspace-write` \| `danger-full-access` \| `external-sandbox` | `workspace-write` |
| `--insecure` | Disable bearer token check (local dev only) | off |

Example:

```bash
kun serve \
  --config ~/.deepseekgui/kun/config.json \
  --host 127.0.0.1 \
  --port 8899 \
  --data-dir ~/.deepseekgui/kun \
  --runtime-token dev-token \
  --api-key "$DEEPSEEK_API_KEY" \
  --model deepseek-v4-pro
```

Kun can also run as a standalone agent without the GUI:

```bash
kun run --data-dir ~/.deepseekgui/kun --workspace "$PWD" "summarize this repo"
kun chat --data-dir ~/.deepseekgui/kun --workspace "$PWD"
kun exec --data-dir ~/.deepseekgui/kun --workspace "$PWD" --list-tools
kun exec --data-dir ~/.deepseekgui/kun --workspace "$PWD" read --args '{"path":"README.md"}'
```

- `kun run` creates a thread, runs one turn, streams assistant text, and exits.
- `kun chat` starts a line-oriented REPL. Use `/exit`, `/quit`, or an empty line to stop.
- `kun exec --list-tools` prints the effective dynamic tool registry for the chosen config/workspace.
- `kun exec <tool> --args <json>` invokes one tool directly. Use `--json` on `run` or `exec` for machine-readable output.

## Environment variables

The runtime reads these from `process.env` when not set via CLI flags.

- `KUN_CONFIG` – explicit JSON config file
- `KUN_HOST` – bind host (overrides `--host` if set)
- `KUN_PORT` – bind port (overrides `--port` if set)
- `KUN_DATA_DIR` – root data directory (overrides `--data-dir` if set)
- `KUN_RUNTIME_TOKEN` – bearer token (overrides `--runtime-token` if set)
- `KUN_BASE_URL` – model API base URL (overrides `--base-url` if set)
- `DEEPSEEK_BASE_URL` – fallback model API base URL
- `KUN_MODEL` – default model id (overrides `--model` if set)
- `DEEPSEEK_API_KEY` – the DeepSeek API key the adapter forwards
  to the upstream model. Required at runtime for the default
  model client.

## Config file

Kun supports a JSON config file so runtime behavior can be managed
without rebuilding or hard-coding loop thresholds.

Config resolution order is:

1. Built-in defaults.
2. JSON config file.
3. Environment variables.
4. CLI flags.

Use `--config <path>` or `KUN_CONFIG=<path>` for an explicit file. If
no explicit config is provided and `--data-dir` / `KUN_DATA_DIR` is set,
Kun also reads `{data-dir}/config.json` when it exists. In the GUI's
default setup this is:

```text
~/.deepseekgui/kun/config.json
```

Shape:

```json
{
  "serve": {
    "host": "127.0.0.1",
    "port": 8899,
    "dataDir": "~/.deepseekgui/kun",
    "runtimeToken": "",
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com/beta",
    "model": "deepseek-v4-pro",
    "approvalPolicy": "auto",
    "sandboxMode": "workspace-write",
    "storage": {
      "backend": "hybrid"
    },
    "insecure": false
  },
  "contextCompaction": {
    "defaultSoftThreshold": 16000,
    "defaultHardThreshold": 24000,
    "summaryMode": "heuristic",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 1200,
    "summaryInputMaxBytes": 98304
  },
  "models": {
    "profiles": {
      "deepseek-v4-pro": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        }
      },
      "deepseek-v4-flash": {
        "aliases": ["deepseek-chat", "deepseek-reasoner"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        }
      }
    }
  },
  "capabilities": {
    "mcp": {
      "enabled": false,
      "servers": {
        "github": {
          "enabled": true,
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": { "GITHUB_TOKEN": "<github-token>" },
          "trustScope": "workspace",
          "trustedWorkspaceRoots": ["/path/to/workspace"],
          "timeoutMs": 30000
        },
        "remote-docs": {
          "enabled": false,
          "transport": "streamable-http",
          "url": "https://mcp.example.com/mcp",
          "headers": { "authorization": "Bearer <docs-mcp-token>" },
          "trustScope": "user",
          "timeoutMs": 30000
        }
      }
    },
    "web": {
      "enabled": false,
      "fetchEnabled": false,
      "searchEnabled": false,
      "provider": "fetch",
      "allowDomains": [],
      "denyDomains": ["localhost", "127.0.0.1"]
    },
    "skills": {
      "enabled": false,
      "roots": ["~/.agents/skills", "./.agents/skills"],
      "legacySkillMd": true
    },
    "subagents": {
      "enabled": false,
      "maxParallel": 2,
      "maxChildRuns": 4
    },
    "attachments": {
      "enabled": false,
      "maxImageBytes": 5242880,
      "maxImageDimension": 4096,
      "allowedMimeTypes": ["image/png", "image/jpeg", "image/webp"],
      "textFallbackMaxBase64Bytes": 524288,
      "textFallbackMaxImageDimension": 1280,
      "textFallbackPreferredMimeType": "image/webp"
    },
    "memory": {
      "enabled": false,
      "scopes": ["user", "workspace", "project"],
      "maxInjectedRecords": 8
    }
  }
}
```

Kun defaults to hybrid session storage: `threads/{threadId}/messages.jsonl`
and `events.jsonl` remain the canonical transcript/replay logs, while
`index.sqlite3` stores only rebuildable thread metadata for fast lists
and search. Set `serve.storage.backend` to `"file"` to use the legacy
JSON index backend, or set `serve.storage.sqlitePath` to override the
default `{dataDir}/index.sqlite3` path.

Model-specific context windows, capabilities, and compaction thresholds
belong in `models.profiles`. Built-in profiles already cover
`deepseek-v4-pro`, `deepseek-v4-flash`, and the compatibility aliases
`deepseek-chat` / `deepseek-reasoner`; DeepSeek V4 defaults to a 1M
context window and starts compaction around 980k input tokens.
The legacy `contextCompaction.modelProfiles` location is still read for
backward compatibility, but new configs should use `models.profiles`.
See `../docs/KUN_CONFIG.md` for the detailed file layout and examples.

Feature flags are intentionally explicit:

- `capabilities.mcp` starts configured MCP clients and imports their tools into the dynamic registry. Workspace-scoped servers require `trustedWorkspaceRoots`.
- `serve.mcpSearch` can collapse a large MCP catalog into four entry points: `mcp_search`, `mcp_describe`, `mcp_call`, and `mcp_refresh_catalog`. When the catalog is too large, the model searches for relevant tools first, then describes and calls the exact tool instead of carrying every MCP schema on every turn.
- `serve.tokenEconomy` / `tokenEconomyMode` compresses tool descriptions, tool results, and history context while preserving code, paths, commands, URLs, errors, and other high-value signals.
- `contextCompaction` controls fallback long-thread compaction thresholds and summary behavior. Per-model thresholds live in `models.profiles`. Compaction preserves goals, constraints, decisions, touched files, tool outcomes, and unresolved next steps.
- `serve.runtimeTuning.toolStorm` suppresses repeated identical tool calls within a turn so useless tool loops do not keep spending tokens.
- `capabilities.web` exposes `web_fetch` and/or `web_search`. The built-in provider can fetch HTTP(S) pages; search requires a provider implementation and may report unavailable.
- `capabilities.skills` scans configured roots for `skill.json` manifests and, when `legacySkillMd` is true, older `SKILL.md` directories.
- `capabilities.attachments` stores image bytes outside thread logs and allows turns to reference `attachmentIds`. Vision-capable models receive image parts; text-only models receive a bounded compressed base64 text fallback.
- `capabilities.memory` stores long-term records under the data dir, retrieves scoped matches before turns, and exposes `memory_create`, `memory_update`, and `memory_delete` tools.
- `capabilities.subagents` exposes `delegate_task` with `maxParallel` and `maxChildRuns` concurrency budgets.

Use `GET /v1/runtime/info` for the runtime capability manifest and
`GET /v1/runtime/tools` for redacted provider diagnostics. The GUI
Settings page reads both routes.

## Data directory layout

`--data-dir` is the on-disk root for everything the runtime owns:

```
{--data-dir}/
  config.json      # Optional Kun runtime config
  attachments/     # Image metadata + content blobs when enabled
  memory/          # Long-term memory records and tombstones when enabled
  child-runs/      # Delegated child run records when subagents are enabled
  threads/
    index.json
    {threadId}/
      thread.json     # ThreadRecord
      messages.jsonl  # TurnItem append-only
      events.jsonl    # RuntimeEvent append-only
      session.json    # Latest AgentSession projection
      usage.json      # Per-thread usage snapshot
```

Atomic JSON writes are used for `index.json`, `thread.json`, and
`session.json`. JSONL streams are append-only and tolerate malformed
lines (the next replay skips them). The renderer can re-read a
thread by listing `index.json` and replaying the per-thread JSONL.

## HTTP API

The HTTP server exposes the following routes under `/v1/*`:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | unauthenticated health probe |
| GET | `/v1/runtime/info` | runtime metadata and capability manifest |
| GET | `/v1/runtime/tools` | redacted dynamic tool/provider diagnostics |
| GET | `/v1/workspace/status?path=...` | workspace git/branch status |
| GET | `/v1/threads?include=side` | list threads (most recently updated first); side threads are hidden unless `include=side` is passed |
| POST | `/v1/threads` | create a thread |
| GET | `/v1/threads/{id}` | read a thread with its turns |
| PATCH | `/v1/threads/{id}` | update title/status/approval/sandbox/relation (promote a side thread by setting `relation: "primary"`) |
| DELETE | `/v1/threads/{id}` | delete a thread |
| POST | `/v1/threads/{id}/fork` | fork the thread. Optional JSON body: `{ "relation": "fork" \| "side", "title"?: string }` (defaults to `fork` when omitted). `relation: "side"` marks the result as a side conversation and tags `parentThreadId`. |
| POST | `/v1/threads/{id}/turns` | start a turn |
| GET | `/v1/threads/{id}/turns/{turnId}` | read a single turn |
| POST | `/v1/threads/{id}/turns/{turnId}/steer` | queue steering text |
| POST | `/v1/threads/{id}/turns/{turnId}/interrupt` | abort a turn |
| POST | `/v1/threads/{id}/compact` | fold old history |
| GET | `/v1/threads/{id}/events?since_seq=N` | SSE backlog + live |
| POST | `/v1/approvals/{approvalId}` | allow/deny |
| POST | `/v1/attachments` | upload an image attachment as base64 |
| GET | `/v1/attachments/diagnostics` | attachment store status |
| GET | `/v1/attachments/{id}` | attachment metadata |
| GET | `/v1/attachments/{id}/content?thread_id=...&workspace=...` | authorized attachment bytes as base64 |
| GET | `/v1/memory?workspace=...&include_deleted=false` | list memory records in scope |
| POST | `/v1/memory` | create a memory record |
| GET | `/v1/memory/diagnostics` | memory store status |
| PATCH | `/v1/memory/{id}` | update, disable, or retag a memory record |
| DELETE | `/v1/memory/{id}` | tombstone a memory record |
| GET | `/v1/usage` | cumulative token/cache/turn counters |

SSE events use `id: <seq>`, `event: <kind>`, and JSON `data:`. A
late-joining client passes `since_seq` to receive the backlog before
live events flow.

`POST /v1/threads/{id}/turns` accepts `attachmentIds` alongside
`prompt`, `model`, `mode`, and `guiPlan`. Attachments are resolved
against the turn thread/workspace and are never embedded into
thread JSONL logs. Runtime events may include optional child-agent
metadata, web citations/sources, attachment ids, active Skill ids,
and injected memory ids; older clients can ignore these fields.

## Thread record

Each thread persisted under `{data-dir}/threads/{id}/thread.json` is a
`ThreadRecord` with the following relation metadata:

- `relation`: discriminator describing how the thread relates to its
  origin. One of `primary` (default), `fork` (a manual fork that
  switches you away), or `side` (a "by-the-way" side conversation
  inherited from a parent snapshot).
- `parentThreadId`: live parent link for `fork` and `side` threads;
  absent for primary threads. Cleared automatically when promoting a
  side thread back to `primary` via `PATCH /v1/threads/{id}`.
- `forkedFromThreadId` / `forkedFromTitle` / `forkedAt` /
  `forkedFromMessageCount` / `forkedFromTurnCount`: lineage metadata
  copied from the parent for forks and side conversations.

The default `GET /v1/threads` listing excludes `relation: "side"`
threads to keep the main thread list uncluttered. Pass
`?include=side` to opt in.

## Migration notes

Legacy Skill folders that only contain `SKILL.md` continue to work
when `capabilities.skills.legacySkillMd` is true. New Skills should
prefer a `skill.json` manifest with explicit `id`, `description`,
trigger metadata, instruction file, and allowed tool list; this makes
activation and diagnostics deterministic. A safe migration path is:

1. Keep the existing `SKILL.md`.
2. Add a `skill.json` next to it that points at the same instructions.
3. Restart Kun or refresh diagnostics.
4. Once `/v1/runtime/tools` reports the Skill without validation
   errors, decide whether to keep legacy compatibility enabled.

Existing thread-level `pinnedConstraints` are not converted into
long-term memory automatically. They remain part of compaction items
and replay exactly as before. If a constraint should become
cross-thread recall, create an explicit memory record through the
GUI memory review surface or the `memory_create` tool. If it should
stay local to one thread, leave it as a pinned constraint.

## Troubleshooting

- MCP server does not appear: check `capabilities.mcp.enabled`, the
  server `enabled` flag, transport-specific fields (`command` for
  `stdio`, `url` for HTTP/SSE), `trustedWorkspaceRoots` for
  workspace-scoped servers, and `/v1/runtime/tools` for redacted
  `lastError` diagnostics.
- Web tools are missing: `capabilities.web.enabled` must be true and
  at least one of `fetchEnabled` / `searchEnabled` must be true.
  Built-in fetch handles HTTP(S) pages; search may still be
  unavailable when no provider implementation is configured.
- Image upload succeeds but the turn fails: check `maxImageBytes`,
  `maxImageDimension`, `allowedMimeTypes`, and the text fallback limits.
  Text-only models need a compressed fallback small enough to fit
  `textFallbackMaxBase64Bytes`.
- Memory is not injected: enable `capabilities.memory`, confirm
  `/v1/memory/diagnostics.enabled`, make sure records are in the
  selected workspace scope and not disabled/deleted, then inspect
  `lastInjectedIds`.
- `kun run`, `kun chat`, or `kun exec` cannot authenticate or load
  config: pass the same `--config`, `--data-dir`, `--api-key`,
  `--base-url`, and `--runtime-token` values used by `kun serve`.
  `kun exec --list-tools --json` is the quickest way to verify the
  effective tool registry for a CLI environment.
- A capability reports `disabled`: that normally means the config flag
  is false. A capability reports `unavailable`: the flag is true, but
  the backing provider/store/model is absent or failed initialization.

## GUI integration

After the legacy provider retirement, the DeepSeek-GUI main process
starts Kun through `kun-process.ts` and routes all
`runtimeRequest` calls to the active base URL with a bearer token.
The renderer uses the same `AgentProvider` interface as the legacy
CodeWhale provider because Kun speaks the same HTTP/SSE
contract. Settings live under `agents.kun` in
`AppSettingsV1` and include `binaryPath`, `port`, `autoStart`,
`apiKey`, `baseUrl`, `runtimeToken`, `dataDir`, `model`,
`approvalPolicy`, `sandboxMode`, and `insecure`.

The renderer also consumes the extension routes added for the larger
agent surface: `/v1/runtime/info`, `/v1/runtime/tools`,
`/v1/attachments/*`, and `/v1/memory/*`. Composer image controls are
enabled only when both the runtime attachment capability and model
image modality are available. Settings diagnostics display MCP
servers, Skill roots, web provider state, attachment store state,
memory records, and the live capability manifest.

Legacy persisted settings (`agentProvider: "codewhale"` or
`"reasonix"`) are migrated by `migrateLegacyAppSettings`.
Legacy credentials, base URLs, ports, and model selections seed
`agents.kun`; the saved settings file no longer keeps live
CodeWhale or Reasonix agent entries.
