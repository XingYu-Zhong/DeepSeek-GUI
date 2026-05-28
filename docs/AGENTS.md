# Agent catalog extension

DeepSeek GUI is the desktop workbench. **CodeWhale** is the default local HTTP agent runtime (the renamed DeepSeek TUI). Additional agents of the same kind can be registered without changing chat-store dispatch.

## Add a CodeWhale-class agent

1. Extend `AgentProviderId` in [`src/shared/agent-catalog.ts`](../src/shared/agent-catalog.ts).
2. Append an `AgentProviderDefinition` to `AGENT_CATALOG` (display name, default port, capabilities).
3. Add `agents.{id}` defaults in [`src/shared/app-settings.ts`](../src/shared/app-settings.ts) and migration in `migrateLegacyAppSettings` if needed.
4. Register a renderer provider factory in [`src/renderer/src/agent/registry.ts`](../src/renderer/src/agent/registry.ts).
   - If the HTTP API matches CodeWhale, reuse [`codewhale-runtime.ts`](../src/renderer/src/agent/codewhale-runtime.ts) patterns or share a local-http base class.
5. Register a main-process adapter in [`src/main/runtime/`](../src/main/runtime/) and wire it in `codewhale-adapter.ts` adapter map (or split into `runtime-adapters.ts`).
6. The Settings **Agent runtime** dropdown reads from `listAgents()` automatically.

## Boundaries

- **DeepSeek GUI** — application brand (unchanged).
- **CodeWhale** — default agent id `codewhale`; legacy npm `deepseek-tui` / CLI `deepseek` remain supported internally in the CodeWhale adapter only.
- **User config** — CodeWhale still uses `~/.deepseek/config.toml` per upstream.

## Verification

- `npm run typecheck`
- `npm run test`
- Switch agent in Settings (when multiple catalog entries exist), restart runtime, send a chat turn, run a Claw task.
