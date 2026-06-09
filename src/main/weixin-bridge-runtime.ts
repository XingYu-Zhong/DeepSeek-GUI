import { app } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, join } from 'node:path'
import { DEFAULT_WEIXIN_BRIDGE_RPC_URL } from '../shared/app-settings'
import { logError, logInfo, logWarn } from './logger'

const requireFromHere = createRequire(import.meta.url)
const WEIXIN_BRIDGE_PORT = 18790
const WEIXIN_BRIDGE_MAX_PORT_ATTEMPTS = 20
const WEIXIN_BRIDGE_HEALTH_TIMEOUT_MS = 3_000
const WEIXIN_BRIDGE_STATE_DIR_NAME = 'weixin-bridge'
const WEIXIN_PLUGIN_ID = 'openclaw-weixin'
const WEIXIN_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const WEIXIN_DEFAULT_BOT_TYPE = '3'
const LOGIN_TTL_MS = 5 * 60_000
const QR_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_API_TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 2_000
const BACKOFF_DELAY_MS = 30_000
const MessageType = {
  BOT: 2
} as const
const MessageItemType = {
  TEXT: 1,
  VOICE: 3
} as const
const MessageState = {
  FINISH: 2
} as const

type JsonRecord = Record<string, unknown>

type WeixinBridgeRuntimeContext = {
  webhookUrl: string
  webhookSecret: string
  channelId: string
}

type WeixinPackageInfo = {
  version: string
  appId: string
}

type WeixinLoginSession = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  currentApiBaseUrl?: string
}

type WeixinAccountData = {
  token?: string
  baseUrl?: string
  userId?: string
}

type WeixinAccount = {
  accountId: string
  baseUrl: string
  cdnBaseUrl: string
  token?: string
  configured: boolean
  userId?: string
}

type WeixinMessageItem = {
  type?: number
  text_item?: { text?: unknown }
  voice_item?: { text?: unknown }
}

type WeixinMessage = {
  message_id?: string
  message_type?: number
  from_user_id?: string
  create_time_ms?: number
  context_token?: string
  item_list?: WeixinMessageItem[]
}

type WeixinMonitor = {
  accountId: string
  controller: AbortController
  promise: Promise<void>
}

export type WeixinBridgeSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

let server: HttpServer | null = null
let startPromise: Promise<string> | null = null
let runtimeContextProvider: (() => Promise<WeixinBridgeRuntimeContext>) | null = null
let activeBridgePort = WEIXIN_BRIDGE_PORT
let packageInfoCache: WeixinPackageInfo | null = null
const activeLogins = new Map<string, WeixinLoginSession>()
const contextTokenStore = new Map<string, string>()
const monitors = new Map<string, WeixinMonitor>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveRpcUrl(port = activeBridgePort): string {
  const url = new URL(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
  url.port = String(port)
  return url.toString()
}

export function configureWeixinBridgeRuntimeContextProvider(
  provider: (() => Promise<WeixinBridgeRuntimeContext>) | null
): void {
  runtimeContextProvider = provider
}

async function resolveRuntimeContext(): Promise<WeixinBridgeRuntimeContext> {
  return runtimeContextProvider
    ? runtimeContextProvider()
    : {
        webhookUrl: 'http://127.0.0.1:8787/claw/im',
        webhookSecret: '',
        channelId: ''
      }
}

function resolvePackagePath(packageName: string, subpath: string): string | null {
  try {
    return requireFromHere.resolve(`${packageName}/${subpath}`)
  } catch {
    return null
  }
}

function resolveWeixinPluginRoot(): string | null {
  const packageJson = resolvePackagePath('@tencent-weixin/openclaw-weixin', 'package.json')
  return packageJson ? dirname(packageJson) : null
}

function readWeixinPackageInfo(): WeixinPackageInfo {
  if (packageInfoCache) return packageInfoCache
  const packageJson = resolvePackagePath('@tencent-weixin/openclaw-weixin', 'package.json')
  if (!packageJson) {
    throw new Error(
      'Built-in WeChat login component is missing. Reinstall DeepSeek GUI or rebuild with @tencent-weixin/openclaw-weixin bundled.'
    )
  }
  const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as JsonRecord
  packageInfoCache = {
    version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
    appId: typeof parsed.ilink_appid === 'string' ? parsed.ilink_appid : 'bot'
  }
  return packageInfoCache
}

function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function buildBaseInfo(): JsonRecord {
  const info = readWeixinPackageInfo()
  return {
    channel_version: info.version,
    bot_agent: `DeepSeekGUI/${app.getVersion() || '0.0.0'}`
  }
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf8').toString('base64')
}

function buildCommonHeaders(): Record<string, string> {
  const info = readWeixinPackageInfo()
  return {
    'iLink-App-Id': info.appId,
    'iLink-App-ClientVersion': String(buildClientVersion(info.version))
  }
}

function buildHeaders(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {})
  }
}

