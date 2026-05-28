import { dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  getActiveAgentRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawRunResult,
  type ClawTaskFromTextResult,
  type ClawRuntimeStatus
} from '../../shared/app-settings'
import type { DeepseekUpdateInfo, DeepseekUpdateInstallResult } from '../../shared/deepseek-update'
import type {
  ClawImInstallPollResult,
  ClawImInstallQrResult,
  DeepseekRuntimeDiagnosticIssue,
  DeepseekRuntimeDiagnosticsResult,
  RuntimeRequestResult,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult,
  WorkspacePickResult
} from '../../shared/ds-gui-api'
import type { GuiUpdateDownloadResult, GuiUpdateInfo, GuiUpdateInstallResult, GuiUpdateState } from '../../shared/gui-update'
import {
  clawMirrorPayloadSchema,
  clawImInstallPollPayloadSchema,
  clawTaskFromTextPayloadSchema,
  deepseekConfigContentSchema,
  defaultPathSchema,
  gitBranchPayloadSchema,
  guiUpdateChannelSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  openEditorPathPayloadSchema,
  rootPathSchema,
  runtimeRequestPayloadSchema,
  shellOpenExternalUrlSchema,
  skillSaveFilePayloadSchema,
  streamIdSchema,
  terminalCreateOptionsSchema,
  terminalInputPayloadSchema,
  terminalLifecyclePayloadSchema,
  terminalResizePayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  writeExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema,
  workspaceRootSchema
} from './app-ipc-schemas'
import type { JsonSettingsStore } from '../settings-store'
import { getRuntimeBaseUrl } from '../settings-store'
import type { ClawRuntime } from '../claw-runtime'
import { findListeningProcessOnPort } from '../deepseek-process'
import { createAndSwitchGitBranch, getGitBranches, switchGitBranch } from '../services/git-service'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  expandHomePath,
  listEditorsResult,
  listWorkspaceDirectory,
  normalizeSkillFolderName,
  openEditorPath,
  openPathWithShell,
  readWorkspaceImage,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  saveWorkspaceClipboardImage,
  writeWorkspaceFile
} from '../services/workspace-service'
import type { createTerminalService } from '../services/terminal-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import { copyWriteDocumentAsRichText, exportWriteDocument } from '../services/write-export-service'

type GuiUpdaterModule = typeof import('../gui-updater')
type TerminalService = ReturnType<typeof createTerminalService>

type WorkspaceFileWatchRecord = {
  watcher: FSWatcher
  sender: WebContents
  path: string
  workspaceRoot: string
  timer: ReturnType<typeof setTimeout> | null
}

type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  getMainWindow: () => BrowserWindow | null
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (
    path: string,
    method?: string,
    body?: string
  ) => Promise<RuntimeRequestResult>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawRuntime: () => ClawRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ClawImInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ClawImInstallPollResult>
  prepareDeepseekBinary: () => Promise<
    { ok: true; path: string } | { ok: false; message: string }
  >
  checkDeepseekUpdate: () => Promise<DeepseekUpdateInfo>
  installDeepseekUpdate: () => Promise<DeepseekUpdateInstallResult>
  resolveDeepseekConfigPath: () => string
  terminalService: TerminalService
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  readGuiUpdateState: () => Promise<GuiUpdateState>
  loadGuiUpdaterModule: () => Promise<GuiUpdaterModule>
  resolveLogDirectory: () => string
  logError: (category: string, message: string, detail?: unknown) => void
}

