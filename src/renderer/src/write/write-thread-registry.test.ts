import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  MAX_WRITE_THREAD_IDS_PER_WORKSPACE,
  MAX_WRITE_THREAD_REGISTRY_WORKSPACES,
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  emptyWriteThreadRegistry,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeWorkspaceForThreadId
} from './write-thread-registry'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, workspace: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-05-24T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace
  }
}

describe('write-thread-registry', () => {
  it('saves and restores write thread records by workspace', () => {
    const storage = new MemoryStorage()
    const registry = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    saveWriteThreadRegistry(registry, storage)

    const restored = readWriteThreadRegistry(storage)
    expect(isWriteThreadId('thread-1', restored)).toBe(true)
    expect(activeWriteThreadForWorkspace('/Users/zxy/workspace', [thread('thread-1', '/Users/zxy/workspace')], restored)?.id).toBe('thread-1')
  })

  it('keeps the newest marked write thread active', () => {
    const first = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    const second = markWriteThread('/Users/zxy/workspace', 'thread-2', first)

    expect(second.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-2')
    expect(second.workspaces['/Users/zxy/workspace'].threadIds).toEqual(['thread-2', 'thread-1'])
  })

  it('caps remembered write thread ids per workspace', () => {
    let registry = emptyWriteThreadRegistry()
    for (let index = 0; index < MAX_WRITE_THREAD_IDS_PER_WORKSPACE + 5; index += 1) {
      registry = markWriteThread('/Users/zxy/write', `thread-${index}`, registry)
    }

    const record = registry.workspaces['/Users/zxy/write']
    expect(record.activeThreadId).toBe(`thread-${MAX_WRITE_THREAD_IDS_PER_WORKSPACE + 4}`)
    expect(record.threadIds).toHaveLength(MAX_WRITE_THREAD_IDS_PER_WORKSPACE)
    expect(record.threadIds).not.toContain('thread-0')
    expect(record.threadIds).not.toContain('thread-4')
    expect(record.threadIds).toContain('thread-5')
  })

  it('caps remembered write workspaces while keeping recently marked workspaces', () => {
    let registry = emptyWriteThreadRegistry()
    for (let index = 0; index < MAX_WRITE_THREAD_REGISTRY_WORKSPACES; index += 1) {
      registry = markWriteThread(`/Users/zxy/write-${index}`, `thread-${index}`, registry)
    }

    registry = markWriteThread('/Users/zxy/write-0', 'thread-refreshed', registry)
    registry = markWriteThread(
      `/Users/zxy/write-${MAX_WRITE_THREAD_REGISTRY_WORKSPACES}`,
      'thread-new',
      registry
    )

    expect(Object.keys(registry.workspaces)).toHaveLength(MAX_WRITE_THREAD_REGISTRY_WORKSPACES)
    expect(registry.workspaces['/Users/zxy/write-1']).toBeUndefined()
    expect(registry.workspaces['/Users/zxy/write-0']?.activeThreadId).toBe('thread-refreshed')
    expect(registry.workspaces[`/Users/zxy/write-${MAX_WRITE_THREAD_REGISTRY_WORKSPACES}`]?.activeThreadId).toBe(
      'thread-new'
    )
  })

  it('prunes missing runtime threads and forgets deleted threads', () => {
    const registry = markWriteThread('/Users/zxy/workspace', 'thread-2',
      markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry()))
    const pruned = pruneWriteThreadRegistry([thread('thread-1', '/Users/zxy/workspace')], registry)

    expect(isWriteThreadId('thread-2', pruned)).toBe(false)
    expect(pruned.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-1')
    expect(forgetWriteThread('thread-1', pruned).workspaces['/Users/zxy/workspace']).toBeUndefined()
  })

  it('hydrates leaked write assistant threads from configured write workspaces', () => {
    const leaked = {
      ...thread('write-thread', '/Users/zxy/.deepseekgui/write_workspace'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }
    const normalCodeThread = {
      ...thread('code-thread', '/Users/zxy/.deepseekgui/write_workspace'),
      title: 'Explain this project'
    }
    const sameTitleElsewhere = {
      ...thread('elsewhere', '/Users/zxy/code/project'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }

    const registry = hydrateWriteThreadRegistry(
      [leaked, normalCodeThread, sameTitleElsewhere],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('write-thread', registry)).toBe(true)
    expect(isWriteThreadId('code-thread', registry)).toBe(false)
    expect(isWriteThreadId('elsewhere', registry)).toBe(false)
  })

  it('hydrates legacy tilde write assistant threads under the configured absolute workspace', () => {
    const legacyThread = {
      ...thread('legacy-write-thread', '~/.deepseekgui/write_workspace'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }

    const registry = hydrateWriteThreadRegistry(
      [legacyThread],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('legacy-write-thread', registry)).toBe(true)
    expect(registry.workspaces['/Users/zxy/.deepseekgui/write_workspace'].threadIds).toEqual([
      'legacy-write-thread'
    ])
    expect(
      activeWriteThreadForWorkspace(
        '/Users/zxy/.deepseekgui/write_workspace',
        [legacyThread],
        registry
      )?.id
    ).toBe('legacy-write-thread')
  })

  it('hydrates Reasonix write-context threads even when the session list reports the default workspace', () => {
    const leaked = {
      ...thread('reasonix-write-thread', '/Users/zxy/.deepseekgui/default_workspace'),
      title: '[写作上下文] 交互限制：当前 GUI 无法提交 request_user_input'
    }

    const registry = hydrateWriteThreadRegistry(
      [leaked],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('reasonix-write-thread', registry)).toBe(true)
    expect(writeWorkspaceForThreadId('reasonix-write-thread', registry)).toBe('/Users/zxy/.deepseekgui/write_workspace')
    expect(
      activeWriteThreadForWorkspace(
        '/Users/zxy/.deepseekgui/write_workspace',
        [leaked],
        registry
      )?.id
    ).toBe('reasonix-write-thread')
  })

  it('preserves the active write thread while adding newly inferred thread ids', () => {
    const existing = markWriteThread('/Users/zxy/write', 'existing-thread', emptyWriteThreadRegistry())
    const registry = hydrateWriteThreadRegistry(
      [
        {
          ...thread('newer-thread', '/Users/zxy/write'),
          title: WRITE_ASSISTANT_THREAD_TITLE,
          updatedAt: '2026-05-25T00:00:00.000Z'
        }
      ],
      ['/Users/zxy/write'],
      existing
    )

    expect(registry.workspaces['/Users/zxy/write'].activeThreadId).toBe('existing-thread')
    expect(registry.workspaces['/Users/zxy/write'].threadIds).toEqual([
      'existing-thread',
      'newer-thread'
    ])
  })

  it('does not reopen archived write threads as active workspace conversations', () => {
    const registry = markWriteThread('/Users/zxy/write', 'archived-thread', emptyWriteThreadRegistry())
    const archivedThread = {
      ...thread('archived-thread', '/Users/zxy/write'),
      archived: true
    }

    expect(activeWriteThreadForWorkspace('/Users/zxy/write', [archivedThread], registry)).toBeNull()
  })
})