async function readJsonResponse(res: Response): Promise<JsonRecord> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) as JsonRecord : {}
  } catch {
    return { message: text.trim() || res.statusText }
  }
}

async function apiGet(
  baseUrl: string,
  endpoint: string,
  timeoutMs: number,
  label: string
): Promise<JsonRecord> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildCommonHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${recordString(data, 'message') || JSON.stringify(data)}`)
  }
  return data
}

async function apiPost(
  baseUrl: string,
  endpoint: string,
  body: JsonRecord,
  options: { token?: string; timeoutMs?: number; label: string }
): Promise<JsonRecord> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildHeaders(options.token),
    body: JSON.stringify(body),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(`${options.label} ${res.status}: ${recordString(data, 'message') || JSON.stringify(data)}`)
  }
  return data
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function recordString(record: JsonRecord, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function stateRoot(): string {
  return join(app.getPath('userData'), WEIXIN_BRIDGE_STATE_DIR_NAME)
}

function weixinStateDir(): string {
  return join(stateRoot(), WEIXIN_PLUGIN_ID)
}

function accountsIndexPath(): string {
  return join(weixinStateDir(), 'accounts.json')
}

function accountsDir(): string {
  return join(weixinStateDir(), 'accounts')
}

function accountPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.json`)
}

function syncBufPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.sync.json`)
}

function contextTokensPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.context-tokens.json`)
}

function configPath(): string {
  return join(stateRoot(), 'weixin-bridge.json')
}

function legacyOpenClawConfigPath(): string {
  return join(stateRoot(), 'openclaw.json')
}

function isBlockedObjectKey(value: string): boolean {
  return value === '__proto__' || value === 'prototype' || value === 'constructor'
}

function normalizeAccountId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'default'
  const lowered = trimmed.toLowerCase()
  const normalized = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)
    ? lowered
    : lowered
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .slice(0, 64)
  return normalized && !isBlockedObjectKey(normalized) ? normalized : 'default'
}

function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith('-im-bot')) return `${normalizedId.slice(0, -7)}@im.bot`
  if (normalizedId.endsWith('-im-wechat')) return `${normalizedId.slice(0, -10)}@im.wechat`
  return undefined
}

