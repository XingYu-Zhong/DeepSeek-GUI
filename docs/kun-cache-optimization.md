# Kun 缓存优化技术文档

本文记录 DeepSeek GUI 当前 Kun 运行时的缓存优化设计、实现位置、
统计口径与后续演进方向。目标不是单纯“让缓存数字变高”，而是让 GUI 与
本地 agent 的请求前缀长期稳定、可验证、可观测，并且在 Code / Write /
连接手机三条主路径下都成立。

## 目标

Kun 的缓存优化服务于四个目标：

- 让发送给 DeepSeek 的请求前缀尽可能字节稳定。
- 让缓存命中统计与 DeepSeek 原生字段一致，而不是依赖猜测。
- 让 prefix 漂移和消息历史污染在开发期就被发现。
- 让 GUI 只承担 HTTP/SSE 调用职责，把缓存纪律收敛在 Kun 内部。

更高一层的产品目标是提高每一个 token 的 ROI。用户付出的上下文预算应该
尽量转化为有效推理、代码修改、需求澄清和可执行结论，而不是被重复的工具
schema、超长工具输出、MCP 工具目录、无效 retry 或历史噪声消耗掉。

因此 Kun 的 token 优化不是单一的“缓存命中率优化”，而是一组组合策略：

- **稳定可缓存的前缀**：系统提示词、工具 schema、few-shot 与 pinned
  constraints 进入 immutable prefix，并用 fingerprint 验证漂移。
- **压缩动态历史**：长会话通过 compaction 保留目标、约束、决策、工具结果和
  未解决事项，减少重复上下文。
- **控制工具输出**：只在发送给模型的请求边界压缩超长 `tool_result`、长参数、
  base64 payload 和重复行；磁盘日志仍保留完整历史，方便回放和审计。
- **渐进发现 MCP 工具**：当 MCP 工具过多时，用 `mcp_search` /
  `mcp_describe` / `mcp_call` 让模型先找相关工具，再拿完整 schema 调用，避免
  每轮请求携带所有工具定义。
- **可观测成本收益**：usage 事件记录 cache hit/miss、token economy savings
  和成本估算，让节省不是凭感觉判断。

## 总体原则

Kun 借鉴了 Reasonix 的 cache-first 设计，但按 GUI 场景做了收束：

- GUI 不拼 prompt，不在 renderer 或 main process 做缓存判断。
- `kun serve` 是唯一请求出口，缓存相关策略都放在运行时内部。
- 稳定前缀和动态上下文分离：稳定部分追求复用，动态部分只允许追加。
- 统计、验证、回归测试一起维护，避免“实现变了，面板数字还好看”的假象。

## 请求前缀稳定化

### 1. 稳定系统提示词

Kun 使用独立的稳定系统提示词文件：

- `kun/src/prompt/kun-system-prompt.ts`

这个前缀只承载长期稳定的运行契约，例如：

- Kun 身份
- GUI 调用边界
- 工具行为约束
- 缓存行为约束
- 回复风格与质量要求

下面这些内容不能进入稳定前缀：

- workspace 路径
- 当前时间
- 文件片段
- 选中文本
- 临时计划
- 一次性工具结果
- 会随 turn 改变的用户上下文

### 2. ImmutablePrefix 指纹

Kun 通过 `ImmutablePrefix` 管理系统 prompt、tools、pinned constraints
和 few-shots，并为这些内容生成稳定指纹：

- `kun/src/cache/immutable-prefix.ts`

当前实现有几个关键点：

- tools 会先做 canonical sort，再进入 fingerprint。
- JSON schema 的 key 顺序会被规范化，避免对象键序扰动缓存。
- few-shot fingerprint 只计算真正会发送给模型的内容，不计算 `id`、
  `turnId`、`threadId`、时间戳等存储层动态字段。
- `verifyImmutablePrefix()` 会在每次 model step 前校验 prefix 是否被绕过
  mutator 直接修改。

校验接入点：

- `kun/src/loop/agent-loop.ts`

这意味着 prefix 如果在开发期发生静默漂移，不会只体现在“缓存变差”，而会
直接抛出 drift 错误，帮助尽早定位。

### 3. 工具定义稳定化

工具集合本身就是 prompt prefix 的一部分。Kun 在发送请求前会统一做：

- 工具数组按 `name` 排序
- `inputSchema` 递归 canonicalize
- 每个 turn 记录 canonical tool catalog fingerprint 和 tool count
- 同一 thread/mode/skill/tool-scope 下如果工具 catalog fingerprint 漂移，
  turn metadata 会标记 `toolCatalogDrift`

实现位置：

- `kun/src/adapters/model/deepseek-compat-model-client.ts`
- `kun/src/cache/tool-catalog-fingerprint.ts`
- `kun/src/loop/agent-loop.ts`

