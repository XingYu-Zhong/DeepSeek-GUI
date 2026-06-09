import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  MAX_THREAD_FORK_REGISTRY_ENTRIES,
  emptyThreadForkRegistry,
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from './thread-fork-registry'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, title = id): NormalizedThread {
  return {
    id,
    title,
    updatedAt: '2026-05-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    workspace: '/Users/zxy/workspace'
  }
}

describe('thread-fork-registry', () => {
  it('saves and restores fork lineage', () => {
    const storage = new MemoryStorage()
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      {
        createdAt: '2026-05-25T00:00:00.000Z',
        forkedFromMessageCount: 12,
        forkedFromTurnCount: 3
      },
      emptyThreadForkRegistry()
    )

    saveThreadForkRegistry(registry, storage)
    const restored = readThreadForkRegistry(storage)

    expect(restored.forks['child-thread']).toEqual({
      parentThreadId: 'parent-thread',
      parentTitle: 'Parent Thread',
      createdAt: '2026-05-25T00:00:00.000Z',
      forkedFromMessageCount: 12,
      forkedFromTurnCount: 3
    })
  })

  it('enriches runtime threads with persisted fork metadata', () => {
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      { forkedFromTurnCount: 2 },
      emptyThreadForkRegistry()
    )

    const enriched = enrichThreadsWithForkInfo(
      [thread('parent-thread', 'Parent Thread'), thread('child-thread', 'Parent Thread')],
      registry
    )

    expect(enriched.find((item) => item.id === 'child-thread')).toMatchObject({
      forkedFromThreadId: 'parent-thread',
      forkedFromTitle: 'Parent Thread',
      forkedFromTurnCount: 2
    })
  })

  it('hydrates future runtime lineage fields into the registry and drops missing children', () => {
    const registry = markThreadFork(
      'missing-child',
      thread('parent-thread', 'Old Parent'),
      {},
      emptyThreadForkRegistry()
    )
    const hydrated = hydrateThreadForkRegistry(
      [
        thread('parent-thread', 'Parent Thread'),
        {
          ...thread('child-thread', 'Parent Thread'),
          forkedFromThreadId: 'parent-thread',
          forkedFromTitle: 'Parent Thread',
          forkedFromMessageCount: 8
        }
      ],
      registry
    )

    expect(hydrated.forks['missing-child']).toBeUndefined()
    expect(hydrated.forks['child-thread']).toMatchObject({
      parentThreadId: 'parent-thread',
      parentTitle: 'Parent Thread',
      forkedFromMessageCount: 8
    })
  })

  it('forgets deleted fork children', () => {
    const registry = markThreadFork(
      'child-thread',
      thread('parent-thread', 'Parent Thread'),
      {},
      emptyThreadForkRegistry()
    )

    expect(forgetThreadFork('child-thread', registry).forks['child-thread']).toBeUndefined()
  })

  it('caps persisted fork records to the latest entries', () => {
    let registry = emptyThreadForkRegistry()
    for (let index = 0; index < MAX_THREAD_FORK_REGISTRY_ENTRIES + 5; index += 1) {
      registry = markThreadFork(
        `child-${index}`,
        thread(`parent-${index}`),
        { createdAt: `2026-05-25T00:${String(index % 60).padStart(2, '0')}:00.000Z` },
        registry
      )
    }

    expect(Object.keys(registry.forks)).toHaveLength(MAX_THREAD_FORK_REGISTRY_ENTRIES)
    expect(registry.forks['child-0']).toBeUndefined()
    expect(registry.forks['child-4']).toBeUndefined()
    expect(registry.forks['child-5']?.parentThreadId).toBe('parent-5')
    expect(registry.forks[`child-${MAX_THREAD_FORK_REGISTRY_ENTRIES + 4}`]?.parentThreadId).toBe(
      `parent-${MAX_THREAD_FORK_REGISTRY_ENTRIES + 4}`
    )
  })

  it('keeps refreshed fork records when the registry is capped', () => {
    let registry = emptyThreadForkRegistry()
    for (let index = 0; index < MAX_THREAD_FORK_REGISTRY_ENTRIES; index += 1) {
      registry = markThreadFork(`child-${index}`, thread(`parent-${index}`), {}, registry)
    }

    registry = markThreadFork('child-0', thread('parent-refreshed', 'Refreshed Parent'), {}, registry)
    registry = markThreadFork(
      `child-${MAX_THREAD_FORK_REGISTRY_ENTRIES}`,
      thread(`parent-${MAX_THREAD_FORK_REGISTRY_ENTRIES}`),
      {},
      registry
    )

    expect(Object.keys(registry.forks)).toHaveLength(MAX_THREAD_FORK_REGISTRY_ENTRIES)
    expect(registry.forks['child-1']).toBeUndefined()
    expect(registry.forks['child-0']).toMatchObject({
      parentThreadId: 'parent-refreshed',
      parentTitle: 'Refreshed Parent'
    })
  })
})
