import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import { buildPlanBuildPrompt } from '../plan/plan-prompts'
import {
  CODE_PANEL_PREFERRED
} from './workbench-layout'
import {
  createGuiPlanArtifact,
  guiPlanMatchesContext,
  useGuiPlanStore,
  type GuiPlanArtifact
} from '../plan/plan-store'
import {
  GUI_PLAN_RELATIVE_DIR,
  nextAvailablePlanRelativePath,
  planFeatureNameFromRequest
} from '../plan/plan-path'
import { extractPlanMetadataFromBlock } from '../plan/plan-tool'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import type { GuiPlanMessageContext, SendMessageOverrides } from '../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

type PlanResultMatch = {
  blockId: string
  meta: NonNullable<ReturnType<typeof extractPlanMetadataFromBlock>>
}

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  'attachmentIds' | 'attachments' | 'displayText' | 'guiPlan' | 'model' | 'reasoningEffort'
> & {
  workspaceRoot?: string
}

type WorkbenchPlanControllerOptions = {
  blocks: ChatBlock[]
  busy: boolean
  mode: 'plan' | 'agent'
  route: ChatState['route']
  sendMessage: ChatState['sendMessage']
  setError: ChatState['setError']
  setMode: Dispatch<SetStateAction<'plan' | 'agent'>>
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>
  setRightSidebarWidth: Dispatch<SetStateAction<number>>
  t: (key: string) => string
  workspaceRoot: string
  onPlanBuildStarted?: (plan: GuiPlanArtifact) => void | Promise<void>
}

function latestSuccessfulPlanBlock(blocks: ChatBlock[]): PlanResultMatch | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'tool' || block.status !== 'success') continue
    const meta = extractPlanMetadataFromBlock(block)
    if (!meta) continue
    return { blockId: block.id, meta }
  }
  return null
}

export function resolvePlanTurnWorkspaceRoot(
  preferredWorkspaceRoot: string | undefined,
  fallbackWorkspaceRoot: string | undefined
): string {
  return normalizePlanWorkspaceRoot(preferredWorkspaceRoot) || normalizePlanWorkspaceRoot(fallbackWorkspaceRoot)
}

function normalizePlanWorkspaceRoot(value: string | undefined): string {
  return normalizeWorkspaceRoot(value).replaceAll('\\', '/').replace(/\/+$/, '')
}

export function buildGuiPlanTurnOverrides(
  plan: GuiPlanArtifact | null,
  workspaceRoot: string,
  activeThreadId: string | null
): { guiPlan?: GuiPlanMessageContext } | undefined {
  if (plan && guiPlanMatchesContext(plan, workspaceRoot, activeThreadId)) {
    return {
      guiPlan: {
        operation: 'refine',
        workspaceRoot: plan.workspaceRoot,
        relativePath: plan.relativePath,
        planId: plan.id,
        sourceRequest: plan.sourceRequest,
        title: plan.featureName
      }
    }
  }
  return undefined
}

export function buildDraftGuiPlanTurnOverrides(input: {
  request: string
  workspaceRoot: string
  activeThreadId: string | null
  existingRelativePaths?: Iterable<string>
}): { guiPlan: GuiPlanMessageContext } {
  const sourceRequest = input.request.trim()
  const featureName = planFeatureNameFromRequest(sourceRequest)
  const relativePath = nextAvailablePlanRelativePath(featureName, input.existingRelativePaths ?? [])
  const plan = createGuiPlanArtifact({
    workspaceRoot: input.workspaceRoot,
    threadId: input.activeThreadId,
    relativePath,
    sourceRequest
  })
  return {
    guiPlan: {
      operation: 'draft',
      workspaceRoot: plan.workspaceRoot,
      relativePath: plan.relativePath,
      planId: plan.id,
      sourceRequest: plan.sourceRequest,
      title: plan.featureName
    }
  }
}

