import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageSnapshot } from '../src/contracts/usage.js'

const atomicWriteFileMock = vi.hoisted(() => vi.fn())

vi.mock('../src/adapters/file/atomic-write.js', () => ({
  atomicWriteFile: atomicWriteFileMock
}))

const { FileSessionStore } = await import('../src/adapters/file/file-session-store.js')

describe('FileSessionStore', () => {
  let dataDir = ''
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-session-'))
    atomicWriteFileMock.mockReset()
    atomicWriteFileMock.mockResolvedValue(undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('keeps appended usage events when best-effort compaction fails', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      usageEventCompaction: {
        maxBytes: 1,
        retentionDays: 365,
        nowIso: () => '2026-06-03T00:00:00.000Z'
      }
    })
    const usage = (tokens: number): UsageSnapshot => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: tokens
    })

    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(1)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 2,
      timestamp: '2025-06-04T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(2)
    })

    const error = new Error('operation not permitted') as Error & { code: string }
    error.code = 'EPERM'
    atomicWriteFileMock.mockRejectedValueOnce(error)

    await expect(sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 3,
      timestamp: '2025-06-04T01:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(3)
    })).resolves.toBeUndefined()

    const events = await sessionStore.loadEventsSince('thr_usage_compact', 0)
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(atomicWriteFileMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('usage event compaction failed'))
  })
})
