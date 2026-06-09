import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runAgentCommand,
  splitKunCliCommand,
  type CliIo
} from '../src/cli/agent-cli.js'
import { ServeExitCode } from '../src/cli/serve.js'
import type { ServeOptions } from '../src/cli/cli-options.js'
import type { ServerRuntime } from '../src/server/routes/server-runtime.js'
import type { TurnItem } from '../src/contracts/items.js'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { GOAL_TOOL_NAMES } from '../src/adapters/tool/goal-tools.js'

type Capture = {
  stdout: string
  stderr: string
  io: CliIo
}

function capture(overrides: Partial<CliIo> = {}): Capture {
  const out = { stdout: '', stderr: '' }
  return {
    ...out,
    io: {
      stdout: { write: (chunk) => { out.stdout += chunk } },
      stderr: { write: (chunk) => { out.stderr += chunk } },
      env: {},
      cwd: () => '/tmp/ws',
      ...overrides
    },
    get stdout() {
      return out.stdout
    },
    get stderr() {
      return out.stderr
    }
  }
}

function assistantItem(text: string): TurnItem {
  return {
    id: 'item_assistant',
    turnId: 'turn_1',
    threadId: 'thr_1',
    role: 'assistant',
    status: 'completed',
    createdAt: 'now',
    finishedAt: 'now',
    kind: 'assistant_text',
    text
  }
}

function fakeRuntime(input: {
  items?: TurnItem[]
  status?: 'completed' | 'failed' | 'aborted'
  throwRun?: boolean
  toolHost?: ServerRuntime['toolHost']
  onShutdown?: () => void
  onOptions?: (options: ServeOptions) => void
} = {}): CliIo['createRuntime'] {
  return async (options) => {
    input.onOptions?.(options)
    const items = input.items ?? [assistantItem('hello from fake model')]
    const status = input.status ?? 'completed'
    return {
      threadService: {
        create: async () => ({
          id: 'thr_1',
          title: 'CLI',
          workspace: '/tmp/ws',
          model: options.model,
          mode: 'agent',
          status: 'idle',
          approvalPolicy: options.approvalPolicy,
          sandboxMode: options.sandboxMode,
          relation: 'primary',
          createdAt: 'now',
          updatedAt: 'now',
          turns: []
        })
      },
      turnService: {
        startTurn: async () => ({
          threadId: 'thr_1',
          turnId: 'turn_1',
          userMessageItemId: 'item_user'
        })
      },
      eventBus: {
        subscribe: () => () => undefined
      },
      sessionStore: {
        loadItems: async () => items
      },
      toolHost: input.toolHost,
      runTurn: async () => {
        if (input.throwRun) throw new Error('model exploded')
        return status
      },
      shutdown: async () => {
        input.onShutdown?.()
      }
    } as unknown as ServerRuntime
  }
}

