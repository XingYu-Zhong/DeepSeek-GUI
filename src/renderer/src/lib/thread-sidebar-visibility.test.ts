import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import {
  filterThreadsForSidebar,
  shouldHideThreadFromSidebarByBlocks,
  shouldHideThreadFromSidebarByTitle,
  shouldInspectThreadForSidebarVisibility
} from './thread-sidebar-visibility'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'title'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title,
    updatedAt: overrides.updatedAt ?? '2026-05-25T00:00:00.000Z',
    model: overrides.model ?? 'auto',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/Users/zxy/workspace',
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {})
  }
}

function userBlock(text = 'hello', managedBy?: 'claw'): ChatBlock {
  return {
    kind: 'user',
    id: 'u-1',
    text,
    ...(managedBy ? { managedBy } : {})
  }
}

describe('thread-sidebar-visibility', () => {
  it('hides codex internal placeholder titles immediately', () => {
    expect(
      shouldHideThreadFromSidebarByTitle(
        thread({ id: 'thr_internal01', title: '__codex_parent_title__' })
      )
    ).toBe(true)
  })

  it('inspects fallback thread titles before hiding them', () => {
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: 'thr_279f' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: '新会话' })
      )
    ).toBe(false)
  })

  it('treats only empty threads as hidden fallback entries', () => {
    expect(shouldHideThreadFromSidebarByBlocks([])).toBe(true)
    expect(shouldHideThreadFromSidebarByBlocks([userBlock()])).toBe(false)
  })

  it('hides fallback entries whose raw prompt came from Claw', () => {
    expect(shouldHideThreadFromSidebarByBlocks([userBlock('现在时间是23:50', 'claw')])).toBe(true)
  })

  it('filters internal placeholder and empty fallback threads while keeping real threads', async () => {
    const threads = [
      thread({ id: 'thr_internal01', title: '__codex_parent_title__' }),
      thread({ id: 'thr_279f3fef', title: 'thr_279f' }),
      thread({ id: 'thr_gui0001', title: '新会话' }),
      thread({ id: 'thr_real0001', title: '修一下侧边栏 bug' })
    ]
    const getThreadDetail = vi.fn(async (threadId: string) => {
      if (threadId === 'thr_279f3fef') return { blocks: [] }
      return { blocks: [userBlock()] }
    })

    const visible = await filterThreadsForSidebar(threads, { getThreadDetail })

    expect(visible.map((thread) => thread.id)).toEqual(['thr_gui0001', 'thr_real0001'])
    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(getThreadDetail).toHaveBeenCalledWith('thr_279f3fef')
  })

  it('keeps fallback titled threads when detail shows real content', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('real content')] })
    })

    expect(visible).toEqual([fallbackThread])
  })

  it('filters fallback titled CodeWhale Claw sessions after inspecting detail', async () => {
    const fallbackThread = thread({ id: 'thr_20be8f66', title: 'thr_20be' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('现在时间是23:50', 'claw')] })
    })

    expect(visible).toEqual([])
  })

  it('hides fallback titled threads when detail loading fails', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => {
        throw new Error('detail unavailable')
      }
    })

    expect(visible).toEqual([])
  })
})
