# 用 BM25 + 关键词 RAG 做 Write 文本编辑：一次探索和落地

Write 里的文本补全已经证明了一件事：写作场景不一定需要重型向量库。只要能在低延迟内从同一个写作空间里找回术语、事实和风格片段，FIM 模型就能更稳地接住当前段落。

这次探索的问题更具体：**文本编辑能不能也走 BM25 + 关键词 RAG？** 例如用户选中一个名词，让 AI 把这个段落里的其他同名词也替换掉。它不是传统 ghost text 补全，而是对一段已有文本做原地替换。

结论是：可以，但它应该被设计成“带边界标记的中间替换”，而不是“光标续写”。

## 为什么不是普通补全

补全的目标是预测光标后的下一小段文本：

```text
prefix [cursor] suffix
```

编辑的目标则是替换一段已有文本：

```text
prefix [original edit scope] suffix
```

如果仍然把编辑当成 cursor completion，模型只能在光标处插入内容，很难自然完成“段落内其他位置也一起替换”。更合适的办法是把待编辑段落挖空：

```text
prompt = 编辑指令 + 检索片段 + prefix
suffix = suffix
model returns = replacement for original edit scope
```

也就是说，“middle”不再是空光标，而是一个需要被重新生成的段落或选区。

## RAG 在编辑里解决什么问题

BM25 + 关键词 RAG 不负责替模型“决定怎么改”，它负责给模型提供局部事实和写作约束：

- 产品名、人物名、项目术语应该怎么写。
- 同一写作空间里类似段落的语气和句式。
- 某个概念在其他文档里的标准表述。
- 用户选中短词时，哪些跨文档片段能解释这个词的上下文。

这很适合编辑任务，因为编辑通常更怕“改飞”而不是“不够发散”。关键词检索比 embedding 更朴素，但在术语替换、风格延续、同主题段落召回上很有效，且桌面端成本低。

## 设计取舍

这次实现复用现有 Write 补全的检索服务：

- 继续扫描当前写作空间内的 Markdown / 文本文件。
- 继续用中英文 token + 中文 2 到 4 字 n-gram。
- 继续用 BM25 分数加标题、路径、短语命中加权。
- 当前正在编辑的文件仍从检索结果中排除，避免把原文重复喂回模型。

新增的是编辑层：

- 用户选中短词或短句时，默认把编辑范围扩展到当前自然段。
- 用户选中较长文本或跨空行文本时，只编辑原选区。
- 用户手动做一次性短语替换时，会先用确定性规则把同段其他同短语一起替换，例如 `deepseek gui -> DeepSeek GUI`。
- 渲染端发送 `prefix`、`suffix`、`original`、`instruction` 和选区元数据。
- 渲染端会带上最近 2 分钟内当前文件的用户/AI 编辑记录，帮助模型理解“继续这样改”。
- 主进程构造编辑 prompt，并把检索片段作为 reference-only 上下文注入。
- 模型只返回 replacement，渲染端把 replacement 原地替换回文档。

## Prompt 形态

编辑 prompt 的关键是边界清晰：

```markdown
<!-- DeepSeek GUI inline edit.
You are replacing the missing middle between PREFIX and SUFFIX.
Return exactly the replacement text for the edit scope.
User instruction: ...

Original edit scope:
...

Reference snippets from the same writing workspace...

Recent local edits in this file...
-->

原始 prefix...
```

