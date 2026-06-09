# Kun GUI 单运行时方案

本文记录 DeepSeek GUI 现在应该如何围绕一个专门服务 GUI 的
Kun 改造。结论先说清楚：GUI 只保留一个 agent，唯一 ID 是
`kun`；Code、Write、连接手机都通过同一条 `kun serve`
HTTP/SSE 边界工作；CodeWhale、Reasonix、绘画/设计类入口、运行时
诊断面板、agent 切换都不再是产品表面。

## 目标边界

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

这个边界借鉴 TUI/CodeWhale 的 serve HTTP 架构：GUI 不直接嵌 agent
loop，不通过 stdio/RPC 混跑多个状态机，只把本地 HTTP 服务当成稳定
协议。Kun 内部再吸收 Reasonix 的 cache-first loop：immutable
prefix、append-only log、bounded LRU/TTL cache、inflight cleanup、
steering queue、context compaction、usage/cache telemetry。

## 缓存命中优化

Kun 的缓存命中率要按 Reasonix 的 DeepSeek 原生口径计算和优化：

- 模型 client 优先解析 DeepSeek 原生
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。只有原生字段缺失
  时，才退回 `prompt_tokens_details.cached_tokens`、`cache_read_input_tokens`
  等兼容字段。
- cache hit rate 使用 `hit / (hit + miss)`，不使用
  `hit / prompt_tokens`。DeepSeek 原生 miss 不一定等于 `prompt_tokens - hit`，
  Reasonix 也是按 hit+miss 作为缓存统计分母。
- `kun/src/prompt/kun-system-prompt.ts` 是稳定前缀。它只放长期
  不变的 Kun 运行契约，不能放 workspace、时间戳、文件片段、选中文本、
  用户动态信息或一次性工具结果。
- `ImmutablePrefix` 在每次 model step 前调用 `verifyImmutablePrefix()`。
  如果有人绕过 `setSystemPrompt` / `setTools` / `setFewShots` 直接改 prefix，
  开发和测试期会立即暴露 fingerprint drift，而不是悄悄牺牲缓存。
- few-shot fingerprint 只计算真正会发给模型的内容，不计算 item id、turn id、
  thread id、时间戳等 GUI/存储层动态字段。
- 工具 schema 在发送到模型前 canonical sort，避免同一工具集合因为顺序或
  schema key 顺序变化造成 prefix churn。
- 每个 turn 会持久化 canonical tool catalog fingerprint 和 tool count；同一
  scope 下工具定义漂移时会标记 `toolCatalogDrift`，便于排查 cache miss。
- 历史消息发送给 DeepSeek 前会做共享的 model-history repair：孤儿
  `tool_result` 不发，缺少对应 result 的 `tool_call` 不发；同一次响应里的
  多个 tool call 会重组为一个合法 assistant `tool_calls` 消息，避免
  400/retry 造成额外延迟和缓存浪费。
- 同一模型回合里连续的 built-in 只读工具 `read` / `grep` / `find` / `ls`
  会小批量并发执行，但 `tool_result` 仍按 call 顺序写入，减少等待时间的同时
  不让动态历史随完成顺序抖动。
- Serve runtime 会从 persisted usage event 恢复累计 cache hit/miss counters，
  重启或 resume 后 runtime usage 面板不重新从 0 计算。
- 动态上下文必须追加在稳定前缀之后。compaction、resume、fork、plan context
  也不得改写稳定系统前缀。

冷启动第一轮可能仍然低或为 0，因为服务端还没有同一前缀可读；热起来后应稳定
超过 90%。2026-06-02 的真实 Kun 临时线程验证：

- 12 轮短消息：去掉冷启动后的热命中 `94.7%`，最新一轮 `93.6%`。
- 同一稳定前缀热身后 24 轮短消息：整体含冷启动 `95.2%`，最新一轮 `98.1%`。

优化前已经持久化的旧 usage 事件不会被事后改写，因为当时没有保存 DeepSeek
原生缓存字段；这些历史数据只能作为旧实现的证据，不能证明新实现仍然低命中。

Reasonix 资料里仍可作为下一阶段的借鉴项：

