# Write 跨文本 BM25 + 关键词检索 RAG 技术说明

这份文档说明 Write 写作模式中的跨文本检索增强方案。它的目标不是做一个完整知识库，而是在文本补全发生前，用很低的延迟从当前写作空间里找出相关片段，帮助模型保持术语、事实和风格连续性。

## 目标

- 在用户写作当前文件时，自动参考同一写作空间里的其他 Markdown / 文本文件。
- 优先服务文本补全场景，要求检索快、上下文短、失败可静默降级。
- 不依赖 embedding、向量数据库或外部服务，降低本地桌面应用的配置成本。
- 对短补全和灵感长补全都可用，但长补全可以获得更多检索片段。

## 非目标

- 不做全局语义问答。
- 不做长期持久化索引。
- 不把检索片段展示给用户。
- 不强迫模型使用检索内容；检索片段只作为 reference-only 上下文。

## 总体架构

```mermaid
flowchart LR
  A["CodeMirror 光标上下文"] --> B["补全 payload"]
  B --> C["主进程 FIM 补全服务"]
  C --> D["写作空间检索服务"]
  D --> E["扫描 Markdown / 文本文件"]
  E --> F["分块 + 分词 + BM25 索引"]
  F --> G["关键词/BM25 召回片段"]
  G --> H["隐藏 Markdown comment 注入 prompt"]
  H --> I["DeepSeek FIM /completions"]
```

核心实现：

- `src/main/services/write-retrieval-service.ts`
- `src/main/services/write-inline-completion-service.ts`
- `src/shared/write-inline-completion.ts`

## 数据输入

检索服务接收 `WriteInlineCompletionRequest`，重点使用这些字段：

- `workspaceRoot`：当前 Write 写作空间根目录。
- `currentFilePath`：当前正在编辑的文件，检索结果会排除这个文件。
- `prefix`：光标前文本窗口。
- `context.currentLinePrefix`：当前行光标前文本。
- `context.previousNonEmptyLine`：上一条非空行。
- `preview.documentTail`：当前文档尾部摘要。
- `mode`：`short` 或 `long`，决定召回片段数量。

## 文件扫描策略

检索只扫描当前写作空间内的本地文件，并做硬上限控制：

- 支持扩展名：`.md`、`.markdown`、`.mdx`、`.txt`
- 跳过目录：`.git`、`node_modules`、`dist`、`build`、`out`、`.next`、`coverage` 等
- 最大扫描条目数：`8_000`
- 最大索引文件数：`160`
- 单文件最大读取字节：`600_000`
- 最大索引块数：`720`

这些限制的设计意图是让补全请求保持可预测。即使写作空间较大，检索也不会退化成一次昂贵的全盘搜索。

## 文本分块

分块以 Markdown 写作结构为优先：

- 标题行会更新当前块标题。
- 空行后的自然段可以形成边界。
- 单块最大字符数约 `900`。
- 过短片段会被丢弃，避免噪声。
- 每个块保存路径、相对路径、标题、正文、起止行号。

这样做的好处是检索结果通常落在“一个自然段”或“一个小节片段”上，而不是任意字符窗口。

## 分词策略

为了同时适配中英文写作，分词采用轻量规则：

- 英文/数字：提取长度大于等于 2 的 `a-z0-9_-` token。
- 中文：对连续汉字段生成 2 到 4 字 n-gram。
- 英文停用词会过滤，例如 `the`、`and`、`with`、`this`。
- 文本会先做 `NFKC` normalize，并转小写。

这种规则没有 embedding 那么“聪明”，但非常快，也足够捕捉术语、人物名、主题词、专有短语和中文关键词。

## 查询构造

补全请求会被压缩成一个加权查询：

| 来源 | 权重 | 作用 |
| --- | ---: | --- |
| 当前行光标前文本 | 3.0 | 最强局部意图 |
| 上一条非空行 | 2.0 | 当前段落/小节语境 |
| 上一行 | 1.4 | 邻近连续性 |
| 当前文档尾部摘要 | 1.0 | 文档级主题 |
| `prefix` 尾部窗口 | 0.7 | 更宽的局部上下文 |