async function ensureStateDirs(): Promise<void> {
  await mkdir(accountsDir(), { recursive: true })
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as unknown
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`
  try {
    const current = await readFile(filePath, 'utf8')
    if (current === next) return
  } catch {
    /* create the file below */
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, next, 'utf8')
}

async function listIndexedWeixinAccountIds(): Promise<string[]> {
  try {
    const parsed = await readJsonFile(accountsIndexPath())
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : []
  } catch {
    return []
  }
}

async function registerWeixinAccountId(accountId: string): Promise<void> {
  await ensureStateDirs()
  const existing = await listIndexedWeixinAccountIds()
  if (existing.includes(accountId)) return
  await writeJsonIfChanged(accountsIndexPath(), [...existing, accountId])
}

async function unregisterWeixinAccountId(accountId: string): Promise<void> {
  const existing = await listIndexedWeixinAccountIds()
  const next = existing.filter((id) => id !== accountId)
  if (next.length !== existing.length) await writeJsonIfChanged(accountsIndexPath(), next)
}

async function readAccountFile(filePath: string): Promise<WeixinAccountData | null> {
  try {
    const parsed = await readJsonFile(filePath)
    return asRecord(parsed) as WeixinAccountData
  } catch {
    return null
  }
}

async function loadLegacyToken(): Promise<string | undefined> {
  try {
    const parsed = await readJsonFile(join(stateRoot(), 'credentials', WEIXIN_PLUGIN_ID, 'credentials.json'))
    const token = asRecord(parsed).token
    return typeof token === 'string' && token.trim() ? token.trim() : undefined
  } catch {
    return undefined
  }
}

async function loadWeixinAccountData(accountId: string): Promise<WeixinAccountData | null> {
  const primary = await readAccountFile(accountPath(accountId))
  if (primary) return primary
  const rawId = deriveRawAccountId(accountId)
  if (rawId) {
    const compat = await readAccountFile(accountPath(rawId))
    if (compat) return compat
  }
  const legacyToken = await loadLegacyToken()
  return legacyToken ? { token: legacyToken } : null
}

async function saveWeixinAccount(accountId: string, update: WeixinAccountData): Promise<void> {
  await ensureStateDirs()
  const existing = await loadWeixinAccountData(accountId) ?? {}
  const token = update.token?.trim() || existing.token?.trim()
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl?.trim()
  const userId = update.userId !== undefined
    ? update.userId.trim() || undefined
    : existing.userId?.trim() || undefined
  await writeJsonIfChanged(accountPath(accountId), {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {})
  })
  await registerWeixinAccountId(accountId)
}

async function clearWeixinAccount(accountId: string): Promise<void> {
  for (const filePath of [accountPath(accountId), syncBufPath(accountId), contextTokensPath(accountId)]) {
    try {
      await unlink(filePath)
    } catch {
      /* ignore */
    }
  }
  await unregisterWeixinAccountId(accountId)
}

async function clearStaleAccountsForUserId(currentAccountId: string, userId: string): Promise<void> {
  if (!userId.trim()) return
  for (const id of await listIndexedWeixinAccountIds()) {
    if (id === currentAccountId) continue
    const data = await loadWeixinAccountData(id)
    if (data?.userId?.trim() === userId) await clearWeixinAccount(id)
  }
}

async function resolveWeixinAccount(accountId: string): Promise<WeixinAccount> {
  const id = normalizeAccountId(accountId)
  const data = await loadWeixinAccountData(id)
  const token = data?.token?.trim()
  return {
    accountId: id,
    baseUrl: data?.baseUrl?.trim() || WEIXIN_API_BASE_URL,
    cdnBaseUrl: WEIXIN_CDN_BASE_URL,
    token,
    configured: Boolean(token),
    userId: data?.userId?.trim() || undefined
  }
}

async function readBridgeConfig(): Promise<JsonRecord> {
  try {
    const parsed = await readJsonFile(configPath())
    return asRecord(parsed)
  } catch {
    try {
      const parsed = await readJsonFile(legacyOpenClawConfigPath())
      return asRecord(parsed)
    } catch {
      return {}
    }
  }
}

async function prepareBridgeState(port: number): Promise<void> {
  if (!resolveWeixinPluginRoot()) {
    throw new Error(
      'Built-in WeChat login component is missing. Reinstall DeepSeek GUI or rebuild with @tencent-weixin/openclaw-weixin bundled.'
    )
  }
  await ensureStateDirs()
  await writeJsonIfChanged(configPath(), {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port,
      auth: { mode: 'none' }
    },
    channels: {
      [WEIXIN_PLUGIN_ID]: {
        enabled: true
      }
    }
  })
}

function isLoginFresh(login: WeixinLoginSession): boolean {
  return Date.now() - login.startedAt < LOGIN_TTL_MS
}

function purgeExpiredLogins(): void {
  for (const [key, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(key)
  }
}

async function localTokenList(): Promise<string[]> {
  const ids = await listIndexedWeixinAccountIds()
  const tokens: string[] = []
  for (let index = ids.length - 1; index >= 0 && tokens.length < 10; index -= 1) {
    const data = await loadWeixinAccountData(ids[index])
    const token = data?.token?.trim()
    if (token) tokens.push(token)
  }
  return tokens
}

async function fetchQRCode(botType = WEIXIN_DEFAULT_BOT_TYPE): Promise<JsonRecord> {
  return apiPost(
    WEIXIN_API_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    { local_token_list: await localTokenList() },
    { label: 'fetchQRCode' }
  )
}

async function pollQRStatus(baseUrl: string, qrcode: string): Promise<JsonRecord> {
  try {
    return await apiGet(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      QR_LONG_POLL_TIMEOUT_MS,
      'pollQRStatus'
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return { status: 'wait' }
    logWarn('weixin-bridge', 'QR status polling failed; retrying.', {
      message: error instanceof Error ? error.message : String(error)
    })
    return { status: 'wait' }
  }
}

async function startWeixinLogin(params: JsonRecord): Promise<JsonRecord> {
  readWeixinPackageInfo()
  purgeExpiredLogins()
  const force = params.force === true
  const sessionKey = recordString(params, 'accountId') || randomUUID()
  const existing = activeLogins.get(sessionKey)
  if (!force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcode: existing.qrcodeUrl,
      qrUrl: existing.qrcodeUrl,
      qrDataUrl: existing.qrcodeUrl,
      sessionKey,
      message: '二维码已显示，请用手机微信扫描。'
    }
  }

  const qr = await fetchQRCode(recordString(params, 'botType') || WEIXIN_DEFAULT_BOT_TYPE)
  const qrcode = recordString(qr, 'qrcode')
  const qrcodeUrl = recordString(qr, 'qrcode_img_content') || recordString(qr, 'qrcodeUrl')
  if (!qrcode || !qrcodeUrl) {
    throw new Error(recordString(qr, 'message') || 'WeChat QR response is incomplete.')
  }
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode,
    qrcodeUrl,
    startedAt: Date.now(),
    currentApiBaseUrl: WEIXIN_API_BASE_URL
  })
  return {
    qrcode: qrcodeUrl,
    qrUrl: qrcodeUrl,
    qrDataUrl: qrcodeUrl,
    sessionKey,
    message: '用手机微信扫描二维码，以继续连接。'
  }
}

async function waitForWeixinLogin(params: JsonRecord): Promise<JsonRecord> {
  const sessionKey = recordString(params, 'accountId') || recordString(params, 'sessionKey')
  const login = activeLogins.get(sessionKey)
  if (!login) return { connected: false, message: '当前没有进行中的登录，请先发起登录。' }
  if (!isLoginFresh(login)) {
    activeLogins.delete(sessionKey)
    return { connected: false, message: '二维码已过期，请重新生成。' }
  }

  const timeoutMs = Math.max(Number(params.timeoutMs) || 480_000, 1_000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await pollQRStatus(login.currentApiBaseUrl ?? WEIXIN_API_BASE_URL, login.qrcode)
    switch (recordString(status, 'status')) {
      case 'wait':
      case 'scaned':
        break
      case 'need_verifycode':
        return {
          connected: false,
          message: '微信要求输入手机端验证码。当前 GUI 登录流程暂不支持验证码，请重新生成二维码后再试。'
        }
      case 'expired':
        activeLogins.delete(sessionKey)
        return { connected: false, message: '二维码已过期，请重新生成。' }
      case 'verify_code_blocked':
        activeLogins.delete(sessionKey)
        return { connected: false, message: '多次输入错误，连接流程已停止。请稍后再试。' }
      case 'binded_redirect':
        activeLogins.delete(sessionKey)
        return {
          connected: true,
          alreadyConnected: true,
          accountId: normalizeAccountId(sessionKey),
          sessionKey,
          message: '已连接过此 DeepSeek GUI，无需重复连接。'
        }
      case 'scaned_but_redirect': {
        const redirectHost = recordString(status, 'redirect_host')
        if (redirectHost) login.currentApiBaseUrl = `https://${redirectHost}`
        break
      }
      case 'confirmed': {
        const rawAccountId = recordString(status, 'ilink_bot_id')
        const token = recordString(status, 'bot_token')
        if (!rawAccountId || !token) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '登录失败：服务器未返回完整账号信息。' }
        }
        const accountId = normalizeAccountId(rawAccountId)
        const baseUrl = recordString(status, 'baseurl') || WEIXIN_API_BASE_URL
        const userId = recordString(status, 'ilink_user_id')
        await saveWeixinAccount(accountId, { token, baseUrl, userId })
        await clearStaleAccountsForUserId(accountId, userId)
        activeLogins.delete(sessionKey)
        return {
          connected: true,
          accountId,
          sessionKey,
          baseUrl,
          userId,
          message: '已将此 DeepSeek GUI 连接到微信。'
        }
      }
    }
    await sleep(1_000)
  }
  activeLogins.delete(sessionKey)
  return { connected: false, message: '登录超时，请重试。' }
}

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`
}

async function persistContextTokens(accountId: string): Promise<void> {
  const prefix = `${accountId}:`
  const tokens: Record<string, string> = {}
  for (const [key, value] of contextTokenStore) {
    if (key.startsWith(prefix)) tokens[key.slice(prefix.length)] = value
  }
  await writeJsonIfChanged(contextTokensPath(accountId), tokens)
}

async function restoreContextTokens(accountId: string): Promise<void> {
  try {
    const parsed = await readJsonFile(contextTokensPath(accountId))
    for (const [userId, token] of Object.entries(asRecord(parsed))) {
      if (typeof token === 'string' && token) {
        contextTokenStore.set(contextTokenKey(accountId, userId), token)
      }
    }
  } catch {
    /* no persisted tokens */
  }
}

async function setContextToken(accountId: string, userId: string, token: string): Promise<void> {
  contextTokenStore.set(contextTokenKey(accountId, userId), token)
  await persistContextTokens(accountId)
}

function getContextToken(accountId: string, userId: string): string | undefined {
  return contextTokenStore.get(contextTokenKey(accountId, userId))
}

async function loadSyncBuf(accountId: string): Promise<string> {
  try {
    const parsed = await readJsonFile(syncBufPath(accountId))
    const value = asRecord(parsed).get_updates_buf
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function saveSyncBuf(accountId: string, getUpdatesBuf: string): Promise<void> {
  await writeJsonIfChanged(syncBufPath(accountId), { get_updates_buf: getUpdatesBuf })
}

async function notifyStart(account: WeixinAccount): Promise<void> {
  await apiPost(
    account.baseUrl,
    'ilink/bot/msg/notifystart',
    { base_info: buildBaseInfo() },
    { token: account.token, timeoutMs: 10_000, label: 'notifyStart' }
  )
}

async function notifyStop(account: WeixinAccount): Promise<void> {
  await apiPost(
    account.baseUrl,
    'ilink/bot/msg/notifystop',
    { base_info: buildBaseInfo() },
    { token: account.token, timeoutMs: 10_000, label: 'notifyStop' }
  )
}

async function getUpdates(
  account: WeixinAccount,
  getUpdatesBuf: string,
  timeoutMs: number
): Promise<JsonRecord> {
  try {
    return await apiPost(
      account.baseUrl,
      'ilink/bot/getupdates',
      {
        get_updates_buf: getUpdatesBuf,
        base_info: buildBaseInfo()
      },
      { token: account.token, timeoutMs, label: 'getUpdates' }
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
    }
    throw error
  }
}

function generateMessageId(): string {
  return `deepseek-gui-weixin-${randomUUID()}`
}

async function sendMessageWeixin(params: {
  account: WeixinAccount
  to: string
  text: string
  contextToken?: string
  timeoutMs?: number
}): Promise<{ messageId: string }> {
  const messageId = generateMessageId()
  await apiPost(
    params.account.baseUrl,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: params.to,
        client_id: messageId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: params.text } }],
        context_token: params.contextToken
      },
      base_info: buildBaseInfo()
    },
    {
      token: params.account.token,
      timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
      label: 'sendMessage'
    }
  )
  return { messageId }
}

function textFromItemList(itemList: unknown): string {
  if (!Array.isArray(itemList)) return ''
  for (const item of itemList) {
    const record = asRecord(item)
    if (record.type === MessageItemType.TEXT) {
      const text = asRecord(record.text_item).text
      if (text != null) return String(text).trim()
    }
    if (record.type === MessageItemType.VOICE) {
      const text = asRecord(record.voice_item).text
      if (text != null) return String(text).trim()
    }
  }
  return ''
}

function buildWebhookMessage(message: WeixinMessage, accountId: string, text: string): JsonRecord {
  const from = message.from_user_id || ''
  return {
    provider: 'weixin',
    platform: 'weixin',
    text,
    sender: from || 'WeChat',
    from,
    chatId: from,
    messageId: message.message_id || generateMessageId(),
    senderId: from,
    senderName: from || 'WeChat',
    threadId: '',
    message: {
      provider: 'weixin',
      text,
      sender: from || 'WeChat',
      accountId
    }
  }
}

async function postToDeepSeekGuiWebhook(message: WeixinMessage, accountId: string): Promise<JsonRecord> {
  const settings = await resolveRuntimeContext()
  const text = textFromItemList(message.item_list)
  if (!text) return { reply: 'Only text messages are supported right now.' }
  const body = {
    ...buildWebhookMessage(message, accountId, text),
    channelId: settings.channelId || undefined
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (settings.webhookSecret) {
    headers.authorization = `Bearer ${settings.webhookSecret}`
    headers['x-deepseek-gui-secret'] = settings.webhookSecret
  }
  const res = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(650_000)
  })
  const data = await readJsonResponse(res)
  if (!res.ok || data.ok === false) {
    throw new Error(recordString(data, 'message') || `DeepSeek GUI webhook HTTP ${res.status}`)
  }
  return data
}

async function monitorWeixinAccount(accountId: string, signal: AbortSignal): Promise<void> {
  const account = await resolveWeixinAccount(accountId)
  if (!account.configured || !account.token?.trim()) {
    throw new Error(`WeChat account is not configured: ${accountId}`)
  }
  await restoreContextTokens(account.accountId)
  try {
    await notifyStart(account)
  } catch {
    /* best-effort */
  }

  let getUpdatesBuf = await loadSyncBuf(account.accountId)
  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
  let consecutiveFailures = 0
  while (!signal.aborted) {
    try {
      const resp = await getUpdates(account, getUpdatesBuf, nextTimeoutMs)
      if (typeof resp.longpolling_timeout_ms === 'number' && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms
      }
      const ret = Number(resp.ret ?? 0)
      const errcode = Number(resp.errcode ?? 0)
      if (ret !== 0 || errcode !== 0) {
        consecutiveFailures += 1
        await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS)
        if (consecutiveFailures >= 3) consecutiveFailures = 0
        continue
      }
      consecutiveFailures = 0
      const nextBuf = typeof resp.get_updates_buf === 'string' ? resp.get_updates_buf : ''
      if (nextBuf) {
        getUpdatesBuf = nextBuf
        await saveSyncBuf(account.accountId, getUpdatesBuf)
      }
      const messages = Array.isArray(resp.msgs) ? resp.msgs as WeixinMessage[] : []
      for (const message of messages) {
        if (signal.aborted) return
        if (message.message_type === MessageType.BOT) continue
        const to = message.from_user_id || ''
        if (!to) continue
        const contextToken = message.context_token || undefined
        if (contextToken) await setContextToken(account.accountId, to, contextToken)
        const result = await postToDeepSeekGuiWebhook(message, account.accountId)
        const reply = recordString(result, 'reply') || recordString(result, 'text')
        if (!reply) continue
        await sendMessageWeixin({
          account,
          to,
          text: reply,
          contextToken
        })
      }
    } catch (error) {
      if (signal.aborted) return
      logWarn('weixin-bridge', 'WeChat monitor iteration failed.', {
        accountId: account.accountId,
        message: error instanceof Error ? error.message : String(error)
      })
      consecutiveFailures += 1
      await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS)
      if (consecutiveFailures >= 3) consecutiveFailures = 0
    }
  }

  try {
    await notifyStop(account)
  } catch {
    /* best-effort */
  }
}

function startAccountMonitor(accountId: string): void {
  const normalized = normalizeAccountId(accountId)
  const existing = monitors.get(normalized)
  if (existing && !existing.controller.signal.aborted) return
  const controller = new AbortController()
  const promise = monitorWeixinAccount(normalized, controller.signal).catch((error) => {
    if (!controller.signal.aborted) {
      logError('weixin-bridge', 'WeChat monitor stopped.', {
        accountId: normalized,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }).finally(() => {
    if (monitors.get(normalized)?.controller === controller) monitors.delete(normalized)
  })
  monitors.set(normalized, { accountId: normalized, controller, promise })
}

async function startWeixinChannels(params: JsonRecord): Promise<JsonRecord> {
  const requestedAccountId = recordString(params, 'accountId')
  const accountIds = requestedAccountId
    ? [normalizeAccountId(requestedAccountId)]
    : await listIndexedWeixinAccountIds()
  for (const accountId of accountIds) startAccountMonitor(accountId)
  return { started: accountIds }
}

async function stopWeixinChannels(params: JsonRecord): Promise<JsonRecord> {
  const requestedAccountId = recordString(params, 'accountId')
  const targets = requestedAccountId ? [normalizeAccountId(requestedAccountId)] : [...monitors.keys()]
  for (const accountId of targets) {
    monitors.get(accountId)?.controller.abort()
    monitors.delete(accountId)
  }
  return { stopped: targets }
}

async function dispatchRpc(method: string, params: JsonRecord): Promise<JsonRecord> {
  switch (method) {
    case 'web.login.start':
      return startWeixinLogin(params)
    case 'web.login.wait':
      return waitForWeixinLogin(params)
    case 'channels.start':
      if (recordString(params, 'channel') && recordString(params, 'channel') !== WEIXIN_PLUGIN_ID) {
        throw new Error(`Unsupported channel: ${recordString(params, 'channel')}`)
      }
      return startWeixinChannels(params)
    case 'channels.stop':
      return stopWeixinChannels(params)
    case 'accounts.list':
      return { accounts: await listIndexedWeixinAccountIds() }
    default:
      throw new Error(`Unknown WeChat bridge method: ${method}`)
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(body)}\n`)
}

