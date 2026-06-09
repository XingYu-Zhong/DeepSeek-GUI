import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { ConnectionsSettingsSection } from './settings-section-connections'

const labels: Record<string, string> = {
  connectionsLocalComputer: 'This computer',
  connectionsSsh: 'SSH',
  sshConnectionsTitle: 'SSH connections',
  sshConnections: 'Remote computers',
  sshConnectionsDesc: 'Remote computer description',
  sshConnectionsSecretNote: 'No secrets are stored',
  sshConnectionsEmpty: 'No SSH connections yet',
  sshConnectionAdd: 'Add',
  sshConnectionDelete: 'Delete',
  sshConnectionTest: 'Test',
  sshConnectionHostRequired: 'Host required',
  sshConnectionTestUnavailable: 'Unavailable',
  sshConnectionTestOk: 'OK',
  sshConnectionTestFailed: 'Failed',
  sshConnectionNamePlaceholder: 'Connection name',
  sshConnectionHost: 'Host',
  sshConnectionHostPlaceholder: 'example.com',
  sshConnectionUser: 'User',
  sshConnectionUserPlaceholder: 'Optional',
  sshConnectionPort: 'Port',
  sshConnectionAuthMethod: 'Authentication',
  sshConnectionAuthAgent: 'SSH agent',
  sshConnectionAuthPassword: 'Password',
  sshConnectionAuthIdentityFile: 'Identity file',
  sshConnectionAuthAgentDesc: 'Uses SSH_AUTH_SOCK or Pageant',
  sshConnectionPassword: 'Password',
  sshConnectionPasswordPlaceholder: 'Saved locally',
  sshConnectionIdentityFile: 'Identity file path',
  sshConnectionIdentityFilePlaceholder: '~/.ssh/id_ed25519',
  sshConnectionPassphrase: 'Key passphrase',
  sshConnectionPassphrasePlaceholder: 'Optional',
  sshConnectionRemotePath: 'Remote path',
  sshConnectionRemotePathPlaceholder: '~',
  sshConnectionOpenProject: 'Open remote project'
}

function t(key: string): string {
  return labels[key] ?? key
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    connections: {
      ssh: [{
        id: 'ssh-1',
        name: 'VPS',
        host: 'vps.example.com',
        user: 'deploy',
        port: 2222,
        authMethod: 'identityFile',
        password: '',
        identityFile: '~/.ssh/id_ed25519',
        passphrase: '',
        remotePath: '/srv/app',
        enabled: true,
        createdAt: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:00.000Z'
      }]
    },
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('ConnectionsSettingsSection', () => {
  it('renders SSH connection management fields', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionsSettingsSection, {
        ctx: {
          t,
          form: settings(),
          update: vi.fn()
        }
      })
    )

    expect(html).toContain('SSH connections')
    expect(html).toContain('No secrets are stored')
    expect(html).toContain('VPS')
    expect(html).toContain('vps.example.com')
    expect(html).toContain('Identity file')
    expect(html).toContain('~/.ssh/id_ed25519')
    expect(html).toContain('/srv/app')
    expect(html).toContain('Test')
    expect(html).toContain('Open remote project')
  })
})
