import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const renameMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    rename: renameMock
  }
})

const { atomicWriteFile } = await import('../src/adapters/file/atomic-write.js')

let actualRename: typeof import('node:fs/promises').rename

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  actualRename = actual.rename
  renameMock.mockReset()
  renameMock.mockImplementation(actualRename)
})

afterEach(() => {
  renameMock.mockReset()
})

describe('atomicWriteFile', () => {
  it('retries transient Windows rename lock failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-atomic-'))
    let failedOnce = false
    renameMock.mockImplementation(async (from: string, to: string) => {
      if (!failedOnce) {
        failedOnce = true
        const error = new Error('operation not permitted') as Error & { code: string }
        error.code = 'EPERM'
        throw error
      }
      return actualRename(from, to)
    })

    try {
      const path = join(dir, 'state.json')
      await atomicWriteFile(path, '{"ok":true}', {
        renameRetry: {
          attempts: 2,
          baseDelayMs: 0
        }
      })

      expect(await readFile(path, 'utf-8')).toBe('{"ok":true}')
      expect(renameMock).toHaveBeenCalledTimes(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
