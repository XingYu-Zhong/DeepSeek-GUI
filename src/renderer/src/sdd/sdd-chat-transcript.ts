import {
  SDD_CHAT_META_FILE_NAME,
  isSddDraftRelativePath,
  sddUnitChatDir
} from '@shared/sdd'
import type { ChatBlock } from '../agent/types'
import { getProvider } from '../agent/registry'
import { readSddThreadRegistry } from './sdd-thread-registry'

/**
 * Mirrors the 需求 AI conversation into the requirement unit directory
 * (`<unit>/chat/<threadId>.md` + `meta.json`) so a requirement folder stays a
 * self-contained record even if the runtime data dir is wiped.
 *
 * Transcripts are REWRITTEN in full from the thread's blocks after every
 * completed turn — idempotent and self-healing, no dedupe bookkeeping.
 */

const TRANSCRIPT_THREAD_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export type SddChatMeta = {
  version: 1
  primaryThreadId: string
  threads: Array<{ id: string; updatedAt?: string }>
}

type ChatStateLike = {
  activeThreadId: string | null
  blocks: ChatBlock[]
}

export function sddChatTranscriptRelativePath(
  draftRelativePath: string,
  threadId: string
): string | null {
  const chatDir = sddUnitChatDir(draftRelativePath)
  if (!chatDir) return null
  const trimmed = threadId.trim()
  if (!trimmed || !TRANSCRIPT_THREAD_ID_PATTERN.test(trimmed)) return null
  return `${chatDir}/${trimmed}.md`
}

export function serializeSddChatTranscript(
  blocks: ChatBlock[],
  options: { threadId: string; generatedAt?: string }
): string {
  const lines: string[] = [
    `# 需求 AI 对话记录`,
    '',
    `- 线程: ${options.threadId}`,
    `- 更新时间: ${options.generatedAt ?? new Date().toISOString()}`
  ]
  for (const block of blocks) {
    if (block.kind === 'user') {
      // SDD user turns carry the composed prompt (with the full draft inlined)
      // in `text`; the human-entered message lives in meta.displayText.
      const text = (block.meta?.displayText ?? block.text).trim()
      if (!text) continue
      lines.push('', '---', '', '## 用户', '', text)
      continue
    }
    if (block.kind === 'assistant') {
      const text = block.text.trim()
      if (!text) continue
      lines.push('', '## 需求 AI', '', text)
      continue
    }
    if (block.kind === 'tool' || block.kind === 'compaction') {
      const status = block.status === 'success' ? '' : `（${block.status}）`
      lines.push('', `> [工具] ${block.summary}${status}`)
      continue
    }
    if (block.kind === 'approval') {
      lines.push('', `> [审批] ${block.summary}（${block.status}）`)
      continue
    }
    if (block.kind === 'review') {
      lines.push('', `> [评审] ${block.title}（${block.status}）`)
      continue
    }
    // reasoning/system/user_input blocks are intentionally omitted.
  }
  return `${lines.join('\n')}\n`
}

function parseMeta(raw: string): SddChatMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SddChatMeta>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.threads)) return null
    return {
      version: 1,
      primaryThreadId: typeof parsed.primaryThreadId === 'string' ? parsed.primaryThreadId : '',
      threads: parsed.threads
        .filter((entry): entry is { id: string; updatedAt?: string } =>
          Boolean(entry) && typeof (entry as { id?: unknown }).id === 'string'
        )
        .map((entry) => ({
          id: entry.id,
          ...(typeof entry.updatedAt === 'string' ? { updatedAt: entry.updatedAt } : {})
        }))
    }
  } catch {
    return null
  }
}

/** Rewrite `<unit>/chat/meta.json`, carrying per-thread timestamps forward
 * from the existing file and stamping only `stampThreadId`. */