这样同一组工具即使注册顺序不同，最终发给模型的 tools payload 仍保持稳定。
如果某个动态 provider 或 Skill 让工具描述/schema 意外变动，也能从 turn
metadata 直接定位到是哪一轮开始扰动缓存前缀。

## 历史消息清洗

除了 prefix 稳定，历史消息本身也会影响缓存和可用性。

Kun 当前在模型请求边界对消息做一层共享的 model history repair：

- 孤儿 `tool_result` 不上传
- 缺少对应 result 的 `tool_call` 不上传
- 同一次模型响应中的多个 `tool_call` 会重新组合成一个合法的 assistant
  `tool_calls` 消息，再跟随对应 `tool_result`
- streaming tool-call delta 会按 provider `id` / `index` 合并，避免后续片段
  缺 `id` 时被误解析成新工具调用
- 如果工具调用和结果之间夹着 assistant 文本、reasoning、approval 或
  user_input 这类 GUI-only 桥接项，发送给模型时仍保持合法配对
- 修复后的历史会在 AgentLoop 进入 token 估算、compaction 和请求 hygiene
  前使用，避免畸形工具历史污染摘要和缓存热前缀占比

实现位置：

- `kun/src/domain/model-history-repair.ts`
- `kun/src/adapters/model/deepseek-compat-model-client.ts`
- `kun/src/loop/agent-loop.ts`

Kun 也会在模型请求边界做一层 Reasonix 风格的 history hygiene：

- 只压缩发给模型的历史，不改磁盘/session 里保存的完整工具结果。
- 超大的 `tool_result` 会按字节、行数和轻量 token 估算上限保留 head、
  tail 和错误/警告等 signal lines。
- 已经有结果配对的 `tool_call`，其超长字符串参数会替换成占位说明。
- base64 payload 会替换成短占位，避免图片/二进制内容污染后续请求。

实现位置：

- `kun/src/loop/request-history-hygiene.ts`
- `kun/src/loop/agent-loop.ts`

同一 turn 内还会启用 repeat-loop guard：

- 第三次完全相同的 `(toolName, arguments)` 会被抑制。
- Kun 会写入一个 error `tool_result`，让模型收敛到更窄的查询或解释原因。
- 文件变更类工具会清掉之前的只读调用记录，避免“编辑后复读”被误判。

连续的内置只读工具调用会做保守并发：

- 只并发 `read`、`grep`、`find`、`ls` 这四个 built-in `tool_call`。
- 每批最多 3 个，遇到写入类、command execution、`untrusted` / `never`
  runtime policy 或非 built-in provider 就退回顺序执行。
- 工具可以并发执行，但最终 `tool_result` 仍按模型给出的 call 顺序写入历史，
  避免完成顺序抖动造成下一次请求的动态历史不稳定。

实现位置：

- `kun/src/loop/tool-storm-breaker.ts`
- `kun/src/loop/agent-loop.ts`

Fork / resume 创建新线程时也会修复克隆历史：

- 孤儿 `tool_result` 不复制到新线程。
- 没有 matching result 的 `tool_call` 不复制到新线程。
- 同一 tool-call block 中可完成的子集会被保留，坏 pair 不会拖掉好 pair。
- 原线程不被修改，修复只作用于新 fork/resume 的可重放历史。

实现位置：

- `kun/src/domain/model-history-repair.ts`
- `kun/src/services/thread-service.ts`

这样做有几个直接收益：

- 避免 DeepSeek 因消息结构不合法返回 400
- 避免因为 retry、历史污染或大工具结果拉低缓存热前缀占比
- 避免重复工具循环继续扩大动态历史并制造无意义 cache miss
- 避免 fork/resume 后第一次请求继承畸形工具历史

## 缓存统计口径

Kun 的缓存命中统计优先使用 DeepSeek 原生 usage 字段：

- `prompt_cache_hit_tokens`
- `prompt_cache_miss_tokens`

只有原生字段缺失时，才回退到兼容字段：

- `prompt_tokens_details.cached_tokens`
- `cache_read_input_tokens`

实现位置：

- `kun/src/adapters/model/deepseek-compat-model-client.ts`

命中率公式采用：

```text
cacheHitRate = hit / (hit + miss)
```

而不是：

```text
cacheHitRate = hit / prompt_tokens
```

原因是 DeepSeek 原生 miss 口径不保证等于 `prompt_tokens - hit`。如果分母错了，
面板看起来“很高”或“很低”都可能只是统计失真。

累计统计同步使用同一公式，避免单轮与累计面板口径不一致：

- `kun/src/telemetry/usage-counter.ts`
- `kun/src/domain/usage.ts`

