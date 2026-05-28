import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GUI_UPDATE_CHANNEL } from '../shared/gui-update'
import { JsonSettingsStore } from './settings-store'

describe('JsonSettingsStore', () => {
  it('defaults GUI updates to the stable channel for new settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.guiUpdate.channel).toBe(DEFAULT_GUI_UPDATE_CHANNEL)
  })

  it('creates a default write workspace with welcome.md', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.defaultWorkspaceRoot).toContain('.deepseekgui')
    expect(loaded.write.workspaces).toContain(loaded.write.defaultWorkspaceRoot)
    expect(loaded.write.inlineCompletion.enabled).toBe(true)
    expect(loaded.write.inlineCompletion.retrievalEnabled).toBe(true)
    expect(loaded.write.inlineCompletion.longCompletionEnabled).toBe(true)
    expect(loaded.write.inlineCompletion.baseUrl).toBe('https://api.deepseek.com/beta')
    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-flash')
    expect(loaded.write.inlineCompletion.longMaxTokens).toBe(256)
    expect(await readFile(join(loaded.write.defaultWorkspaceRoot, 'welcome.md'), 'utf8')).toContain('Welcome to Write')
  })

  it('preserves the pro write completion model', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-pro'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-pro')
  })

  it('preserves deepseek.autoStart=false when loading saved settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot,
        deepseek: {
          autoStart: false
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.codewhale.autoStart).toBe(false)
  })

  it('migrates legacy deepseek-runtime agentProvider to codewhale', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        deepseek: { port: 8787 }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agentProvider).toBe('codewhale')
    expect(loaded.agents.codewhale.port).toBe(8787)
  })

  it('backs up invalid JSON and replaces it with defaults', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    await writeFile(settingsPath, '{ invalid json', 'utf8')

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const files = await readdir(userDataDir)
    const backupName = files.find((file) => file.startsWith('deepseek-gui-settings.invalid-'))

    expect(loaded.workspaceRoot.length).toBeGreaterThan(0)
    expect(backupName).toBeTruthy()
    expect(await readFile(join(userDataDir, backupName ?? ''), 'utf8')).toBe('{ invalid json')
    const replaced = await readFile(settingsPath, 'utf8')
    expect(() => JSON.parse(replaced)).not.toThrow()
  })

  it('throws for non-recoverable read errors', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    await mkdir(settingsPath, { recursive: true })

    const store = new JsonSettingsStore(userDataDir)

    await expect(store.load()).rejects.toThrow(/Failed to read settings file/)
  })
})