export function useWorkbenchPlanController({
  blocks,
  busy,
  mode,
  route,
  sendMessage,
  setError,
  setMode,
  setRightPanelMode,
  setRightSidebarWidth,
  t,
  workspaceRoot,
  onPlanBuildStarted
}: WorkbenchPlanControllerOptions) {
  const activeGuiPlan = useGuiPlanStore((s) => s.activePlan)
  const latestPlanBlock = useMemo(() => latestSuccessfulPlanBlock(blocks), [blocks])
  const planTurnInFlightRef = useRef(false)
  const lastLoadedPlanBlockIdRef = useRef<string | null>(null)

  const openGuiPlanPanel = useCallback((): void => {
    setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    setRightPanelMode('plan')
  }, [setRightPanelMode, setRightSidebarWidth])

  const savePlanContentToDisk = async (
    plan: GuiPlanArtifact,
    contentToSave: string
  ): Promise<boolean> => {
    const planStore = useGuiPlanStore.getState()
    planStore.setSaveStatus('saving')
    try {
      const result = await window.dsGui.writeWorkspaceFile({
        workspaceRoot: plan.workspaceRoot,
        path: plan.relativePath,
        content: contentToSave
      })
      if (!result.ok) {
        useGuiPlanStore.getState().setSaveStatus('error', result.message)
        return false
      }
      const latest = useGuiPlanStore.getState()
      if (latest.activePlan?.id === plan.id) {
        latest.markSaved(contentToSave)
      }
      return true
    } catch (error) {
      useGuiPlanStore.getState().setSaveStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      )
      return false
    }
  }

  const planTurnOverrides = (
    targetWorkspaceRoot: string,
    targetThreadId: string | null
  ): { guiPlan?: GuiPlanMessageContext } | undefined => {
    const plan = useGuiPlanStore.getState().activePlan
    return buildGuiPlanTurnOverrides(plan, targetWorkspaceRoot, targetThreadId)
  }

  const readExistingPlanRelativePaths = async (
    targetWorkspaceRoot: string
  ): Promise<string[]> => {
    try {
      const result = await window.dsGui.listWorkspaceDirectory({
        workspaceRoot: targetWorkspaceRoot,
        path: GUI_PLAN_RELATIVE_DIR
      })
      if (!result.ok) return []
      return result.entries
        .filter((entry) => entry.type === 'file' && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => `${GUI_PLAN_RELATIVE_DIR}/${entry.name}`)
    } catch {
      return []
    }
  }

  const sendPlanTurn = async (
    text: string,
    overrides?: PlanTurnOverrides
  ): Promise<boolean> => {
    const currentChatState = useChatStore.getState()
    const currentPlan = useGuiPlanStore.getState().activePlan
    const fallbackWorkspaceRoot =
      currentChatState.workspaceRoot || workspaceRoot || currentPlan?.workspaceRoot
    const targetWorkspaceRoot = resolvePlanTurnWorkspaceRoot(
      overrides?.workspaceRoot,
      fallbackWorkspaceRoot
    )
    if (!targetWorkspaceRoot) {
      setError(t('workspaceRequiredToCreateThread'))
      return false
    }
    planTurnInFlightRef.current = true
    const planOverrides = planTurnOverrides(targetWorkspaceRoot, currentChatState.activeThreadId)
    const { workspaceRoot: _workspaceRoot, ...messageOverrides } = overrides ?? {}
    const guiPlan = messageOverrides.guiPlan ?? planOverrides?.guiPlan ?? buildDraftGuiPlanTurnOverrides({
      request: text,
      workspaceRoot: targetWorkspaceRoot,
      activeThreadId: currentChatState.activeThreadId,
      existingRelativePaths: await readExistingPlanRelativePaths(targetWorkspaceRoot)
    }).guiPlan
    const sent = await sendMessage(text, 'plan', {
      ...messageOverrides,
      guiPlan
    })
    if (!sent) planTurnInFlightRef.current = false
    return sent
  }

  const loadPlanFromMeta = useCallback(async (
    meta: PlanResultMatch['meta'],
    shouldOpen: boolean
  ): Promise<void> => {
    const result = await window.dsGui.readWorkspaceFile({
      workspaceRoot: meta.workspaceRoot,
      path: meta.relativePath
    })
    if (!result.ok) {
      useGuiPlanStore.getState().setOperationStatus('error', result.message)
      return
    }
    const base = createGuiPlanArtifact({
      workspaceRoot: meta.workspaceRoot,
      threadId: useChatStore.getState().activeThreadId,
      relativePath: meta.relativePath,
      absolutePath: meta.absolutePath ?? result.path,
      sourceRequest: meta.sourceRequest ?? ''
    })
    const plan = meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base
    useGuiPlanStore.getState().setActivePlan(plan, result.content)
    if (shouldOpen) openGuiPlanPanel()
  }, [openGuiPlanPanel])

  const buildGuiPlan = async (): Promise<void> => {
    const snapshot = useGuiPlanStore.getState()
    const plan = snapshot.activePlan
    if (!plan) return
    if (useChatStore.getState().busy) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    const saved = await savePlanContentToDisk(plan, snapshot.content)
    if (!saved) return
    setMode('agent')
    const prompt = buildPlanBuildPrompt(plan.relativePath)
    const sent = await sendMessage(prompt, 'agent', {
      displayText: `${t('planBuild')}: ${plan.relativePath}`
    })
    if (sent) {
      await onPlanBuildStarted?.(plan)
    }
  }

  const handleGuiPlanCommand = async (request?: string): Promise<void> => {
    setMode('plan')
    if (request?.trim()) {
      await sendPlanTurn(request.trim())
    }
  }

  useEffect(() => {
    if (route !== 'chat' && mode === 'plan') {
      setMode('agent')
    }
  }, [mode, route, setMode])

  useEffect(() => {
    if (latestPlanBlock && lastLoadedPlanBlockIdRef.current === latestPlanBlock.blockId) return
    if (!latestPlanBlock) return
    lastLoadedPlanBlockIdRef.current = latestPlanBlock.blockId
    const shouldOpen = planTurnInFlightRef.current || mode === 'plan'
    planTurnInFlightRef.current = false
    void loadPlanFromMeta(latestPlanBlock.meta, shouldOpen).catch((error) => {
      useGuiPlanStore.getState().setOperationStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      )
    })
  }, [latestPlanBlock, loadPlanFromMeta, mode])

  useEffect(() => {
    if (!busy) planTurnInFlightRef.current = false
  }, [busy])

  return {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    sendPlanTurn
  }
}
