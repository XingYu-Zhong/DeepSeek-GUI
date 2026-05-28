import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedClawScheduleMcpJson,
  clawScheduleMcpSettingsChanged,
  removeLegacyClawScheduleTomlConfig,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { defaultClawSettings, defaultWriteSettings, type AppSettingsV1 } from '../shared/app-settings'

function createSettings(patch: Partial<AppSettingsV1['claw']['im']> = {}): AppSettingsV1 {
  const claw = defaultClawSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agentProvider: 'codewhale',
    agents: {
      codewhale: {
        binaryPath: '',
        port: 7878,
        autoStart: true,
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/beta',
        runtimeToken: '',
        extraCorsOrigins: [],
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write'
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    write: defaultWriteSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    claw: {
      ...claw,
      enabled: true,
      im: {
        ...claw.im,
        enabled: true,
        port: 8787,
        secret: '',
        ...patch
      }
    }
  }
}

const launch: ClawScheduleMcpLaunchConfig = {
  appPath: '/Applications/DeepSeek GUI.app',
  execPath: '/Applications/DeepSeek GUI.app/Contents/MacOS/DeepSeek GUI',
  isPackaged: false
}

describe('claw schedule MCP config', () => {
  it('writes the claw_schedule server to the MCP JSON config shape used by DeepSeek TUI', () => {
    const settings = createSettings({ port: 9787, secret: 'top-secret' })
    const synced = buildSyncedClawScheduleMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          }
        }
      },
      settings,
      launch
    )

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      },
      claw_schedule: {
        command: launch.execPath,
        args: [
          launch.appPath,
          '--claw-schedule-mcp-server',
          '--base-url',
          'http://127.0.0.1:9787',
          '--secret',
          'top-secret'
        ],
        url: null,
        enabled: true
      }
    })
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('removes legacy config.toml claw_schedule blocks without touching other MCP servers', () => {
    const cleaned = removeLegacyClawScheduleTomlConfig(
      [
        'provider = "deepseek"',
        '',
        '[mcp_servers.context7]',
        'command = "npx"',
        '',
        '[mcp_servers.claw_schedule]',
        'command = "old"',
        'args = []',
        '',
        '# DeepSeek GUI plugin:mcp:claw-schedule START',
        '[mcp_servers.claw_schedule]',
        'command = "electron"',
        'args = []',
        '# DeepSeek GUI plugin:mcp:claw-schedule END',
        '',
        '[providers.deepseek]',
        'api_key = ""'
      ].join('\n')
    )

    expect(cleaned).toContain('[mcp_servers.context7]')
    expect(cleaned).toContain('[providers.deepseek]')
    expect(cleaned).not.toContain('[mcp_servers.claw_schedule]')
    expect(cleaned).not.toContain('DeepSeek GUI plugin:mcp:claw-schedule')
  })

  it('does not rewrite config.toml text when there is no legacy claw_schedule block', () => {
    const current = [
      'provider = "deepseek"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      '',
      ''
    ].join('\n')

    expect(removeLegacyClawScheduleTomlConfig(current)).toBe(current)
  })

  it('syncs mcp.json and cleans the old config.toml entry on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ds-gui-mcp-'))
    const deepseekDir = join(root, '.deepseek')
    const configTomlPath = join(deepseekDir, 'config.toml')
    const mcpJsonPath = join(deepseekDir, 'mcp.json')
    await mkdir(deepseekDir, { recursive: true })
    await writeFile(
      configTomlPath,
      [
        'provider = "deepseek"',
        '',
        '# DeepSeek GUI plugin:mcp:claw-schedule START',
        '[mcp_servers.claw_schedule]',
        'command = "electron"',
        'args = []',
        '# DeepSeek GUI plugin:mcp:claw-schedule END',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        servers: {
          existing: {
            command: '/bin/echo',
            args: ['ok'],
            env: {},
            url: null
          }
        }
      }),
      'utf8'
    )

    await syncClawScheduleMcpConfig(createSettings(), launch, { configTomlPath, mcpJsonPath })

    const toml = await readFile(configTomlPath, 'utf8')
    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>

    expect(toml).toBe('provider = "deepseek"\n')
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        },
        claw_schedule: {
          command: launch.execPath,
          args: [launch.appPath, '--claw-schedule-mcp-server', '--base-url', 'http://127.0.0.1:8787']
        }
      }
    })
  })

  it('requests a runtime restart when the MCP launch arguments change', () => {
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings({ port: 9876 }))).toBe(true)
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings({ secret: 'abc' }))).toBe(true)
  })
})