async function handleBridgeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url || '/', `http://127.0.0.1:${activeBridgePort}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true, status: 'live' })
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/api/v1/admin/rpc') {
      writeJson(response, 404, { ok: false, message: 'Not found' })
      return
    }
    const body = asRecord(JSON.parse(await readRequestBody(request)) as unknown)
    const id = body.id ?? null
    const method = recordString(body, 'method')
    const params = asRecord(body.params)
    if (!method) throw new Error('JSON-RPC method is required.')
    const result = await dispatchRpc(method, params)
    writeJson(response, 200, { jsonrpc: '2.0', id, ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeJson(response, 200, {
      jsonrpc: '2.0',
      id: null,
      ok: false,
      error: { message }
    })
  }
}

async function fetchBridgeHealth(port = activeBridgePort): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(WEIXIN_BRIDGE_HEALTH_TIMEOUT_MS)
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null) as { ok?: unknown; status?: unknown } | null
    return data?.ok === true || data?.status === 'live' || data?.status === 'ok'
  } catch {
    return false
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer()
    probe.unref()
    probe.once('error', () => resolve(false))
    probe.listen({ host: '127.0.0.1', port }, () => {
      probe.close(() => resolve(true))
    })
  })
}

async function resolveAvailableBridgePort(): Promise<number> {
  if (server && await fetchBridgeHealth(activeBridgePort)) return activeBridgePort
  for (let offset = 0; offset < WEIXIN_BRIDGE_MAX_PORT_ATTEMPTS; offset += 1) {
    const port = WEIXIN_BRIDGE_PORT + offset
    if (await isPortAvailable(port)) return port
  }
  throw new Error('Built-in WeChat login component could not find an available local port.')
}

async function listen(serverToStart: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      serverToStart.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      serverToStart.off('error', onError)
      resolve()
    }
    serverToStart.once('error', onError)
    serverToStart.once('listening', onListening)
    serverToStart.listen({ host: '127.0.0.1', port })
  })
}

async function startBridgeServer(): Promise<string> {
  if (server && await fetchBridgeHealth(activeBridgePort)) return resolveRpcUrl()
  const port = await resolveAvailableBridgePort()
  activeBridgePort = port
  await prepareBridgeState(port)
  server = createHttpServer((request, response) => {
    void handleBridgeRequest(request, response)
  })
  await listen(server, port)
  logInfo('weixin-bridge', `started built-in GUI WeChat bridge on port ${port}`)
  await startWeixinChannels({})
  return resolveRpcUrl()
}

export async function ensureWeixinBridgeRpcUrl(): Promise<string> {
  if (!startPromise) {
    startPromise = startBridgeServer().catch((error) => {
      startPromise = null
      throw error
    })
  }
  return startPromise
}

export async function sendWeixinBridgeMessage(options: {
  accountId: string
  to: string
  text: string
}): Promise<WeixinBridgeSendResult> {
  const accountId = normalizeAccountId(options.accountId)
  const to = options.to.trim()
  const text = options.text.trim()
  if (!accountId) return { ok: false, message: 'WeChat account id is missing.' }
  if (!to) return { ok: false, message: 'WeChat recipient is missing.' }
  if (!text) return { ok: false, message: 'Message is empty.' }

  try {
    await ensureWeixinBridgeRpcUrl()
    const cfg = await readBridgeConfig()
    void cfg
    const account = await resolveWeixinAccount(accountId)
    if (!account.configured || !account.token?.trim()) {
      return { ok: false as const, message: 'WeChat account is not configured.' }
    }
    await restoreContextTokens(account.accountId)
    const result = await sendMessageWeixin({
      account,
      to,
      text,
      contextToken: getContextToken(account.accountId, to)
    })
    return { ok: true as const, messageId: result.messageId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError('weixin-bridge', 'Failed to send WeChat message from GUI.', {
      message,
      accountId,
      to
    })
    return { ok: false, message }
  }
}

export function stopWeixinBridgeRuntime(): void {
  startPromise = null
  for (const monitor of monitors.values()) monitor.controller.abort()
  monitors.clear()
  if (!server) return
  const runningServer = server
  server = null
  runningServer.close()
}

export const weixinBridgeRuntimeInternals = {
  buildBaseInfo,
  normalizeAccountId
}
