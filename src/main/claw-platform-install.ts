import { randomUUID } from 'node:crypto'
import { DEFAULT_WEIXIN_BRIDGE_RPC_URL } from '../shared/app-settings'

type ClawPlatformInstallStartResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }

type ClawPlatformInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: true; kind: 'weixin'; accountId: string; sessionKey: string }
  | { done: false; error?: string }

let feishuInstallIsLark = false
const feishuInstallTargets = new Map<string, boolean>()
const MAX_FEISHU_INSTALL_TARGETS = 32
const weixinInstallSessions = new Map<string, string>()
const MAX_WEIXIN_INSTALL_SESSIONS = 32
const WEIXIN_ALREADY_CONNECTED_MESSAGE = '已连接过此 OpenClaw'
const WEIXIN_BRIDGE_URL_ENV_KEYS = [
  'DEEPSEEK_GUI_WEIXIN_BRIDGE_URL',
  'DEEPSEEK_GUI_OPENCLAW_GATEWAY_URL',
  'OPENCLAW_GATEWAY_URL'
]
const WEIXIN_BRIDGE_MISSING_MESSAGE =
  'WeChat login bridge is unavailable. Restart the app and try generating the WeChat QR code again.'
const WEIXIN_CHANNEL_ID = 'openclaw-weixin'

let managedWeixinBridgeUrlResolver: (() => Promise<string>) | null = null

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeIntervalSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(3, Math.floor(parsed)) : fallback
}

function rememberFeishuInstallTarget(deviceCode: string, isLark: boolean): void {
  feishuInstallTargets.delete(deviceCode)
  feishuInstallTargets.set(deviceCode, isLark)
  while (feishuInstallTargets.size > MAX_FEISHU_INSTALL_TARGETS) {
    const oldestDeviceCode = feishuInstallTargets.keys().next().value
    if (!oldestDeviceCode) break
    feishuInstallTargets.delete(oldestDeviceCode)
  }
}

function resolveFeishuInstallTarget(deviceCode: string): boolean {
  return feishuInstallTargets.get(deviceCode) ?? feishuInstallIsLark
}

function rememberWeixinInstallSession(deviceCode: string, sessionKey: string): void {
  weixinInstallSessions.delete(deviceCode)
  weixinInstallSessions.set(deviceCode, sessionKey)
  while (weixinInstallSessions.size > MAX_WEIXIN_INSTALL_SESSIONS) {
    const oldestDeviceCode = weixinInstallSessions.keys().next().value
    if (!oldestDeviceCode) break
    weixinInstallSessions.delete(oldestDeviceCode)
  }
}

export function configureManagedWeixinBridgeUrlResolver(
  resolver: (() => Promise<string>) | null
): void {
  managedWeixinBridgeUrlResolver = resolver
}

async function resolveWeixinBridgeUrl(configuredWeixinBridgeUrl?: string): Promise<string> {
  const configured = configuredWeixinBridgeUrl?.trim() ?? ''
  if (configured) return configured
  for (const key of WEIXIN_BRIDGE_URL_ENV_KEYS) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  if (managedWeixinBridgeUrlResolver) return managedWeixinBridgeUrlResolver()
  return DEFAULT_WEIXIN_BRIDGE_RPC_URL
}

function jsonRpcPayload(method: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
    params
  }
}

async function requestWeixinBridge(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  configuredWeixinBridgeUrl?: string
): Promise<Record<string, unknown>> {
  const bridgeUrl = await resolveWeixinBridgeUrl(configuredWeixinBridgeUrl)
  if (!bridgeUrl) {
    throw new Error(WEIXIN_BRIDGE_MISSING_MESSAGE)
  }
  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonRpcPayload(method, params)),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    const message = recordString(data, 'message')
    if (res.status === 404 || /^not found$/i.test(message)) {
      throw new Error(WEIXIN_BRIDGE_MISSING_MESSAGE)
    }
    throw new Error(message || `HTTP ${res.status}`)
  }
  if (data.ok === false) {
    const rpcError = asRecord(data.error)
    throw new Error(
      recordString(rpcError, 'message') ||
      recordString(data, 'message') ||
      'WeChat login bridge returned an error.'
    )
  }
  const error = data.error
  if (typeof error === 'string' && error.trim()) throw new Error(error.trim())
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = recordString(error as Record<string, unknown>, 'message')
    throw new Error(message || 'WeChat login bridge returned an error.')
  }
  const payload = data.payload
  if (data.ok === true && payload && typeof payload === 'object') {
    return asRecord(payload)
  }
  const result = data.result
  return asRecord(result && typeof result === 'object' ? result : data)
}