- 工具集合 mutation gate：新增工具允许 append，编辑、重排、删除工具时要求
  restart 或新会话边界，避免热前缀突然全量 miss。当前 Kun 已排序工具
  schema，但还没有把“工具集合变更策略”做成显式产品规则。
- LLM fold summarizer：现在 `ContextCompactor` 是本地摘要骨架，没有额外请求
  模型。未来如果改成模型摘要，应复用主 agent 的 system/tools/few-shot 前缀，
  让 summarizer call 也命中同一段缓存。
- 大工具结果 token cap 和长参数 markerize：当前本地工具输出较小；一旦加入
  shell、文件全文、网页抓取类工具，需要在进入历史窗口前按 token 截断或标记化，
  不让超大 tool result 把 append-only log 撑爆。
- volatile scratch 边界：assistant reasoning 现在不会上传给模型，但仍会落 GUI
  历史。未来若加入内部计划、临时草稿或子 agent scratch，应保持“可展示”和
  “可重放给模型”分离。

## GUI 要拆的东西

Renderer 只应展示 Kun。需要删除或保持删除的 UI 面包括：

- Agent 切换器：`AgentSwitcher` 不再出现，`AGENT_CATALOG` 只有
  `kun`。
- 顶部连接状态条和 runtime 诊断按钮：不再把运行时检测作为用户入口。
- Runtime insights/right panel：右侧面板只保留 Changes、Preview、Plan、
  File 等 GUI 工作区视图，不再有 runtime/usage 控制台。
- 斜杠菜单里的 `/usage`、`/runtime`：这些命令会暗示还有可切换运行时。
- 设置页 provider selector：Settings -> Agents 直接展示 Kun 配置，
  包含 binary path、port、autoStart、API key、base URL、runtime token、
  data dir、model、approval policy、sandbox mode、insecure。
- 绘画/设计 starter：GUI 首页不再放设计/绘画入口，只保留 Code、Write、
  连接手机相关核心流。

## Main / Preload 要拆的东西

主进程和 preload 不再暴露旧 agent IPC：

- 删除 `deepseek:spawn-if-needed`、`deepseek:update-*`、
  `deepseek:diagnostics`。
- 删除 `reasonix:rpc-send`、`reasonix:spawn-if-needed`、
  `reasonix` RPC event bridge。
- 删除 CodeWhale adapter、Reasonix adapter、Reasonix HTTP bridge、
  DeepSeek/CodeWhale updater、旧 binary resolver、旧 process manager。
- 删除 Kun 之外的 diagnostics/importer 模块。用户要的是可用的单
  agent，不是运行时检测中心。

主进程现在只需要：

- `kunRuntimeAdapter`：启动/停止 `kun serve`、同步 config、
  计算 base URL、附加 auth header。
- `runtimeRequestViaHost`：确保 Kun running 后转发 `/v1/*`。
- `startSse/stopSse`：按 `threadId + sinceSeq` 转发 Kun SSE。

## Settings / Migration

保存后的 settings 结构只应有：

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

代码里仍允许出现 `codewhale` / `reasonix` 字符串的唯一原因是读取旧
settings 文件时做一次性迁移：

- `agentProvider: codewhale | reasonix | deepseek-runtime` 归一为
  `kun`。
- 旧 `deepseek`/`agents.codewhale` 的 port、autoStart、API key、
  base URL、runtime token、approval、sandbox 会种到 `agents.kun`。
- 旧 `agents.reasonix` 的 API key、base URL、model、autoStart 会种到
  `agents.kun`。
- 迁移后的落盘文件不再保留 `agents.codewhale` 或 `agents.reasonix`。
- 连接手机（内部旧名 Claw）旧 `agentThreadIds.codewhale/reasonix` 只折叠成
  `agentThreadIds.kun`，不保留 per-agent map。

## Code / Write / 连接手机如何走 Kun

- Code：`KunRuntimeProvider` 负责 list/create thread、send turn、
  steer、interrupt、compact、approval、SSE 映射。Chat UI 不知道旧
  provider。
- Write：写作助手和 inline completion 读取同一份 Kun API key /
  base URL 配置。Write thread registry 只把写作线程识别为 Kun
  thread，不再区分 Reasonix 会话。
