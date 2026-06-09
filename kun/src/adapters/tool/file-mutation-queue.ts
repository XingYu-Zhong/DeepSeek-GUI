import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fileMutationQueues = new Map<string, Promise<void>>()
let registrationQueue = Promise.resolve()
const FILE_MUTATION_LOCK_ROOT = join(tmpdir(), 'kun-file-mutation-locks')
const LOCK_OWNER_FILE = 'owner.json'
const LOCK_POLL_MS = 25
const LOCK_WAIT_TIMEOUT_MS = 60_000
const OWNERLESS_LOCK_STALE_MS = 10 * 60_000

type LockOwner = {
  pid: number
  createdAtMs: number
  key: string
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function isExistingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EPERM'
    )
  }
}

function lockPathForKey(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex')
  return join(FILE_MUTATION_LOCK_ROOT, `${hash}.lock`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const raw = await readFile(join(lockPath, LOCK_OWNER_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LockOwner>
    if (
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAtMs === 'number' &&
      typeof parsed.key === 'string'
    ) {
      return {
        pid: parsed.pid,
        createdAtMs: parsed.createdAtMs,
        key: parsed.key
      }
    }
  } catch {
    // Missing or malformed owner metadata is handled by mtime-based staleness below.
  }
  return null
}

async function removeDeadOrStaleLock(lockPath: string, nowMs: number): Promise<boolean> {
  const owner = await readLockOwner(lockPath)
  if (owner && !isProcessAlive(owner.pid)) {
    await rm(lockPath, { recursive: true, force: true })
    return true
  }
  if (owner) return false

  const info = await stat(lockPath).catch(() => null)
  if (!info) return true
  if (nowMs - info.mtimeMs < OWNERLESS_LOCK_STALE_MS) return false
  await rm(lockPath, { recursive: true, force: true })
  return true
}

async function acquireFileMutationLock(key: string): Promise<() => Promise<void>> {
  await mkdir(FILE_MUTATION_LOCK_ROOT, { recursive: true })
  const lockPath = lockPathForKey(key)
  const startedAt = Date.now()
  for (;;) {
    try {
      await mkdir(lockPath)
    } catch (error) {
      if (!isExistingPathError(error)) throw error
      const nowMs = Date.now()
      if (await removeDeadOrStaleLock(lockPath, nowMs)) continue
      if (nowMs - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for file mutation lock: ${key}`)
      }
      await delay(LOCK_POLL_MS)
      continue
    }

    try {
      await writeFile(
        join(lockPath, LOCK_OWNER_FILE),
        JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), key } satisfies LockOwner),
        'utf8'
      )
      return async () => {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}

async function getMutationQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath)
  try {
    return await realpath(resolvedPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return resolvedPath
    }
    throw error
  }
}

export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await getMutationQueueKey(filePath)
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve()

    let releaseNext!: () => void
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue
    })
    const chainedQueue = currentQueue.then(() => nextQueue)
    fileMutationQueues.set(key, chainedQueue)

    return { key, currentQueue, chainedQueue, releaseNext }
  })

  registrationQueue = registration.then(
    () => undefined,
    () => undefined
  )

  const { key, currentQueue, chainedQueue, releaseNext } = await registration
  await currentQueue
  let releaseLock: (() => Promise<void>) | undefined
  try {
    releaseLock = await acquireFileMutationLock(key)
    return await fn()
  } finally {
    try {
      await releaseLock?.()
    } finally {
      releaseNext()
      if (fileMutationQueues.get(key) === chainedQueue) {
        fileMutationQueues.delete(key)
      }
    }
  }
}
