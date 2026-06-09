import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import type {
  AppSettingsV1,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_SCHEDULE_MODEL,
  buildScheduleRuntimePrompt,
  normalizeScheduleReasoningEffort
} from '../shared/app-settings'
import {
  buildScheduledTaskFromDetectedRequest,
  detectClawScheduledTaskRequest
} from './claw-scheduled-task-detector'
import {
  SCHEDULER_INTERVAL_MS,
  TASK_RESPONSE_TIMEOUT_MS,
  asString,
  computeScheduleNextRunAt,
  hasEnabledScheduledTask,
  internalUrl,
  isRunningStatus,
  latestAssistantText,
  nestedRecord,
  normalizeTaskModel,
  parseJsonObject,
  readRequestBody,
  runtimeErrorMessage,
  sleep,
  summarizeTaskResult,
  writeJson,
  type RunPromptOptions,
  type ScheduleRuntimeDeps,
  type ThreadDetailJson,
  type ThreadRecordJson
} from './schedule-runtime-helpers'

export { computeScheduleNextRunAt } from './schedule-runtime-helpers'

export function scheduledThreadTitle(title: string): string {
  const trimmed = title.trim()
  const prefix = '[Scheduled task]'
  const suffix = Array.from(trimmed).slice(0, 4).join('')
  return suffix ? `${prefix} ${suffix}` : prefix
}

