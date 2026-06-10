import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  hasPendingRuntimeWork,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
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

  it('ignores stale pending work once the same turn has visible assistant content', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'Run the task' },
      {
        kind: 'tool',
        id: 'tool-stale',
        summary: 'Old tool',
        status: 'running',
        toolKind: 'tool_call'
      },
      { kind: 'assistant', id: 'answer-1', text: 'The task is complete.' }
    ]

    expect(threadHasPendingRuntimeWork(blocks)).toBe(false)
    expect(threadSnapshotLooksRunning(blocks)).toBe(false)
  })

  it('keeps the thread busy when pending work has no later assistant answer', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'Run the task' },
      { kind: 'assistant', id: 'partial-1', text: 'I will check that.' },
      {
        kind: 'tool',
        id: 'tool-running',
        summary: 'Still running',
        status: 'running',
        toolKind: 'tool_call'
      }
    ]

    expect(threadHasPendingRuntimeWork(blocks)).toBe(true)
    expect(threadSnapshotLooksRunning(blocks)).toBe(true)
  })

  it('does not let stale pending work from an older turn block new input', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'First task' },
      {
        kind: 'tool',
        id: 'tool-stale',
        summary: 'Old tool',
        status: 'running',
        toolKind: 'tool_call'
      },
      { kind: 'user', id: 'user-2', text: 'Second task' },
      { kind: 'assistant', id: 'answer-2', text: 'Second answer.' }
    ]

    expect(threadHasPendingRuntimeWork(blocks)).toBe(false)
    expect(threadSnapshotLooksRunning(blocks)).toBe(false)
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
