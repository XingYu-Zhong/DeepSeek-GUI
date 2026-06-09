# Use BM25 + keyword RAG to do Write text editing: an exploration and implementation

Text completion in Write has proven one thing: writing scenarios don’t necessarily require heavy vector libraries. As long as it can retrieve terms, facts, and style fragments from the same writing space with low latency, the FIM model can more reliably catch the current paragraph.

The question explored this time is more specific: **Can text editing also use BM25 + keyword RAG? ** For example, the user selects a noun and asks AI to replace other nouns with the same name in this paragraph. It is not a traditional ghost text completion, but an in-place replacement of an existing text.

The conclusion is: Yes, but it should be designed as "boundary-marked middle replacement" rather than "cursor continuation".

## Why is it not a normal completion?

The goal of completion is to predict the next short paragraph of text after the cursor:

```text
prefix [cursor] suffix

```

The goal of editing is to replace an existing text:

```text
prefix [original edit scope] suffix

```

If you still regard editing as cursor completion, the model can only insert content at the cursor, and it is difficult to naturally complete "replacing other positions within the paragraph as well". A more appropriate approach is to hollow out the paragraph to be edited:

```text
prompt = edit instruction + retrieved snippets + prefix
suffix = suffix
model returns = replacement for original edit scope

```

In other words, the "middle" is no longer an empty cursor, but a paragraph or selection that needs to be regenerated.

## What problems does RAG solve in editing?

BM25 + keyword RAG is not responsible for "deciding how to change" for the model, it is responsible for providing local facts and writing constraints to the model:

- How to write product names, character names, and project terms.
- Similar paragraph tone and sentence structure in the same writing space.
- A standard representation of a concept in other documents.
- When a user selects a short word, which cross-document fragments explain the context of the word.

This works well for editing tasks, as editors are often more afraid of "flying" than "not being divergent enough". Keyword search is simpler than embedding, but it is very effective in term replacement, style continuation, and recall of paragraphs on the same topic, and the desktop cost is low.

## Design trade-offs

This time, the existing Write completion retrieval service is reused:

- Continue scanning Markdown/text files in the current writing space.
- Continue to use Chinese and English tokens + Chinese 2 to 4 character n-grams.
- Continue weighting title, path, phrase hits with BM25 score.
- The file currently being edited is still excluded from the search results to avoid repeatedly feeding the original text back to the model.

Newly added is the editing layer:

- When the user selects a short word or sentence, the editing scope is expanded to the current natural paragraph by default.
- When the user selects long text or text that spans blank lines, only the original selection will be edited.
- When users manually perform one-time phrase replacement, they will first use deterministic rules to replace other identical phrases in the same paragraph, such as `deepseek gui -> DeepSeek GUI`.
- The rendering side sends `prefix`, `suffix`, `original`, `instruction` and selection metadata.
- The rendering end will bring the user/AI editing records of the current file in the last 2 minutes to help the model understand "continue to change like this".
- The main process constructs an edit prompt and injects retrieved fragments as reference-only context.
- The model only returns replacement, and the rendering end replaces the replacement in place back to the document.

## Prompt form

The key to editing prompt is to have clear boundaries:

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

raw prefix...

```

Explicit edit requests currently use the same `write:inline-completion` IPC, but the main process sends them through chat completions so the model can choose a marked `EDIT` action:

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

This allows the model to see both the front and rear boundaries of the edit and treat the retrieved fragment as a reference-only context.

## Recent edits Intent Signal

BM25 + keyword RAG solves cross-file references, recent edits solves the editing intention that just happened in the current file. The implementation logs user input and deleted/inserted text produced by AI in-place editing, before and after neighbors, edit source, and AI editing instructions.

Additionally, term casing and simple renaming are not entirely model dependent. The editor will propagate one-time phrase replacements in the same paragraph: when you change `deepseek gui` to `DeepSeek GUI` or `DXGUI`, other `deepseek gui` in the same natural paragraph will be replaced simultaneously. This deterministic layer is responsible for the consistency of "must happen", and recent edits and RAG are responsible for understanding this intent during subsequent AI edits.

When the user enters weak instructions such as "Continue to change like this", "Replace the same", "Retouch as before", the prompt will remind the model to infer the current editing mode from recent edits; if recent edits conflict with the current instruction, the current instruction will take precedence.

See `docs/WRITE_INLINE_EDIT_RECENT_EDITS.en.md` for detailed technical description.

```markdown
Recent local edits in this file. Treat these as intent signals...

[1] 2s ago; source=user; range=20-32
Deleted: DeepSeek GUI
Inserted: Write mode
Around: Earlier term: [[edit]] should be consistent.

```

## Why do we need to expand the paragraph in a short selection area?

"Replacing a noun and simultaneously replacing other parts of the paragraph" essentially does not replace a few selected characters, but allows the model to rewrite the paragraph.

So there is a heuristic in this implementation:

- The selected text must not exceed 120 characters.
- The selection does not span empty lines.
- then the editing scope extends to the natural segment between the nearest blank line, heading, code fence, or separator line.

In this way, the user only needs to select a word and enter "Change Alpha to Write mode". The model will get the `original` of the entire paragraph and return the replacement of the entire paragraph.

## Failure protection

Editing in place is riskier than ghost text, so several layers of protection are added to the implementation:

- It will fail directly when there is no API key, the completion capability is turned off, and there is no command.
- Multiple selections are not supported at the moment to avoid errors when merging multiple non-consecutive ranges.
- When the model returns empty text, only delete class directives are allowed to be applied.
- After the request returns, it will be checked whether the original editing range is still the same as when the request was made; if the user has already changed this section, the application will be rejected.
- Write's original autosave mechanism is still used after application, and the editor state is not bypassed.

## Implementation files

Major new additions and changes:

- `src/shared/write-inline-edit.ts`: Edit request/result type.
- `src/main/services/write-inline-completion-service.ts`: handles `mode: "edit"` requests, FIM/chat edit prompts, RAG injection, action parsing, and debug logging.
- `src/renderer/src/write/inline-edit.ts`: Expand the selection section, construct the payload, and apply replacement.
- `src/renderer/src/write/recent-edits.ts`: Logging, filtering and prompt payload conversion of recent edit contexts.
- `src/renderer/src/write/term-propagation.ts`: Term case/rename propagation in the same paragraph.
- `src/renderer/src/components/write/WriteWorkspaceView.tsx`: The selected text floating layer supports two paths: "AI Editing" and "Send to Writing Assistant".
- `src/main/ipc/app-ipc-schemas.ts`, `src/preload/index.ts`, `src/shared/ds-gui-api.ts`: the existing `write:inline-completion` IPC accepts `mode: "edit"` plus `editCandidate` and recent edits.

Test coverage:

- Edit payload schema.
- Edit action requests and replacement extraction.
- RAG fragment injection into editing prompt.
- Recent edits inject editing prompt.
- Propagation of terminology in the same paragraph.
- Short selections are expanded into paragraphs.
- replacement only replaces the resolved range.

## You can continue to explore later

- Added diff preview to allow users to confirm before applying.
- Display RAG hit segment number, recent edits hit number and source as lightweight hints.
- Select a narrower or wider editing range for different instruction categories. For example, "correct typos" do not need to be expanded, and "unify terminology" should be expanded.
- Added optional editing modes such as "minimal changes" or "readability rewrite" to prompt.

This version first clears the most critical closed loop: **selected words -> paragraph-level inline edit -> BM25/keyword RAG assistance -> in-situ replacement**. It shares basic capabilities with completion, but the interaction goals are clearly different: completion is to add text after the cursor, and editing is to rewrite in a controlled range.
