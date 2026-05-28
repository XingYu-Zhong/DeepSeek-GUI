import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { JsonSettingsStore, getRuntimeBaseUrl, devServerHintUrl } from './settings-store'
import deepseekLogoPng from '../asset/img/deepseek.png'
import {
  startDeepseekChild,
  stopDeepseekChild,
  stopDeepseekChildAndWait,
  waitForRuntimeHealth,
  isDeepseekChildRunning,
  reclaimDeepseekPort,
  inspectDeepseekLaunchConfig
} from './deepseek-process'
import { resolveDeepseekExecutable } from './resolve-deepseek-binary'
import {
  getActiveAgentRuntimeSettings,
  mergeClawSettings,
  mergeWriteSettings,
  normalizeAppSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import type { GuiUpdateChannel, GuiUpdateInfo, GuiUpdateState } from '../shared/gui-update'
import { isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { fetchUpstreamModelIds } from './upstream-models'
import {
  checkDeepseekTuiUpdate,
  installDeepseekTuiUpdatePackage
} from './deepseek-updater'
import { getActiveRuntimeAdapter } from './runtime/runtime-host'
import { deepseekTuiConfigChanged, syncDeepseekTuiConfig } from './deepseek-config'
import { configureLogger, logError, logWarn, pruneOnStartup } from './logger'
import { createClawRuntime, type ClawRuntime } from './claw-runtime'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import {
  clawScheduleMcpSettingsChanged,
  resolveDeepseekConfigPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { sseStartPayloadSchema, streamIdSchema } from './ipc/app-ipc-schemas'
import { createTerminalService } from './services/terminal-service'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_USER_MODEL_ID = 'com.xingyuzhong.deepseekgui'
const startupTraceEnabled = process.env.DEEPSEEK_GUI_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function traceStartup(label: string, detail?: unknown): void {
  if (!startupTraceEnabled) return
  const elapsed = String(Date.now() - startupTraceStart).padStart(6, ' ')
  if (detail === undefined) {
    console.info(`[startup +${elapsed}ms] ${label}`)
  } else {
    console.info(`[startup +${elapsed}ms] ${label}`, detail)
  }
}

const runningClawScheduleMcpServer = process.argv.includes('--claw-schedule-mcp-server')

traceStartup('main module evaluated')

if (runningClawScheduleMcpServer && process.platform === 'darwin') {
  app.dock.hide()
}

if (!runningClawScheduleMcpServer && process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null
let store: JsonSettingsStore
let logDir = ''
let clawRuntime: ClawRuntime | null = null
const terminalService = createTerminalService()

type GuiUpdaterModule = typeof import('./gui-updater')

let guiUpdaterModulePromise: Promise<GuiUpdaterModule> | null = null
let guiUpdaterInitialized = false

function emitClawChannelActivity(payload: { channelId: string; threadId: string }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('claw:channel-activity', payload)
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel
          )
          guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        guiUpdaterModulePromise = null
        throw error
      })
  }
  return guiUpdaterModulePromise
}

async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!guiUpdaterModulePromise) return { status: 'idle' }
  try {
    const module = await loadGuiUpdaterModule()
    return module.getGuiUpdateState()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'unknown'
    }
  }
}

type ClawPlatformInstallStartResult =
  | { ok: true; url: string; deviceCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }

type ClawPlatformInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: false; error?: string }

let feishuInstallIsLark = false

function resolveLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

function resolvePreloadPath(): string {
  const cjsPath = join(__dirname, '../preload/index.cjs')
  if (existsSync(cjsPath)) return cjsPath
  return join(__dirname, '../preload/index.mjs')
}

function getClawScheduleMcpLaunchConfig(): ClawScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function recordString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function readJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return asRecord(JSON.parse(text) as unknown)
  } catch {
    return { message: text.trim() || res.statusText }
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(recordString(data, 'errmsg') || recordString(data, 'message') || `HTTP ${res.status}`)
  }
  return data
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(recordString(data, 'error_description') || recordString(data, 'message') || `HTTP ${res.status}`)
  }
  return data
}

async function postFormResult(
  url: string,
  body: Record<string, string>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000)
  })
  const data = await readJsonResponse(res)
  return { ok: res.ok, status: res.status, data }
}

function normalizeIntervalSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(3, Math.floor(parsed)) : fallback
}

async function startFeishuInstallQrcode(isLark: boolean): Promise<ClawPlatformInstallStartResult> {
  try {
    const baseUrl = isLark ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn'
    feishuInstallIsLark = isLark
    await postForm(`${baseUrl}/oauth/v1/app/registration`, { action: 'init' })
    const data = await postForm(`${baseUrl}/oauth/v1/app/registration`, {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id'
    })
    const url = recordString(data, 'verification_uri_complete')
    const deviceCode = recordString(data, 'device_code')
    if (!url || !deviceCode) {
      throw new Error(recordString(data, 'error_description') || recordString(data, 'message') || 'Feishu QR response is incomplete.')
    }
    return {
      ok: true,
      url,
      deviceCode,
      interval: normalizeIntervalSeconds(data.interval, 5),
      expireIn: normalizeIntervalSeconds(data.expire_in ?? data.expires_in, 300)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function pollFeishuInstall(deviceCode: string): Promise<ClawPlatformInstallPollResult> {
  try {
    const baseUrl = feishuInstallIsLark ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn'
    const result = await postFormResult(`${baseUrl}/oauth/v1/app/registration`, {
      action: 'poll',
      device_code: deviceCode
    })
    const data = result.data
    const error = recordString(data, 'error')
    if (error) {
      if (error === 'authorization_pending' || error === 'slow_down') return { done: false }
      return { done: false, error: recordString(data, 'error_description') || error }
    }
    if (!result.ok) {
      return {
        done: false,
        error: recordString(data, 'error_description') || recordString(data, 'message') || `HTTP ${result.status}`
      }
    }
    const appId = recordString(data, 'client_id')
    const appSecret = recordString(data, 'client_secret')
    if (appId && appSecret) {
      const userInfo = asRecord(data.user_info)
      const domain = recordString(userInfo, 'tenant_brand') === 'lark' ? 'lark' : 'feishu'
      return { done: true, kind: 'feishu', appId, appSecret, domain }
    }
    return { done: false }
  } catch (error) {
    return { done: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function installDevPreviewWebviewGuards(): void {
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      if (!isAllowedDevPreviewUrl(src)) {
        event.preventDefault()
        return
      }

      delete webPreferences.preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (contents.getType() !== 'webview') return
      if (!isAllowedDevPreviewUrl(navigationUrl)) event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() !== 'webview') return { action: 'allow' }
      return isAllowedDevPreviewUrl(url) ? { action: 'allow' } : { action: 'deny' }
    })
  })
}

type SseControllerState = {
  controller: AbortController
  stoppedByClient: boolean
}

type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

const sseControllers = new Map<string, SseControllerState>()

function createAppIcon(source: string): Electron.NativeImage {
  return source.startsWith('data:')
    ? nativeImage.createFromDataURL(source)
    : nativeImage.createFromPath(source)
}

const appIcon = createAppIcon(deepseekLogoPng)
traceStartup('app icon loaded', { source: deepseekLogoPng.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function revealMainWindow(): void {
  if (!mainWindow) {
    createWindow()
  }
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  if (!settings.notifications.turnComplete) {
    return { ok: true, shown: false, reason: 'disabled' }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const title = normalizeNotificationText(payload.title, 'DeepSeek GUI', 80)
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      icon: appIcon.isEmpty() ? undefined : appIcon
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}

function normalizeGithubOwnerRepo(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('github:')) {
    s = s.slice('github:'.length).trim()
  }
  const ssh = s.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)
  if (ssh?.[1]) {
    return ssh[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  }
  const https = s.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:$|[#/])/i)
  if (https?.[1]) {
    return https[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s
  return null
}

function resolveGuiReleaseRepo(): string | null {
  const fromEnv = normalizeGithubOwnerRepo(process.env.DEEPSEEK_GUI_GITHUB_REPO?.trim() ?? '')
  if (fromEnv) return fromEnv
  try {
    const pkgPath = join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      repository?: string | { url?: string }
    }
    const raw =
      typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    if (!raw?.trim()) return null
    return normalizeGithubOwnerRepo(raw)
  } catch {
    return null
  }
}

if (!runningClawScheduleMcpServer && !gotSingleInstanceLock) {
  app.quit()
}

function runtimeFailure(error: string, message: string, status = 0) {
  return {
    ok: false as const,
    status,
    body: JSON.stringify({ error, message })
  }
}

function resolveConfiguredApiKey(settings: AppSettingsV1): string {
  const fromSettings = getActiveAgentRuntimeSettings(settings).apiKey?.trim() ?? ''
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
  return fromSettings || fromEnv
}

function runtimeJsonError(error: string, message: string): Error {
  return new Error(JSON.stringify({ error, message }))
}

function parseRuntimeErrorBody(body: string): { error?: string; message: string } {
  const fallback = body.trim() || 'The local runtime returned an unexpected error.'
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string; status?: number }
      message?: string
    }
    const nested =
      parsed.error && typeof parsed.error === 'object' ? parsed.error.message?.trim() ?? '' : ''
    const topLevel =
      typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : undefined
    const message =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : nested || topLevel || fallback
    return { ...(topLevel ? { error: topLevel } : {}), message }
  } catch {
    return { message: fallback }
  }
}

function parseVersionParts(v: string): number[] {
  // Strip leading "v" and everything after the first "-" (pre-release suffix)
  const cleaned = v.trim().replace(/^v/i, '').replace(/-.*$/, '')
  return cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function isVersionGreater(latest: string, current: string): boolean {
  const a = parseVersionParts(latest)
  const b = parseVersionParts(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}

/** Tag looks like a stable semver (v1.2.3 or 0.1.0.1), not 1.0.0-beta.1 */
function isStableSemverTag(tag: string): boolean {
  const ver = tag.trim().replace(/^v/i, '')
  if (!ver) return false
  return /^\d+(\.\d+)*$/.test(ver)
}

type GitHubReleaseRow = {
  tag_name?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

async function checkGuiUpdateFromGitHub(currentVersion: string): Promise<GuiUpdateInfo> {
  const guiReleaseRepo = resolveGuiReleaseRepo()
  const channel: GuiUpdateChannel = 'stable'
  if (!guiReleaseRepo) {
    return {
      ok: false,
      currentVersion,
      message: '',
      code: 'not_configured'
    }
  }

  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || ''
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `deepseek-gui/${currentVersion}`
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const readGithubError = async (res: Response): Promise<string> => {
    try {
      const body = (await res.json()) as { message?: string; documentation_url?: string }
      const msg = body.message?.trim()
      if (msg) return `${msg} (${res.status})`
    } catch {
      /* ignore */
    }
    return `GitHub API ${res.status} ${res.statusText}`.trim()
  }

  const fetchJson = async <T>(
    url: string
  ): Promise<
    { ok: true; data: T; status: number } | { ok: false; message: string; status: number }
  > => {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        return { ok: false, message: await readGithubError(res), status: res.status }
      }
      return { ok: true, data: (await res.json()) as T, status: res.status }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        status: 0
      }
    }
  }

  const classifyRepoError = (
    msg: string,
    status: number
  ): Pick<Extract<GuiUpdateInfo, { ok: false }>, 'code' | 'message' | 'repo'> => {
    if (status === 404 || /\(404\)/.test(msg)) {
      return {
        code: 'github_repo_not_found',
        message: msg,
        repo: guiReleaseRepo
      }
    }
    if (status === 429 || /\(429\)/.test(msg)) {
      return { code: 'github_rate_limited', message: msg }
    }
    if (status === 403 || /\(403\)/.test(msg)) {
      return { code: 'github_forbidden', message: msg }
    }
    return { code: 'unknown', message: msg }
  }

  const releasesUrl = `https://api.github.com/repos/${guiReleaseRepo}/releases?per_page=40`

  try {
    const repoProbe = await fetchJson<unknown>(`https://api.github.com/repos/${guiReleaseRepo}`)
    if (!repoProbe.ok) {
      return {
        ok: false,
        currentVersion,
        ...classifyRepoError(repoProbe.message, repoProbe.status)
      }
    }

    const relResult = await fetchJson<GitHubReleaseRow[]>(releasesUrl)
    if (!relResult.ok) {
      return {
        ok: false,
        currentVersion,
        ...classifyRepoError(relResult.message, relResult.status)
      }
    }

    const releases = relResult.data

    const fromReleases = releases.find(
      (r) =>
        r.tag_name?.trim() &&
        !r.draft &&
        !r.prerelease &&
        isStableSemverTag(r.tag_name)
    )

    let latestVersion = ''
    let releaseUrl = `https://github.com/${guiReleaseRepo}/releases`

    if (fromReleases?.tag_name?.trim()) {
      latestVersion = fromReleases.tag_name.trim()
      releaseUrl =
        (fromReleases.html_url ?? '').trim() ||
        `https://github.com/${guiReleaseRepo}/releases/tag/${encodeURIComponent(latestVersion)}`
    } else {
      const tagsUrl = `https://api.github.com/repos/${guiReleaseRepo}/tags?per_page=40`
      const tagsResult = await fetchJson<Array<{ name?: string }>>(tagsUrl)
      if (!tagsResult.ok) {
        return {
          ok: false,
          currentVersion,
          ...classifyRepoError(tagsResult.message, tagsResult.status)
        }
      }

      let best: string | null = null
      for (const row of tagsResult.data) {
        const name = row.name?.trim()
        if (!name || !isStableSemverTag(name)) continue
        if (!best || isVersionGreater(name, best)) best = name
      }

      if (!best) {
        return {
          ok: false,
          currentVersion,
          message: `Repository: ${guiReleaseRepo}`,
          code: 'no_stable_version'
        }
      }

      latestVersion = best
      releaseUrl = `https://github.com/${guiReleaseRepo}/tree/${encodeURIComponent(best)}`
    }

    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        message: '',
        code: 'no_stable_version',
        repo: guiReleaseRepo
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isVersionGreater(latestVersion, currentVersion),
      releaseUrl,
      channel
    }
  } catch (e) {
    return {
      ok: false,
      currentVersion,
      code: 'unknown',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

async function probeThreadApi(settings: AppSettingsV1): Promise<
  | { ok: true }
  | { ok: false; error: string; message: string }
> {
  const runtime = getActiveAgentRuntimeSettings(settings)
  const base = getRuntimeBaseUrl(runtime.port)
  const headers = new Headers({ Accept: 'application/json' })
  const runtimeToken = runtime.runtimeToken?.trim() ?? ''
  if (runtimeToken) {
    headers.set('Authorization', `Bearer ${runtimeToken}`)
  }

  try {
    const res = await fetch(`${base}/v1/threads?limit=1`, {
      headers,
      signal: AbortSignal.timeout(2_000)
    })
    if (res.ok) return { ok: true }
    const info = parseRuntimeErrorBody(await res.text())
    if (res.status === 401 && /bearer token required/i.test(info.message)) {
      return {
        ok: false,
        error: 'runtime_auth_required',
        message: 'The local runtime requires a bearer token for thread APIs.'
      }
    }
    return {
      ok: false,
      error: info.error ?? 'runtime_request_failed',
      message: info.message
    }
  } catch (e) {
    return {
      ok: false,
      error: 'fetch_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

function parseSseData(raw: string): unknown | null {
  const lines = raw.split('\n')
  const dataLines: string[] = []
  for (const line of lines) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized.startsWith('data:')) {
      dataLines.push(normalized.slice(5).trimStart())
    }
  }
  if (!dataLines.length) return null
  const payload = dataLines.join('\n')
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function takeSseBlock(buffer: string): { block: string; rest: string } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return {
      block: buffer.slice(0, crlf),
      rest: buffer.slice(crlf + 4)
    }
  }
  return {
    block: buffer.slice(0, lf),
    rest: buffer.slice(lf + 2)
  }
}

let runtimeEnsurePromise: Promise<void> | null = null
let runtimeSettingsApplyPromise: Promise<void> | null = null

function queueRuntimeSettingsApply(prev: AppSettingsV1, next: AppSettingsV1): void {
  if (!deepseekTuiConfigChanged(prev, next) && !runtimeStartupConfigChanged(prev, next)) {
    return
  }

  const previousTask = runtimeSettingsApplyPromise ?? Promise.resolve()
  const task = previousTask
    .catch(() => undefined)
    .then(async () => {
      if (deepseekTuiConfigChanged(prev, next)) {
        await syncDeepseekTuiConfig(next, prev)
      }
      await restartManagedRuntimeForSettingsChange(prev, next)
    })
    .catch((error: unknown) => {
      logWarn('settings-apply', 'Failed to apply DeepSeek runtime settings in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (runtimeSettingsApplyPromise === task) {
        runtimeSettingsApplyPromise = null
      }
    })

  runtimeSettingsApplyPromise = task
}

async function waitForQueuedRuntimeSettingsApply(): Promise<void> {
  if (!runtimeSettingsApplyPromise) return
  await runtimeSettingsApplyPromise
}

async function ensureRuntime(settings: AppSettingsV1): Promise<void> {
  if (runtimeEnsurePromise) return runtimeEnsurePromise
  runtimeEnsurePromise = ensureRuntimeOnce(settings).finally(() => {
    runtimeEnsurePromise = null
  })
  return runtimeEnsurePromise
}

async function ensureRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  await waitForQueuedRuntimeSettingsApply()

  const runtime = getActiveAgentRuntimeSettings(settings)
  const hasApiKey = Boolean(resolveConfiguredApiKey(settings))
  const runtimeToken = runtime.runtimeToken?.trim() ?? ''
  const healthy = await waitForRuntimeHealth(runtime.port, 2000)

  if (healthy) {
    const threadApi = await probeThreadApi(settings)
    if (threadApi.ok) {
      if (!isDeepseekChildRunning() && runtime.autoStart && hasApiKey) {
        const launch = await inspectDeepseekLaunchConfig(settings)
        if (launch.state === 'deepseek' && !launch.matches) {
          console.warn(
            `[deepseek-gui] restarting runtime on port ${runtime.port}; launch config mismatch: ${launch.reason}`
          )
          const reclaimed = await reclaimDeepseekPort(runtime.port)
          if (!reclaimed.ok) {
            throw runtimeJsonError('runtime_port_conflict', reclaimed.message)
          }
        } else {
          return
        }
      } else {
        return
      }
    }

    if (!threadApi.ok) {
      const canReclaimConflictingRuntime =
        threadApi.error === 'runtime_auth_required' &&
        !runtimeToken &&
        runtime.autoStart &&
        hasApiKey

      if (!canReclaimConflictingRuntime) {
        throw runtimeJsonError(threadApi.error, threadApi.message)
      }

      const reclaimed = await reclaimDeepseekPort(runtime.port)
      if (!reclaimed.ok) {
        throw runtimeJsonError('runtime_port_conflict', reclaimed.message)
      }
    }
  } else {
    if (!hasApiKey) {
      throw runtimeJsonError(
        'missing_api_key',
        'DeepSeek API Key is required before the GUI can start the local runtime.'
      )
    }
    if (!runtime.autoStart) {
      throw runtimeJsonError(
        'runtime_offline',
        'The local runtime is offline. Enable automatic startup in Settings, or start `codewhale serve --http` manually.'
      )
    }
  }

  if (!hasApiKey) {
    throw runtimeJsonError(
      'missing_api_key',
      'DeepSeek API Key is required before the GUI can start the local runtime.'
    )
  }
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'The local runtime is offline. Enable automatic startup in Settings, or start `codewhale serve --http` manually.'
    )
  }
  const adapter = getActiveRuntimeAdapter(settings)
  await adapter.syncConfig(settings)
  try {
    await adapter.ensureRunning(settings)
  } catch (e) {
    console.error('[deepseek-gui] failed to start deepseek:', e)
    throw e
  }
  const started = await waitForRuntimeHealth(runtime.port, 20_000)
  if (!started) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'The local runtime did not become healthy after launch.'
    )
  }

  const threadApi = await probeThreadApi(settings)
  if (!threadApi.ok) {
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }
}