function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid payload for ${channel}: ${issue?.message ?? 'Bad request.'}`)
}

const settingsPatchSchema = z.object({}).passthrough()

function trimDiagnosticBody(body: string, max = 2_000): string {
  const text = body.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function detectTomlConfigIssues(path: string, content: string): DeepseekRuntimeDiagnosticIssue[] {
  const issues: DeepseekRuntimeDiagnosticIssue[] = []
  const tables = new Map<string, number>()
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^\[([^\][\r\n]+)\]\s*(?:#.*)?$/)
    if (!match) continue
    const tableName = match[1].trim()
    const firstLine = tables.get(tableName)
    if (typeof firstLine === 'number') {
      issues.push({
        severity: 'error',
        code: 'duplicate_toml_table',
        title: 'Duplicate TOML table',
        message: `[${tableName}] is declared again on line ${index + 1}. TOML tables can only be declared once; merge or remove the duplicate block.`,
        path,
        line: index + 1
      })
      continue
    }
    tables.set(tableName, index + 1)
  }

  return issues
}

async function probeRuntimeEndpoint(url: string): Promise<{
  ok: boolean
  status: number
  body: string
  message?: string
}> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return {
      ok: res.ok,
      status: res.status,
      body: trimDiagnosticBody(await res.text())
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function diagnoseDeepseekRuntime(
  options: Pick<RegisterAppIpcHandlersOptions, 'store' | 'prepareDeepseekBinary' | 'resolveDeepseekConfigPath'>
): Promise<DeepseekRuntimeDiagnosticsResult> {
  const settings = await options.store.load()
  const configPath = options.resolveDeepseekConfigPath()
  let configContent = ''
  let configExists = true
  try {
    configContent = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      configExists = false
    } else {
      throw error
    }
  }

  const configIssues = detectTomlConfigIssues(configPath, configContent)
  const binary = await options.prepareDeepseekBinary()
  const runtime = getActiveAgentRuntimeSettings(settings)
  const baseUrl = getRuntimeBaseUrl(runtime.port)
  const portOwner = await findListeningProcessOnPort(runtime.port)
  const health = await probeRuntimeEndpoint(`${baseUrl}/health`)
  const threadApi = health.ok
    ? await probeRuntimeEndpoint(`${baseUrl}/v1/threads?limit=1`)
    : null
  const issues: DeepseekRuntimeDiagnosticIssue[] = [...configIssues]

  if (!runtime.apiKey.trim() && !process.env.DEEPSEEK_API_KEY?.trim()) {
    issues.push({
      severity: 'error',
      code: 'missing_api_key',
      title: 'Missing DeepSeek API key',
      message: 'The GUI cannot auto-start the local runtime until a DeepSeek API key is configured.'
    })
  }

  if (!runtime.autoStart) {
    issues.push({
      severity: 'warning',
      code: 'auto_start_disabled',
      title: 'Automatic runtime startup is disabled',
      message: 'Enable auto-start or run `codewhale serve --http` manually before retrying the connection.'
    })
  }

  if (!binary.ok) {
    issues.push({
      severity: 'error',
      code: 'binary_unavailable',
      title: 'CodeWhale CLI is unavailable',
      message: binary.message
    })
  }

  if (!portOwner) {
    issues.push({
      severity: runtime.autoStart ? 'info' : 'warning',
      code: 'runtime_not_listening',
      title: 'No runtime is listening on the configured port',
      message: `Nothing is listening on ${baseUrl}. Retry will ask the GUI to start the managed runtime.`
    })
  } else if (!portOwner.command.toLowerCase().includes('deepseek')) {
    issues.push({
      severity: 'warning',
      code: 'port_owned_by_other_process',
      title: 'Configured port is owned by another process',
      message: `Port ${runtime.port} is currently owned by PID ${portOwner.pid}: ${portOwner.command}`
    })
  }

  if (health.ok && threadApi && !threadApi.ok) {
    issues.push({
      severity: threadApi.status === 401 ? 'error' : 'warning',
      code: threadApi.status === 401 ? 'runtime_auth_required' : 'thread_api_unavailable',
      title: threadApi.status === 401 ? 'Runtime token mismatch' : 'Thread API check failed',
      message: threadApi.body || threadApi.message || `Thread API returned ${threadApi.status}.`
    })
  }

  return {
    checkedAt: new Date().toISOString(),
    settings: {
      port: runtime.port,
      autoStart: runtime.autoStart,
      binaryPath: runtime.binaryPath,
      baseUrl: runtime.baseUrl,
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode,
      hasApiKey: Boolean(runtime.apiKey.trim() || process.env.DEEPSEEK_API_KEY?.trim()),
      hasRuntimeToken: Boolean(runtime.runtimeToken.trim())
    },
    binary,
    config: {
      path: configPath,
      exists: configExists,
      content: configContent,
      issues: configIssues
    },
    runtime: {
      baseUrl,
      portOwner,
      health,
      threadApi
    },
    issues
  }
}

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    runtimeRequest,
    fetchUpstreamModels,
    getClawRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    prepareDeepseekBinary,
    checkDeepseekUpdate,
    installDeepseekUpdate,
    resolveDeepseekConfigPath,
    terminalService,
    showTurnCompleteNotification,
    getAppVersion,
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    logError
  } = options
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()

  const disposeWorkspaceFileWatch = (watchId: string): boolean => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    return true
  }

  const disposeWorkspaceFileWatchesForSender = (sender: WebContents): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  const emitWorkspaceFileChange = async (watchId: string): Promise<void> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    const changedAt = new Date().toISOString()
    try {
      const result = await readWorkspaceFile({
        path: record.path,
        workspaceRoot: record.workspaceRoot
      })
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      if (result.ok) {
        latest.sender.send('file:workspace-changed', {
          ok: true,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: result.path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          changedAt
        })
        return
      }
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: result.message,
        changedAt
      })
    } catch (error) {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: error instanceof Error ? error.message : String(error),
        changedAt
      })
    }
  }

  const scheduleWorkspaceFileChange = (watchId: string): void => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest) return
      latest.timer = null
      void emitWorkspaceFileChange(watchId)
    }, 90)
  }

  ipcMain.handle('settings:get', async () => store.load())
  ipcMain.handle('settings:set', async (_, partial: unknown) =>
    applySettingsPatch(
      parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
    )
  )

  ipcMain.handle('runtime:request', async (_, payload: unknown) => {
    const request = parseIpcPayload('runtime:request', runtimeRequestPayloadSchema, payload)
    return runtimeRequest(request.path, request.method, request.body)
  })

  ipcMain.handle('upstream:models', async () => fetchUpstreamModels())

  ipcMain.handle('claw:status', async (): Promise<ClawRuntimeStatus> =>
    getClawRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  ipcMain.handle('claw:task:run', async (_, taskId: unknown): Promise<ClawRunResult> => {
    const normalizedTaskId = parseIpcPayload('claw:task:run', streamIdSchema, taskId)
    const clawRuntime = getClawRuntime()
    if (!clawRuntime) return { ok: false, message: 'Claw runtime is not initialized.' }
    return clawRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle(
    'claw:channel:mirror-to-feishu',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror-to-feishu', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToFeishu(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:task:create-from-text',
    async (_, payload: unknown): Promise<ClawTaskFromTextResult> => {
      const request = parseIpcPayload(
        'claw:task:create-from-text',
        clawTaskFromTextPayloadSchema,
        payload
      )
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { kind: 'error', message: 'Claw runtime is not initialized.' }
      return clawRuntime.createScheduledTaskFromText(request.text, {
        channelId: request.channelId,
        modelHint: request.modelHint,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'claw:im-install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:qrcode',
        z.object({ provider: z.literal('feishu'), isLark: z.boolean().optional() }).strict(),
        payload
      )
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  ipcMain.handle(
    'claw:im-install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:im-install:poll', clawImInstallPollPayloadSchema, payload)
      return pollFeishuInstall(request.deviceCode)
    }
  )

  ipcMain.handle('deepseek:prepare-binary', async () => prepareDeepseekBinary())
  ipcMain.handle('deepseek:update-check', async () => checkDeepseekUpdate())
  ipcMain.handle('deepseek:update-install', async () => installDeepseekUpdate())

  ipcMain.handle('workspace:pick-directory', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-directory',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select working directory',
      defaultPath: normalizedDefaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  ipcMain.handle(
    'skill:save-file',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('skill:save-file', skillSaveFilePayloadSchema, payload)
      try {
        const rootPath = expandHomePath(request.rootPath)
        if (!rootPath) {
          return { ok: false as const, message: 'Skill directory is required.' }
        }
        const skillName = normalizeSkillFolderName(request.skillName)
        const skillDir = join(rootPath, skillName)
        const filePath = join(skillDir, 'SKILL.md')
        await mkdir(skillDir, { recursive: true })
        await writeFile(filePath, request.content, 'utf8')
        return { ok: true as const, path: filePath }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('skill:open-root', async (_, rootPath: unknown) => {
    const normalizedRootPath = parseIpcPayload('skill:open-root', rootPathSchema, rootPath)
    try {
      const target = expandHomePath(normalizedRootPath)
      if (!target) {
        return { ok: false as const, message: 'Skill directory is required.' }
      }
      await mkdir(target, { recursive: true })
      return openPathWithShell(target)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('deepseek:config:read', async () => {
    const path = resolveDeepseekConfigPath()
    try {
      const content = await readFile(path, 'utf8')
      return { path, content, exists: true as const }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path, content: '', exists: false as const }
      }
      throw error
    }
  })

  ipcMain.handle('deepseek:config:write', async (_, content: unknown) => {
    const validatedContent = parseIpcPayload(
      'deepseek:config:write',
      deepseekConfigContentSchema,
      content
    )
    const path = resolveDeepseekConfigPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, validatedContent, 'utf8')
    return { ok: true as const, path }
  })

  ipcMain.handle('deepseek:config:open-dir', async () => {
    try {
      const path = resolveDeepseekConfigPath()
      const dirPath = dirname(path)
      await mkdir(dirPath, { recursive: true })
      return openPathWithShell(dirPath)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('deepseek:diagnostics', async () =>
    diagnoseDeepseekRuntime({ store, prepareDeepseekBinary, resolveDeepseekConfigPath })
  )

  ipcMain.handle('git:branches', async (_, workspaceRoot: unknown) =>
    getGitBranches(parseIpcPayload('git:branches', workspaceRootSchema, workspaceRoot))
  )
  ipcMain.handle(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return switchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return createAndSwitchGitBranch(request.workspaceRoot, request.branch)
    }
  )

  ipcMain.handle('editor:list', async () => listEditorsResult())
  ipcMain.handle('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

  ipcMain.handle('terminal:create', async (event, payload: unknown) =>
    terminalService.createTerminalSession(
      event.sender,
      parseIpcPayload('terminal:create', terminalCreateOptionsSchema, payload)
    )
  )
  ipcMain.handle('terminal:write', async (_, payload: unknown) =>
    terminalService.writeTerminalSession(
      parseIpcPayload('terminal:write', terminalInputPayloadSchema, payload)
    )
  )
  ipcMain.handle('terminal:resize', async (_, payload: unknown) =>
    terminalService.resizeTerminalSession(
      parseIpcPayload('terminal:resize', terminalResizePayloadSchema, payload)
    )
  )
  ipcMain.handle('terminal:close', async (_, payload: unknown) =>
    terminalService.closeTerminalSession(
      parseIpcPayload('terminal:close', terminalLifecyclePayloadSchema, payload)
    )
  )

  ipcMain.handle('file:resolve-workspace', async (_, payload: unknown) =>
    resolveWorkspaceFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:list-workspace-directory', async (_, payload: unknown) =>
    listWorkspaceDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace', async (_, payload: unknown) =>
    readWorkspaceFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-image', async (_, payload: unknown) =>
    readWorkspaceImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:write-workspace', async (_, payload: unknown) =>
    writeWorkspaceFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace', async (_, payload: unknown) =>
    createWorkspaceFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace-directory', async (_, payload: unknown) =>
    createWorkspaceDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    saveWorkspaceClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  ipcMain.handle('file:rename-workspace-entry', async (_, payload: unknown) =>
    renameWorkspaceEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:delete-workspace-entry', async (_, payload: unknown) =>
    deleteWorkspaceEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:watch-workspace', async (event, payload: unknown) => {
    const request = parseIpcPayload('file:watch-workspace', workspaceFileWatchPayloadSchema, payload)
    const initial = await readWorkspaceFile(request)
    let watchedPath: string
    let initialContent: string
    let initialSize: number
    let initialTruncated: boolean
    if (initial.ok) {
      watchedPath = initial.path
      initialContent = initial.content
      initialSize = initial.size
      initialTruncated = initial.truncated
    } else {
      const initialImage = await readWorkspaceImage(request)
      if (!initialImage.ok) return initial
      watchedPath = initialImage.path
      initialContent = ''
      initialSize = initialImage.size
      initialTruncated = false
    }

    const watchId = randomUUID()
    try {
      const watcher = watch(watchedPath, { persistent: false }, () => {
        scheduleWorkspaceFileChange(watchId)
      })
      workspaceFileWatchers.set(watchId, {
        watcher,
        sender: event.sender,
        path: watchedPath,
        workspaceRoot: request.workspaceRoot,
        timer: null
      })
      event.sender.once('destroyed', () => disposeWorkspaceFileWatchesForSender(event.sender))
      return {
        ok: true as const,
        watchId,
        path: watchedPath,
        content: initialContent,
        size: initialSize,
        truncated: initialTruncated,
        startedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('file:unwatch-workspace', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId))
  )
  ipcMain.handle('write:export', async (_, payload: unknown) =>
    exportWriteDocument(
      parseIpcPayload('write:export', writeExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('write:copy-rich-text', async (_, payload: unknown) =>
    copyWriteDocumentAsRichText(
      parseIpcPayload('write:copy-rich-text', writeRichClipboardPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await store.load(),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  ipcMain.handle('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  ipcMain.handle('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  ipcMain.handle('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  ipcMain.handle('app:version', async () => getAppVersion())
  ipcMain.handle('gui:update-state', async () => readGuiUpdateState())
  ipcMain.handle('gui:update-check', async (_, channel: unknown): Promise<GuiUpdateInfo> => {
    const module = await loadGuiUpdaterModule()
    return module.checkGuiUpdate(
      parseIpcPayload(
        'gui:update-check',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-download', async (_, channel: unknown): Promise<GuiUpdateDownloadResult> => {
    const module = await loadGuiUpdaterModule()
    return module.downloadGuiUpdate(
      parseIpcPayload(
        'gui:update-download',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-install', async (): Promise<GuiUpdateInstallResult> => {
    const module = await loadGuiUpdaterModule()
    return module.installGuiUpdate()
  })

  ipcMain.handle('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  ipcMain.handle('log:get-path', async () => resolveLogDirectory())
  ipcMain.handle('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })
}
