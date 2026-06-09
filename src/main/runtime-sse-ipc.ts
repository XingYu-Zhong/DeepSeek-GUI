import type { IpcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type { AppSettingsV1 } from '../shared/app-settings'
import { kunThreadEventsPath } from '../shared/kun-endpoints'
import { sseStartPayloadSchema, streamIdSchema } from './ipc/app-ipc-schemas'
import type { JsonSettingsStore } from './settings-store'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './runtime/kun-adapter'

type SseControllerState = {
  controller: AbortController
  stoppedByClient: boolean
}

const SSE_RECONNECT_BASE_MS = 750
const SSE_RECONNECT_MAX_MS = 5_000
const SSE_START_TIMEOUT_MS = 15_000


const sseControllers = new Map<string, SseControllerState>()

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseSseData(raw: string): { data: unknown; event?: string; id?: string } | null {
  const lines = raw.split('\n')
  const dataLines: string[] = []
  let eventName = ''
  let eventId = ''
  for (const line of lines) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized.startsWith('event:')) {
      eventName = normalized.slice(6).trim()
      continue
    }
    if (normalized.startsWith('id:')) {
      eventId = normalized.slice(3).trim()
      continue
    }
    if (normalized.startsWith('data:')) {
      dataLines.push(normalized.slice(5).trimStart())
    }
  }
  if (!dataLines.length) return null
  const payload = dataLines.join('\n')
  try {
    return {
      data: JSON.parse(payload),
      ...(eventName ? { event: eventName } : {}),
      ...(eventId ? { id: eventId } : {})
    }
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

function coerceSsePayload(parsed: { data: unknown; event?: string; id?: string }): Record<string, unknown> {
  const payload: Record<string, unknown> =
    parsed.data && typeof parsed.data === 'object'
      ? { ...(parsed.data as Record<string, unknown>) }
      : { value: parsed.data }
  if (typeof payload.seq !== 'number' && parsed.id && /^\d+$/.test(parsed.id)) {
    payload.seq = Number(parsed.id)
  }
  if (typeof payload.kind !== 'string' && parsed.event) {
    payload.kind = parsed.event
  }
  return payload
}

function isFatalSseStatus(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

async function fetchSseWithStartTimeout(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<Response> {
  const attempt = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    attempt.abort()
  }, timeoutMs)
  const onAbort = (): void => {
    attempt.abort()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(url, { signal: attempt.signal, headers })
  } catch (error) {
    if (timedOut) {
      throw new Error('sse start timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

export function registerRuntimeSseIpc(options: {
  ipcMain: IpcMain
  store: JsonSettingsStore
  ensureRuntime: (settings: AppSettingsV1) => Promise<void>
  logError: (category: string, message: string, detail?: unknown) => void
}): void {
  const { ipcMain, store, ensureRuntime, logError } = options
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
    const base = getRuntimeBaseUrlForSettings(s)

    ;(async () => {
      const wc = event.sender
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      runtimeAuthHeaders(s).forEach((value, key) => {
        headers[key] = value
      })
      let nextSinceSeq = request.sinceSeq
      let reconnectDelayMs = SSE_RECONNECT_BASE_MS
      try {
        while (!state.stoppedByClient && !ac.signal.aborted) {
          const url = new URL(`${base}${kunThreadEventsPath(request.threadId)}`)
          url.searchParams.set('since_seq', String(nextSinceSeq))
          const requestHeaders = { ...headers }
          if (nextSinceSeq > 0) {
            requestHeaders['Last-Event-ID'] = String(nextSinceSeq)
          } else {
            delete requestHeaders['Last-Event-ID']
          }
          try {
            const res = await fetchSseWithStartTimeout(url, requestHeaders, ac.signal, SSE_START_TIMEOUT_MS)
            if (!res.ok || !res.body) {
              if (isFatalSseStatus(res.status)) {
                wc.send('runtime:sse-error', { streamId: id, status: res.status })
                logError('sse', `SSE connection failed for thread ${request.threadId}`, {
                  status: res.status,
                  streamId: id
                })
                return
              }
              await sleepWithAbort(reconnectDelayMs, ac.signal)
              reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_RECONNECT_MAX_MS)
              continue
            }
            reconnectDelayMs = SSE_RECONNECT_BASE_MS
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
                  const payload = coerceSsePayload(parsed)
                  if (typeof payload.seq === 'number') {
                    nextSinceSeq = Math.max(nextSinceSeq, payload.seq)
                  }
                  wc.send('runtime:sse-event', { streamId: id, data: payload })
                }
              }
            }
            buffer += dec.decode()
            const trailing = buffer.trim()
            if (trailing) {
              const parsed = parseSseData(trailing)
              if (parsed !== null) {
                const payload = coerceSsePayload(parsed)
                if (typeof payload.seq === 'number') {
                  nextSinceSeq = Math.max(nextSinceSeq, payload.seq)
                }
                wc.send('runtime:sse-event', { streamId: id, data: payload })
              }
            }
          } catch (e) {
            if (state.stoppedByClient || ac.signal.aborted) return
            const msg = e instanceof Error ? e.message : String(e)
            if (/sse start timeout/i.test(msg) || /fetch failed/i.test(msg) || /network/i.test(msg)) {
              await sleepWithAbort(reconnectDelayMs, ac.signal)
              reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_RECONNECT_MAX_MS)
              continue
            }
            wc.send('runtime:sse-error', { streamId: id, message: msg })
            logError('sse', `SSE stream error for thread ${request.threadId}`, { message: msg, streamId: id })
            return
          }
        }
      } finally {
        if (!state.stoppedByClient && !ac.signal.aborted) {
          wc.send('runtime:sse-end', { streamId: id })
        }
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
}
