import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildWebToolProviders } from '../src/adapters/tool/web-tool-provider.js'
import {
  buildRuntimeCapabilityManifest,
  KunCapabilitiesConfig
} from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'
import { DeterministicWebProvider } from '../src/ports/web-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/project',
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function deterministicProvider() {
  return new DeterministicWebProvider({
    id: 'test-search',
    nowIso: () => '2026-06-03T00:00:00.000Z',
    pages: {
      'https://docs.example.test/page': {
        url: 'https://docs.example.test/page',
        finalUrl: 'https://docs.example.test/page',
        title: 'Docs Page',
        contentType: 'text/plain',
        text: 'Current docs content'
      }
    },
    searchResults: {
      'kun web': [
        {
          url: 'https://docs.example.test/page',
          title: 'Kun Web Docs',
          snippet: 'How Kun web access works.'
        }
      ]
    }
  })
}

describe('Web tool provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not advertise web tools when web access is disabled', async () => {
    const config = KunCapabilitiesConfig.parse({})
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })

    expect(built.providers).toEqual([])
    expect(built.fetchAvailable).toBe(false)
    expect(built.searchAvailable).toBe(false)
  })

  it('fetches allowed URLs with source metadata and telemetry', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['web_fetch'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page' }
    }, buildContext())

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.isError).toBe(false)
      const output = result.item.output as {
        sourceId: string
        text: string
        sources: Array<{ sourceId: string; url: string; retrievedAt: string }>
        citations: Array<{ sourceId: string }>
        telemetry: { policy: string; provider: string; byteCount: number }
      }
      expect(output.text).toBe('Current docs content')
      expect(output.sources[0]).toMatchObject({
        sourceId: output.sourceId,
        url: 'https://docs.example.test/page',
        retrievedAt: '2026-06-03T00:00:00.000Z'
      })
      expect(output.citations[0]?.sourceId).toBe(output.sourceId)
      expect(output.telemetry).toMatchObject({
        policy: 'allowed',
        provider: 'test-search',
        byteCount: 20
      })
    }
  })

  it('truncates oversized fetch responses instead of failing', async () => {
    vi.stubGlobal('fetch', async () => new Response('abcdefghijklmnopqrstuvwxyz', {
      headers: {
        'content-length': '26',
        'content-type': 'text/plain'
      }
    }))
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/large', max_bytes: 10 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        text: 'abcdefghij',
        byteCount: 26,
        truncated: true,
        telemetry: {
          policy: 'allowed',
          provider: 'fetch',
          byteCount: 26
        }
      })
    }
  })

  it('rejects disallowed fetch URLs before contacting the provider', async () => {
    let contacted = false
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        denyDomains: ['blocked.example.test']
      }
    })
    const provider = new DeterministicWebProvider({
      pages: {
        'https://blocked.example.test/page': {
          url: 'https://blocked.example.test/page',
          finalUrl: 'https://blocked.example.test/page',
          text: 'secret'
        }
      }
    })
    provider.fetch = async (request) => {
      contacted = true
      return DeterministicWebProvider.prototype.fetch.call(provider, request)
    }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://blocked.example.test/page' }
    }, buildContext())

    expect(contacted).toBe(false)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      })
    }
  })

  it('returns unavailable-provider errors for search without a search provider', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'missing'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'kun web' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: {
          code: 'provider_unavailable',
          message: 'web search provider is unavailable'
        }
      })
    }
  })

  it('searches through a configured provider with citations and telemetry', async () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'kun web', limit: 3 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as {
        results: Array<{ sourceId: string; url: string; provider: string; rank: number }>
        sources: Array<{ sourceId: string }>
        telemetry: { resultCount: number; provider: string }
      }
      expect(output.results[0]).toMatchObject({
        url: 'https://docs.example.test/page',
        provider: 'test-search',
        rank: 1
      })
      expect(output.sources[0]?.sourceId).toBe(output.results[0]?.sourceId)
      expect(output.telemetry).toMatchObject({
        resultCount: 1,
        provider: 'test-search'
      })
    }
  })

  it('reports web availability in the runtime capability manifest', () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })
    const manifest = buildRuntimeCapabilityManifest({
      config,
      model: modelCapabilitiesForModel('deepseek-chat'),
      web: {
        fetchAvailable: built.fetchAvailable,
        searchAvailable: built.searchAvailable,
        provider: built.provider
      }
    })

    expect(manifest.web.available).toBe(true)
    expect(manifest.web.fetch.available).toBe(true)
    expect(manifest.web.search.available).toBe(true)
    expect(manifest.web.provider).toBe('test-search')
  })
})
