import { create } from 'zustand'
import { browserStorage } from '../lib/browser-storage'
import { planDisplayNameFromRelativePath } from './plan-path'

export type GuiPlanOperationStatus =
  | 'idle'
  | 'drafting'
  | 'ready'
  | 'refining'
  | 'building'
  | 'error'

export type GuiPlanSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type GuiPlanPreviewMode = 'live' | 'source' | 'split' | 'preview'

export type GuiPlanArtifact = {
  id: string
  workspaceRoot: string
  threadId?: string | null
  featureName: string
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  createdAt: string
  updatedAt: string
}

type PersistedPlanRegistry = {
  version: 1
  activeByWorkspace: Record<string, string>
  activeByThread: Record<string, string>
  plans: Record<string, GuiPlanArtifact>
}

export type GuiPlanState = {
  activePlan: GuiPlanArtifact | null
  content: string
  lastSavedContent: string
  saveStatus: GuiPlanSaveStatus
  operationStatus: GuiPlanOperationStatus
  error: string | null
  previewMode: GuiPlanPreviewMode
  setActivePlan: (plan: GuiPlanArtifact, content: string) => void
  setContent: (content: string) => void
  setGeneratedContent: (planId: string, content: string) => void
  setSaveStatus: (status: GuiPlanSaveStatus, error?: string | null) => void
  markSaved: (content: string) => void
  setOperationStatus: (status: GuiPlanOperationStatus, error?: string | null) => void
  setPreviewMode: (mode: GuiPlanPreviewMode) => void
  updateActivePlan: (planId: string, patch: Partial<Pick<GuiPlanArtifact, 'threadId' | 'absolutePath'>>) => void
  clearActivePlan: () => void
}

const PLAN_REGISTRY_STORAGE_KEY = 'deepseekgui.plan.registry.v1'
const PLAN_PREVIEW_MODE_STORAGE_KEY = 'deepseekgui.plan.previewMode'

function normalizeWorkspaceRoot(value: string | undefined | null): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function threadKey(workspaceRoot: string, threadId: string | null | undefined): string {
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const thread = threadId?.trim()
  return workspace && thread ? `${workspace}::${thread}` : ''
}