- 连接手机：定时任务、飞书/Lark/微信、IM webhook 创建或复用 Kun thread。
  代码内部仍沿用 `claw` route / settings key / runtime 文件名，作为旧命名兼容。
  `threadId` / `localThreadId` 字段只作为旧 settings 兼容字段存在，真正
  当前映射写入 `agentThreadIds.kun`。

## CodeWhale 功能等价面

替换 CodeWhale 不是只保留聊天。Kun 的 GUI HTTP 面必须覆盖旧
provider 已经暴露给 store/UI 的能力：

- `GET /v1/threads` 支持 `limit`、`search`、`include_archived`、
  `archived_only`。默认隐藏 archived/deleted，会话搜索和归档视图不依赖
  GUI 本地猜测。
- `POST /v1/threads/{id}/fork` 复制 thread 历史、写入 fork lineage，
  并把历史 item 写回新 thread 的 session store。复制时会把 pending
  approval/user-input 规整为不可继续操作的历史状态，避免新会话悬挂旧 gate。
- `POST /v1/sessions/{id}/resume-thread` 沿用旧 CodeWhale resume 路径。
  Kun 优先从同名 thread 恢复；没有 thread 时从 session snapshot
  或 JSONL items 重建 turns；找不到时返回 404，而不是在 GUI 抛
  unsupported。
- `POST /v1/user-inputs/{id}` 和旧兼容路径 `/v1/user-input/{id}` 都可接收
  `{ answers }` 或 `{ cancelled: true }`。AgentLoop 通过 `request_user_input`
  / `user_input` tool 暂停，GUI 回答后继续模型回合。
- `POST /v1/approvals/{id}` 继续支持工具审批；approval 和 user-input 都是
  gate/route/service 分层，不在 renderer 内实现 agent 逻辑。
- `GET /v1/usage?group_by=thread|day` 返回累计 token、turn、cache hit 数据。
  Workbench 首页和 composer 底部只消费 Kun usage，不再打开 runtime
  insights 面板。

## 已删除/应保持删除的旧路径

旧 agent 运行路径不应再回来：

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
- Runtime diagnostics/importers for old agent paths

旧 UI 入口不应再回来：

- `AgentSwitcher`
- `ConnectionStatusBar`
- `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- `ReasonixInsightsPanel`
- 设计/绘画 starter card

## 设计模式约束

Kun 包按 ports & adapters 组织：

- `contracts/`：HTTP/SSE DTO 和 zod schema。
- `ports/`：ModelClient、ToolHost、ThreadStore、SessionStore、
  ApprovalGate、EventBus、WorkspaceInspector、Clock。
- `adapters/`：DeepSeek-compatible model client、local tool host、
  file/in-memory stores、workspace inspector。
- `loop/`：AgentLoop、InflightTracker、SteeringQueue、ContextCompactor。
- `cache/`：ImmutablePrefix、LRU、TTL-LRU。
- `server/`：Router、auth、SSE、routes。

GUI 侧不实现 agent 逻辑，只做 HTTP client、SSE subscription 和状态映射。
新增能力时优先加 Kun tool 或 HTTP endpoint，不新增 GUI 内第二个
agent。

## 验证清单

每次改这条线至少跑：

```bash
npm run typecheck
npm test
npm run build
```

手动冒烟：

1. 打开 DeepSeek GUI。
2. Code 新建会话，能创建 thread、发送消息、流式返回、审批/中断可用。
3. Write 打开写作空间，inline completion 和选中文本助手能用同一个 API key。
4. 连接手机能保存设置、运行手动 task、把 thread id 写回 Kun mapping。
5. Settings -> Agents 只看得到 Kun，没有 provider switch、runtime
   diagnostics、CodeWhale/Reasonix 配置块。
6. `GET /v1/usage?group_by=thread` 有历史 usage 时，GUI 首页/底部不显示
   “暂无用量”，而显示 token、回合、缓存命中等指标。
7. 线程搜索、归档视图、fork、resume session、request_user_input 回答/取消
   都能通过 Kun HTTP 路径完成。
