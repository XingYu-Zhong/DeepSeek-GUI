import { describe, expect, it } from 'vitest'

import { buildMcpMarketplaceOverlay } from './plugin-marketplace-runtime'

describe('buildMcpMarketplaceOverlay', () => {
  it('summarizes connected MCP runtime state', () => {
    const overlay = buildMcpMarketplaceOverlay({
      runtimeInfo: {
        host: '127.0.0.1',
        port: 8899,
        dataDir: '/tmp/kun',
        startedAt: '2026-06-03T00:00:00.000Z',
        capabilities: {
          contractVersion: 1,
          model: {
            id: 'deepseek-chat',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          },
          cli: {
            serve: { status: 'available', enabled: true, available: true },
            run: { status: 'disabled', enabled: false, available: false },
            chat: { status: 'disabled', enabled: false, available: false },
            exec: { status: 'disabled', enabled: false, available: false }
          },
          mcp: {
            status: 'available',
            enabled: true,
            available: true,
            configuredServers: 2,
            connectedServers: 1,
            toolCount: 12,
            search: {
              enabled: true,
              mode: 'auto',
              active: true,
              indexedToolCount: 12,
              advertisedToolCount: 3
            }
          },
          web: {
            status: 'disabled',
            enabled: false,
            available: false,
            fetch: { status: 'disabled', enabled: false, available: false },
            search: { status: 'disabled', enabled: false, available: false }
          },
          skills: { status: 'disabled', enabled: false, available: false, configuredRoots: 0, discoveredSkills: 0 },
          subagents: { status: 'disabled', enabled: false, available: false, maxParallel: 0, maxChildRuns: 0 },
          attachments: {
            status: 'disabled',
            enabled: false,
            available: false,
            maxImageBytes: 1,
            maxImageDimension: 1,
            allowedMimeTypes: []
          },
          memory: { status: 'disabled', enabled: false, available: false, scopes: ['user'], maxInjectedRecords: 1 }
        }
      },
      toolDiagnostics: {
        mcpServers: [
          { id: 'github', status: 'connected', toolCount: 12 },
          { id: 'local', status: 'disabled', toolCount: 0 }
        ],
        mcpSearch: {
          enabled: true,
          mode: 'auto',
          active: true,
          indexedToolCount: 12,
          advertisedToolCount: 3
        }
      }
    })

    expect(overlay).toMatchObject({
      status: 'connected',
      configuredServers: 2,
      connectedServers: 1,
      toolCount: 12,
      serverIds: ['github', 'local'],
      searchActive: true,
      indexedToolCount: 12,
      advertisedToolCount: 3
    })
  })

  it('prioritizes error and drift diagnostics', () => {
    expect(buildMcpMarketplaceOverlay({
      toolDiagnostics: {
        mcpServers: [{ id: 'bad', status: 'error', lastError: 'missing token' }]
      }
    })).toMatchObject({
      status: 'error',
      errorCount: 1,
      lastError: 'missing token'
    })

    expect(buildMcpMarketplaceOverlay({
      toolDiagnostics: {
        mcpServers: [{ id: 'docs', status: 'connected', catalogDrift: true, toolCount: 5 }]
      }
    })).toMatchObject({
      status: 'drift',
      driftCount: 1
    })
  })

  it('reports disabled and offline states', () => {
    expect(buildMcpMarketplaceOverlay({
      runtimeInfo: {
        host: '127.0.0.1',
        port: 8899,
        dataDir: '/tmp/kun',
        startedAt: '2026-06-03T00:00:00.000Z',
        capabilities: {
          contractVersion: 1,
          model: {
            id: 'deepseek-chat',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          },
          cli: {
            serve: { status: 'available', enabled: true, available: true },
            run: { status: 'disabled', enabled: false, available: false },
            chat: { status: 'disabled', enabled: false, available: false },
            exec: { status: 'disabled', enabled: false, available: false }
          },
          mcp: {
            status: 'disabled',
            enabled: false,
            available: false,
            configuredServers: 0,
            connectedServers: 0,
            toolCount: 0
          },
          web: {
            status: 'disabled',
            enabled: false,
            available: false,
            fetch: { status: 'disabled', enabled: false, available: false },
            search: { status: 'disabled', enabled: false, available: false }
          },
          skills: { status: 'disabled', enabled: false, available: false, configuredRoots: 0, discoveredSkills: 0 },
          subagents: { status: 'disabled', enabled: false, available: false, maxParallel: 0, maxChildRuns: 0 },
          attachments: {
            status: 'disabled',
            enabled: false,
            available: false,
            maxImageBytes: 1,
            maxImageDimension: 1,
            allowedMimeTypes: []
          },
          memory: { status: 'disabled', enabled: false, available: false, scopes: ['user'], maxInjectedRecords: 1 }
        }
      }
    }).status).toBe('disabled')

    expect(buildMcpMarketplaceOverlay({}).status).toBe('offline')
  })

  it('includes GUI-managed MCP servers before runtime diagnostics connect', () => {
    expect(buildMcpMarketplaceOverlay({
      managedServers: [{ id: 'gui_schedule', toolCount: 4 }]
    })).toMatchObject({
      status: 'offline',
      configuredServers: 1,
      toolCount: 4,
      serverIds: ['gui_schedule']
    })
  })
})
