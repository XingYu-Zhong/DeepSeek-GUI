import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ReviewTarget,
  ThreadEventSink,
  ThreadListOptions,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import { getKunRuntimeSettings } from '@shared/app-settings'
import {
  KUN_ATTACHMENT_DIAGNOSTICS_PATH,
  KUN_ATTACHMENTS_PATH,
  KUN_MEMORY_DIAGNOSTICS_PATH,
  KUN_MEMORY_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_SKILLS_PATH,
  kunApprovalPath,
  kunThreadCompactPath,
  kunThreadEventsPath,
  kunThreadForkPath,
  kunThreadGoalPath,
  kunThreadReviewPath,
  kunThreadTodosPath,
  kunThreadInterruptPath,
  kunThreadPath,
  kunThreadSteerPath,
  kunThreadTurnsPath,
  kunAttachmentContentPath,
  kunUserInputPath,
  kunMemoryRecordPath,
  kunSessionResumePath,
  normalizeThreadMode,
  type KunThreadMode
} from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeError } from '@shared/runtime-error'
import type {
  CoreAttachmentDiagnosticsJson,
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreAttachmentUploadResponseJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryListResponseJson,
  CoreMemoryRecordJson,
  CoreResumeSessionResponseJson,
  CoreRuntimeInfoJson,
  CoreRuntimeEventJson,
  CoreRuntimeSkillJson,
  CoreRuntimeSkillsResponseJson,
  CoreRuntimeToolDiagnosticsJson,
  CoreStartReviewResponseJson,
  CoreClearThreadGoalResponseJson,
  CoreClearThreadTodosResponseJson,
  CoreStartTurnResponseJson,
  CoreThreadGoalResponseJson,
  CoreThreadJson,
  CoreThreadSummaryJson,
  CoreThreadTodosResponseJson
} from './kun-contract'
import {
  buildQuery,
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  goalFromCore,
  mergeChatBlocks,
  todosFromCore,
  threadFromCore
} from './kun-mapper'
import { rendererRuntimeClient } from './runtime-client'

function createSseStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readRuntimeError(body: string, fallback: string): RuntimeError {
  return parseRuntimeErrorBody(body, fallback)
}

function readRuntimeJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw runtimeErrorToError({ code: 'unknown', message: fallback })
  }
}

/**
 * GUI-side adapter for the Kun HTTP/SSE contract.
 *
 * The provider owns renderer orchestration only: HTTP calls, SSE
 * reconnection, and approval policy decisions. DTO and chat-block
 * mapping live in `kun-contract.ts` and `kun-mapper.ts`.
 */
