import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  sddChatTranscriptRelativePath,
  serializeSddChatTranscript
} from './sdd-chat-transcript'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const DRAFT = `.kunsdd/requirements/${UUID}/requirement.md`

describe('sddChatTranscriptRelativePath', () => {
  it('builds the chat file path inside the requirement unit', () => {
    expect(sddChatTranscriptRelativePath(DRAFT, 'thr_abc-123')).toBe(
      `.kunsdd/requirements/${UUID}/chat/thr_abc-123.md`
    )
  })

  it('refuses unsafe thread ids and non-unit drafts', () => {
    expect(sddChatTranscriptRelativePath(DRAFT, '../escape')).toBeNull()
    expect(sddChatTranscriptRelativePath(DRAFT, 'a/b')).toBeNull()
    expect(sddChatTranscriptRelativePath(DRAFT, '  ')).toBeNull()
    expect(sddChatTranscriptRelativePath('.kunsdd/draft/x/requirement.md', 'thr_1')).toBeNull()
  })
})

describe('serializeSddChatTranscript', () => {
  it('prefers the human-entered displayText over composed prompts', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'u1',
        text: 'Kun is asking… full draft markdown inlined …',
        meta: { displayText: '帮我澄清需求' }
      },
      { kind: 'reasoning', id: 'r1', text: '思考过程不应出现' },
      { kind: 'assistant', id: 'a1', text: '需要澄清三个问题。' },
      { kind: 'tool', id: 't1', summary: '读取 requirement.md', status: 'success' },
      { kind: 'user', id: 'u2', text: '直接输入的第二轮' },
      { kind: 'assistant', id: 'a2', text: '好的。' }
    ]
    const transcript = serializeSddChatTranscript(blocks, {
      threadId: 'thr_1',
      generatedAt: '2026-06-12T00:00:00.000Z'
    })

    expect(transcript).toContain('线程: thr_1')
    expect(transcript).toContain('## 用户\n\n帮我澄清需求')
    expect(transcript).not.toContain('full draft markdown')
    expect(transcript).not.toContain('思考过程不应出现')
    expect(transcript).toContain('## 需求 AI\n\n需要澄清三个问题。')
    expect(transcript).toContain('> [工具] 读取 requirement.md')
    expect(transcript).toContain('## 用户\n\n直接输入的第二轮')
    // One turn separator per user message.
    expect(transcript.match(/^---$/gm)).toHaveLength(2)
  })

  it('annotates non-success tool status', () => {
    const blocks: ChatBlock[] = [
      { kind: 'tool', id: 't1', summary: '写文件', status: 'error' }
    ]
    expect(serializeSddChatTranscript(blocks, { threadId: 'thr_1' })).toContain('> [工具] 写文件（error）')
  })
})
