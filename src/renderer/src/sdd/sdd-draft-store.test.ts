import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSddDraft, readRememberedSddDraft, useSddDraftStore } from './sdd-draft-store'
import { saveActiveSddDraftToDisk } from './sdd-draft-actions'

const SDD_DRAFT_REGISTRY_STORAGE_KEY = 'deepseekgui.sdd.draft.registry.v1'

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
      dsGui: {
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

    expect(draft.id).toBe('/tmp/app:.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md')
    expect(readRememberedSddDraft('/tmp/app')?.id).toBe(draft.id)
    expect(readRememberedSddDraft('/tmp/other')).toBeNull()
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
          relativePath: '.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
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
      relativePath: '.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
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

  it('saves the active draft to disk and updates clean state', async () => {
    const writeWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      savedAt: '2026-01-01T00:00:00.000Z'
    })
    window.dsGui.writeWorkspaceFile = writeWorkspaceFile
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
      path: '.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Draft updated'
    })
    expect(useSddDraftStore.getState()).toMatchObject({
      content: '# Draft updated',
      lastSavedContent: '# Draft updated',
      saveStatus: 'saved'
    })
  })

  it('keeps the draft dirty when disk save fails', async () => {
    window.dsGui.writeWorkspaceFile = vi.fn().mockResolvedValue({
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
