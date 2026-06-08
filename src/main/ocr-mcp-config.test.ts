import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'
import {
  buildOcrMcpServerConfig,
  syncOcrMcpConfig,
  resolveOcrMcpNodeEntryPath,
  type OcrMcpLaunchConfig
} from './ocr-mcp-config'

function createLaunchConfig(overrides: Partial<OcrMcpLaunchConfig> = {}): OcrMcpLaunchConfig {
  return {
    appPath: '/Applications/DeepSeek GUI.app/Contents/Resources/app.asar',
    execPath: '/Applications/DeepSeek GUI.app/Contents/MacOS/DeepSeek GUI',
    isPackaged: true,
    ...overrides
  }
}

describe('ocr-mcp-config', () => {
  const tempDirs: string[] = []

  afterAll(async () => {
    for (const dir of tempDirs) {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  describe('resolveOcrMcpNodeEntryPath', () => {
    it('returns the correct path for packaged macOS app', () => {
      const launch = createLaunchConfig()
      const result = resolveOcrMcpNodeEntryPath(launch)
      expect(result).toContain('out/main/ocr-mcp-node-entry.js')
      expect(result).toContain('app.asar')
    })

    it('returns the correct path for development (non-packaged)', () => {
      const launch = createLaunchConfig({
        appPath: '/Users/dev/deepseek-gui',
        isPackaged: false
      })
      const result = resolveOcrMcpNodeEntryPath(launch)
      expect(result).toContain('out/main/ocr-mcp-node-entry.js')
      expect(result).not.toContain('app.asar')
    })
  })

  describe('buildOcrMcpServerConfig', () => {
    it('returns a valid server config object', () => {
      const launch = createLaunchConfig()
      const config = buildOcrMcpServerConfig(launch)

      expect(config).toHaveProperty('command')
      expect(config).toHaveProperty('args')
      expect(config).toHaveProperty('env')
      expect(config).toHaveProperty('disabled', false)
      expect(config).toHaveProperty('enabled', true)

      const args = config.args as string[]
      expect(args).toContain('--gui-ocr-mcp-server')

      const env = config.env as Record<string, string>
      expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    })
  })

  describe('syncOcrMcpConfig', () => {
    it('creates a new mcp.json with gui_ocr server when none exists', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'ocr-mcp-test-'))
      tempDirs.push(tmpDir)
      const mcpJsonPath = join(tmpDir, 'mcp.json')

      const launch = createLaunchConfig()
      await syncOcrMcpConfig(launch, mcpJsonPath)

      const raw = await readFile(mcpJsonPath, 'utf8')
      const parsed = JSON.parse(raw)

      expect(parsed.servers).toBeDefined()
      expect(parsed.servers.gui_ocr).toBeDefined()
      expect(parsed.servers.gui_ocr.enabled).toBe(true)
      expect(parsed.servers.gui_ocr.args).toContain('--gui-ocr-mcp-server')
    })

    it('preserves existing servers when adding gui_ocr', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'ocr-mcp-test-'))
      tempDirs.push(tmpDir)
      const mcpJsonPath = join(tmpDir, 'mcp.json')

      // Pre-create mcp.json with another server
      const existing = {
        timeouts: { connect_timeout: 10, execute_timeout: 60, read_timeout: 120 },
        servers: {
          my_custom_server: {
            command: '/usr/bin/my-tool',
            args: ['--serve'],
            env: {},
            url: null,
            connect_timeout: null,
            execute_timeout: null,
            read_timeout: null,
            disabled: false,
            enabled: true,
            required: false,
            enabled_tools: [],
            disabled_tools: []
          }
        }
      }
      await writeFile(mcpJsonPath, JSON.stringify(existing, null, 2), 'utf8')

      const launch = createLaunchConfig()
      await syncOcrMcpConfig(launch, mcpJsonPath)

      const raw = await readFile(mcpJsonPath, 'utf8')
      const parsed = JSON.parse(raw)

      expect(parsed.servers.my_custom_server).toBeDefined()
      expect(parsed.servers.gui_ocr).toBeDefined()
    })

    it('is idempotent — does not change file when config is unchanged', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'ocr-mcp-test-'))
      tempDirs.push(tmpDir)
      const mcpJsonPath = join(tmpDir, 'mcp.json')

      const launch = createLaunchConfig()
      await syncOcrMcpConfig(launch, mcpJsonPath)

      const raw1 = await readFile(mcpJsonPath, 'utf8')
      await syncOcrMcpConfig(launch, mcpJsonPath)
      const raw2 = await readFile(mcpJsonPath, 'utf8')

      expect(raw1).toBe(raw2)
    })
  })
})
