import { useEffect, useMemo, useState } from 'react'
import type { FileReferenceTarget } from './file-references'

type ValidationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'valid'; path: string }
  | { status: 'invalid' }

type SettledValidation = Extract<ValidationState, { status: 'valid' | 'invalid' }>
type CachedValidation = SettledValidation | Promise<SettledValidation>

export const MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES = 300

const validationCache = new Map<string, CachedValidation>()

function normalizeTarget(target: FileReferenceTarget | null): FileReferenceTarget | null {
  const path = target?.path.trim() ?? ''
  if (!path) return null
  return {
    path,
    ...(target?.line ? { line: target.line } : {}),
    ...(target?.column ? { column: target.column } : {})
  }
}

function normalizedWorkspaceRoot(workspaceRoot?: string): string {
  return workspaceRoot?.trim() ?? ''
}

function cacheKey(target: FileReferenceTarget | null, workspaceRoot?: string): string {
  return `${normalizedWorkspaceRoot(workspaceRoot)}\u0000${normalizeTarget(target)?.path ?? ''}`
}

function readValidationCache(key: string): CachedValidation | undefined {
  const cached = validationCache.get(key)
  if (cached === undefined) return undefined
  validationCache.delete(key)
  validationCache.set(key, cached)
  return cached
}

function writeValidationCache(key: string, value: CachedValidation): void {
  validationCache.delete(key)
  validationCache.set(key, value)
  while (validationCache.size > MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES) {
    const oldestKey = validationCache.keys().next().value
    if (!oldestKey) break
    validationCache.delete(oldestKey)
  }
}

export function clearFileReferenceValidationCache(): void {
  validationCache.clear()
}

export function fileReferenceValidationCacheSize(): number {
  return validationCache.size
}

export function hasCachedFileReferenceValidation(
  target: FileReferenceTarget,
  workspaceRoot?: string
): boolean {
  return validationCache.has(cacheKey(target, workspaceRoot))
}

export async function validateFileReference(
  target: FileReferenceTarget,
  workspaceRoot?: string
): Promise<SettledValidation> {
  const normalizedTarget = normalizeTarget(target)
  if (!normalizedTarget) return { status: 'invalid' }
  const normalizedWorkspace = normalizedWorkspaceRoot(workspaceRoot)
  const key = cacheKey(normalizedTarget, normalizedWorkspace)
  const cached = readValidationCache(key)
  if (cached !== undefined) return cached instanceof Promise ? cached : cached

  const task = (async (): Promise<SettledValidation> => {
    if (typeof window === 'undefined' || typeof window.dsGui?.resolveWorkspaceFile !== 'function') {
      return { status: 'invalid' }
    }

    const result = await window.dsGui.resolveWorkspaceFile({
      path: normalizedTarget.path,
      line: normalizedTarget.line,
      column: normalizedTarget.column,
      workspaceRoot: normalizedWorkspace
    })

    return result.ok ? { status: 'valid', path: result.path } : { status: 'invalid' }
  })()

  writeValidationCache(key, task)
  try {
    const resolved = await task
    writeValidationCache(key, resolved)
    return resolved
  } catch {
    const fallback = { status: 'invalid' } as const
    writeValidationCache(key, fallback)
    return fallback
  }
}

export function useValidatedFileReference(
  target: FileReferenceTarget | null,
  workspaceRoot?: string
): ValidationState {
  const key = useMemo(() => cacheKey(target, workspaceRoot), [target, workspaceRoot])
  const [state, setState] = useState<ValidationState>(() => {
    if (!target?.path.trim()) return { status: 'idle' }
    const cached = readValidationCache(key)
    if (!cached) return { status: 'pending' }
    if (cached instanceof Promise) return { status: 'pending' }
    return cached
  })

  useEffect(() => {
    if (!target?.path.trim()) {
      setState({ status: 'idle' })
      return
    }

    const cached = readValidationCache(key)
    if (cached && !(cached instanceof Promise)) {
      setState(cached)
      return
    }

    let cancelled = false
    setState({ status: 'pending' })
    void validateFileReference(target, workspaceRoot).then((next) => {
      if (!cancelled) setState(next)
    })

    return () => {
      cancelled = true
    }
  }, [key, target, workspaceRoot])

  return state
}