function createWindow(): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 14 } : undefined,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[deepseek-gui] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', { preloadPath, message })
  })
  const showWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
  }
  mainWindow.on('closed', () => {
    terminalService.disposeTerminalSessionsForWindow(mainWindow?.id ?? -1)
    mainWindow = null
  })
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame && mainWindow) {
      terminalService.disposeTerminalSessionsForWindow(mainWindow.id)
    }
  })
  const devUrl = devServerHintUrl()
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.once('ready-to-show', () => {
    traceStartup('window:ready-to-show')
    showWindow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    traceStartup('window:did-finish-load')
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

function deepseekLaunchConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = prev.agents.codewhale
  const b = next.agents.codewhale
  return (
    a.binaryPath !== b.binaryPath ||
    a.port !== b.port ||
    a.autoStart !== b.autoStart ||
    a.apiKey !== b.apiKey ||
    a.baseUrl !== b.baseUrl ||
    a.runtimeToken !== b.runtimeToken ||
    a.approvalPolicy !== b.approvalPolicy ||
    a.sandboxMode !== b.sandboxMode ||
    JSON.stringify(a.extraCorsOrigins) !== JSON.stringify(b.extraCorsOrigins)
  )
}

function runtimeStartupConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return deepseekLaunchConfigChanged(prev, next) || clawScheduleMcpSettingsChanged(prev, next)
}