async function writeSddChatMeta(input: {
  workspaceRoot: string
  draftRelativePath: string
  stampThreadId?: string
}): Promise<void> {
  const chatDir = sddUnitChatDir(input.draftRelativePath)
  if (!chatDir) return
  if (
    typeof window.kunGui?.writeWorkspaceFile !== 'function' ||
    typeof window.kunGui?.readWorkspaceFile !== 'function'
  ) {
    return
  }
  const metaPath = `${chatDir}/${SDD_CHAT_META_FILE_NAME}`
  const registry = readSddThreadRegistry()
  const record = Object.values(registry.drafts).find((entry) =>
    entry.workspaceRoot === input.workspaceRoot &&
    entry.draftId.endsWith(input.draftRelativePath)
  )
  if (!record) return

  let previous: SddChatMeta | null = null
  try {
    const existing = await window.kunGui.readWorkspaceFile({
      workspaceRoot: input.workspaceRoot,
      path: metaPath
    })
    if (existing.ok) previous = parseMeta(existing.content)
  } catch {
    // Missing or unreadable meta is regenerated from scratch.
  }

  const previousById = new Map((previous?.threads ?? []).map((entry) => [entry.id, entry]))
  const meta: SddChatMeta = {
    version: 1,
    primaryThreadId: record.threadId,
    threads: record.threadIds.map((id) => {
      const carried = previousById.get(id)
      const updatedAt = id === input.stampThreadId ? new Date().toISOString() : carried?.updatedAt
      return { id, ...(updatedAt ? { updatedAt } : {}) }
    })
  }
  await window.kunGui.writeWorkspaceFile({
    workspaceRoot: input.workspaceRoot,
    path: metaPath,
    content: `${JSON.stringify(meta, null, 2)}\n`
  })
}

export async function writeSddChatTranscriptForThread(input: {
  workspaceRoot: string
  draftRelativePath: string
  threadId: string
  blocks: ChatBlock[]
}): Promise<boolean> {
  if (typeof window.kunGui?.writeWorkspaceFile !== 'function') return false
  const transcriptPath = sddChatTranscriptRelativePath(input.draftRelativePath, input.threadId)
  if (!transcriptPath) return false
  try {
    const written = await window.kunGui.writeWorkspaceFile({
      workspaceRoot: input.workspaceRoot,
      path: transcriptPath,
      content: serializeSddChatTranscript(input.blocks, { threadId: input.threadId })
    })
    if (!written.ok) return false
    await writeSddChatMeta({
      workspaceRoot: input.workspaceRoot,
      draftRelativePath: input.draftRelativePath,
      stampThreadId: input.threadId
    })
    return true
  } catch {
    return false
  }
}

/** Resolve the requirement unit owning a thread via the thread registry,
 * independent of which draft (if any) is currently open. */
export function sddDraftRefForThreadId(
  threadId: string
): { workspaceRoot: string; draftRelativePath: string } | null {
  if (!threadId.trim()) return null
  const registry = readSddThreadRegistry()
  for (const record of Object.values(registry.drafts)) {
    if (!record.threadIds.includes(threadId)) continue
    // draftId is `${workspaceRoot}:${relativePath}`; slice on the stored
    // workspaceRoot rather than splitting on ':' (Windows drive letters).
    const relativePath = record.draftId.startsWith(`${record.workspaceRoot}:`)
      ? record.draftId.slice(record.workspaceRoot.length + 1)
      : ''
    if (!relativePath || !isSddDraftRelativePath(relativePath)) return null
    return { workspaceRoot: record.workspaceRoot, draftRelativePath: relativePath }
  }
  return null
}

/** onTurnComplete hook: mirror the just-finished turn's thread when it is an
 * SDD assistant thread. Fire-and-forget; failures only skip the mirror. */
export function notifySddChatTranscriptMirror(get: () => ChatStateLike): void {
  const state = get()
  const threadId = state.activeThreadId
  if (!threadId) return
  const ref = sddDraftRefForThreadId(threadId)
  if (!ref) return
  void writeSddChatTranscriptForThread({
    workspaceRoot: ref.workspaceRoot,
    draftRelativePath: ref.draftRelativePath,
    threadId,
    blocks: state.blocks
  }).catch(() => undefined)
}

/** Self-heal on draft open: rebuild the primary thread's transcript from the
 * runtime's full thread record (covers turns completed in the background). */
export async function refreshSddChatTranscriptFromProvider(draft: {
  workspaceRoot: string
  relativePath: string
}): Promise<void> {
  const registry = readSddThreadRegistry()
  const record = Object.values(registry.drafts).find((entry) =>
    entry.workspaceRoot === draft.workspaceRoot &&
    entry.draftId.endsWith(draft.relativePath)
  )
  const threadId = record?.threadId
  if (!threadId) return
  try {
    const detail = await getProvider().getThreadDetail(threadId)
    await writeSddChatTranscriptForThread({
      workspaceRoot: draft.workspaceRoot,
      draftRelativePath: draft.relativePath,
      threadId,
      blocks: detail.blocks
    })
  } catch {
    // The thread may be gone runtime-side; the existing transcript stays.
  }
}