显式编辑请求目前复用 `write:inline-completion` IPC，但主进程会通过 chat completions 发送，让模型返回带标记的 `EDIT` action：

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "system",
      "content": "You are DeepSeek GUI inline writing..."
    },
    {
      "role": "user",
      "content": "<<<PREFIX ... >>>\n<<<EDIT_SCOPE ... >>>\n<<<SUFFIX ... >>>"
    }
  ],
  "max_tokens": 512
}
```

这样可以让模型同时看到编辑前后边界，并把检索片段当成 reference-only 上下文。

## Recent edits 意图信号

BM25 + 关键词 RAG 解决的是跨文件参考，recent edits 解决的是当前文件里刚刚发生的编辑意图。实现会记录用户输入和 AI 原地编辑产生的删除/插入文本、前后邻域、编辑来源和 AI 编辑指令。

此外，术语大小写和简单重命名不完全依赖模型。编辑器会对一次性短语替换做同段传播：当你把 `deepseek gui` 改成 `DeepSeek GUI` 或 `DXGUI`，同一个自然段里其他 `deepseek gui` 会同步替换。这个确定性层负责“必须发生”的一致性，recent edits 和 RAG 再负责后续 AI 编辑时理解这种意图。

当用户输入“继续这样改”“同样替换”“照刚才那样润色”这类弱指令时，prompt 会提醒模型从 recent edits 中推断当前编辑模式；如果 recent edits 和当前指令冲突，则优先当前指令。

详细技术说明见 `docs/WRITE_INLINE_EDIT_RECENT_EDITS.zh-CN.md`。

```markdown
Recent local edits in this file. Treat these as intent signals...

[1] 2s ago; source=user; range=20-32
Deleted: DeepSeek GUI
Inserted: Write mode
Around: Earlier term: [[edit]] should be consistent.
```

## 为什么短选区要扩段落

“替换某个名词，并同步替换段落其他地方”本质上不是替换选中的几个字符，而是让模型重写这个段落。

因此这次实现里有一个启发式：

- 选中文本不超过 120 个字符。
- 选区没有跨空行。
- 则编辑范围扩展到最近空行、标题、代码围栏或分隔线之间的自然段。

这样用户只需要选中一个词，输入“把 Alpha 改成 Write mode”，模型拿到的是整个段落的 `original`，返回的也是整个段落 replacement。

## 失败保护

原地编辑比 ghost text 风险更高，所以实现里加了几层保护：

- 没有 API key、补全能力关闭、无指令时直接失败。
- 多选区暂不支持，避免把多个非连续范围合并出错。
- 模型返回空文本时，只有删除类指令才允许应用。
- 请求返回后会检查原编辑范围是否仍和发起请求时一致；如果用户已经改过这段，就拒绝应用。
- 应用后仍走 Write 原有 autosave 机制，不绕过编辑器状态。

## 落地文件

主要新增和改动：

- `src/shared/write-inline-edit.ts`：编辑请求/结果类型。
- `src/main/services/write-inline-completion-service.ts`：处理 `mode: "edit"` 请求、FIM / chat 编辑 prompt、RAG 注入、action 解析和调试日志。
- `src/renderer/src/write/inline-edit.ts`：选区扩段落、构造 payload、应用 replacement。
- `src/renderer/src/write/recent-edits.ts`：最近编辑上下文的记录、筛选和 prompt payload 转换。
- `src/renderer/src/write/term-propagation.ts`：同段术语大小写/重命名传播。
- `src/renderer/src/components/write/WriteWorkspaceView.tsx`：选中文本浮层支持“AI 编辑”和“发送到写作助手”两条路径。
- `src/main/ipc/app-ipc-schemas.ts`、`src/preload/index.ts`、`src/shared/ds-gui-api.ts`：复用 `write:inline-completion` IPC，通过 `mode: "edit"`、`editCandidate` 和 recent edits 承载 inline edit。

测试覆盖：

- 编辑 payload schema。
- 编辑 action 请求和 replacement 提取。
- RAG 片段注入编辑 prompt。
- Recent edits 注入编辑 prompt。
- 同段术语传播。
- 短选区扩展为段落。
- replacement 只替换解析出的范围。

## 后续可以继续探索

- 增加 diff preview，让用户确认后再应用。
- 把 RAG 命中片段数量、recent edits 命中数量和来源展示为轻量提示。
- 对不同指令分类选择更窄或更宽的编辑范围，例如“改错别字”不必扩段，“统一术语”应扩段。
- 在 prompt 中加入“最小改动”或“可读性重写”等可选编辑模式。

这一版先把最关键的闭环打通：**选中词语 -> 段落级 inline edit -> BM25/关键词 RAG 辅助 -> 原地替换**。它和补全共享基础能力，但交互目标明确不同：补全是在光标后加字，编辑是在一个受控范围里重写。