async function restartManagedRuntimeForSettingsChange(
  prev: AppSettingsV1,
  next: AppSettingsV1
): Promise<void> {
  if (!runtimeStartupConfigChanged(prev, next) || !isDeepseekChildRunning()) return

  const samePort = prev.agents.codewhale.port === next.agents.codewhale.port
  await stopDeepseekChildAndWait()

  if (samePort) {
    const reclaimed = await reclaimDeepseekPort(prev.agents.codewhale.port)
    if (!reclaimed.ok) {
      console.warn('[deepseek-gui] runtime restart skipped:', reclaimed.message)
      return
    }
  }

  if (!resolveConfiguredApiKey(next) || !next.agents.codewhale.autoStart) {
    return
  }

  try {
    await startDeepseekChild(next)
    const healthy = await waitForRuntimeHealth(next.agents.codewhale.port, 20_000)
    if (!healthy) {
      console.warn('[deepseek-gui] runtime restart did not become healthy after settings change')
    }
  } catch (e) {
    console.warn('[deepseek-gui] runtime restart failed after settings change:', e)
  }
}

async function runtimeRequest(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    await ensureRuntime(settings)
    const runtime = getActiveAgentRuntimeSettings(settings)
    const base = getRuntimeBaseUrl(runtime.port)
    const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
    const url = `${base}${pathNorm}`
    const hdrs = new Headers(init.headers ?? {})
    hdrs.set('Accept', 'application/json')
    if (init.body && !hdrs.has('Content-Type')) {
      hdrs.set('Content-Type', 'application/json')
    }
    if (runtime.runtimeToken) {
      hdrs.set('Authorization', `Bearer ${runtime.runtimeToken}`)
    }
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: hdrs,
      body: init.body,
      signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, body: text }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('runtime-request', `HTTP request to ${pathAndQuery} failed`, { message })
    try {
      const parsed = JSON.parse(message) as { error?: string; message?: string }
      if (parsed.error || parsed.message) {
        return runtimeFailure(parsed.error ?? 'runtime_request_failed', parsed.message ?? message)
      }
    } catch {
      /* use generic fallback below */
    }
    return runtimeFailure('fetch_failed', message)
  }
}

