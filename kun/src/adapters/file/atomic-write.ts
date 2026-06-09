import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type AtomicWriteFileOptions = {
  renameRetry?: {
    attempts?: number
    baseDelayMs?: number
  }
}

const DEFAULT_RENAME_RETRY_ATTEMPTS = 6
const DEFAULT_RENAME_RETRY_BASE_DELAY_MS = 25
const RETRYABLE_RENAME_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteFileOptions = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, contents, 'utf-8')
    await renameWithRetry(tmp, path, options.renameRetry)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function renameWithRetry(
  from: string,
  to: string,
  options: NonNullable<AtomicWriteFileOptions['renameRetry']> | undefined
): Promise<void> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? DEFAULT_RENAME_RETRY_ATTEMPTS))
  const baseDelayMs = Math.max(0, Math.floor(options?.baseDelayMs ?? DEFAULT_RENAME_RETRY_BASE_DELAY_MS))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (attempt >= attempts || !isRetryableRenameError(error)) {
        throw error
      }
      await delay(baseDelayMs * attempt)
    }
  }
}

function isRetryableRenameError(error: unknown): boolean {
  return RETRYABLE_RENAME_ERROR_CODES.has(String((error as { code?: unknown })?.code ?? ''))
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
