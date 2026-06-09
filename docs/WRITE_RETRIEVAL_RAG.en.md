# Write cross-text BM25 + keyword search RAG technical description

This document describes cross-text retrieval enhancements in Write writing mode. Its goal is not to build a complete knowledge base, but to find relevant fragments from the current writing space with very low latency before text completion occurs, helping the model maintain terminology, fact and style continuity.

## Target

- When the user writes the current file, automatically reference other Markdown/text files in the same writing space.
- Prioritize service text completion scenarios, which require fast retrieval, short context, and silent degradation if failure occurs.
- Does not rely on embedding, vector databases or external services, reducing the configuration cost of local desktop applications.
- Available for both short completion and inspired long completion, but long completion can get more retrieved fragments.

## non-target

- No global semantic question and answer.
- No long-term persistent indexing.
- Do not display retrieved fragments to the user.
- Do not force the model to use retrieved content; retrieved fragments only serve as reference-only context.

## Overall architecture

```mermaid
flowchart LR
  A["CodeMirror cursor context"] --> B["completion payload"]
  B --> C["main-process FIM completion service"]
  C --> D["writing-space retrieval service"]
  D --> E["scan Markdown / text files"]
  E --> F["chunk + tokenize + BM25 index"]
  F --> G["keyword/BM25 recalled snippets"]
  G --> H["inject hidden Markdown comment into prompt"]
  H --> I["DeepSeek FIM /completions"]

```

Core implementation:

- `src/main/services/write-retrieval-service.ts`
- `src/main/services/write-inline-completion-service.ts`
- `src/shared/write-inline-completion.ts`

## Data input

The retrieval service receives a `WriteInlineCompletionRequest`, focusing on these fields:

- `workspaceRoot`: the root directory of the current Write writing space.
- `currentFilePath`: The file currently being edited, this file will be excluded from the search results.
- `prefix`: the text window in front of the cursor.
- `context.currentLinePrefix`: The text before the cursor in the current line.
- `context.previousNonEmptyLine`: the previous non-empty line.
- `preview.documentTail`: summary of the tail of the current document.
- `mode`: `short` or `long`, determines the number of recalled fragments.

## File scanning strategy

The search only scans local files in the current writing space and performs hard upper limit control:

- Support extensions: `.md`, `.markdown`, `.mdx`, `.txt`
- Skip directories: `.git`, `node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, etc.
- Maximum number of scan entries: `8_000`
- Maximum number of index files: `160`
- Maximum read bytes of a single file: `600_000`
- Maximum number of index blocks: `720`

These limits are designed to keep completion requests predictable. Even with a large writing space, retrieval does not degenerate into an expensive full search.

## Text chunking

Chunking prioritizes Markdown writing structure:

- The title row updates the current block title.
- The natural paragraph after a blank line can form a boundary.
- The maximum number of characters in a single block is approximately `900`.
- Clips that are too short will be discarded to avoid noise.
- Each block saves the path, relative path, title, body, and starting and ending line numbers.

The advantage of this is that the search results usually fall on "a natural segment" or "a bar fragment" rather than an arbitrary character window.

## Word segmentation strategy

In order to adapt to both Chinese and English writing, lightweight rules are used for word segmentation:

- English/Number: Extract `a-z0-9_-` tokens whose length is greater than or equal to 2.
- Chinese: Generate 2 to 4 character n-grams for continuous Chinese fields.
- English stop words will be filtered, such as `the`, `and`, `with`, `this`.
- The text will be `NFKC` normalized first and converted to lowercase.

This kind of rule is not as "smart" as embedding, but it is very fast and enough to capture terms, character names, subject headings, proprietary phrases and Chinese keywords.

## Query construction

Completion requests are compressed into a weighted query:

| Source | Weight | Role |
| --- | ---: | --- |
| Text before cursor in current line | 3.0 | Strongest local intent |
| Previous non-blank line | 2.0 | Current paragraph/section context |
| Previous line | 1.4 | Proximity continuity |
| Summary at the end of the current document | 1.0 | Document-level topic |
| `prefix` tail window | 0.7 | Wider local context |

The query retains up to 36 high-weight tokens. This can reduce the interference of the tail of long documents on retrieval and give priority to the intention near the current cursor.

## Sorting formula

The final score consists of two parts:

```text
score = BM25(chunk, query) + keywordBoost(chunk, query)

```

BM25 uses the standard form:

```text
idf = log(1 + (N - df + 0.5) / (df + 0.5))
norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunkLength / avgLength))

```

Current parameters:

- `k1 = 1.2`
- `b = 0.72`

Keyword enhancements include:

- Hit the title token for extra points.
- Bonus points for hitting the file path token.
- Hit the current line/previous line phrase for extra points.
- The more hit tokens, the slight coverage bonus.

The results filter out low-scoring clips, empty clips, duplicate clips, and limit a single file to contribute up to 2 clips.

## Prompt injection

The search results will not be appended directly to the user text, but will be placed in front of the FIM prompt in the form of a hidden Markdown comment:

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

raw prefix...

```

This has three advantages:

- Explicitly state to the model that these contents are reference-only.
- Don't change `suffix` after cursor.
- If the model behaves normally, the returned results will only be insertable text and will not expose retrieval meta-information.

## The difference between short completion and long completion

The retrieval service itself is the same, but the number of recalls is different:

- `short`: up to 3 fragments, serving local completion with low latency and low interruption.
- `long`: up to 5 fragments, inspirational continuation after service pause, requiring stronger cross-text grounding.

Long completion is still not "full text generation". Retrieving fragments only helps the model catch the context, not let it diverge.

## Caching and performance

The index is a short TTL memory cache:

- TTL: 30 seconds
- Cache key: writing space root directory
- Cache content: chunking, term frequency, document frequency, average chunk length

When writing, completion is often triggered multiple times in a row. A short TTL cache avoids rescanning the file on every request while allowing for faster refresh when the user modifies the file.

## Security Boundary

- Only read files within `workspaceRoot`.
- The currently edited file will be excluded from the search results to avoid repeated completion of the current text.
- Binary files are skipped via NUL byte detection.
- There is a byte limit for single file reading.
- Failure to read the file will be ignored and completion will not be blocked.
- When there is no hit result, completion will degrade to normal FIM.

## Failed to downgrade

The following situations will silently return `null`:

- There is no `workspaceRoot`.
- The current file is not in the writing space.
- Index is empty.
- The query token is empty.
- There are no segments that exceed the threshold.
- A local error occurred during file scanning or reading.

The main process completion service will catch the retrieval exception and continue to request FIM using the original prompt.

## Adjustable parameters

The current parameters are concentrated at the top of `write-retrieval-service.ts`:

- `INDEX_CACHE_TTL_MS`
- `MAX_SCAN_ENTRIES`
- `MAX_INDEX_FILES`
- `MAX_FILE_BYTES`
- `MAX_INDEX_CHUNKS`
- `MAX_CHUNK_CHARS`
- `MAX_QUERY_TERMS`
- `DEFAULT_MAX_SNIPPETS`

If UI is needed in the future, it is recommended to expose it first:

- Whether to enable search enhancement.
- Number of fragments retrieved for long completion.
- The maximum number of index files in the writing space.

## Test coverage

Related tests:

- `src/main/services/write-retrieval-service.test.ts`
- `src/main/services/write-inline-completion-service.test.ts`
- `src/main/ipc/app-ipc-schemas.test.ts`

Key coverage:

- Chinese and English token generation.
- Recall across document fragments.
- Exclude the current file.
- Retrieve fragment injection FIM prompt.
- Keep the original prompt when there are no search results.
