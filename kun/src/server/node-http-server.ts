import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Router } from './router.js'
import { dispatchRequest } from './http-server.js'

export type NodeHttpServerHandle = {
  server: Server
  host: string
  port: number
  close(): Promise<void>
}

export async function startNodeHttpServer(input: {
  router: Router
  host: string
  port: number
}): Promise<NodeHttpServerHandle> {
  const server = createServer((request, response) => {
    void handleNodeRequest(input.router, request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port
  return {
    server,
    host: input.host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

async function handleNodeRequest(
  router: Router,
  incoming: IncomingMessage,
  outgoing: ServerResponse
): Promise<void> {
  try {
    const request = toFetchRequest(incoming)
    const response = await dispatchRequest(router, request)
    await writeFetchResponse(outgoing, response)
  } catch (error) {
    const body = JSON.stringify({
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error)
    })
    outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    outgoing.end(body)
  }
}

function toFetchRequest(incoming: IncomingMessage): Request {
  const method = incoming.method ?? 'GET'
  const host = incoming.headers.host ?? '127.0.0.1'
  const url = `http://${host}${incoming.url ?? '/'}`
  const headers = new Headers()
  for (const [key, raw] of Object.entries(incoming.headers)) {
    if (raw == null) continue
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value)
    } else {
      headers.set(key, raw)
    }
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers
  }
  if (hasBody) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value)
  })
  if (!response.body) {
    outgoing.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) outgoing.write(Buffer.from(value))
    }
  } finally {
    outgoing.end()
    reader.releaseLock()
  }
}
