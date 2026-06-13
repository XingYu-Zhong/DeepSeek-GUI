import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSddDraft,
  forgetRememberedSddDraft,
  readRememberedSddDraftContent,
  readRememberedSddDraft,
  useSddDraftStore
} from './sdd-draft-store'
import { deleteSddDraft, saveActiveSddDraftToDisk, syncActiveSddDraftFromDisk } from './sdd-draft-actions'

const SDD_DRAFT_REGISTRY_STORAGE_KEY = 'kun.sdd.draft.registry.v1'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

describe('sdd-draft-store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('window', {
      localStorage,
      kunGui: {
        writeWorkspaceFile: vi.fn()
      }
    })
    useSddDraftStore.getState().clearActiveDraft()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useSddDraftStore.getState().clearActiveDraft()
  })

  it('creates and remembers the active draft per workspace', () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app/',
      now: 1
    })

    useSddDraftStore.getState().setActiveDraft(draft, '# Requirement')

    expect(draft.id).toBe('/tmp/app:.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md')
    expect(readRememberedSddDraft('/tmp/app')?.id).toBe(draft.id)
    expect(readRememberedSddDraft('/tmp/other')).toBeNull()
  })

  it('forgets a completed draft without clearing other workspaces', () => {
    const firstDraft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    const secondDraft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174111',
      workspaceRoot: '/tmp/other',
      now: 2
    })

    useSddDraftStore.getState().setActiveDraft(firstDraft, '# First')
    useSddDraftStore.getState().setActiveDraft(secondDraft, '# Second')
    forgetRememberedSddDraft(firstDraft)

    expect(readRememberedSddDraft('/tmp/app')).toBeNull()
    expect(readRememberedSddDraft('/tmp/other')?.id).toBe(secondDraft.id)
  })

  it('does not clear a newer remembered draft in the same workspace', () => {
    const oldDraft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    const newDraft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174111',
      workspaceRoot: '/tmp/app',
      now: 2
    })

    useSddDraftStore.getState().setActiveDraft(oldDraft, '# Old')
    useSddDraftStore.getState().setActiveDraft(newDraft, '# New')
    forgetRememberedSddDraft(oldDraft)

    expect(readRememberedSddDraft('/tmp/app')?.id).toBe(newDraft.id)
  })

  it('normalizes malformed persisted draft registry data', () => {
    localStorage.setItem(SDD_DRAFT_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByWorkspace: {
        '/tmp/valid/': 'valid',
        '/tmp/missing': 'missing'
      },
      drafts: {
        valid: {
          workspaceRoot: '/tmp/valid/',
          relativePath: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        invalid: {
          id: 'invalid',
          workspaceRoot: 42,
          relativePath: ''
        }
      }
    }))

    expect(readRememberedSddDraft('/tmp/valid')).toMatchObject({
      id: 'valid',
      workspaceRoot: '/tmp/valid',
      relativePath: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(readRememberedSddDraft('/tmp/missing')).toBeNull()
  })

  it('tracks dirty and saved state while preserving operation errors', () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')

    useSddDraftStore.getState().setContent('# Draft updated')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')

    useSddDraftStore.getState().setOperationStatus('error', 'image missing')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    useSddDraftStore.getState().markSaved('# Draft updated')

    const state = useSddDraftStore.getState()
    expect(state.saveStatus).toBe('saved')
    expect(state.error).toBe('image missing')
    expect(readRememberedSddDraft('/tmp/app')?.updatedAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('persists unsaved draft content for restart recovery', () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    useSddDraftStore.getState().setContent('# Draft\n\nUnsaved line')

    expect(readRememberedSddDraftContent(draft)).toEqual({
      draftId: draft.id,
      content: '# Draft\n\nUnsaved line',
      lastSavedContent: '# Draft',
      updatedAt: '2026-01-02T03:04:05.000Z'
    })
  })

  it('opens a restored dirty draft with separate saved baseline', () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })

    useSddDraftStore.getState().setActiveDraft(draft, '# Local unsaved draft', {
      lastSavedContent: '# Disk draft',
      saveStatus: 'dirty'
    })

    expect(useSddDraftStore.getState()).toMatchObject({
      content: '# Local unsaved draft',
      lastSavedContent: '# Disk draft',
      saveStatus: 'dirty'
    })
    expect(readRememberedSddDraftContent(draft)).toMatchObject({
      content: '# Local unsaved draft',
      lastSavedContent: '# Disk draft'
    })
  })

  it('saves the active draft to disk and updates clean state', async () => {
    const writeWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      savedAt: '2026-01-01T00:00:00.000Z'
    })
    window.kunGui.writeWorkspaceFile = writeWorkspaceFile
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')
    useSddDraftStore.getState().setContent('# Draft updated')

    await expect(saveActiveSddDraftToDisk()).resolves.toBe(true)

    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/app',
      path: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Draft updated'
    })
    expect(useSddDraftStore.getState()).toMatchObject({
      content: '# Draft updated',
      lastSavedContent: '# Draft updated',
      saveStatus: 'saved'
    })
  })

  it('deletes a draft folder and clears the active remembered draft', async () => {
    const deleteWorkspaceEntry = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000',
      deletedAt: '2026-01-01T00:00:00.000Z'
    })
    window.kunGui.deleteWorkspaceEntry = deleteWorkspaceEntry
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')

    await expect(deleteSddDraft(draft)).resolves.toEqual({ ok: true })

    expect(deleteWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/app',
      path: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000'
    })
    expect(readRememberedSddDraft('/tmp/app')).toBeNull()
    expect(readRememberedSddDraftContent(draft)).toBeNull()
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
  })

  it('forgets a remembered draft when its disk folder is already missing', async () => {
    window.kunGui.deleteWorkspaceEntry = vi.fn().mockResolvedValue({
      ok: false,
      message: 'ENOENT: no such file or directory'
    })
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')

    await expect(deleteSddDraft(draft)).resolves.toEqual({ ok: true })

    expect(readRememberedSddDraft('/tmp/app')).toBeNull()
  })

  it('refreshes a clean active draft from disk changes', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      absolutePath: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')

    await expect(syncActiveSddDraftFromDisk({
      path: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Draft updated by AI',
      size: 21,
      truncated: false
    })).resolves.toBe(true)

    expect(useSddDraftStore.getState()).toMatchObject({
      content: '# Draft updated by AI',
      lastSavedContent: '# Draft updated by AI',
      saveStatus: 'saved'
    })
  })

  it('does not overwrite unsaved draft edits with disk changes', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      absolutePath: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')
    useSddDraftStore.getState().setContent('# Local unsaved draft')

    await expect(syncActiveSddDraftFromDisk({
      path: '/tmp/app/.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# External draft',
      size: 16,
      truncated: false
    })).resolves.toBe(false)

    expect(useSddDraftStore.getState()).toMatchObject({
      content: '# Local unsaved draft',
      lastSavedContent: '# Draft',
      saveStatus: 'dirty'
    })
  })

  it('keeps the draft dirty when disk save fails', async () => {
    window.kunGui.writeWorkspaceFile = vi.fn().mockResolvedValue({
      ok: false,
      message: 'write failed'
    })
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setActiveDraft(draft, '# Draft')
    useSddDraftStore.getState().setContent('# Draft updated')

    await expect(saveActiveSddDraftToDisk()).resolves.toBe(false)

    expect(useSddDraftStore.getState()).toMatchObject({
      saveStatus: 'error',
      error: 'write failed',
      lastSavedContent: '# Draft'
    })
  })
})