if (runningClawScheduleMcpServer) {
  void runClawScheduleMcpServerFromArgv(process.argv).catch((error) => {
    console.error('[claw-schedule-mcp] server failed:', error)
    process.exit(1)
  })
} else {
app.whenReady().then(async () => {
  traceStartup('app.whenReady:start')
  if (!gotSingleInstanceLock) return

  traceStartup('install webview guards:start')
  installDevPreviewWebviewGuards()
  traceStartup('install webview guards:done')

  if (process.platform === 'darwin' && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon)
  }

  store = new JsonSettingsStore(app.getPath('userData'))
  traceStartup('settings load:start')
  const initial = await store.load()
  traceStartup('settings load:done')
  await syncClawScheduleMcpConfig(initial, getClawScheduleMcpLaunchConfig()).catch((error) => {
    console.error('[claw-schedule-mcp] failed to sync config on startup:', error)
  })

  logDir = resolveLogDirectory()
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  clawRuntime = createClawRuntime({ store, runtimeRequest, logError, notifyChannelActivity: emitClawChannelActivity })
  clawRuntime.sync(initial)

  traceStartup('ipc registration:start')
  const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const prev = await store.load()
    const next = normalizeAppSettings({
      ...prev,
      ...partial,
      agents: {
        codewhale: {
          ...prev.agents.codewhale,
          ...(partial.agents?.codewhale ?? {})
        }
      },
      log: { ...prev.log, ...(partial.log ?? {}) },
      notifications: { ...prev.notifications, ...(partial.notifications ?? {}) },
      write: mergeWriteSettings(prev.write, partial.write),
      claw: mergeClawSettings(prev.claw, partial.claw),
      guiUpdate: { ...prev.guiUpdate, ...(partial.guiUpdate ?? {}) },
      agentProvider: partial.agentProvider ?? prev.agentProvider
    })
    if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
      configureLogger({ enabled: next.log.enabled, retentionDays: next.log.retentionDays })
    }
    const saved = await store.patch(partial)
    await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
    })
    if (prev.guiUpdate.channel !== saved.guiUpdate.channel && guiUpdaterModulePromise) {
      void guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
    }
    queueRuntimeSettingsApply(prev, saved)
    clawRuntime?.sync(saved)
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    const key = resolveConfiguredApiKey(settings)
    return fetchUpstreamModelIds(settings, key)
  }

  const prepareDeepseekBinary = async () => {
    const settings = await store.load()
    try {
      const pathToBin = await resolveDeepseekExecutable(getActiveAgentRuntimeSettings(settings).binaryPath)
      return { ok: true as const, path: pathToBin }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('deepseek-binary', 'Failed to resolve deepseek executable', { message })
      return {
        ok: false as const,
        message
      }
    }
  }

  const checkDeepseekUpdateForSettings = async () => {
    const settings = await store.load()
    return checkDeepseekTuiUpdate(getActiveAgentRuntimeSettings(settings).binaryPath)
  }

  const installDeepseekUpdateForSettings = async () => {
    const settings = await store.load()
    const installed = await installDeepseekTuiUpdatePackage(getActiveAgentRuntimeSettings(settings).binaryPath)
    if (!installed.ok) return installed

    let restarted = false
    let healthy = false
    if (isDeepseekChildRunning()) {
      restarted = true
      await stopDeepseekChildAndWait()
      if (resolveConfiguredApiKey(settings) && getActiveAgentRuntimeSettings(settings).autoStart) {
        try {
          await startDeepseekChild(settings)
          healthy = await waitForRuntimeHealth(getActiveAgentRuntimeSettings(settings).port, 20_000)
        } catch (error) {
          console.warn('[deepseek-gui] runtime restart failed after deepseek-tui update:', error)
        }
      }
    }

    return {
      ok: true as const,
      version: installed.version,
      binaryPath: installed.binaryPath,
      restarted,
      healthy
    }
  }

  registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    runtimeRequest: async (path, method, body) => {
      const settings = await store.load()
      return runtimeRequest(settings, path, { method, body })
    },
    fetchUpstreamModels: fetchModels,
    getClawRuntime: () => clawRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    prepareDeepseekBinary,
    checkDeepseekUpdate: checkDeepseekUpdateForSettings,
    installDeepseekUpdate: installDeepseekUpdateForSettings,
    resolveDeepseekConfigPath,
    terminalService,
    showTurnCompleteNotification,
    getAppVersion: () => app.getVersion(),
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    logError
  })

  void loadGuiUpdaterModule().catch((error) => {
    console.warn('[deepseek-gui updater] failed to initialize on startup:', error)
  })

  ipcMain.handle('deepseek:spawn-if-needed', async () => {
    const s = await store.load()
    if (!resolveConfiguredApiKey(s)) {
      return {
        started: false,
        healthy: false,
        error: 'missing_api_key',
        message: 'DeepSeek API Key is required before starting the local runtime.'
      }
    }
    try {
      await ensureRuntime(s)
    } catch (e) {
      console.error('[deepseek-gui] spawn:', e)
      logError('deepseek-spawn', 'Failed to start deepseek runtime', { message: e instanceof Error ? e.message : String(e) })
      return {
        started: false,
        healthy: false,
        error: 'spawn_failed',
        message: e instanceof Error ? e.message : String(e)
      }
    }
    const ok = await waitForRuntimeHealth(getActiveAgentRuntimeSettings(s).port, 2_000)
    return { started: true, healthy: ok, pid: isDeepseekChildRunning() }
  })

  ipcMain.handle('runtime:sse:start', async (event, args: unknown) => {
    const request = sseStartPayloadSchema.parse(args)
    const s = await store.load()
    await ensureRuntime(s)
    const requestedId = request.streamId?.trim() ?? ''
    const id = requestedId || randomUUID()
    const existing = sseControllers.get(id)
    if (existing) {
      existing.stoppedByClient = true
      existing.controller.abort()
      sseControllers.delete(id)
    }
    const ac = new AbortController()
    const state: SseControllerState = { controller: ac, stoppedByClient: false }
    sseControllers.set(id, state)
    const runtime = getActiveAgentRuntimeSettings(s)
    const base = getRuntimeBaseUrl(runtime.port)
    const token = runtime.runtimeToken
    const u = `${base}/v1/threads/${encodeURIComponent(request.threadId)}/events?since_seq=${request.sinceSeq}`
    const url = new URL(u)
    if (token) url.searchParams.set('token', token)

    ;(async () => {
      const wc = event.sender
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (token) headers.Authorization = `Bearer ${token}`
      try {
        const res = await fetch(url, { signal: ac.signal, headers })
        if (!res.ok || !res.body) {
          wc.send('runtime:sse-error', { streamId: id, status: res.status })
          logError('sse', `SSE connection failed for thread ${request.threadId}`, { status: res.status, streamId: id })
          return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += dec.decode(value, { stream: true })
          let next: { block: string; rest: string } | null
          while ((next = takeSseBlock(buffer)) !== null) {
            const block = next.block
            buffer = next.rest
            const parsed = parseSseData(block)
            if (parsed !== null) {
              wc.send('runtime:sse-event', { streamId: id, data: parsed })
            }
          }
        }
        buffer += dec.decode()
        const trailing = buffer.trim()
        if (trailing) {
          const parsed = parseSseData(trailing)
          if (parsed !== null) {
            wc.send('runtime:sse-event', { streamId: id, data: parsed })
          }
        }
        if (!state.stoppedByClient && !ac.signal.aborted) {
          wc.send('runtime:sse-end', { streamId: id })
        }
      } catch (e) {
        if (state.stoppedByClient || ac.signal.aborted) {
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        wc.send('runtime:sse-error', { streamId: id, message: msg })
        logError('sse', `SSE stream error for thread ${request.threadId}`, { message: msg, streamId: id })
      } finally {
        sseControllers.delete(id)
      }
    })()

    return { streamId: id }
  })

  ipcMain.handle('runtime:sse:stop', async (_, streamId: unknown) => {
    const normalizedStreamId = streamIdSchema.parse(streamId)
    const state = sseControllers.get(normalizedStreamId)
    if (state) {
      state.stoppedByClient = true
      state.controller.abort()
    }
    return true
  })
  traceStartup('ipc registration:done')

  createWindow()
  traceStartup('createWindow:returned')

  void pruneOnStartup().catch((err) => {
    console.warn('[deepseek-gui] prune logs:', err)
  })

  if (resolveConfiguredApiKey(initial)) {
    setTimeout(() => {
      void resolveDeepseekExecutable(getActiveAgentRuntimeSettings(initial).binaryPath).catch((err) => {
        console.warn('[deepseek-gui] prewarm binary:', err)
      })
    }, 1500)
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[deepseek-gui] startup failed:', error)
  dialog.showErrorBox('DeepSeek GUI failed to start', message)
  app.quit()
})
}

app.on('window-all-closed', () => {
  stopDeepseekChild()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  clawRuntime?.stop()
  stopDeepseekChild()
})
