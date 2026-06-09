import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APPROVAL_POLICY } from '../shared/app-settings'
import { DEFAULT_GUI_UPDATE_CHANNEL } from '../shared/gui-update'
import { JsonSettingsStore } from './settings-store'

describe('JsonSettingsStore', () => {
  it('defaults GUI updates to the stable channel for new settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.guiUpdate.channel).toBe(DEFAULT_GUI_UPDATE_CHANNEL)
    expect(loaded.agents.kun.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(loaded.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    })
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
    expect(loaded.provider.baseUrl).toBe('https://api.deepseek.com')
    expect(loaded.write.inlineCompletion.apiKey).toBe('')
    expect(loaded.write.inlineCompletion.baseUrl).toBe('')
    expect(loaded.write.inlineCompletion.inheritModel).toBe(true)
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

    expect(loaded.write.inlineCompletion.inheritModel).toBe(false)
    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-pro')
  })

  it('treats legacy flash defaults as inherited until the user explicitly overrides them', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-flash'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion.inheritModel).toBe(true)
    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-flash')
  })

  it('migrates legacy deepseek.autoStart=false into Kun', async () => {
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

    expect(loaded.agents.kun.autoStart).toBe(false)
  })

  it('migrates existing Kun credentials into General provider settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agents: {
          kun: {
            apiKey: 'sk-existing',
            baseUrl: 'https://runtime.example/v1'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.provider.apiKey).toBe('sk-existing')
    expect(loaded.provider.baseUrl).toBe('https://runtime.example/v1')
    expect(loaded.agents.kun.apiKey).toBe('')
    expect(loaded.agents.kun.baseUrl).toBe('')
  })

  it('creates the configured code workspace on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const workspaceRoot = join(userDataDir, 'missing-workspace')

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.workspaceRoot).toBe(workspaceRoot)
    expect((await stat(workspaceRoot)).isDirectory()).toBe(true)
  })

  it('migrates legacy deepseek-runtime agentProvider to Kun', async () => {
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

    expect(loaded.agents.kun.port).toBe(8787)
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

  it('merges Kun settings patches', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const saved = await store.patch({
      agents: {
        kun: {
          model: 'deepseek-reasoner',
          approvalPolicy: 'on-request'
        }
      }
    })

    expect(saved.agents.kun.model).toBe('deepseek-reasoner')
    expect(saved.agents.kun.approvalPolicy).toBe('on-request')
  })

  it('merges desktop behavior patches without keeping invalid startup state', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const enabled = await store.patch({
      appBehavior: {
        openAtLogin: true,
        startMinimized: true,
        closeToTray: true
      }
    })
    const disabled = await store.patch({
      appBehavior: {
        openAtLogin: false
      }
    })

    expect(enabled.appBehavior).toEqual({
      openAtLogin: true,
      startMinimized: true,
      closeToTray: true
    })
    expect(disabled.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: true
    })
  })

  it('omits agentProvider when writing normalized settings to disk', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    const store = new JsonSettingsStore(userDataDir)
    await store.load()
    await store.patch({
      agents: {
        kun: {
          model: 'deepseek-chat'
        }
      }
    })

    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect('agentProvider' in persisted).toBe(false)
    expect(persisted.agents).toEqual(
      expect.objectContaining({
        kun: expect.objectContaining({ model: 'deepseek-chat' })
      })
    )
  })

  it('folds legacy Claw thread ids into the single Kun mapping', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        claw: {
          channels: [
            {
              id: 'channel-1',
              provider: 'feishu',
              label: 'Feishu Agent',
              threadId: 'thr_codewhale',
              agentThreadIds: { reasonix: '2026-06-01T01:00:00.000Z' },
              conversations: [
                {
                  id: 'conversation-1',
                  chatId: 'chat-1',
                  latestMessageId: 'message-1',
                  localThreadId: 'thr_conversation_codewhale',
                  agentThreadIds: { reasonix: '2026-06-01T02:00:00.000Z' }
                }
              ]
            }
          ]
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const channel = loaded.claw.channels[0]
    const conversation = channel?.conversations[0]

    expect(channel?.threadId).toBe('thr_codewhale')
    expect(conversation?.localThreadId).toBe('thr_conversation_codewhale')
  })

  it('seeds Reasonix-only Claw conversations into the canonical thread id', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        claw: {
          channels: [
            {
              id: 'channel-1',
              provider: 'feishu',
              label: 'Feishu Agent',
              agentThreadIds: { reasonix: 'reasonix-channel' },
              conversations: [
                {
                  id: 'conversation-1',
                  chatId: 'chat-1',
                  latestMessageId: 'message-1',
                  localThreadId: '',
                  agentThreadIds: { reasonix: 'reasonix-conversation' }
                }
              ]
            }
          ]
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const channel = loaded.claw.channels[0]
    const conversation = channel?.conversations[0]

    expect(channel?.threadId).toBe('reasonix-channel')
    expect(conversation?.localThreadId).toBe('reasonix-conversation')
  })
})