function emptyRegistry(): PersistedPlanRegistry {
  return { version: 1, activeByWorkspace: {}, activeByThread: {}, plans: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePlanArtifact(raw: unknown, fallbackId = ''): GuiPlanArtifact | null {
  if (!isRecord(raw)) return null
  const id = normalizeText(raw.id) || normalizeText(fallbackId)
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(raw.workspaceRoot))
  const relativePath = normalizeText(raw.relativePath)
  if (!id || !workspaceRoot || !relativePath) return null
  const threadId = normalizeText(raw.threadId)
  const absolutePath = normalizeText(raw.absolutePath)
  const sourceRequest = typeof raw.sourceRequest === 'string' ? raw.sourceRequest : ''
  const featureName = normalizeText(raw.featureName) || planDisplayNameFromRelativePath(relativePath)
  const createdAt = normalizeText(raw.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(raw.updatedAt) || createdAt
  return {
    id,
    workspaceRoot,
    ...(threadId ? { threadId } : { threadId: null }),
    featureName,
    relativePath,
    ...(absolutePath ? { absolutePath } : {}),
    sourceRequest,
    createdAt,
    updatedAt
  }
}

function normalizePlanRegistry(raw: unknown): PersistedPlanRegistry {
  if (!isRecord(raw)) return emptyRegistry()
  const plans: PersistedPlanRegistry['plans'] = {}
  if (isRecord(raw.plans)) {
    for (const [planId, value] of Object.entries(raw.plans)) {
      const plan = normalizePlanArtifact(value, planId)
      if (plan) plans[plan.id] = plan
    }
  }

  const activeByWorkspace: PersistedPlanRegistry['activeByWorkspace'] = {}
  if (isRecord(raw.activeByWorkspace)) {
    for (const [workspaceRoot, value] of Object.entries(raw.activeByWorkspace)) {
      const workspace = normalizeWorkspaceRoot(workspaceRoot)
      const planId = normalizeText(value)
      const plan = plans[planId]
      if (workspace && plan && normalizeWorkspaceRoot(plan.workspaceRoot) === workspace) {
        activeByWorkspace[workspace] = plan.id
      }
    }
  }

  const activeByThread: PersistedPlanRegistry['activeByThread'] = {}
  if (isRecord(raw.activeByThread)) {
    for (const [key, value] of Object.entries(raw.activeByThread)) {
      const activeKey = normalizeText(key)
      const planId = normalizeText(value)
      if (activeKey && plans[planId]) activeByThread[activeKey] = plans[planId].id
    }
  }

  return { version: 1, activeByWorkspace, activeByThread, plans }
}

function readRegistry(storage = browserStorage()): PersistedPlanRegistry {
  if (!storage) return emptyRegistry()
  try {
    const raw = storage.getItem(PLAN_REGISTRY_STORAGE_KEY)
    if (!raw) return emptyRegistry()
    return normalizePlanRegistry(JSON.parse(raw))
  } catch {
    return emptyRegistry()
  }
}

function writeRegistry(registry: PersistedPlanRegistry, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify(normalizePlanRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

function readPreviewMode(): GuiPlanPreviewMode {
  try {
    const raw = browserStorage()?.getItem(PLAN_PREVIEW_MODE_STORAGE_KEY)
    return raw === 'source' || raw === 'split' || raw === 'preview' || raw === 'live'
      ? raw
      : 'live'
  } catch {
    return 'live'
  }
}

function persistPreviewMode(mode: GuiPlanPreviewMode): void {
  try {
    browserStorage()?.setItem(PLAN_PREVIEW_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore storage failures */
  }
}

export function createGuiPlanArtifact(options: {
  workspaceRoot: string
  threadId?: string | null
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  now?: number
}): GuiPlanArtifact {
  const now = new Date(options.now ?? Date.now()).toISOString()
  const featureName = planDisplayNameFromRelativePath(options.relativePath)
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
  return {
    id: `${workspaceRoot}:${options.relativePath}`,
    workspaceRoot,
    threadId: options.threadId ?? null,
    featureName,
    relativePath: options.relativePath,
    ...(options.absolutePath ? { absolutePath: options.absolutePath } : {}),
    sourceRequest: options.sourceRequest,
    createdAt: now,
    updatedAt: now
  }
}

export function rememberGuiPlan(plan: GuiPlanArtifact): void {
  const normalizedPlan = normalizePlanArtifact(plan)
  if (!normalizedPlan) return
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(normalizedPlan.workspaceRoot)
  const key = threadKey(workspace, normalizedPlan.threadId)
  registry.plans[normalizedPlan.id] = normalizedPlan
  if (workspace) registry.activeByWorkspace[workspace] = normalizedPlan.id
  if (key) registry.activeByThread[key] = normalizedPlan.id
  writeRegistry(registry)
}

export function forgetGuiPlan(planOrId: GuiPlanArtifact | string): void {
  const registry = readRegistry()
  const planId = typeof planOrId === 'string' ? planOrId : planOrId.id
  delete registry.plans[planId]
  for (const [workspace, activePlanId] of Object.entries(registry.activeByWorkspace)) {
    if (activePlanId === planId) delete registry.activeByWorkspace[workspace]
  }
  for (const [key, activePlanId] of Object.entries(registry.activeByThread)) {
    if (activePlanId === planId) delete registry.activeByThread[key]
  }
  writeRegistry(registry)
}

export function guiPlanMatchesContext(
  plan: GuiPlanArtifact,
  workspaceRoot: string,
  threadId?: string | null
): boolean {
  if (normalizeWorkspaceRoot(plan.workspaceRoot) !== normalizeWorkspaceRoot(workspaceRoot)) return false
  const activeThread = threadId?.trim() ?? ''
  const planThread = plan.threadId?.trim() ?? ''
  return activeThread ? planThread === activeThread : !planThread
}

export function readRememberedGuiPlan(
  workspaceRoot: string,
  threadId?: string | null
): GuiPlanArtifact | null {
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const byThread = registry.activeByThread[threadKey(workspace, threadId)]
  const byWorkspace = threadId?.trim() ? undefined : registry.activeByWorkspace[workspace]
  const plan = registry.plans[byThread ?? byWorkspace ?? ''] ?? null
  return plan && guiPlanMatchesContext(plan, workspace, threadId) ? plan : null
}

export const useGuiPlanStore = create<GuiPlanState>((set) => ({
  activePlan: null,
  content: '',
  lastSavedContent: '',
  saveStatus: 'saved',
  operationStatus: 'idle',
  error: null,
  previewMode: readPreviewMode(),

  setActivePlan: (plan, content) => {
    rememberGuiPlan(plan)
    set({
      activePlan: plan,
      content,
      lastSavedContent: content,
      saveStatus: 'saved',
      operationStatus: 'ready',
      error: null
    })
  },

  setContent: (content) =>
    set((state) => ({
      content,
      saveStatus: content === state.lastSavedContent ? 'saved' : 'dirty',
      error: state.saveStatus === 'error' ? null : state.error
    })),

  setGeneratedContent: (planId, content) =>
    set((state) => {
      if (state.activePlan?.id !== planId) return {}
      return { content }
    }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, error }),

  markSaved: (content) =>
    set((state) => {
      const activePlan = state.activePlan
        ? { ...state.activePlan, updatedAt: new Date().toISOString() }
        : state.activePlan
      if (activePlan) rememberGuiPlan(activePlan)
      return {
        content,
        lastSavedContent: content,
        saveStatus: 'saved',
        error: state.operationStatus === 'error' ? state.error : null,
        activePlan
      }
    }),

  setOperationStatus: (status, error = null) => set({ operationStatus: status, error }),

  setPreviewMode: (mode) => {
    persistPreviewMode(mode)
    set({ previewMode: mode })
  },

  updateActivePlan: (planId, patch) =>
    set((state) => {
      if (state.activePlan?.id !== planId) return {}
      const updated = {
        ...state.activePlan,
        ...patch,
        updatedAt: new Date().toISOString()
      }
      rememberGuiPlan(updated)
      return { activePlan: updated }
    }),

  clearActivePlan: () =>
    set({
      activePlan: null,
      content: '',
      lastSavedContent: '',
      saveStatus: 'saved',
      operationStatus: 'idle',
      error: null
    })
}))
