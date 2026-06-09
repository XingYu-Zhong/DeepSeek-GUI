# Kun

Kun 是 DeepSeek-GUI 的本地 HTTP/SSE 代理运行时。它为 GUI 提供稳定、类型化且 GUI 友好的代理循环合约：

- `kun serve` 会启动一个本地 HTTP 服务器，并暴露 `/v1/*` 路由。
- 线程、回合（turn）、事件、审批和用量都会以追加写入的 JSONL 日志持久化，并配合原子化索引更新。
- Agent 循环采用 cache-first 设计：不可变的 prompt 前缀、边界受限的 TTL/LRU 缓存、inflight 跟踪，以及显式上下文压缩。

Kun 取意于《庄子·逍遥游》中的“北冥有鱼，其名为鲲”。在 DeepSeek-GUI
里，它代表一个更深的本地运行时：不是把模型回复包一层 UI，而是让模型可以
长期携带项目上下文、稳定调用工具、恢复会话，并在桌面、写作、手机连接和
定时任务之间复用同一套 agent loop。

Kun 的核心目标是提高每一个 token 的 ROI。它会尽量让 token 花在用户需求、
代码、决策和结果上，而不是浪费在重复工具 schema、失控工具输出、畸形历史、
无效重试或本可以命中的稳定前缀上。

## 目录结构

```text
kun/
  src/
    cli/         命令行入口（serve, run, chat, exec）
    contracts/   HTTP/SSE 合约的 Zod schema 与派生类型
    domain/      Thread、Turn、Item、Event、Approval、Usage 实体
    ports/       ModelClient、ToolHost、stores、EventBus、ApprovalGate 等
    adapters/    DeepSeek 兼容模型客户端、本地工具宿主、内存/文件存储、工作区检查器
    services/    线程与回合编排服务
    loop/        Cache-first 的 agent loop 与 inflight 辅助逻辑
    cache/       LRU/TTL 缓存与不可变前缀工具
    telemetry/   用量、缓存与成本指标
    server/      HTTP 路由、鉴权、SSE 与响应辅助
  tests/         合同级测试与联动测试
  dist/          构建产物（已 gitignore）
```

## 脚本

请在 `kun/` 目录执行。

- `npm run typecheck` – 进行类型检查（不发出构建产物）。
- `npm run test` – 运行 Vitest 单元测试与合同测试。
- `npm run build` – 输出 ESM JavaScript 与类型声明到 `dist/`。
- `npm run serve` – 构建后启动运行时。
- `npm run dev` – 监听模式重建。

## CLI

