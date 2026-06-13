import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLogger } from './logger'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { KunConfigSchema } from '../../kun/src/config/kun-config.js'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

let tempRoot: string | null = null

function createSettings(binaryPath: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(8899),
        binaryPath,
        autoStart: true
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function writeScript(name: string, content: string): string {
  if (!tempRoot) throw new Error('temp root not initialized')
  const path = join(tempRoot, name)
  writeFileSync(path, content, 'utf8')
  return path
}

async function readKunLog(): Promise<string> {
  if (!tempRoot) throw new Error('temp root not initialized')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logFile = readdirSync(tempRoot).find((entry) => entry.startsWith('kun-') && entry.endsWith('.log'))
    if (logFile) return readFileSync(join(tempRoot, logFile), 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected a kun log file to be created')
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kun-process-'))
  configureLogger({ dir: tempRoot, enabled: true, retentionDays: 7 })
})

afterEach(async () => {
  const module = await import('./kun-process')
  await module.stopKunChildAndWait()
  configureLogger({ dir: '', enabled: true, retentionDays: 2 })
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('startKunChild', () => {
  it('waits for the explicit Kun ready marker before resolving', async () => {
    const script = writeScript(
      'ready-child.js',
      [
        "setTimeout(() => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "}, 50)",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./kun-process')
    await expect(module.startKunChild(createSettings(script))).resolves.toBeUndefined()
    expect(module.isKunChildRunning()).toBe(true)
    await module.stopKunChildAndWait()
    const logText = await readKunLog()
    expect(logText).toContain('KUN_READY')
    expect(logText).toContain('ready marker received on port 8899')
  })

  it('shares the startup promise while Kun is spawned but not ready', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const readySignalPath = join(tempRoot, 'allow-ready')
    const script = writeScript(
      'delayed-ready-child.js',
      [
        "const { existsSync } = require('node:fs')",
        `const readySignalPath = ${JSON.stringify(readySignalPath)}`,
        'let sentReady = false',
        'setInterval(() => {',
        '  if (sentReady || !existsSync(readySignalPath)) return',
        '  sentReady = true',
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        '}, 10)',
        'setInterval(() => {}, 1_000)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    const settings = createSettings(script)
    const first = module.startKunChild(settings)

    for (let attempt = 0; attempt < 100 && !module.isKunChildRunning(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(module.isKunChildRunning()).toBe(true)

    let secondResolved = false
    const second = module.startKunChild(settings).then(() => {
      secondResolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(secondResolved).toBe(false)

    writeFileSync(readySignalPath, 'ready', 'utf8')
    await first
    await second
    expect(secondResolved).toBe(true)
  })

  it('rejects when the child exits before reporting ready', async () => {
    const script = writeScript(
      'exit-child.js',
      [
        "process.stderr.write('bind failed on port 8899\\n')",
        'setTimeout(() => process.exit(23), 20)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    await expect(module.startKunChild(createSettings(script))).rejects.toThrow(
      /Kun exited during startup with code 23[\s\S]*bind failed on port 8899/
    )
    expect(module.isKunChildRunning()).toBe(false)
    await module.stopKunChildAndWait()
    const logText = await readKunLog()
    expect(logText).toContain('bind failed on port 8899')
    expect(logText).toContain('exited with code 23')
  })
})

describe('reclaimKunPort', () => {
  it('reports a port as unavailable when another listener owns it', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = server.address() as AddressInfo
      const module = await import('./kun-process')

      await expect(module.reclaimKunPort(address.port)).resolves.toEqual({
        ok: false,
        message: `port ${address.port} is in use`
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('allows non-positive ports so Kun can request an ephemeral port', async () => {
    const module = await import('./kun-process')

    await expect(module.reclaimKunPort(0)).resolves.toEqual({ ok: true })
  })

  it('resolves an available fallback port when the preferred port is unavailable', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = server.address() as AddressInfo
      const module = await import('./kun-process')

      const resolved = await module.resolveAvailableKunPort(address.port)

      expect(resolved.changed).toBe(true)
      expect(resolved.message).toBe(`port ${address.port} is in use`)
      expect(resolved.port).not.toBe(address.port)
      await expect(module.reclaimKunPort(resolved.port)).resolves.toEqual({ ok: true })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('resolveKunDataDir', () => {
  it('expands Windows-style home-relative data directories', async () => {
    const module = await import('./kun-process')

    expect(module.resolveKunDataDir({ dataDir: '~\\deepseek\\kun' })).toBe(join(homedir(), 'deepseek', 'kun'))
  })

  it('does not expand non-home tilde prefixes', async () => {
    const module = await import('./kun-process')

    expect(module.resolveKunDataDir({ dataDir: '~other\\kun' })).toBe('~other\\kun')
  })
})

describe('parseListeningPidsFromNetstat', () => {
  it('extracts the listening TCP PIDs for the port across IPv4/IPv6, ignoring everything else', async () => {
    const { parseListeningPidsFromNetstat } = await import('./kun-process')
    const output = [
      '',
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1010',
      '  TCP    127.0.0.1:8899         0.0.0.0:0              LISTENING       6789',
      '  TCP    [::1]:8899             [::]:0                 LISTENING       6789',
      '  TCP    127.0.0.1:8899         127.0.0.1:51000        ESTABLISHED     7000',
      '  TCP    127.0.0.1:18899        0.0.0.0:0              LISTENING       8000',
      '  UDP    0.0.0.0:8899           *:*                                    9000',
      `  TCP    127.0.0.1:8899         0.0.0.0:0              LISTENING       ${process.pid}`,
      ''
    ].join('\r\n')

    // Dedups IPv4+IPv6 rows for the same PID; excludes the :135 listener, the
    // ESTABLISHED row, the :18899 suffix collision, the UDP row, and our own PID.
    expect(parseListeningPidsFromNetstat(output, 8899)).toEqual([6789])
  })

  it('returns no PIDs when nothing listens on the port', async () => {
    const { parseListeningPidsFromNetstat } = await import('./kun-process')
    const output = '  TCP    127.0.0.1:8899         0.0.0.0:0              LISTENING       6789'

    expect(parseListeningPidsFromNetstat(output, 9999)).toEqual([])
  })
})

describe('syncGuiManagedKunConfig', () => {
  it('creates GUI-managed config with attachments enabled for image paste/upload', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.serve.storage).toMatchObject({ backend: 'hybrid' })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: false,
      compressToolDescriptions: true,
      compressToolResults: true,
      conciseResponses: true,
      historyHygiene: {
        maxToolResultLines: 320,
        maxToolResultBytes: 32768,
        maxToolResultTokens: 8000,
        maxToolArgumentStringBytes: 8192,
        maxToolArgumentStringTokens: 2000,
        maxArrayItems: 80
      }
    })
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 16000,
      defaultHardThreshold: 24000,
      summaryMode: 'heuristic'
    })
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.models.profiles['deepseek-v4-flash']).toMatchObject({
      aliases: ['deepseek-chat', 'deepseek-reasoner'],
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.toolStorm).toMatchObject({ enabled: true, windowSize: 8, threshold: 3 })
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 524288 })
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.web).toMatchObject({ enabled: true, fetchEnabled: true })
    expect(parsed.capabilities.mcp.search).toMatchObject({ enabled: false, mode: 'auto' })
    expect(parsed.capabilities.imageGen).toEqual({
      enabled: false,
      protocol: 'openai-images',
      timeoutMs: 180000
    })
    expect(parsed.capabilities.speechGen).toEqual({
      enabled: false,
      protocol: 'openai-speech',
      timeoutMs: 120000,
      format: 'mp3'
    })
    expect(parsed.capabilities.musicGen).toEqual({
      enabled: false,
      protocol: 'minimax-music',
      timeoutMs: 300000,
      format: 'mp3'
    })
    expect(parsed.capabilities.videoGen).toEqual({
      enabled: false,
      protocol: 'minimax-video',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
  })

  it('writes the image generation capability and omits cleared fields', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const runtime = {
      ...defaultKunRuntimeSettings(),
      imageGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'openai-images' as const,
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-image-test',
        model: 'Kwai-Kolors/Kolors',
        defaultSize: '',
        timeoutMs: 240000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.imageGen).toEqual({
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-image-test',
      model: 'Kwai-Kolors/Kolors',
      timeoutMs: 240000
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)

    // Clearing the key in GUI settings must remove it from config.json.
    await module.syncGuiManagedKunConfig(tempRoot, {
      ...runtime,
      imageGeneration: { ...runtime.imageGeneration, apiKey: '' }
    })
    const cleared = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect('apiKey' in cleared.capabilities.imageGen).toBe(false)
  })

  it('keeps the config stable across repeated syncs with imageGen configured', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const runtime = {
      ...defaultKunRuntimeSettings(),
      imageGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'openai-images' as const,
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-image-test',
        model: 'Kwai-Kolors/Kolors',
        defaultSize: '1024x1024',
        timeoutMs: 180000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)
    const firstText = readFileSync(configPath, 'utf8')
    const firstMtime = statSync(configPath).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 25))

    // If the capability sanitizer strips imageGen from the existing config,
    // every sync rewrites the file and restarts Kun in a loop.
    await module.syncGuiManagedKunConfig(tempRoot, runtime)
    expect(readFileSync(configPath, 'utf8')).toBe(firstText)
    expect(statSync(configPath).mtimeMs).toBe(firstMtime)
  })

  it('writes media generation capabilities and omits cleared optional fields', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const runtime = {
      ...defaultKunRuntimeSettings(),
      textToSpeech: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-t2a' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-tts-test',
        model: 'speech-2.8-hd',
        voice: 'male-qn-qingse',
        format: 'mp3',
        timeoutMs: 120000
      },
      musicGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-music' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-music-test',
        model: 'music-2.6',
        format: 'mp3',
        timeoutMs: 300000
      },
      videoGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-video' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-video-test',
        model: 'MiniMax-Hailuo-2.3',
        defaultDuration: 6,
        defaultResolution: '1080P',
        timeoutMs: 900000,
        pollIntervalMs: 10000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.speechGen).toEqual({
      enabled: true,
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-tts-test',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'mp3',
      timeoutMs: 120000
    })
    expect(parsed.capabilities.musicGen).toEqual({
      enabled: true,
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music-test',
      model: 'music-2.6',
      format: 'mp3',
      timeoutMs: 300000
    })
    expect(parsed.capabilities.videoGen).toEqual({
      enabled: true,
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video-test',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...runtime,
      textToSpeech: { ...runtime.textToSpeech, apiKey: '', voice: '' }
    })
    const cleared = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect('apiKey' in cleared.capabilities.speechGen).toBe(false)
    expect('voice' in cleared.capabilities.speechGen).toBe(false)
  })

  it('adds the built-in schedule MCP server to Kun runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    settings.schedule.internal.port = 9788
    settings.schedule.internal.secret = 'top-secret'

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/deepseek-gui-test-app/out/main/claw-schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:9788',
        '--secret',
        'top-secret'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      },
      trustScope: 'user'
    })
  })

  it('adds GUI project and configured global skill roots to Kun runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const workspaceRoot = join(tempRoot, 'workspace')
    const extraRoot = join(tempRoot, 'extra-skills')
    settings.workspaceRoot = workspaceRoot
    settings.claw.skills.extraDirs = [extraRoot]
    mkdirSync(join(workspaceRoot, '.codex', 'skills'), { recursive: true })

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.enabled).toBe(true)
    expect(parsed.capabilities.skills.legacySkillMd).toBe(true)
    expect(parsed.capabilities.skills.roots).toEqual(expect.arrayContaining([
      join(workspaceRoot, '.codex', 'skills'),
      extraRoot
    ]))
  })

  it('writes GUI-managed MCP search settings without removing existing servers', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      legacyTopLevelFlag: true,
      contextCompaction: {
        modelProfiles: {
          'custom-model': {
            contextWindowTokens: 128000
          }
        }
      },
      models: {
        profiles: {
          'user-model': {
            contextWindowTokens: 96000,
            contextCompaction: {
              softThreshold: 86000
            }
          },
          'deepseek-v4-pro': {
            contextCompaction: {
              softThreshold: 970000
            }
          }
        }
      },
      runtime: {
        customRuntimeFlag: true,
        toolStorm: {
          customStormFlag: 'keep'
        }
      },
      serve: {
        legacyServeFlag: true,
        tokenEconomy: {
          customTokenEconomyFlag: 'keep',
          historyHygiene: {
            customHistoryFlag: true
          }
        }
      },
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp',
              trustScope: 'user'
            }
          }
        },
        web: {
          enabled: true,
          fetchEnabled: true
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      storage: {
        backend: 'hybrid',
        sqlitePath: '/tmp/kun-index.sqlite3'
      },
      contextCompaction: {
        defaultSoftThreshold: 32000,
        defaultHardThreshold: 64000,
        summaryMode: 'model',
        summaryTimeoutMs: 30000,
        summaryMaxTokens: 1600,
        summaryInputMaxBytes: 131072
      },
      runtimeTuning: {
        toolStorm: {
          enabled: false,
          windowSize: 12,
          threshold: 4
        },
        toolArgumentRepair: {
          maxStringBytes: 262144
        }
      },
      mcpSearch: {
        enabled: true,
        mode: 'search',
        autoThresholdToolCount: 12,
        topKDefault: 4,
        topKMax: 9,
        minScore: 0.2
      },
      tokenEconomy: {
        enabled: true,
        compressToolDescriptions: false,
        compressToolResults: true,
        conciseResponses: false,
        historyHygiene: {
          maxToolResultLines: 100,
          maxToolResultBytes: 16384,
          maxToolResultTokens: 4000,
          maxToolArgumentStringBytes: 4096,
          maxToolArgumentStringTokens: 1000,
          maxArrayItems: 40
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.legacyTopLevelFlag).toBeUndefined()
    expect(parsed.serve.legacyServeFlag).toBeUndefined()
    expect(parsed.serve.storage).toMatchObject({
      backend: 'hybrid',
      sqlitePath: '/tmp/kun-index.sqlite3'
    })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: true,
      compressToolDescriptions: false,
      compressToolResults: true,
      conciseResponses: false,
      historyHygiene: {
        maxToolResultLines: 100,
        maxToolResultBytes: 16384,
        maxToolResultTokens: 4000,
        maxToolArgumentStringBytes: 4096,
        maxToolArgumentStringTokens: 1000,
        maxArrayItems: 40
      }
    })
    expect(parsed.serve.tokenEconomy.customTokenEconomyFlag).toBeUndefined()
    expect(parsed.serve.tokenEconomy.historyHygiene.customHistoryFlag).toBeUndefined()
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 32000,
      defaultHardThreshold: 64000,
      summaryMode: 'model',
      summaryTimeoutMs: 30000,
      summaryMaxTokens: 1600,
      summaryInputMaxBytes: 131072
    })
    expect(parsed.contextCompaction.modelProfiles['custom-model']).toMatchObject({
      contextWindowTokens: 128000
    })
    expect(parsed.models.profiles['user-model']).toMatchObject({
      contextWindowTokens: 96000,
      contextCompaction: {
        softThreshold: 86000
      }
    })
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 970_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.toolStorm).toMatchObject({
      enabled: false,
      windowSize: 12,
      threshold: 4
    })
    expect(parsed.runtime.toolStorm.customStormFlag).toBeUndefined()
    expect(parsed.runtime.customRuntimeFlag).toBeUndefined()
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 262144 })
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.mcp.servers.github.command).toBe('github-mcp')
    expect(parsed.capabilities.web.fetchEnabled).toBe(true)
    expect(parsed.capabilities.mcp.search).toMatchObject({
      enabled: true,
      mode: 'search',
      autoThresholdToolCount: 12,
      topKDefault: 4,
      topKMax: 9,
      minScore: 0.2
    })
  })

  it('imports GUI-managed MCP servers into runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: {
        'stata-mcp': {
          command: 'uvx',
          args: ['stata-mcp'],
          env: {
            STATA_CLI: 'D:\\stata\\StataMP-64.exe'
          },
          enabled: true,
          disabled: false
        },
        'docs-mcp': {
          url: 'https://mcp.example.test/mcp',
          headers: {
            Authorization: 'Bearer docs-token'
          }
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers['stata-mcp']).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['stata-mcp'],
      env: {
        STATA_CLI: 'D:\\stata\\StataMP-64.exe'
      },
      trustScope: 'user'
    })
    expect(parsed.capabilities.mcp.servers['docs-mcp']).toMatchObject({
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      headers: {
        Authorization: 'Bearer docs-token'
      },
      trustScope: 'user'
    })
  })

  it('replaces unparsable historical Kun config with a valid GUI-managed config', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, '{ legacy config', 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('does not enable MCP when the capability is explicitly disabled', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        mcp: {
          enabled: false
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings: createSettings('/tmp/fake-kun-child.js'),
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(false)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/deepseek-gui-test-app/out/main/claw-schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:8788'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
  })

  it('does not override an explicitly disabled attachment capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        attachments: {
          enabled: false,
          maxImageBytes: 1024
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.attachments).toMatchObject({
      enabled: false,
      maxImageBytes: 1024
    })
  })

  it('does not override explicitly disabled web fetch capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        web: {
          enabled: false,
          fetchEnabled: false,
          searchEnabled: true,
          provider: 'custom-search'
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.web).toMatchObject({
      enabled: false,
      fetchEnabled: false,
      searchEnabled: true,
      provider: 'custom-search'
    })
  })
})
