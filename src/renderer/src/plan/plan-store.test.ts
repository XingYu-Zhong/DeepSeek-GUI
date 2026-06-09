import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuiPlanArtifact,
  forgetGuiPlan,
  guiPlanMatchesContext,
  readRememberedGuiPlan,
  useGuiPlanStore
} from './plan-store'

const PLAN_REGISTRY_STORAGE_KEY = 'deepseekgui.plan.registry.v1'

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

describe('plan-store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    useGuiPlanStore.getState().clearActivePlan()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useGuiPlanStore.getState().clearActivePlan()
  })

  it('remembers active plans only for the owning thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.deepseekgui/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')?.id).toBe(plan.id)
    expect(readRememberedGuiPlan('/tmp/app', 'thread-b')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/app')).toBeNull()
  })

  it('remembers threadless plans at workspace scope without leaking into threaded context', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      relativePath: '.deepseekgui/plan/draft.md',
      sourceRequest: 'draft',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Draft')

    expect(readRememberedGuiPlan('/tmp/app')?.id).toBe(plan.id)
    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
  })

  it('normalizes malformed persisted plan registry data before restoring plans', () => {
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByWorkspace: {
        '/tmp/valid': 'valid',
        '/tmp/missing': 'missing'
      },
      activeByThread: {
        '/tmp/valid::thread-a': 'valid',
        '/tmp/invalid::thread-b': 'invalid'
      },
      plans: {
        valid: {
          workspaceRoot: '/tmp/valid/',
          threadId: 'thread-a',
          relativePath: '.deepseekgui/plan/draft.md',
          sourceRequest: 'draft',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        invalid: {
          id: 'invalid',
          workspaceRoot: 42,
          relativePath: ''
        }
      }
    }))

    expect(readRememberedGuiPlan('/tmp/valid', 'thread-a')).toMatchObject({
      id: 'valid',
      workspaceRoot: '/tmp/valid',
      featureName: 'draft',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(readRememberedGuiPlan('/tmp/missing')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/invalid', 'thread-b')).toBeNull()
  })

  it('forgets completed plans from the persisted registry', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.deepseekgui/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')
    forgetGuiPlan(plan)

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
  })

  it('persists updated plan timestamps when saved content is marked clean', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.deepseekgui/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })
    const savedAt = new Date('2026-01-02T03:04:05.000Z')

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')
    vi.useFakeTimers()
    vi.setSystemTime(savedAt)
    useGuiPlanStore.getState().markSaved('# Auth updated')

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')?.updatedAt).toBe(savedAt.toISOString())
  })

  it('matches active plans to the current workspace and thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.deepseekgui/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })
    const threadlessPlan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      relativePath: '.deepseekgui/plan/draft.md',
      sourceRequest: 'draft',
      now: 1
    })

    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-a')).toBe(true)
    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-b')).toBe(false)
    expect(guiPlanMatchesContext(plan, '/tmp/other', 'thread-a')).toBe(false)
    expect(guiPlanMatchesContext(threadlessPlan, '/tmp/app')).toBe(true)
    expect(guiPlanMatchesContext(threadlessPlan, '/tmp/app', 'thread-a')).toBe(false)
  })
})
