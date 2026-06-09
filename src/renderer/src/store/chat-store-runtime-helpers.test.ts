import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  hasPendingRuntimeWork,
  settlePendingRuntimeWorkAfterInterrupt,
  threadSnapshotLooksRunning
} from './chat-store-runtime-helpers'

describe('chat-store-runtime-helpers compaction state', () => {
  it('keeps the thread busy while a compaction item is running', () => {
    const runningCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-running',
      summary: 'Compacting context',
      status: 'running'
    }
    const completedCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-completed',
      summary: 'Compacted context',
      status: 'success'
    }

    expect(hasPendingRuntimeWork(runningCompaction)).toBe(true)
    expect(hasPendingRuntimeWork(completedCompaction)).toBe(false)
    expect(threadSnapshotLooksRunning([runningCompaction])).toBe(true)
    expect(threadSnapshotLooksRunning([completedCompaction])).toBe(false)
  })

  it('trusts an explicit idle thread status over stale pending blocks', () => {
    const staleTool: ChatBlock = {
      kind: 'tool',
      id: 'tool-stale',
      summary: 'Old tool',
      status: 'running',
      toolKind: 'tool_call'
    }

    expect(threadSnapshotLooksRunning([staleTool], 'idle')).toBe(false)
    expect(threadSnapshotLooksRunning([staleTool], 'aborted')).toBe(false)
    expect(threadSnapshotLooksRunning([staleTool], 'running')).toBe(true)
    expect(threadSnapshotLooksRunning([staleTool])).toBe(true)
  })

  it('settles local pending work after a successful interrupt', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-running',
        summary: 'Running tool',
        status: 'running',
        toolKind: 'tool_call'
      },
      {
        kind: 'approval',
        id: 'approval-pending',
        approvalId: 'approval-1',
        summary: 'Needs approval',
        status: 'pending'
      },
      {
        kind: 'user_input',
        id: 'input-pending',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      },
      {
        kind: 'tool',
        id: 'tool-success',
        summary: 'Done',
        status: 'success',
        toolKind: 'tool_call'
      }
    ]

    const settled = settlePendingRuntimeWorkAfterInterrupt(blocks)

    expect(settled.map((block) => ('status' in block ? block.status : ''))).toEqual([
      'error',
      'error',
      'cancelled',
      'success'
    ])
    expect(settled.some(hasPendingRuntimeWork)).toBe(false)
  })
})
