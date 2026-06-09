# DeepSeek GUI v0.2.0

这一版是 DeepSeek GUI 的一次全面改版。

DeepSeek GUI 不再只是一个聊天窗口，而是一个围绕真实项目工作的本地 AI 工作台：Code 处理代码库，Write 打磨文档，连接手机接入 IM 与定时任务，需求、计划、目标、代码审查、Skill/MCP 和更新都被收进同一个图形化流程里。

### 内置 Kun Agent 运行时

本版最大的变化，是 DeepSeek GUI 现在以内置自研 Agent 运行时 **Kun** 作为唯一核心运行时。

Kun 取意于《庄子·逍遥游》中的“北冥有鱼，其名为鲲”。它不是一个临时聊天壳，而是一个专门为 GUI、长期项目上下文和复杂工具调用设计的本地 Agent runtime。GUI 只负责清晰地展示会话、工具、审批、计划和文件改动，真正的 agent loop、缓存纪律、上下文治理和工具调用都沉到 Kun 里完成。

Kun 通过本地 HTTP/SSE 边界连接桌面应用和 agent loop。Code、Write、连接手机和定时任务共用同一个运行时，但会话、工作区和界面状态彼此独立，适合长期维护多个项目。

### 更高的 Token ROI

Kun 的核心目标是提高每一个 token 的 ROI：让用户花出去的上下文预算尽量用于需求、代码、决策和结果，而不是浪费在重复工具 schema、失控工具输出、无效历史、MCP 工具目录或本来可以被缓存复用的前缀上。

这一版围绕 token economy 做了系统性优化：

- 稳定 prompt 前缀：系统提示词、工具 schema、few-shot 和 pinned constraints 被纳入 immutable prefix，并用 fingerprint 追踪漂移。
- DeepSeek 原生缓存统计：优先使用 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，让 cache hit rate 更接近真实成本收益。
- 上下文压缩：长会话会保留目标、约束、决策、重要工具结果和未解决事项，减少重复历史对上下文窗口的占用。
- 工具输出治理：超长 `tool_result`、长参数、base64 payload、重复行和重复工具循环会在模型请求边界被压缩或抑制，磁盘日志仍保留完整记录，方便审计和回放。
- MCP search：当 MCP 工具很多时，Kun 可以通过 `mcp_search` / `mcp_describe` / `mcp_call` 渐进发现工具，避免每一轮都把庞大的 MCP 工具目录塞进 prompt。
- 可观测用量：usage 事件会记录 cache hit/miss、token economy savings 和成本估算，让“更省 token、更省钱”不只是感觉，而是可以被看见和验证。

简单说，这版的 Kun 会尽量把 token 花在真正产生价值的地方。

### 新建需求：从想法到计划再到执行

这一版把需求写作、项目理解和 agent 执行结合到了一起。

你可以直接在 GUI 里写需求草稿，包括背景、目标、验收标准和截图参考。写需求时，Requirement AI 会知道当前项目，会围绕项目做检索和上下文补齐，也会提供更贴近项目语境的幽灵补全，让需求写起来更顺手。

需求写完后，可以一键生成实施计划。计划会保存成可编辑的 Markdown 文件，并同步到右侧计划面板和线程 Todo。确认计划后，可以直接让 agent build 这个计划，把“写需求 -> 生成计划 -> 执行实现 -> 检查结果”串成一条连续流程。

这是 DeepSeek GUI 现在很重要的一条产品范式：Agent 不再只是在聊天框里回答问题，而是和 GUI 一起承载需求、计划、执行和复盘。

### Code 工作台全面升级

Code 模式现在更适合真实代码库里的长任务。