Kun 也会把单轮真实 `prompt_tokens` 作为下一次请求的 compaction pressure。
如果 provider 报告的 prompt token 数已经达到当前模型 soft threshold，下一次
model step 会优先触发 compaction；这样比单纯依赖 4 字符/token 的本地估算更
接近 DeepSeek 实际上下文压力，也能在工具 continuation 前保住热前缀占比。

实现位置：

- `kun/src/loop/agent-loop.ts`
- `kun/src/loop/context-compactor.ts`

Serve runtime 启动时还会从每个线程最新的 persisted usage event 恢复累计
usage/cache counters：

- 重启或 resume 后，runtime 模式的 `/v1/usage` 不会把 cache hit/miss 累计值
  从 0 重新开始。
- 只恢复事件中已经显式保存的 `cacheHitTokens` / `cacheMissTokens`，不会把
  只有兼容 `cachedTokens` 的旧事件猜成命中。
- `/v1/usage?group_by=thread|day|model` 的聚合桶也只用显式
  `cacheHitTokens` / `cacheMissTokens` 累计 `cached_tokens` 和
  `cache_miss_tokens`；旧事件只有 `cachedTokens` 时，命中率保持未知。
- Renderer 的 realtime usage mapper 和 thread usage hook 同样保留未知态：
  只看到兼容 `cachedTokens` 的旧事件/聚合桶时，不重新推导 hit/miss 或命中率。

实现位置：

- `kun/src/services/usage-service.ts`
- `kun/src/server/runtime-factory.ts`
- `src/renderer/src/agent/kun-mapper.ts`
- `src/renderer/src/hooks/use-thread-usage.ts`

## 可观测性与验证

缓存优化必须能被验证，而不是停留在设计口号。

当前有三层验证：

### 1. 单元测试

Kun 已覆盖这些关键行为：

- 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 优先解析
- tools canonical 排序与 schema key 稳定化
- few-shot 动态 id 不应扰动 fingerprint
- 非法 prefix 直接触发 drift 校验
- 不完整 tool pair 不应被发给模型

主要测试位置：

- `kun/tests/cache.test.ts`
- `kun/tests/model-client.test.ts`

### 2. 运行时 usage API

GUI 通过 Kun 使用统一接口读取 usage：

- `GET /v1/usage?group_by=thread`
- `GET /v1/usage?group_by=day`

当前产品期望是：

- 冷启动首轮可能接近 0
- 前缀热起来后，短轮次对话应稳定保持较高命中

### 3. 真实线程热身验证

2026-06-02 的 Kun 实测结果：

- 12 轮短消息：去掉冷启动后的热命中约 `94.7%`
- 同一稳定前缀热身后 24 轮短消息：整体约 `95.2%`
- 最新单轮可达到 `98.1%`

需要注意：

- 旧实现时期写入的 usage 事件不能事后修复
- 旧线程若当时没保存原生 hit/miss 字段，历史面板会继续反映旧口径

## 与 GUI 的边界

这个文档强调一个产品级约束：缓存优化属于 Kun，而不是 GUI。

GUI 侧只应该做：

- runtimeRequest
- SSE 订阅
- usage 展示
- 审批与用户输入交互

GUI 不应该做：

- 动态重写系统 prompt
- 本地拼装 tools schema 顺序
- 猜测缓存命中率公式
- 为了显示效果临时修正 usage 统计

这样 Code / Write / 连接手机三个入口才能共享同一套缓存纪律。

## 当前已借鉴与未完成项

已经落地的 Reasonix 思路：

- 稳定前缀文件
- immutable prefix 指纹
- 工具 schema canonical 排序
- tool catalog fingerprint / drift metadata
- DeepSeek 原生缓存字段优先
- tool-call / tool-result 配对修复
- multi-tool call block 重组与可完成子集 salvage
- streamed tool-call delta 按 `index` 续接
- 请求边界的大工具结果和长 tool args hygiene
- 真实 `usage.prompt_tokens` 驱动下一步 compaction
- runtime 启动时恢复 persisted cache token carryover
- 同 turn 重复工具调用 storm breaker
- 同 turn 内 built-in 只读工具小批量并发且按调用顺序落盘
- fork/resume 克隆历史时修复工具配对

下一阶段仍值得借鉴的点：

- 工具集合 mutation gate：新增工具可以接受，但编辑、重排、删除工具时最好有
  明确 restart 或新会话边界
- LLM fold summarizer：未来若使用模型做 compaction，应复用主前缀，避免
  summarizer 自己变成冷请求
- 大工具结果 token cap：当前已加入轻量 token-aware 估算；如未来内置 DeepSeek
  tokenizer，可改为 Reasonix 那种 token 精确上限
- volatile scratch 边界：把“展示给用户的思考”与“重放给模型的历史”继续分离

## 相关文档

- 架构总览：`docs/kun-architecture.md`
- Kun 贡献指南：`docs/kun-contributing.md`
- Kun 使用说明：`kun/README.md`