export class ScheduleRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private server: Server | null = null
  private serverKey = ''
  private runningTaskIds = new Set<string>()
  private powerSaveBlockerId: number | null = null

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.syncInternalServer(settings)
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    void this.ensureNextRuns(settings)
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.closeInternalServer()
    this.stopPowerSaveBlocker()
  }

  async status(): Promise<ScheduleRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      internalServerRunning: this.server !== null,
      internalUrl: internalUrl(settings),
      runningTaskIds: [...this.runningTaskIds],
      powerSaveBlockerActive: this.isPowerSaveBlockerActive()
    }
  }

  async runTask(taskId: string): Promise<ScheduleRunResult> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, message: 'Task not found.' }
    return this.runTaskInternal(task, false)
  }

  async createScheduledTaskFromText(
    text: string,
    options: { workspaceRoot?: string | null; modelHint?: string | null; mode?: ScheduleRunMode | null } = {}
  ): Promise<ScheduleTaskFromTextResult> {
    const settings = await this.deps.store.load()
    try {
      const request = await detectClawScheduledTaskRequest(
        settings,
        text,
        options.modelHint?.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL
      )
      if (!request) return { kind: 'noop' }
      const task = buildScheduledTaskFromDetectedRequest({
        request,
        workspaceRoot: options.workspaceRoot?.trim() || this.resolveDefaultWorkspaceRoot(settings),
        model: options.modelHint?.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
        mode: options.mode ?? settings.schedule.mode,
        id: randomUUID()
      })
      const saved = await this.deps.store.patch({
        schedule: {
          enabled: true,
          tasks: [...settings.schedule.tasks, task]
        }
      })
      this.sync(saved)
      return {
        kind: 'created',
        taskId: task.id,
        title: task.title,
        scheduleAt: request.scheduleAt,
        confirmationText: request.confirmationText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-task', 'Failed to create scheduled task from text', { message, text })
      return { kind: 'error', message }
    }
  }

  async listTasks(): Promise<ScheduledTaskV1[]> {
    const settings = await this.deps.store.load()
    return settings.schedule.tasks
  }

  async createTask(task: ScheduledTaskV1): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const saved = await this.deps.store.patch({
      schedule: {
        enabled: true,
        tasks: [...settings.schedule.tasks, task]
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === task.id) ?? task
  }

  async createTaskFromInput(input: {
    title: string
    prompt: string
    workspaceRoot?: string
    model?: string
    reasoningEffort?: ScheduleReasoningEffort
    mode?: ScheduleRunMode
    enabled?: boolean
    schedule: Partial<ScheduledTaskV1['schedule']> & { kind: ScheduledTaskV1['schedule']['kind'] }
  }): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const now = new Date().toISOString()
    const task: ScheduledTaskV1 = {
      id: randomUUID(),
      title: input.title.trim() || 'New scheduled task',
      enabled: input.enabled !== false,
      prompt: input.prompt,
      workspaceRoot: input.workspaceRoot?.trim() || this.resolveDefaultWorkspaceRoot(settings),
      model: input.model?.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
      reasoningEffort: normalizeScheduleReasoningEffort(input.reasoningEffort),
      mode: input.mode ?? settings.schedule.mode,
      schedule: {
        kind: input.schedule.kind,
        everyMinutes: typeof input.schedule.everyMinutes === 'number' ? input.schedule.everyMinutes : 60,
        timeOfDay: input.schedule.timeOfDay?.trim() || '09:00',
        atTime: input.schedule.atTime?.trim() || ''
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      lastThreadId: ''
    }
    const saved = await this.createTask(task)
    await this.ensureNextRuns(await this.deps.store.load())
    return saved
  }

  async updateTaskById(taskId: string, patch: Partial<ScheduledTaskV1>): Promise<ScheduledTaskV1 | null> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return null
    const now = new Date().toISOString()
    const shouldRecomputeNextRun =
      Object.prototype.hasOwnProperty.call(patch, 'enabled') || patch.schedule !== undefined
    const nextTask: ScheduledTaskV1 = {
      ...task,
      ...patch,
      schedule: patch.schedule ? { ...task.schedule, ...patch.schedule } : task.schedule,
      ...(shouldRecomputeNextRun ? { nextRunAt: '' } : {}),
      updatedAt: now
    }
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.map((item) => (item.id === taskId ? nextTask : item))
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === taskId) ?? nextTask
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.tasks.some((item) => item.id === taskId)) return false
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.filter((item) => item.id !== taskId)
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.every((item) => item.id !== taskId)
  }

  private startScheduler(): void {
    if (this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.tick()
    }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref?.()
    void this.tick()
  }

  private async tick(): Promise<void> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    for (const task of fresh.schedule.tasks) {
      if (!task.enabled || task.schedule.kind === 'manual') continue
      if (this.runningTaskIds.has(task.id)) continue
      const dueAt = Date.parse(task.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runTaskInternal(task, true)
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    if (!settings.schedule.enabled) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    let changed = false
    const now = new Date()
    const tasks = settings.schedule.tasks.map((task) => {
      const wasInterrupted = task.lastStatus === 'running' && !this.runningTaskIds.has(task.id)
      if (!task.enabled || task.schedule.kind === 'manual' || this.runningTaskIds.has(task.id)) {
        if (!wasInterrupted) return task
        changed = true
        return {
          ...task,
          ...(task.schedule.kind === 'at' ? { enabled: false } : {}),
          nextRunAt: task.schedule.kind === 'at' ? '' : task.nextRunAt,
          lastStatus: 'error' as const,
          lastMessage: 'Task was interrupted before completion.',
          updatedAt: now.toISOString()
        }
      }
      if (task.nextRunAt && !wasInterrupted) return task
      changed = true
      return {
        ...task,
        nextRunAt: computeScheduleNextRunAt(task, now),
        ...(wasInterrupted
          ? {
              lastStatus: 'error' as const,
              lastMessage: 'Task was interrupted before completion.',
              updatedAt: now.toISOString()
            }
          : {})
      }
    })
    if (!changed) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    const saved = await this.deps.store.patch({ schedule: { ...settings.schedule, tasks } })
    this.syncPowerSaveBlocker(saved)
  }

  private async updateTask(
    taskId: string,
    updater: (task: ScheduledTaskV1, settings: AppSettingsV1) => ScheduledTaskV1
  ): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    const tasks = settings.schedule.tasks.map((task) => task.id === taskId ? updater(task, settings) : task)
    const saved = await this.deps.store.patch({ schedule: { ...settings.schedule, tasks } })
    this.syncPowerSaveBlocker(saved)
    return saved
  }

  private async runTaskInternal(task: ScheduledTaskV1, scheduled: boolean): Promise<ScheduleRunResult> {
    if (this.runningTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already running.' }
    }
    if (scheduled && (!task.enabled || task.schedule.kind === 'manual')) {
      return { ok: false, message: 'Task is not scheduled.' }
    }
    if (!task.prompt.trim()) {
      return { ok: false, message: 'Task prompt is empty.' }
    }

    this.runningTaskIds.add(task.id)
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: new Date().toISOString()
    }))

    try {
      const settings = await this.deps.store.load()
      const result = await this.runPrompt(settings, {
        prompt: task.prompt,
        title: scheduledThreadTitle(task.title),
        workspaceRoot: task.workspaceRoot || this.resolveDefaultWorkspaceRoot(settings),
        model: task.model,
        reasoningEffort: task.reasoningEffort,
        mode: task.mode,
        waitForResult: false,
        responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS
      })
      if (!result.ok) {
        const finishedAt = new Date()
        await this.updateTask(task.id, (current) => ({
          ...current,
          ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
          lastRunAt: finishedAt.toISOString(),
          nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
          lastStatus: 'error',
          lastMessage: result.message,
          updatedAt: finishedAt.toISOString()
        }))
        this.runningTaskIds.delete(task.id)
        return result
      }

      const startedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: startedAt.toISOString(),
        nextRunAt: '',
        lastStatus: 'running',
        lastMessage: result.message ?? 'Started',
        lastThreadId: result.threadId,
        updatedAt: startedAt.toISOString()
      }))
      void this.monitorTaskTurn(task.id, result.threadId, result.turnId ?? '')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        updatedAt: finishedAt.toISOString()
      }))
      this.runningTaskIds.delete(task.id)
      return { ok: false, message }
    }
  }

  private async monitorTaskTurn(taskId: string, threadId: string, turnId: string): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const task = settings.schedule.tasks.find((item) => item.id === taskId)
      const text = await this.waitForAssistantText(
        settings,
        threadId,
        turnId,
        TASK_RESPONSE_TIMEOUT_MS,
        task?.workspaceRoot || this.resolveDefaultWorkspaceRoot(settings)
      )
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'success',
        lastMessage: summarizeTaskResult(text),
        lastThreadId: threadId,
        updatedAt: finishedAt.toISOString()
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        lastThreadId: threadId || current.lastThreadId,
        updatedAt: finishedAt.toISOString()
      }))
      this.deps.logError('schedule-task', 'Scheduled task failed', { message, taskId, threadId })
    } finally {
      this.runningTaskIds.delete(taskId)
    }
  }

  private async runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ScheduleRunResult> {
    const workspace = options.workspaceRoot.trim() || this.resolveDefaultWorkspaceRoot(settings)
    if (workspace) {
      await mkdir(workspace, { recursive: true })
    }
    const model = normalizeTaskModel(options.model) ?? (settings.agents.kun.model.trim() || DEFAULT_SCHEDULE_MODEL)
    const create = await this.deps.runtimeRequest(settings, '/v1/threads', {
      method: 'POST',
      body: JSON.stringify({
        workspace,
        model,
        mode: options.mode,
        ...(options.title.trim() ? { title: options.title.trim() } : {})
      })
    })
    if (!create.ok) return { ok: false, message: runtimeErrorMessage(create, 'Failed to create thread.') }
    const thread = JSON.parse(create.body) as ThreadRecordJson

    const turnBody: Record<string, unknown> = {
      prompt: buildScheduleRuntimePrompt(settings, options.prompt),
      mode: options.mode
    }
    if (model) turnBody.model = model
    if (options.reasoningEffort) {
      turnBody.reasoningEffort = options.reasoningEffort
    }
    const turn = await this.deps.runtimeRequest(
      settings,
      `/v1/threads/${encodeURIComponent(thread.id)}/turns`,
      { method: 'POST', body: JSON.stringify(turnBody) }
    )
    if (!turn.ok) return { ok: false, message: runtimeErrorMessage(turn, 'Failed to start turn.') }

    const parsedTurn = parseJsonObject(turn.body)
    const turnId = asString(nestedRecord(parsedTurn?.turn).id) || asString(parsedTurn?.turnId)
    if (!turnId) {
      return { ok: false, message: 'Failed to start turn: missing turn id.' }
    }
    if (!options.waitForResult) {
      return { ok: true, threadId: thread.id, turnId, message: 'Started' }
    }

    const text = await this.waitForAssistantText(settings, thread.id, turnId, options.responseTimeoutMs, workspace)
    return { ok: true, threadId: thread.id, turnId, text, message: text || 'Completed' }
  }

  private async waitForAssistantText(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot?: string
  ): Promise<string> {
    void workspaceRoot
    const deadline = Date.now() + timeoutMs
    let lastText = ''
    while (Date.now() < deadline) {
      await sleep(1_500)
      const detailRes = await this.deps.runtimeRequest(
        settings,
        `/v1/threads/${encodeURIComponent(threadId)}`,
        { method: 'GET' }
      )
      if (!detailRes.ok) {
        throw new Error(runtimeErrorMessage(detailRes, 'Failed to read thread result.'))
      }
      const detail = JSON.parse(detailRes.body) as ThreadDetailJson
      lastText = latestAssistantText(detail, { turnId }) || lastText
      const targetTurn = Array.isArray(detail.turns)
        ? detail.turns.find((turn) => turn.id === turnId)
        : undefined
      if (!targetTurn) continue
      if (isRunningStatus(targetTurn.status)) continue
      if (targetTurn.status === 'failed' || targetTurn.status === 'aborted') {
        const error = targetTurn.error?.trim()
        throw new Error(error || `Agent turn ${targetTurn.status}.`)
      }
      if (targetTurn.status === 'completed' && lastText) return lastText
    }
    if (lastText) return lastText
    throw new Error('Timed out waiting for agent response.')
  }

  private resolveDefaultWorkspaceRoot(settings: AppSettingsV1): string {
    return settings.schedule.defaultWorkspaceRoot.trim() || settings.workspaceRoot
  }

  private syncInternalServer(settings: AppSettingsV1): void {
    const internal = settings.schedule.internal
    const key = `${internal.port}`
    if (this.server && this.serverKey === key) return
    this.closeInternalServer()

    const server = createServer((req, res) => {
      void this.handleInternalRequest(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('schedule-server', 'Schedule internal server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) {
        this.closeInternalServer()
      }
    })
    server.listen(internal.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  private closeInternalServer(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleInternalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith('/schedule/internal/')) {
        writeJson(res, 404, { ok: false, message: 'Not found.' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, message: 'Method not allowed.' })
        return
      }
      const secret = settings.schedule.internal.secret.trim()
      if (secret) {
        const auth = req.headers.authorization ?? ''
        const headerSecret = Array.isArray(req.headers['x-deepseek-gui-secret'])
          ? req.headers['x-deepseek-gui-secret'][0]
          : req.headers['x-deepseek-gui-secret']
        if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }

      if (url.pathname === '/schedule/internal/list') {
        const tasks = await this.listTasks()
        writeJson(res, 200, { ok: true, tasks })
        return
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
        return
      }

      if (url.pathname === '/schedule/internal/create') {
        const input = nestedRecord(payload.input)
        if (!input || Object.keys(input).length === 0) {
          writeJson(res, 400, { ok: false, message: 'Missing task input.' })
          return
        }
        const title = asString(input.title)
        const prompt = asString(input.prompt)
        const schedule = nestedRecord(input.schedule)
        const kind = asString(schedule.kind) as ScheduledTaskV1['schedule']['kind']
        if (!prompt || !kind) {
          writeJson(res, 400, { ok: false, message: 'Missing prompt or schedule.kind.' })
          return
        }
        const saved = await this.createTaskFromInput({
          title,
          prompt,
          workspaceRoot: asString(input.workspaceRoot) || undefined,
          model: asString(input.model) || undefined,
          reasoningEffort: (asString(input.reasoningEffort) as ScheduleReasoningEffort) || undefined,
          mode: (asString(input.mode) as ScheduleRunMode) || undefined,
          enabled: input.enabled === false ? false : true,
          schedule: {
            kind,
            everyMinutes: Number(schedule.everyMinutes),
            timeOfDay: asString(schedule.timeOfDay),
            atTime: asString(schedule.atTime)
          }
        })
        writeJson(res, 200, { ok: true, task: saved })
        return
      }

      if (url.pathname === '/schedule/internal/update') {
        const taskId = asString(payload.taskId)
        const patch = nestedRecord(payload.patch)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const updated = await this.updateTaskById(taskId, patch as Partial<ScheduledTaskV1>)
        if (!updated) {
          writeJson(res, 404, { ok: false, message: 'Task not found.' })
          return
        }
        writeJson(res, 200, { ok: true, task: updated })
        return
      }

      if (url.pathname === '/schedule/internal/delete') {
        const taskId = asString(payload.taskId)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const removed = await this.deleteTaskById(taskId)
        writeJson(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, message: 'Task not found.' })
        return
      }

      writeJson(res, 404, { ok: false, message: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-server', 'Schedule internal request failed', { message })
      writeJson(res, 500, { ok: false, message })
    }
  }

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const shouldKeepAwake =
      settings.schedule.keepAwake &&
      settings.schedule.enabled &&
      hasEnabledScheduledTask(settings)
    if (!shouldKeepAwake) {
      this.stopPowerSaveBlocker()
      return
    }
    if (this.isPowerSaveBlockerActive()) return
    const blocker = this.deps.powerSaveBlocker
    if (!blocker) return
    this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('schedule-power-save', 'Failed to stop power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private isPowerSaveBlockerActive(): boolean {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    if (!blocker || id == null) return false
    try {
      return blocker.isStarted(id)
    } catch {
      return false
    }
  }
}

export function createScheduleRuntime(deps: ScheduleRuntimeDeps): ScheduleRuntime {
  return new ScheduleRuntime(deps)
}