`kun serve` 支持以下参数：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--config` | JSON 配置文件。若未提供且配置了 `{--data-dir}/config.json`，则自动读取 | optional |
| `--host` | 监听地址 | `127.0.0.1` |
| `--port` | HTTP 端口 | `8899` |
| `--data-dir` | 线程、事件和用量数据根目录 | required |
| `--runtime-token` | `/v1/*` 鉴权 token | empty |
| `--api-key` | DeepSeek 兼容 API key | empty |
| `--base-url` | DeepSeek 兼容模型 API 的基础 URL | `https://api.deepseek.com/beta` |
| `--model` | 默认模型 ID | `deepseek-v4-pro` |
| `--approval-policy` | `on-request` \| `untrusted` \| `never` \| `auto` \| `suggest` | `auto` |
| `--sandbox-mode` | `read-only` \| `workspace-write` \| `danger-full-access` \| `external-sandbox` | `workspace-write` |
| `--insecure` | 关闭 token 鉴权（仅本地开发） | off |

示例：

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

Kun 也可以在无 GUI 的情况下独立运行：

```bash
kun run --data-dir ~/.deepseekgui/kun --workspace "$PWD" "summarize this repo"
kun chat --data-dir ~/.deepseekgui/kun --workspace "$PWD"
kun exec --data-dir ~/.deepseekgui/kun --workspace "$PWD" --list-tools
kun exec --data-dir ~/.deepseekgui/kun --workspace "$PWD" read --args '{"path":"README.md"}'
```

- `kun run` 会创建一个线程，执行一个回合并流式输出助手文本后退出。
- `kun chat` 启动行式 REPL。使用 `/exit`、`/quit` 或空行退出。
- `kun exec --list-tools` 打印当前配置 / 工作区下生效的动态工具列表。
- `kun exec <tool> --args <json>` 直接调用单个工具。`run` 或 `exec` 上可配合 `--json` 获取机器可读输出。

## 环境变量

当未通过 CLI 显式设置时，运行时会从 `process.env` 读取：

- `KUN_CONFIG` – 明确的 JSON 配置文件路径
- `KUN_HOST` – 监听主机（覆盖 `--host`）
- `KUN_PORT` – 监听端口（覆盖 `--port`）
- `KUN_DATA_DIR` – 数据目录（覆盖 `--data-dir`）
- `KUN_RUNTIME_TOKEN` – 运行时 token（覆盖 `--runtime-token`）
- `KUN_BASE_URL` – 模型 API 基础 URL（覆盖 `--base-url`）
- `DEEPSEEK_BASE_URL` – 备用模型 API URL
- `KUN_MODEL` – 默认模型 ID（覆盖 `--model`）
- `DEEPSEEK_API_KEY` – 适配器转发到上游模型的 DeepSeek API key，GUI 默认运行时需要

## 配置文件

Kun 使用 JSON 配置文件管理运行时行为，避免重建后重配或硬编码参数。

配置优先级：

1. 内置默认值。
2. JSON 配置文件。
3. 环境变量。
4. CLI 参数。

通过 `--config <path>` 或 `KUN_CONFIG=<path>` 指定配置路径。
若未明确指定且设置了 `--data-dir` / `KUN_DATA_DIR`，则会自动读取
`{data-dir}/config.json`（若存在）。GUI 默认路径是：

```text
~/.deepseekgui/kun/config.json
```

示例结构：

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

Kun 默认使用混合存储：`threads/{threadId}/messages.jsonl` 与 `events.jsonl` 是会话的标准回放日志；`index.sqlite3` 仅保存可重建的线程元数据（列表与搜索加速）。将 `serve.storage.backend` 设置为 `"file"` 可以回退到旧版 JSON 索引，或设置 `serve.storage.sqlitePath` 覆盖默认的 `{dataDir}/index.sqlite3`。

模型窗口、模型能力和模型级压缩阈值写在 `models.profiles`。内置配置已包含 `deepseek-v4-pro`、`deepseek-v4-flash` 以及兼容别名 `deepseek-chat` / `deepseek-reasoner`；DeepSeek V4 默认是 1M 上下文，并在约 980k input tokens 时开始压缩。旧的 `contextCompaction.modelProfiles` 仍会读取以兼容已有配置，但新配置请使用 `models.profiles`。更完整的文件位置、字段格式和用户自定义方式见 `../docs/KUN_CONFIG.md`。

功能开关是显式设计：

- `capabilities.mcp` 启动配置化 MCP 客户端并将工具加入动态注册表；工作区级服务器要求设置 `trustedWorkspaceRoots`。
- `serve.mcpSearch` 可把大量 MCP 工具收敛为 `mcp_search`、`mcp_describe`、`mcp_call` 和 `mcp_refresh_catalog` 四个入口；当工具目录过大时，模型先检索意图相关工具，再描述和调用具体工具，避免每轮都携带完整 MCP schema。
- `serve.tokenEconomy` / `tokenEconomyMode` 会压缩工具描述、工具结果和历史上下文；保留代码、路径、命令、URL、错误信号等高价值信息，同时省掉重复、超长或二进制 payload。
- `contextCompaction` 控制长会话压缩的兜底阈值和摘要方式；模型级阈值写在 `models.profiles`。压缩时保留目标、约束、决策、已触碰文件、工具结果和未解决事项。
- `serve.runtimeTuning.toolStorm` 会抑制同一回合内重复的相同工具调用，阻止无意义 tool loop 继续烧 token。
- `capabilities.web` 暴露 `web_fetch` 与/或 `web_search`。内置 provider 负责 HTTP(S) 抓取；搜索功能依赖 provider 实现，未配置时会变为不可用。
- `capabilities.skills` 扫描 `roots` 下的 `skill.json`，并在 `legacySkillMd` 为 `true` 时兼容 `SKILL.md`。
- `capabilities.attachments` 将图片二进制从线程日志剥离，允许回合记录引用 `attachmentIds`。视觉模型直接接收图片部分，纯文本模型走受限文本 fallback。
- `capabilities.memory` 在数据目录下持久化跨会话记忆，按作用域检索并注入上下文；也会公开 `memory_create`、`memory_update`、`memory_delete` 工具。
- `capabilities.subagents` 通过 `maxParallel` 与 `maxChildRuns` 限制委派任务并发。

在渲染端使用 `GET /v1/runtime/info` 获取运行时能力清单，使用
`GET /v1/runtime/tools` 查看 provider 诊断。GUI 设置页会读取这两条接口。

## 数据目录布局

`--data-dir` 即运行时所管理的一切磁盘根目录：

```text
{--data-dir}/
  config.json      # 可选，运行时配置
  attachments/     # 附件元数据与二进制（启用时）
  memory/          # 长期记忆记录与墓碑记录（启用时）
  child-runs/      # 子任务运行记录（subagents 开启时）
  threads/
    index.json
    {threadId}/
      thread.json     # ThreadRecord
      messages.jsonl  # TurnItem append-only
      events.jsonl    # RuntimeEvent append-only
      session.json    # 最新 AgentSession 视图
      usage.json      # 按线程累计用量
```

`index.json`、`thread.json` 与 `session.json` 使用原子写入。
JSONL 为追加式，即使包含部分格式错误行也可通过下一次重放跳过。GUI 可通过 `index.json` 列表并重放各线程 JSONL 来重建会话。

## HTTP API

HTTP 服务在 `/v1/*` 提供以下路由：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 无鉴权健康检查 |
| GET | `/v1/runtime/info` | 运行时元数据与能力清单 |
| GET | `/v1/runtime/tools` | 动态工具/供应商诊断 |
| GET | `/v1/workspace/status?path=...` | 工作区 Git/分支状态 |
| GET | `/v1/threads?include=side` | 列表线程（按最近更新）；未传 `include=side` 时会隐藏 side 线程 |
| POST | `/v1/threads` | 创建线程 |
| GET | `/v1/threads/{id}` | 获取线程 |
| PATCH | `/v1/threads/{id}` | 更新标题/状态/审批/副线程关系（`relation: "primary"`） |
| DELETE | `/v1/threads/{id}` | 删除线程 |
| POST | `/v1/threads/{id}/fork` | 复制线程。可选 body：`{ "relation": "fork" \| "side", "title"?: string }`。默认 `fork`；`relation: "side"` 会将结果标记为 side 并写入 `parentThreadId` |
| POST | `/v1/threads/{id}/turns` | 发起一个回合 |
| GET | `/v1/threads/{id}/turns/{turnId}` | 获取回合 |
| POST | `/v1/threads/{id}/turns/{turnId}/steer` | 追加 steering 文本 |
| POST | `/v1/threads/{id}/turns/{turnId}/interrupt` | 中断回合 |
| POST | `/v1/threads/{id}/compact` | 压缩历史 |
| GET | `/v1/threads/{id}/events?since_seq=N` | 获取事件积压并订阅实时事件 |
| POST | `/v1/approvals/{approvalId}` | 允许/拒绝工具审批 |
| POST | `/v1/attachments` | 以 base64 上传图片附件 |
| GET | `/v1/attachments/diagnostics` | 附件存储状态 |
| GET | `/v1/attachments/{id}` | 获取附件元数据 |
| GET | `/v1/attachments/{id}/content?thread_id=...&workspace=...` | 授权后返回附件字节（base64） |
| GET | `/v1/memory?workspace=...&include_deleted=false` | 查询作用域内记忆 |
| POST | `/v1/memory` | 创建记忆 |
| GET | `/v1/memory/diagnostics` | 记忆存储状态 |
| PATCH | `/v1/memory/{id}` | 更新、禁用或重标记记忆 |
| DELETE | `/v1/memory/{id}` | 删除（打墓碑）记忆 |
| GET | `/v1/usage` | 累计 token / 缓存命中 / 回合计数 |

SSE 使用 `id: <seq>`、`event: <kind>` 与 `data:`。新连接可通过 `since_seq` 获取历史事件。

`POST /v1/threads/{id}/turns` 支持 `prompt`、`model`、`mode`、`guiPlan` 与 `attachmentIds`。附件会按作用域和会话注入，但不会进入线程 JSONL。事件中可能带有可选子代理元数据、网络引用、来源、附件 ID、激活中的技能 ID、注入记忆 ID；老客户端可忽略不认识的字段。

## 线程关系

`{data-dir}/threads/{id}/thread.json` 下的每个 `ThreadRecord` 都包含：

- `relation`：与父关系信息，取值 `primary`（默认）、`fork`（手动 fork）、`side`（旁路会话）。
- `parentThreadId`：`fork` 或 `side` 线程指向父线程；主线程为空。通过 `PATCH /v1/threads/{id}` 可以把 side 恢复为 primary 并清理父引用。
- `forkedFromThreadId` / `forkedFromTitle` / `forkedAt` / `forkedFromMessageCount` / `forkedFromTurnCount`：来源线程的 fork 元数据。

默认 `GET /v1/threads` 不返回 `relation: "side"` 线程；添加 `include=side` 可显式包含。

## 迁移说明

当 `capabilities.skills.legacySkillMd` 为 true 时，仍会兼容单独存在的 `SKILL.md`。建议把新能力迁移为显式 `skill.json`（包含 `id`、`description`、prompt 与 tool 白名单等），以便提高加载和诊断确定性。

推荐迁移步骤：

1. 保留现有 `SKILL.md`。
2. 在同目录新增等价的 `skill.json`。
3. 重启 Kun 或刷新诊断。
4. 当 `/v1/runtime/tools` 报告 `lastError` 时再决定是否保留旧兼容行为。

历史线程中的 `pinnedConstraints` 不会自动转到长期记忆；它们仍属于该线程的压缩历史。
如需跨线程长期记忆，请用 GUI Memory 面板创建 `memory_create` 工具记录。

## 故障排查

- MCP 不出现：检查 `capabilities.mcp.enabled`、服务器的 `enabled` 开关、`transport` 字段（`stdio` 需检查 `command`，HTTP/SSE 需检查 `url`）、workspace 级服务器的 `trustedWorkspaceRoots`，以及 `/v1/runtime/tools` 的 `lastError`。
- Web 工具不可用：检查 `capabilities.web.enabled`，并确保 `fetchEnabled` / `searchEnabled` 至少一项为 true。内置 provider 负责抓取 HTTP(S) 页面，搜索可能因未实现 provider 而不可用。
- 图片上传失败：检查 `maxImageBytes`、`maxImageDimension`、`allowedMimeTypes` 与文本 fallback 的大小限制。纯文本模型需要足够小的 base64 文本 fallback。
- 记忆未注入：确认 `capabilities.memory` 为 true，`/v1/memory/diagnostics` 显示正常，作用域与工作区匹配且未被禁用；再看 `lastInjectedIds`。
- `kun run`/`kun chat`/`kun exec` 报错：核对 `--config`、`--data-dir`、`--api-key`、`--base-url`、`--runtime-token` 一致；先用 `kun exec --list-tools --json` 检查工具注册表。
- 功能显示为 disabled：通常表示配置标志为 false；显示为 unavailable 通常表示标志为 true，但 provider/存储/模型未就绪或初始化失败。

## GUI 集成

Legacy provider 退役后，主流程由 `kun-process.ts` 启动 Kun，并通过 `runtimeRequest` 使用 bearer token 调用活动 base URL。渲染层保持与旧 `AgentProvider` 的接口兼容：`agents.kun` 下保存 `binaryPath`、`port`、`autoStart`、`apiKey`、`baseUrl`、`runtimeToken`、`dataDir`、`model`、`approvalPolicy`、`sandboxMode`、`insecure`。

渲染层同时会消费扩展运行时接口：`/v1/runtime/info`、`/v1/runtime/tools`、`/v1/attachments/*` 与 `/v1/memory/*`。
Composer 的图片控件仅在 `attachments` 与模型均支持时可用。
设置页诊断会展示 MCP、skills 根目录、web provider、附件存储、记忆、能力可用性。

旧的持久化设置（`agentProvider: "codewhale"` 或 `"reasonix"`）会由 `migrateLegacyAppSettings` 做一次性迁移；旧凭据、baseUrl、端口与模型会映射到 `agents.kun`；迁移后保存的设置不再包含 CodeWhale/Reasonix 配置。