export class KunRuntimeProvider implements AgentProvider {
  readonly id = 'kun' as const
  readonly displayName = 'Kun'

  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review: boolean
  } {
    return { interrupt: true, stream: true, approvals: true, attachFiles: true, review: true }
  }

  async connect(): Promise<void> {
    const health = await rendererRuntimeClient.runtimeRequest('/health', 'GET')
    if (!health.ok) {
      throw runtimeErrorToError(readRuntimeError(health.body, `runtime unhealthy (${health.status || 0})`))
    }
    const threads = await rendererRuntimeClient.runtimeRequest('/v1/threads?limit=1', 'GET')
    if (!threads.ok) {
      throw runtimeErrorToError(readRuntimeError(threads.body, `failed to list threads (${threads.status || 0})`))
    }
  }

  async listThreads(options: ThreadListOptions = {}): Promise<NormalizedThread[]> {
    const query = buildQuery({
      limit: options.limit ?? 50,
      search: options.search,
      include_archived: options.includeArchived,
      archived_only: options.archivedOnly
    })
    const response = await rendererRuntimeClient.runtimeRequest(`/v1/threads${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list threads'))
    }
    const body = readRuntimeJson<{ threads: CoreThreadSummaryJson[] }>(
      response.body,
      'runtime returned an invalid thread list response'
    )
    return body.threads.map(threadFromCore)
  }

  async createThread(input: {
    workspace?: string
    title?: string
    mode?: KunThreadMode
  }): Promise<NormalizedThread> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getKunRuntimeSettings(settings)
    const response = await rendererRuntimeClient.runtimeRequest(
      '/v1/threads',
      'POST',
      JSON.stringify({
        workspace: input.workspace || settings.workspaceRoot || '~',
        title: input.title,
        model: runtime.model,
        mode: normalizeThreadMode(input.mode),
        approvalPolicy: runtime.approvalPolicy,
        sandboxMode: runtime.sandboxMode
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to create thread'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    goal?: NormalizedThread['goal']
    todos?: NormalizedThread['todos']
  }> {
    const response = await rendererRuntimeClient.runtimeRequest(kunThreadPath(threadId), 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread'))
    }
    const thread = readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    )
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const items = turns.flatMap((turn) =>
      (turn.items ?? []).map((item) => ({
        ...item,
        attachmentIds: turn.attachmentIds,
        activeSkillIds: turn.activeSkillIds,
        injectedMemoryIds: turn.injectedMemoryIds,
        skillInjectionBytes: turn.skillInjectionBytes
      }))
    )
    const blocks = mergeChatBlocks(items.flatMap((item) => {
      const block = chatBlockFromItem(item)
      return block ? [block] : []
    }))
    const latestTurn = turns.at(-1)
    const latestUserMessageId = [...items].reverse().find((item) => item.kind === 'user_message')?.id
    return {
      blocks,
      latestSeq: thread.latestSeq ?? 0,
      threadStatus: thread.status ?? latestTurn?.status,
      latestTurnId: latestTurn?.id,
      latestUserMessageId,
      goal: thread.goal ? goalFromCore(thread.goal) : null,
      todos: thread.todos ? todosFromCore(thread.todos) : null
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: KunThreadMode
      model?: string
      reasoningEffort?: string
      displayText?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      attachmentIds?: string[]
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const body: Record<string, unknown> = { prompt: text, model: options?.model }
    if (options?.reasoningEffort?.trim()) {
      body.reasoningEffort = options.reasoningEffort.trim()
    }
    if (options?.displayText?.trim() && options.displayText.trim() !== text.trim()) {
      body.displayText = options.displayText.trim()
    }
    const mode = options?.mode
    if (mode === 'agent' || mode === 'plan') {
      body.mode = mode
    }
    if (options?.guiPlan) {
      body.guiPlan = {
        operation: options.guiPlan.operation,
        workspaceRoot: options.guiPlan.workspaceRoot,
        relativePath: options.guiPlan.relativePath,
        planId: options.guiPlan.planId,
        sourceRequest: options.guiPlan.sourceRequest,
        title: options.guiPlan.title
      }
    }
    if (options?.attachmentIds?.length) {
      body.attachmentIds = options.attachmentIds
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTurnsPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start turn'))
    }
    const parsed = readRuntimeJson<CoreStartTurnResponseJson>(
      response.body,
      'runtime returned an invalid turn response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId
    }
  }

  async reviewThread(
    threadId: string,
    target: ReviewTarget,
    options?: { model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }> {
    const body: Record<string, unknown> = { target }
    if (options?.model?.trim()) {
      body.model = options.model.trim()
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadReviewPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start review'))
    }
    const parsed = readRuntimeJson<CoreStartReviewResponseJson>(
      response.body,
      'runtime returned an invalid review response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId,
      reviewItemId: parsed.reviewItemId
    }
  }

  async steerUserMessage(threadId: string, turnId: string, text: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadSteerPath(threadId, turnId),
      'POST',
      JSON.stringify({ text })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to queue message'))
    }
  }

  async interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadInterruptPath(threadId, turnId),
      'POST',
      JSON.stringify({ discard: options?.discard === true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to interrupt turn'))
    }
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ title })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'rename thread failed'))
    }
  }

  async archiveThread(threadId: string, archived: boolean): Promise<void> {
    const response = await window.dsGui.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ status: archived ? 'archived' : 'idle' })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'archive thread failed'))
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(kunThreadPath(threadId), 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'delete thread failed'))
    }
  }

  async compactThread(threadId: string, reason?: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadCompactPath(threadId),
      'POST',
      JSON.stringify({ reason: reason?.trim() || undefined })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'compact thread failed'))
    }
  }

  async getThreadGoal(threadId: string): Promise<NonNullable<NormalizedThread['goal']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    return body.goal ? goalFromCore(body.goal) : null
  }

  async setThreadGoal(
    threadId: string,
    patch: {
      objective?: string
      status?: NonNullable<NormalizedThread['goal']>['status']
      tokenBudget?: number | null
    }
  ): Promise<NonNullable<NormalizedThread['goal']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'POST',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    if (!body.goal) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread goal returned an invalid response'
      })
    }
    return goalFromCore(body.goal)
  }

  async clearThreadGoal(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread goal'))
    }
    return readRuntimeJson<CoreClearThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid clear thread goal response'
    ).cleared
  }

  async getThreadTodos(threadId: string): Promise<NonNullable<NormalizedThread['todos']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    return body.todos ? todosFromCore(body.todos) : null
  }

  async setThreadTodos(
    threadId: string,
    todos: Parameters<NonNullable<AgentProvider['setThreadTodos']>>[1]
  ): Promise<NonNullable<NormalizedThread['todos']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'POST',
      JSON.stringify({ todos })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    if (!body.todos) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread todos returned an invalid response'
      })
    }
    return todosFromCore(body.todos)
  }

  async clearThreadTodos(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread todos'))
    }
    return readRuntimeJson<CoreClearThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid clear thread todos response'
    ).cleared
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny'
  ): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunApprovalPath(approvalId),
      'POST',
      JSON.stringify({ decision })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'approval decision failed'))
    }
  }

  async submitUserInputResponse(inputId: string, answers: UserInputAnswer[]): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunUserInputPath(inputId),
      'POST',
      JSON.stringify({ answers })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input response failed'))
    }
  }

  async cancelUserInput(inputId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunUserInputPath(inputId),
      'POST',
      JSON.stringify({ cancelled: true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input cancel failed'))
    }
  }

  async getRuntimeInfo(): Promise<CoreRuntimeInfoJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_RUNTIME_INFO_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime info'))
    }
    return readRuntimeJson<CoreRuntimeInfoJson>(
      response.body,
      'runtime returned an invalid runtime info response'
    )
  }

  async getToolDiagnostics(): Promise<CoreRuntimeToolDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_RUNTIME_TOOLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime diagnostics'))
    }
    return readRuntimeJson<CoreRuntimeToolDiagnosticsJson>(
      response.body,
      'runtime returned an invalid runtime diagnostics response'
    )
  }

  async listSkills(): Promise<CoreRuntimeSkillJson[]> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_SKILLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list skills'))
    }
    return readRuntimeJson<CoreRuntimeSkillsResponseJson>(
      response.body,
      'runtime returned an invalid skills response'
    ).skills ?? []
  }

  async uploadAttachment(input: {
    name: string
    mimeType?: string
    dataBase64: string
    textFallback?: CoreAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<CoreAttachmentMetadataJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      KUN_ATTACHMENTS_PATH,
      'POST',
      JSON.stringify(input)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'attachment upload failed'))
    }
    return readRuntimeJson<CoreAttachmentUploadResponseJson>(
      response.body,
      'runtime returned an invalid attachment upload response'
    ).attachment
  }

  async getAttachmentDiagnostics(): Promise<CoreAttachmentDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_ATTACHMENT_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment diagnostics'))
    }
    return readRuntimeJson<CoreAttachmentDiagnosticsJson>(
      response.body,
      'runtime returned an invalid attachment diagnostics response'
    )
  }

  async getAttachmentContent(
    attachmentId: string,
    options: { threadId?: string; workspace?: string } = {}
  ): Promise<CoreAttachmentContentResponseJson> {
    const query = buildQuery({
      thread_id: options.threadId,
      workspace: options.workspace
    })
    const response = await rendererRuntimeClient.runtimeRequest(
      `${kunAttachmentContentPath(attachmentId)}${query}`,
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment content'))
    }
    return readRuntimeJson<CoreAttachmentContentResponseJson>(
      response.body,
      'runtime returned an invalid attachment content response'
    )
  }

  async listMemories(options: { workspace?: string; includeDeleted?: boolean } = {}): Promise<CoreMemoryRecordJson[]> {
    const query = buildQuery({
      workspace: options.workspace,
      include_deleted: options.includeDeleted
    })
    const response = await rendererRuntimeClient.runtimeRequest(`${KUN_MEMORY_PATH}${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list memories'))
    }
    return readRuntimeJson<CoreMemoryListResponseJson>(
      response.body,
      'runtime returned an invalid memory list response'
    ).memories ?? []
  }

  async updateMemory(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }
  ): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunMemoryRecordPath(memoryId),
      'PATCH',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to update memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async deleteMemory(memoryId: string): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(kunMemoryRecordPath(memoryId), 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to delete memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async getMemoryDiagnostics(): Promise<CoreMemoryDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_MEMORY_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load memory diagnostics'))
    }
    return readRuntimeJson<CoreMemoryDiagnosticsJson>(
      response.body,
      'runtime returned an invalid memory diagnostics response'
    )
  }

  async forkThread(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ): Promise<NormalizedThread> {
    const body: Record<string, unknown> = {}
    if (options?.relation) body.relation = options.relation
    if (options?.title) body.title = options.title
    const url = kunThreadForkPath(threadId)
    const response =
      Object.keys(body).length > 0
        ? await rendererRuntimeClient.runtimeRequest(url, 'POST', JSON.stringify(body))
        : await rendererRuntimeClient.runtimeRequest(url, 'POST')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'fork thread failed'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async resumeSession(
    sessionId: string,
    options?: { model?: string; mode?: KunThreadMode }
  ): Promise<{ threadId: string; sessionId: string }> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getKunRuntimeSettings(settings)
    const response = await rendererRuntimeClient.runtimeRequest(
      kunSessionResumePath(sessionId),
      'POST',
      JSON.stringify({
        workspace: settings.workspaceRoot || undefined,
        model: options?.model?.trim() || runtime.model,
        mode: options?.mode
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'resume session failed'))
    }
    const body = readRuntimeJson<CoreResumeSessionResponseJson>(
      response.body,
      'runtime returned an invalid resume session response'
    )
    const threadId = body.thread_id ?? body.threadId
    if (!threadId) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'resume session returned an invalid response'
      })
    }
    return { threadId, sessionId: body.session_id ?? body.sessionId ?? sessionId }
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const streamId = createSseStreamId()
    await new Promise<void>(async (resolve) => {
      let settled = false
      const pendingDispatches = new Set<Promise<void>>()
      const finish = (): void => {
        if (settled) return
        settled = true
        offData()
        offEnd()
        offErr()
        signal.removeEventListener('abort', onAbort)
        void Promise.allSettled([...pendingDispatches]).then(() => resolve())
      }
      const offData = rendererRuntimeClient.onSseEvent(({ streamId: sid, data }) => {
        if (sid !== streamId) return
        const event = data && typeof data === 'object' ? (data as CoreRuntimeEventJson) : {}
        if (typeof event.seq === 'number') {
          sink.onSeq(event.seq)
        }
        const task = dispatchKunRuntimeEvent(event, sink, (runtimeEvent, eventSink) =>
          this.handleApprovalRequest(runtimeEvent, eventSink)
        ).finally(() => {
          pendingDispatches.delete(task)
        })
        pendingDispatches.add(task)
      })
      const offErr = rendererRuntimeClient.onSseError(({ streamId: sid, message, status }) => {
        if (sid !== streamId) return
        sink.onError(new Error(message ?? `sse error ${status ?? ''}`))
        finish()
      })
      const offEnd = rendererRuntimeClient.onSseEnd(({ streamId: sid }) => {
        if (sid !== streamId) return
        finish()
      })
      const onAbort = (): void => {
        void rendererRuntimeClient.stopSse(streamId)
        finish()
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await rendererRuntimeClient.startSse(threadId, sinceSeq, streamId)
      } catch (error) {
        sink.onError(error instanceof Error ? error : new Error(String(error)))
        finish()
      }
    })
    void rendererRuntimeClient.stopSse(streamId)
  }

  private async handleApprovalRequest(event: CoreRuntimeEventJson, sink: ThreadEventSink): Promise<void> {
    const approvalId = event.approvalId ?? event.itemId ?? ''
    if (!approvalId) return
    try {
      const settings = await rendererRuntimeClient.getSettings()
      const policy = getKunRuntimeSettings(settings).approvalPolicy
      switch (policy) {
        case 'auto':
          await this.submitApprovalDecision(approvalId, 'allow')
          return
        case 'never':
          await this.submitApprovalDecision(approvalId, 'deny')
          return
        case 'on-request':
        case 'suggest':
        case 'untrusted':
          break
      }
    } catch {
      /* Fall through and render the approval card. */
    }
    sink.onApproval({
      approvalId,
      summary: event.summary ?? 'Approval required',
      toolName: event.toolName,
      ...(event.child ? { meta: { child: event.child } } : {})
    })
  }
}

export { kunThreadEventsPath }
