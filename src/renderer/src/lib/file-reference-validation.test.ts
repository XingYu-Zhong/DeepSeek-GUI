import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearFileReferenceValidationCache,
  fileReferenceValidationCacheSize,
  hasCachedFileReferenceValidation,
  MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES,
  validateFileReference
} from './file-reference-validation'

function installResolveWorkspaceFile(
  resolveWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
    ok: true,
    path: `/resolved/${path}`
  }))
): ReturnType<typeof vi.fn> {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dsGui: {
        resolveWorkspaceFile
      }
    }
  })
  return resolveWorkspaceFile
}

describe('file reference validation cache', () => {
  afterEach(() => {
    clearFileReferenceValidationCache()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('normalizes file references and reuses cached validations', async () => {
    const resolveWorkspaceFile = installResolveWorkspaceFile()

    await expect(validateFileReference({ path: ' src/main.ts ' }, ' /repo ')).resolves.toEqual({
      status: 'valid',
      path: '/resolved/src/main.ts'
    })
    await expect(validateFileReference({ path: 'src/main.ts' }, '/repo')).resolves.toEqual({
      status: 'valid',
      path: '/resolved/src/main.ts'
    })

    expect(resolveWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: 'src/main.ts',
      line: undefined,
      column: undefined,
      workspaceRoot: '/repo'
    })
  })

  it('caps cached file reference validations', async () => {
    installResolveWorkspaceFile()

    for (let index = 0; index < MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES + 5; index += 1) {
      await validateFileReference({ path: `file-${index}.ts` }, '/repo')
    }

    expect(fileReferenceValidationCacheSize()).toBe(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES)
    expect(hasCachedFileReferenceValidation({ path: 'file-0.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-4.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-5.ts' }, '/repo')).toBe(true)
  })

  it('refreshes cached validations when they are reused', async () => {
    const resolveWorkspaceFile = installResolveWorkspaceFile()

    await validateFileReference({ path: 'file-0.ts' }, '/repo')
    for (let index = 1; index < MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES; index += 1) {
      await validateFileReference({ path: `file-${index}.ts` }, '/repo')
    }
    await validateFileReference({ path: 'file-0.ts' }, '/repo')
    await validateFileReference({ path: `file-${MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES}.ts` }, '/repo')

    expect(fileReferenceValidationCacheSize()).toBe(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES)
    expect(resolveWorkspaceFile).toHaveBeenCalledTimes(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES + 1)
    expect(hasCachedFileReferenceValidation({ path: 'file-1.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-0.ts' }, '/repo')).toBe(true)
  })

  it('safely treats references as invalid when the bridge is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'window')

    await expect(validateFileReference({ path: 'src/main.ts' }, '/repo')).resolves.toEqual({ status: 'invalid' })
    expect(fileReferenceValidationCacheSize()).toBe(1)
  })
})
