import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withFileMutationQueue } from './file-mutation-queue.js'

const lockRoot = join(tmpdir(), 'kun-file-mutation-locks')

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lockPathForKey(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex')
  return join(lockRoot, `${hash}.lock`)
}

describe('withFileMutationQueue', () => {
  let tempDir: string | undefined
  const lockPaths = new Set<string>()

  afterEach(async () => {
    for (const path of lockPaths) {
      await rm(path, { recursive: true, force: true })
    }
    lockPaths.clear()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  async function tempFile(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), 'kun-file-queue-'))
    const path = join(tempDir, 'target.txt')
    await writeFile(path, 'initial', 'utf8')
    return path
  }

  it('serializes concurrent same-process mutations for the same file', async () => {
    const path = await tempFile()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withFileMutationQueue(path, async () => {
      events.push('first-start')
      await firstReleased
      events.push('first-end')
    })
    await delay(20)

    const second = withFileMutationQueue(path, async () => {
      events.push('second')
    })
    await delay(50)

    expect(events).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'first-end', 'second'])
  })

  it('waits for an existing filesystem lock before mutating', async () => {
    const path = await tempFile()
    const key = await realpath(path)
    const lockPath = lockPathForKey(key)
    lockPaths.add(lockPath)
    await mkdir(lockRoot, { recursive: true })
    await mkdir(lockPath)
    await writeFile(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), key }),
      'utf8'
    )

    let entered = false
    const queued = withFileMutationQueue(path, async () => {
      entered = true
      return 'done'
    })
    await delay(80)

    expect(entered).toBe(false)
    await rm(lockPath, { recursive: true, force: true })
    await expect(queued).resolves.toBe('done')
    expect(entered).toBe(true)
  })
})