function readWeixinQrValue(data: Record<string, unknown>): string {
  return (
    recordString(data, 'qrDataUrl') ||
    recordString(data, 'qrUrl') ||
    recordString(data, 'qrcode') ||
    recordString(data, 'qrCode') ||
    recordString(data, 'url')
  )
}

function isWeixinAlreadyConnectedMessage(message: string): boolean {
  return message.includes(WEIXIN_ALREADY_CONNECTED_MESSAGE)
}

async function startWeixinBridgeChannel(
  accountId: string,
  weixinBridgeUrl?: string
): Promise<void> {
  await requestWeixinBridge(
    'channels.start',
    {
      channel: WEIXIN_CHANNEL_ID,
      ...(accountId ? { accountId } : {})
    },
    30_000,
    weixinBridgeUrl
  )
}

export async function startFeishuInstallQrcode(isLark: boolean): Promise<ClawPlatformInstallStartResult> {
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
    const userCode = recordString(data, 'user_code')
    if (!url || !deviceCode) {
      throw new Error(recordString(data, 'error_description') || recordString(data, 'message') || 'Feishu QR response is incomplete.')
    }
    rememberFeishuInstallTarget(deviceCode, isLark)
    return {
      ok: true,
      url,
      deviceCode,
      userCode,
      interval: normalizeIntervalSeconds(data.interval, 5),
      expireIn: normalizeIntervalSeconds(data.expire_in ?? data.expires_in, 300)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function pollFeishuInstall(deviceCode: string): Promise<ClawPlatformInstallPollResult> {
  try {
    const baseUrl = resolveFeishuInstallTarget(deviceCode) ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn'
    const result = await postFormResult(`${baseUrl}/oauth/v1/app/registration`, {
      action: 'poll',
      device_code: deviceCode
    })
    const data = result.data
    const error = recordString(data, 'error')
    if (error) {
      if (error === 'authorization_pending' || error === 'slow_down') return { done: false }
      feishuInstallTargets.delete(deviceCode)
      return { done: false, error: recordString(data, 'error_description') || error }
    }
    if (!result.ok) {
      feishuInstallTargets.delete(deviceCode)
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
      feishuInstallTargets.delete(deviceCode)
      return { done: true, kind: 'feishu', appId, appSecret, domain }
    }
    return { done: false }
  } catch (error) {
    return { done: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function startWeixinInstallQrcode(
  weixinBridgeUrl?: string
): Promise<ClawPlatformInstallStartResult> {
  try {
    const data = await requestWeixinBridge(
      'web.login.start',
      { force: true, timeoutMs: 300_000, verbose: true },
      30_000,
      weixinBridgeUrl
    )
    const url = readWeixinQrValue(data)
    const sessionKey = recordString(data, 'sessionKey')
    if (!url) {
      throw new Error(recordString(data, 'message') || 'WeChat QR response is incomplete.')
    }
    const deviceCode = randomUUID()
    rememberWeixinInstallSession(deviceCode, sessionKey)
    return {
      ok: true,
      url,
      deviceCode,
      userCode: '',
      interval: 3,
      expireIn: 120
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function pollWeixinInstall(
  deviceCode: string,
  weixinBridgeUrl?: string
): Promise<ClawPlatformInstallPollResult> {
  const sessionKey = weixinInstallSessions.get(deviceCode) ?? deviceCode
  try {
    const data = await requestWeixinBridge(
      'web.login.wait',
      { timeoutMs: 480_000, ...(sessionKey ? { accountId: sessionKey } : {}) },
      490_000,
      weixinBridgeUrl
    )
    const message = recordString(data, 'message')
    const alreadyConnected = data.alreadyConnected === true || isWeixinAlreadyConnectedMessage(message)
    const connected = data.connected === true || alreadyConnected
    if (!connected) {
      return { done: false, error: message || 'WeChat login was not completed.' }
    }
    const accountId = recordString(data, 'accountId') || sessionKey
    if (!accountId) {
      return { done: false, error: 'WeChat login completed, but no account id was returned.' }
    }
    await startWeixinBridgeChannel(recordString(data, 'accountId'), weixinBridgeUrl)
    weixinInstallSessions.delete(deviceCode)
    return { done: true, kind: 'weixin', accountId, sessionKey }
  } catch (error) {
    return { done: false, error: error instanceof Error ? error.message : String(error) }
  }
}