- `/plan`：快速创建或修订 GUI 管理的实施计划。
- `/goal`：给当前线程设置长期目标，agent 会围绕目标持续推进，直到完成、暂停或被清除。
- `/review`：审查当前未提交改动，也可以指定 base branch、commit 或自定义范围，结果以 findings 卡片呈现。
- `/btw`：开启继承当前上下文的旁支对话，适合临时追问而不打断主线任务。
- 计划面板和线程 Todo：长任务可以被拆成可跟踪步骤，执行状态更清楚。
- 变更审查面板：文件改动、内联 diff 和执行结果都可以在应用内检查。
- 权限与审批：继续支持只读、工作区可写、完全访问等模式，并可配置工具调用前是否需要审批。

这些能力和 Kun 的缓存、上下文压缩、工具治理结合后，可以更好地发挥模型能力，同时减少无效 token 消耗。

### Write 写作工作台

Write 模式也在这一版中成为独立工作台。

- 管理默认写作空间和多个自定义写作空间。
- Markdown 文件树支持新建、重命名、删除和实时保存。
- Live / Source / Split / Preview 多种编辑模式，让 Markdown 写作更接近所见即所得。
- 内置 DeepSeek FIM 短补全和灵感长补全。
- 补全前会对写作空间内的 Markdown / 文本文件建立轻量索引，用 BM25 和关键词召回相关片段，帮助模型保持术语、事实和风格连续。
- 选中文本后可以直接唤起 inline agent，用于润色、续写、解释、改写。
- 当前文档可导出为 `HTML` / `PDF` / `DOC` / `DOCX`。

Write 使用 Kun thread，但在 GUI 本地隔离写作会话，避免写作上下文污染 Code 或连接手机侧栏。

### 连接手机与定时任务

连接手机现在是 DeepSeek GUI 的第三个重要入口。

- 支持飞书 / Lark / 微信接入。
- 每个 IM Agent 可以配置独立人设、模型和工作目录。
- 支持本地 webhook / relay，方便接入团队协作或个人自动化流程。
- 支持一次性、每日、间隔或手动定时任务。
- 定时任务会创建独立 Kun thread，并按配置发送 prompt，让 Agent 在电脑唤醒时自动执行。

这让 DeepSeek GUI 不只是在你打开聊天窗口时工作，也可以成为持续运行的本地自动化 Agent。

### Skill、MCP 与扩展能力

设置页现在可以更集中地管理 Kun 能力：

- 创建和管理 Skill。
- 编辑 MCP 配置。
- 查看运行时实际上报的 capability 和 diagnostics。
- 按配置启用 MCP、Web fetch/search、Skills、图片附件、跨会话 Memory 和子 agent 委派。

当 MCP 工具数量很多时，Kun 的 MCP search 能明显减少工具 schema 对上下文的占用，降低复杂工具生态下的 token 成本。

### 全平台安装包与发布流程

本版开始提供 macOS、Windows 和 Linux 预构建安装包：

- macOS：`.dmg` / `.zip`，支持 Apple Silicon 和 Intel。
- Windows：`.exe`，NSIS 安装器，x64。
- Linux：`.AppImage`，x64。

发布流程也更新为可以在 macOS 上完成全平台构建、GitHub release 上传和 R2 更新发布，方便维护者一次性完成跨平台发布。

### 升级说明

- 首次启动仍需要填写 DeepSeek API Key；如果使用兼容 DeepSeek / OpenAI 的服务，可以在设置里修改 Base URL。
- 旧的 CodeWhale / Reasonix / deepseek-runtime 设置会迁移到 Kun 配置。
- 本地设置、会话、MCP、Skill 和 Kun 数据默认保存在本机，卸载应用不会自动删除这些数据。

### 总结

v0.2.0 是 DeepSeek GUI 从“桌面聊天工具”走向“本地 Agent 工作台”的一次关键版本。

Kun 负责把模型调用、缓存、上下文和工具成本管住；GUI 负责把需求、计划、目标、审查、写作、自动化和文件改动变得可见、可控、可继续。两者结合之后，DeepSeek GUI 更适合真实项目里的长期工作，也更能把每一个 token 用在刀刃上。
