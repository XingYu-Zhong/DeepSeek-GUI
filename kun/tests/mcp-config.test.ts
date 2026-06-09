import { describe, expect, it } from 'vitest'
import {
  KunCapabilitiesConfig,
  McpServerConfig
} from '../src/contracts/capabilities.js'
import { REDACTED_SECRET, redactSecrets } from '../src/config/secret-redaction.js'

describe('MCP config', () => {
  it('accepts trusted stdio MCP servers', () => {
    const server = McpServerConfig.parse({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'secret' },
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/project']
    })

    expect(server.enabled).toBe(true)
    expect(server.transport).toBe('stdio')
    expect(server.timeoutMs).toBe(30_000)
  })

  it('accepts trusted streamable HTTP MCP servers', () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'streamable-http',
            url: 'https://mcp.example.test/mcp',
            headers: { Authorization: 'Bearer token' },
            trustScope: 'user'
          }
        }
      }
    })

    expect(config.mcp.enabled).toBe(true)
    expect(config.mcp.servers.github?.transport).toBe('streamable-http')
  })

  it('rejects stdio servers without commands', () => {
    const result = McpServerConfig.safeParse({
      transport: 'stdio',
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/project']
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).join('\n')).toMatch(/require command/)
  })

  it('rejects HTTP servers without valid URLs', () => {
    const missing = McpServerConfig.safeParse({
      transport: 'streamable-http',
      trustScope: 'user'
    })
    const invalid = McpServerConfig.safeParse({
      transport: 'sse',
      url: 'file:///tmp/mcp.sock',
      trustScope: 'user'
    })

    expect(missing.success).toBe(false)
    expect(invalid.success).toBe(false)
  })

  it('requires workspace roots for workspace-scoped trust', () => {
    const result = McpServerConfig.safeParse({
      transport: 'stdio',
      command: 'node',
      trustScope: 'workspace'
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).join('\n')).toMatch(/trusted workspace/)
  })

  it('redacts common secret fields in diagnostics', () => {
    const redacted = redactSecrets({
      headers: {
        Authorization: 'Bearer token',
        'X-Api-Key': 'key'
      },
      env: {
        NORMAL: 'visible',
        CLIENT_SECRET: 'secret',
        PASSWORD: 'pw'
      }
    })

    expect(redacted.headers.Authorization).toBe(REDACTED_SECRET)
    expect(redacted.headers['X-Api-Key']).toBe(REDACTED_SECRET)
    expect(redacted.env.CLIENT_SECRET).toBe(REDACTED_SECRET)
    expect(redacted.env.PASSWORD).toBe(REDACTED_SECRET)
    expect(redacted.env.NORMAL).toBe('visible')
  })
})
