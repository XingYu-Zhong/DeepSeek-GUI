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
import { ClawSettingsSection } from './settings-section-claw'

const labels: Record<string, string> = {
  clawRuntime: 'Phone connection',
  clawEnabled: 'Enable phone connection',
  clawEnabledDesc: 'Enable phone connection description',
  clawDefaultWorkspace: 'Default phone workspace',
  clawDefaultWorkspaceDesc: 'Default phone workspace description',
  clawDefaultWorkspacePlaceholder: 'Inherit {{path}}',
  clawDefaultWorkspaceReset: 'Use GUI default',
  browse: 'Browse',
  clawManageAgents: 'Connected phone agents',
  clawManageAgentsEmpty: 'No phone agents',
  clawManageAgentMeta: '{{provider}} {{model}} {{workspace}}',
  clawManageAgentEnabled: 'Enabled',
  clawManageAgentDisabled: 'Disabled',
  clawManageAgentName: 'Agent name',
  clawManageAgentNamePlaceholder: 'Agent name placeholder',
  clawModel: 'Model',
  clawWorkspaceOverride: 'Workspace override',
  clawWorkspaceInherit: 'Use default workspace: {{path}}',
  clawManageAgentDescription: 'Short description',
  clawManageAgentDescriptionPlaceholder: 'Short description placeholder',
  clawManageAgentIdentity: 'Role definition',
  clawManageAgentIdentityPlaceholder: 'Role definition placeholder',
  clawManageAgentPersonality: 'Personality',
  clawManageAgentPersonalityPlaceholder: 'Personality placeholder',
  clawManageAgentUserContext: 'User context',
  clawManageAgentUserContextPlaceholder: 'User context placeholder',
  clawManageAgentReplyRules: 'Reply rules',
  clawManageAgentReplyRulesPlaceholder: 'Reply rules placeholder'
}

function t(key: string, values?: Record<string, unknown>): string {
  let label = labels[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    label = label.replace(`{{${name}}}`, String(value))
  }
  return label
}

function buildSettings(): AppSettingsV1 {
  const settings: AppSettingsV1 = {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'medium',
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
  settings.claw.enabled = true
  settings.claw.im.workspaceRoot = '/tmp/claw'
  settings.claw.channels = [
    {
      id: 'channel_1',
      provider: 'feishu',
      label: 'Team helper',
      enabled: true,
      model: 'deepseek-v4-pro',
      threadId: 'thr_1',
      workspaceRoot: '',
      agentProfile: {
        name: 'Team helper',
        description: 'Handles team chat requests',
        identity: 'You are the project assistant.',
        personality: 'Concise and practical.',
        userContext: 'The user coordinates product and engineering.',
        replyRules: 'Start with the conclusion.'
      },
      conversations: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }
  ]
  return settings
}

describe('ClawSettingsSection', () => {
  it('renders connected phone agent management fields', () => {
    const html = renderToStaticMarkup(
      createElement(ClawSettingsSection, {
        ctx: {
          t,
          form: buildSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control',
          pickClawWorkspace: async () => undefined,
          resetClawWorkspaceToDefault: () => undefined,
          clawWorkspacePickerError: null
        }
      })
    )

    expect(html).toContain('Connected phone agents')
    expect(html).toContain('Team helper')
    expect(html).toContain('Role definition')
    expect(html).toContain('You are the project assistant.')
    expect(html).toContain('Personality')
    expect(html).toContain('Reply rules')
    expect(html).toContain('Start with the conclusion.')
    expect(html).toContain('<option value="deepseek-v4-pro"')
  })
})
