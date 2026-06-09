# 代理运行时说明

DeepSeek GUI 当前只有一个可运行的本地 Agent 运行时：**Kun**。

不要新增第二套运行时、运行时切换器、运行时诊断面板，或旧的 CodeWhale / Reasonix 进程路径。Code、Write、连接手机三个入口都统一走同一个 Kun HTTP/SSE 边界。连接手机在代码内部仍沿用 `claw` 命名作为兼容标识。

## 允许的扩展路径

1. 在 `kun/src/contracts/` 中新增协议字段。
2. 在 `kun/src/loop/`、`kun/src/services/` 或 `kun/src/ports/` / `kun/src/adapters/` 下新增端口与适配器来实现新行为。
3. 在 `kun/src/server/routes/` 下新增 HTTP 接口。
4. 在 `src/renderer/src/agent/kun-runtime.ts` 与 `src/renderer/src/agent/kun-mapper.ts` 中完成端点与事件映射。
5. 仅在 `agents.kun` 下新增设置项。

## 禁止路径

- 不要新增 `AgentSwitcher`。
- 不要新增 `ConnectionStatusBar`。
- 不要新增 `RuntimeDiagnosticsDialog` 或运行时自检 UI。
- 不要恢复 CodeWhale/Reasonix 的适配器、进程管理、RPC 桥、更新器或导入器。
- 不要恢复绘图/设计的启动卡片。
- 不要新增打开运行时控制面板的 `/usage` 或 `/runtime` 斜杠命令。

## 旧数据兼容规则

旧的持久化 key 仅在 settings 迁移时按只读路径使用：

- `agentProvider: codewhale | reasonix | deepseek-runtime` 映射为 `kun`。
- `agents.codewhale`、`agents.reasonix` 和旧 `deepseek` 的值会一次性写入 `agents.kun`。
- 保存后的 settings 仅保留 `agents.kun`。
- 旧连接手机（内部 Claw）的 `agentThreadIds.codewhale/reasonix` 会并入 `agentThreadIds.kun`。

## 验证清单

执行：

```bash
npm run typecheck
npm test
npm run build
```

手工冒烟检查：

- Code 可以创建 Kun 会话、流式回传回复、进行工具审批/拒绝、以及中断回合。
- CodeWhale 的等价能力应保持在 Kun 下可用：会话搜索/归档筛选、fork、会话恢复、`request_user_input` 提交与取消、usage 查询。
- 缓存指标使用 DeepSeek 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；在稳定前缀热身后，热门对话的 hit rate 应长期保持在 90% 以上。
- 不可变前缀漂移与异常的 tool-call/tool-result 历史必须在请求下发 DeepSeek 前被拦截。
- Write 可以打开工作区、发起 inline 补全、使用选中文本助手动作。
- 连接手机可以保存设置，并通过 Kun 会话执行手工任务。
- 设置 -> Agent 仅显示 Kun。

完整方案见 [`docs/kun-architecture.md`](./kun-architecture.md)。