describe('Kun agent CLI commands', () => {
  let dataDir = ''

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cli-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('splits explicit commands and keeps legacy serve flags compatible', () => {
    expect(splitKunCliCommand(['run', 'hello'])).toEqual({ command: 'run', args: ['hello'] })
    expect(splitKunCliCommand(['--port', '9999'])).toEqual({
      command: 'serve',
      args: ['--port', '9999']
    })
    expect(splitKunCliCommand(['nope']).error).toMatch(/unknown command/)
  })

  it('lists tools from kun exec with JSON output', async () => {
    const c = capture()
    const code = await runAgentCommand('exec', [
      '--data-dir',
      dataDir,
      '--workspace',
      dataDir,
      '--list-tools',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.ok)
    const parsed = JSON.parse(c.stdout) as { tools: Array<{ name: string; providerId?: string }> }
    const providerByTool = new Map(parsed.tools.map((tool) => [tool.name, tool.providerId]))
    expect(providerByTool.get('read')).toBe('builtin')
    expect(providerByTool.get('echo')).toBe('builtin')
    for (const toolName of GOAL_TOOL_NAMES) {
      expect(providerByTool.get(toolName)).toBe('goal')
    }
  })

  it('invokes a direct tool through kun exec', async () => {
    const c = capture()
    const code = await runAgentCommand('exec', [
      '--data-dir',
      dataDir,
      '--workspace',
      dataDir,
      '--approval-policy',
      'auto',
      'echo',
      '--args',
      '{"text":"hi"}',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.ok)
    const item = JSON.parse(c.stdout) as { kind: string; output: { echoed?: string } }
    expect(item.kind).toBe('tool_result')
    expect(item.output.echoed).toBe('hi')
  })

  it('lists dynamic runtime tools from kun exec', async () => {
    const webTool = LocalToolHost.defineTool({
      name: 'web_fetch',
      description: 'fetch',
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: { ok: true } })
    })
    const toolHost = new LocalToolHost({
      registry: new CapabilityRegistry([
        { id: 'web', kind: 'web', enabled: true, available: true, tools: [webTool] }
      ])
    })
    let shutdownCalled = false
    const c = capture({
      createRuntime: fakeRuntime({
        toolHost,
        onShutdown: () => {
          shutdownCalled = true
        }
      })
    })
    const code = await runAgentCommand('exec', [
      '--data-dir',
      dataDir,
      '--workspace',
      dataDir,
      '--list-tools',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.ok)
    const parsed = JSON.parse(c.stdout) as { tools: Array<{ name: string; providerId?: string }> }
    expect(parsed.tools).toEqual([
      expect.objectContaining({ name: 'web_fetch', providerId: 'web' })
    ])
    expect(shutdownCalled).toBe(true)
  })

  it('returns config errors for invalid exec args', async () => {
    const c = capture()
    const code = await runAgentCommand('exec', [
      '--data-dir',
      dataDir,
      'echo',
      '--args',
      'nope'
    ], c.io)

    expect(code).toBe(ServeExitCode.config)
    expect(c.stderr).toMatch(/invalid --args JSON/)
  })

  it('runs one prompt and emits machine-readable JSON', async () => {
    const c = capture({ createRuntime: fakeRuntime() })
    const code = await runAgentCommand('run', [
      '--data-dir',
      dataDir,
      '--prompt',
      'hello',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.ok)
    const parsed = JSON.parse(c.stdout) as { status: string; items: TurnItem[] }
    expect(parsed.status).toBe('completed')
    expect(parsed.items.some((item) => item.kind === 'assistant_text')).toBe(true)
  })

  it('returns runtime failures from one-shot runs', async () => {
    const c = capture({ createRuntime: fakeRuntime({ throwRun: true }) })
    const code = await runAgentCommand('run', [
      '--data-dir',
      dataDir,
      '--prompt',
      'hello'
    ], c.io)

    expect(code).toBe(ServeExitCode.runtime)
    expect(c.stderr).toMatch(/model exploded/)
  })

  it('returns non-zero when a one-shot run is aborted', async () => {
    const c = capture({ createRuntime: fakeRuntime({ status: 'aborted' }) })
    const code = await runAgentCommand('run', [
      '--data-dir',
      dataDir,
      '--prompt',
      'hello',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.runtime)
    expect(JSON.parse(c.stdout).status).toBe('aborted')
  })

  it('shares config loading between serve and agent commands', async () => {
    const configPath = join(dataDir, 'kun.config.json')
    await writeFile(configPath, JSON.stringify({
      serve: {
        dataDir,
        model: 'deepseek-v4-pro',
        approvalPolicy: 'auto'
      }
    }), 'utf8')
    let seen: ServeOptions | undefined
    const c = capture({
      createRuntime: fakeRuntime({
        onOptions: (options) => {
          seen = options
        }
      })
    })
    const code = await runAgentCommand('run', [
      '--config',
      configPath,
      '--prompt',
      'hello',
      '--json'
    ], c.io)

    expect(code).toBe(ServeExitCode.ok)
    expect(seen?.model).toBe('deepseek-v4-pro')
    expect(seen?.approvalPolicy).toBe('auto')
    expect(seen?.dataDir).toBe(dataDir)
  })
})