查询最多保留 36 个高权重 token。这样可以降低长文档尾部对检索的干扰，让当前光标附近的意图优先。

## 排序公式

最终分数由两部分组成：

```text
score = BM25(chunk, query) + keywordBoost(chunk, query)
```

BM25 使用标准形式：

```text
idf = log(1 + (N - df + 0.5) / (df + 0.5))
norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunkLength / avgLength))
```

当前参数：

- `k1 = 1.2`
- `b = 0.72`

关键词增强包括：

- 命中标题 token 加分。
- 命中文件路径 token 加分。
- 命中当前行/上一行短语加分。
- 命中 token 越多，有轻微覆盖度加分。

结果会过滤掉低分片段、空片段、重复片段，并限制单个文件最多贡献 2 个片段。

## Prompt 注入

检索结果不会直接追加到用户正文里，而是以隐藏 Markdown comment 形式放在 FIM prompt 前：

```markdown
<!-- DeepSeek GUI inline completion references.
Use these snippets only for local terminology, factual continuity, and style. Do not insert or mention this comment.
Completion mode: short.
Retrieval: bm25-keyword; indexed 12 files / 38 chunks.
Query keywords: ...

[1] notes/example.md:12-18
Title: ...
Matched: ...
...
-->

原始 prefix...
```

这样有三个好处：

- 对模型明确说明这些内容是 reference-only。
- 不改变光标后的 `suffix`。
- 如果模型表现正常，返回结果只会是可插入文本，不会暴露检索元信息。

## 短补全与长补全的差异

检索服务本身是同一个，但召回数量不同：

- `short`：最多 3 个片段，服务低延迟、低打扰的局部补全。
- `long`：最多 5 个片段，服务停顿后的灵感续写，需要更强跨文本 grounding。

长补全仍然不是“全文生成”。检索片段只帮助模型接住上下文，不让它发散。

## 缓存与性能

索引是短 TTL 内存缓存：

- TTL：30 秒
- 缓存 key：写作空间根目录
- 缓存内容：分块、词频、文档频率、平均块长度

写作时通常会连续触发多次补全。短 TTL 缓存可以避免每次请求都重新扫描文件，同时又能在用户修改文件后较快刷新。

## 安全边界

- 只读取 `workspaceRoot` 内文件。
- 当前编辑文件会从检索结果中排除，避免重复补全当前文本。
- 二进制文件会通过 NUL 字节检测跳过。
- 单文件读取有字节上限。
- 读文件失败会忽略，不阻塞补全。
- 没有命中结果时，补全会退化为普通 FIM。

## 失败降级

以下情况都会静默返回 `null`：

- 没有 `workspaceRoot`。
- 当前文件不在写作空间内。
- 索引为空。
- 查询 token 为空。
- 没有超过阈值的片段。
- 文件扫描或读取过程中出现局部错误。

主进程补全服务会捕获检索异常，继续用原始 prompt 请求 FIM。

## 可调参数

当前参数都集中在 `write-retrieval-service.ts` 顶部：

- `INDEX_CACHE_TTL_MS`
- `MAX_SCAN_ENTRIES`
- `MAX_INDEX_FILES`
- `MAX_FILE_BYTES`
- `MAX_INDEX_CHUNKS`
- `MAX_CHUNK_CHARS`
- `MAX_QUERY_TERMS`
- `DEFAULT_MAX_SNIPPETS`

后续如果需要 UI 化，建议优先暴露：

- 是否开启检索增强。
- 长补全检索片段数量。
- 写作空间最大索引文件数。

## 测试覆盖

相关测试：

- `src/main/services/write-retrieval-service.test.ts`
- `src/main/services/write-inline-completion-service.test.ts`
- `src/main/ipc/app-ipc-schemas.test.ts`

重点覆盖：

- 中英文 token 生成。
- 跨文档片段召回。
- 排除当前文件。
- 检索片段注入 FIM prompt。
- 无检索结果时保持原始 prompt。
