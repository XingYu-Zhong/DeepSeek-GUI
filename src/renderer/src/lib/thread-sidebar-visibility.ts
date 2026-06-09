import type { ChatBlock, NormalizedThread } from '../agent/types'
import {
  hasThreadIdFallbackTitle,
  isInternalPlaceholderThreadTitle
} from './thread-title'

type ThreadDetailReader = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
}

export function shouldHideThreadFromSidebarByTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'>
): boolean {
  return isInternalPlaceholderThreadTitle(thread.title)
}

export function shouldInspectThreadForSidebarVisibility(
  thread: Pick<NormalizedThread, 'id' | 'title'>
): boolean {
  return !shouldHideThreadFromSidebarByTitle(thread) && hasThreadIdFallbackTitle(thread)
}

export function shouldHideThreadFromSidebarByBlocks(blocks: ChatBlock[]): boolean {
  return blocks.length === 0 ||
    blocks.some((block) => block.kind === 'user' && block.managedBy === 'claw')
}

export async function filterThreadsForSidebar(
  threads: NormalizedThread[],
  reader: ThreadDetailReader
): Promise<NormalizedThread[]> {
  const hiddenIds = new Set(
    threads.filter((thread) => shouldHideThreadFromSidebarByTitle(thread)).map((thread) => thread.id)
  )
  const suspiciousThreads = threads.filter(
    (thread) =>
      !hiddenIds.has(thread.id) && shouldInspectThreadForSidebarVisibility(thread)
  )
  for (const thread of suspiciousThreads) {
    hiddenIds.add(thread.id)
  }

  if (suspiciousThreads.length > 0) {
    const results = await Promise.allSettled(
      suspiciousThreads.map(async (thread) => {
        const detail = await reader.getThreadDetail(thread.id)
        return {
          threadId: thread.id,
          hide: shouldHideThreadFromSidebarByBlocks(detail.blocks)
        }
      })
    )

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      if (result.value.hide) {
        hiddenIds.add(result.value.threadId)
      } else {
        hiddenIds.delete(result.value.threadId)
      }
    }
  }

  if (hiddenIds.size === 0) return threads
  return threads.filter((thread) => !hiddenIds.has(thread.id))
}
