import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings
} from '@shared/app-settings'
import { AgentsSettingsSection, modelProvidersSettingsPatch } from './settings-section-agents'

const labels: Record<string, string> = {
  agentsQuickBase: 'Base',
  agentsQuickSkill: 'Skills',
  agentsQuickMcp: 'MCP',
  agentsQuickPermissions: 'Permissions',
  agents: 'Agents',
  kunProvider: 'Provider',
  kunProviderDesc: 'Provider description',
  kunApiKey: 'Kun API key',
  kunApiKeyDesc: 'Kun API key description',
  kunApiKeyPlaceholder: 'Inherit API key',
  kunApiKeyInherited: 'Inherited API key',
  kunApiKeyMissing: 'Missing API key',
  kunApiKeyOverride: 'Override API key',
  kunBaseUrl: 'Kun base URL',
  kunBaseUrlDesc: 'Kun base URL description',
  kunBaseUrlPlaceholder: 'Inherit base URL',
  kunBaseUrlOfficial: 'Official base URL',
  kunBaseUrlInherited: 'Inherited base URL',
  kunBaseUrlOverride: 'Override base URL',
  kunAssistantAdvanced: 'Assistant advanced settings',
  kunAssistantAdvancedDesc: 'Assistant advanced settings description',
  autoStart: 'Auto start',
  autoStartDesc: 'Auto start description',
  port: 'Port',
  portDesc: 'Port description',
  kunBinary: 'Kun binary',
  kunBinaryDesc: 'Kun binary description',
  kunBinaryPlaceholder: 'Bundled Kun',
  kunDataDir: 'Data dir',
  kunDataDirDesc: 'Data dir description',
  kunModel: 'Model',
  kunModelDesc: 'Model description',
  kunTokenEconomy: 'Token-saving mode',
  kunTokenEconomyDesc: 'Token-saving mode description',
  kunTokenEconomySavings: 'Saved {{tokens}} / {{cost}}',
  kunTokenEconomySavingsLoading: 'Loading savings',
  kunTokenEconomySavingsEmpty: 'Savings empty',
  kunTokenEconomyAdvanced: 'Token-saving advanced settings',
  kunTokenEconomyAdvancedDesc: 'Token-saving advanced settings description',
  kunTokenEconomyOptions: 'Token-saving options',
  kunTokenEconomyOptionsDesc: 'Token-saving options description',
  kunCompressToolDescriptions: 'Compress tool descriptions',
  kunCompressToolResults: 'Compress tool results',
  kunConciseResponses: 'Concise responses',
  kunHistoryHygiene: 'History guard',
  kunHistoryHygieneDesc: 'History guard description',
  kunHistoryMaxResultLines: 'Max result lines',
  kunHistoryMaxResultBytes: 'Max result bytes',
  kunHistoryMaxResultTokens: 'Max result tokens',
  kunHistoryMaxArgumentBytes: 'Max argument bytes',
  kunHistoryMaxArgumentTokens: 'Max argument tokens',
  kunHistoryMaxArrayItems: 'Max array items',
  runtimeToken: 'Runtime token',
  runtimeTokenDesc: 'Runtime token description',
  showSecret: 'Show',
  hideSecret: 'Hide',
  kunInsecure: 'Insecure',
  kunInsecureDesc: 'Insecure description',
  kunInsecureForcedDesc: 'Insecure forced',
  kunAdvanced: 'Advanced runtime settings',
  kunAdvancedDetails: 'Storage, model context, and tool guards',
  kunAdvancedDetailsDesc: 'Per-model context policy comes from models.profiles',
  kunStorageBackend: 'Storage backend',
  kunStorageBackendDesc: 'Storage backend description',
  kunStorageHybrid: 'Hybrid storage',
  kunStorageFile: 'Pure JSONL file storage',
  kunStorageSqlitePath: 'SQLite path',
  kunStorageSqlitePathDesc: 'SQLite path description',
  kunStorageSqlitePathPlaceholder: 'Automatic SQLite path',
  kunModelContextProfile: 'Current model context policy',
  kunModelContextProfileDesc: 'Current model context policy description',
  kunModelContextModel: 'Matched model',
  kunModelContextWindow: 'Context window',
  kunModelContextSoft: 'Model soft threshold',
  kunModelContextHard: 'Model hard threshold',
  kunModelContextSourceBuiltIn: 'Built-in model config',
  kunModelContextSourceFallback: 'Fallback model config',
  kunCompactionThresholds: 'Fallback compaction thresholds',
  kunCompactionThresholdsDesc: 'Fallback compaction thresholds description',
  kunCompactionSoftThreshold: 'Fallback soft threshold',
  kunCompactionHardThreshold: 'Fallback hard threshold',
  kunCompactionSummary: 'Compaction summary',
  kunCompactionSummaryDesc: 'Compaction summary description',
  kunCompactionSummaryMode: 'Summary mode',
  kunCompactionSummaryHeuristic: 'Heuristic summary',
  kunCompactionSummaryModel: 'Model summary',
  kunCompactionSummaryTimeout: 'Summary timeout',
  kunCompactionSummaryMaxTokens: 'Summary max tokens',
  kunCompactionSummaryInputBytes: 'Summary input bytes',
  kunToolStorm: 'Tool storm',
  kunToolStormDesc: 'Tool storm description',
  kunToolStormLimits: 'Tool storm limits',
  kunToolStormLimitsDesc: 'Tool storm limits description',
  kunToolStormWindowSize: 'Tool storm window',
  kunToolStormThreshold: 'Tool storm threshold',
  kunToolArgumentRepair: 'Tool argument repair',
  kunToolArgumentRepairDesc: 'Tool argument repair description',
  kunDiagnostics: 'Kun diagnostics',
  kunDiagnosticsAdvanced: 'Detailed diagnostics',
  kunDiagnosticsAdvancedDesc: 'Detailed diagnostics description',
  kunRuntimeCapabilities: 'Runtime capabilities',
  kunRuntimeCapabilitiesDesc: 'Runtime capabilities description',
  kunRuntimeModel: 'Runtime model',
  kunRuntimePid: 'Runtime PID',
  kunDiagnosticsRefresh: 'Refresh diagnostics',
  kunToolDiagnostics: 'Tool diagnostics',
  kunToolDiagnosticsDesc: 'Tool diagnostics description',
  kunDiagnosticsProviders: 'Providers',
  kunDiagnosticsMcpServers: 'MCP servers',
  kunDiagnosticsSkills: 'Discovered Skills',
  kunDiagnosticsAttachments: 'Attachments',
  kunMemoryRecords: 'Memory records',
  kunMemoryRecordsDesc: 'Memory records description',
  kunMemoryEmpty: 'No memories',
  kunMemoryDisable: 'Disable memory',
  kunMemoryDelete: 'Delete memory',
  kunMemoryDisabled: 'Disabled',
  skill: 'Skill',
  skillsLocation: 'Skill location',
  skillsLocationDesc: 'Skill location description',
  skillsPath: 'Skills path',
  skillsPathDesc: 'Skills path description',
  skillsRootUnavailable: 'Unavailable',
  skillsScanDirs: 'Scan dirs',
  skillsScanDirsDesc: 'Scan dirs description',
  skillsActions: 'Skill actions',
  skillsActionsDesc: 'Skill actions description',
  skillsOpenRoot: 'Open root',
  skillsOpenPlugins: 'Open plugins',
  mcp: 'MCP',
  mcpSearchEnabled: 'MCP search enabled',
  mcpSearchEnabledDesc: 'MCP search description',
  mcpAdvanced: 'MCP advanced settings',
  mcpAdvancedDesc: 'MCP advanced settings description',
  mcpSearchMode: 'MCP search mode',
  mcpSearchModeDesc: 'MCP search mode description',
  mcpSearchModeAuto: 'Auto mode',
  mcpSearchModeSearch: 'Search mode',
  mcpSearchModeDirect: 'Direct mode',
  mcpSearchLimits: 'MCP search limits',
  mcpSearchLimitsDesc: 'MCP search limits description',
  mcpSearchAutoThreshold: 'Auto threshold',
  mcpSearchTopKDefault: 'Default results',
  mcpSearchTopKMax: 'Max results',
  mcpSearchMinScore: 'Minimum score',
  mcpSearchDiagnostics: 'MCP search diagnostics',
  mcpSearchDiagnosticsDesc: 'MCP search diagnostics description',
  mcpSearchStatus: 'MCP search status',
  mcpSearchActive: 'Active',
  mcpSearchInactive: 'Inactive',
  mcpSearchIndexed: 'Indexed',
  mcpSearchAdvertised: 'Advertised',
  configFilePath: 'External tool config path',
  mcpPathDesc: 'MCP JSON path description',
  mcpEditor: 'MCP editor',
  mcpEditorDesc: 'Model and API credentials do not live in this MCP file',
  mcpFileStatusReady: 'MCP config ready',
  mcpFileStatusMissing: 'MCP config missing',
  loading: 'Loading',
  mcpActions: 'MCP actions',
  mcpRuntimeHint: 'MCP runtime hint',
  mcpSave: 'Save MCP config',
  mcpReload: 'Reload MCP config',
  mcpOpenDir: 'Open MCP directory',
  permissions: 'Permissions',
  approvalPolicy: 'Approval policy',
  approvalPolicyDesc: 'Approval policy description',
  approvalAuto: 'Auto',
  approvalOnRequest: 'On request',
  approvalUntrusted: 'Untrusted',
  approvalSuggest: 'Suggest',
  approvalNever: 'Never',
  sandboxMode: 'Sandbox mode',
  sandboxModeDesc: 'Sandbox description',
  sandboxWorkspaceWrite: 'Workspace write',
  sandboxReadOnly: 'Read only',
  sandboxFullAccess: 'Full access',
  sandboxExternal: 'External sandbox'
}

function t(key: string): string {
  return labels[key] ?? key
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  const ref = { current: null }
  const kun = {
    ...defaultKunRuntimeSettings(),
    autoStart: true,
    runtimeToken: '',
    insecure: true
  }
  return {
    t,
    tCommon: t,
    form: { claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } } },
    kun,
    activeApiKey: '',
    update: noop,
    updateKun: noop,
    updateSharedCredential: noop,
    sharedApiKey: '',
    sharedBaseUrl: '',
    showApiKey: false,
    setShowApiKey: noop,
    showRuntimeToken: false,
    setShowRuntimeToken: noop,
    portError: '',
    selectControlClass: 'select',
    openOnboardingPreview: noop,
    pickWorkspace: asyncNoop,
    resetWorkspaceToDefault: noop,
    workspacePickerError: '',
    guiUpdateInfo: null,
    checkingGuiUpdate: false,
    downloadingGuiUpdate: false,
    installingGuiUpdate: false,
    guiUpdateDownloaded: false,
    guiUpdateProgress: null,
    guiUpdateError: null,
    checkGuiUpdate: asyncNoop,
    downloadGuiUpdate: asyncNoop,
    installGuiUpdate: asyncNoop,
    logPath: '',
    logDirOpenError: '',
    setLogDirOpenError: noop,
    pickWriteWorkspace: asyncNoop,
    resetWriteWorkspaceToDefault: noop,
    writeWorkspacePickerError: '',
    writeInlineBaseUrlInherited: false,
    effectiveWriteInlineBaseUrl: '',
    writeInlineModelInherited: false,
    effectiveWriteInlineModel: '',
    setWriteDebugModalOpen: noop,
    loadWriteDebugEntries: asyncNoop,
    scrollToAgentSection: noop,
    agentsSectionRef: ref,
    skillSectionRef: ref,
    mcpSectionRef: ref,
    permissionsSectionRef: ref,
    selectedSkillRoot: {
      id: 'workspace',
      label: 'Workspace',
      path: '/tmp/project/.agents/skills',
      available: true
    },
    skillRootOptions: [
      {
        id: 'workspace',
        label: 'Workspace',
        path: '/tmp/project/.agents/skills',
        available: true
      }
    ],
    skillRootId: 'workspace',
    setSkillRootId: noop,
    skillNotice: null,
    openSkillRoot: asyncNoop,
    openPlugins: noop,
    mcpConfigPath: '/tmp/project/.kun/mcp.json',
    mcpConfigExists: true,
    mcpConfigText: '{"mcpServers":{}}',
    setMcpConfigText: noop,
    mcpLoading: false,
    mcpBusy: false,
    mcpNotice: null,
    saveMcpConfig: asyncNoop,
    loadMcpConfig: asyncNoop,
    openMcpConfigDir: asyncNoop,
    runtimeInfo: null,
    toolDiagnostics: null,
    memoryRecords: [],
    runtimeDiagnosticsBusy: false,
    runtimeDiagnosticsNotice: null,
    refreshKunDiagnostics: asyncNoop,
    disableMemoryRecord: asyncNoop,
    deleteMemoryRecord: asyncNoop,
    pickClawWorkspace: asyncNoop,
    resetClawWorkspaceToDefault: noop,
    clawWorkspacePickerError: '',
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (value: string[]) => value.join('\n')
  }
}

describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  it('builds a single patch when adding and selecting a model provider', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      models: []
    }

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, customProvider],
      kun: { providerId: customProvider.id }
    })

    expect(patch.provider?.providers).toEqual([...provider.providers, customProvider])
    expect(patch.agents?.kun?.providerId).toBe(customProvider.id)
  })

  it('builds a single patch when removing the active model provider', () => {
    const provider = defaultModelProviderSettings()

    const patch = modelProvidersSettingsPatch({
      provider: {
        ...provider,
        providers: [
          ...provider.providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: '',
            baseUrl: 'https://api.example.com/v1',
            models: []
          }
        ]
      },
      providers: provider.providers,
      kun: { providerId: DEFAULT_MODEL_PROVIDER_ID }
    })

    expect(patch.provider?.providers).toEqual(provider.providers)
    expect(patch.agents?.kun?.providerId).toBe(DEFAULT_MODEL_PROVIDER_ID)
  })

  it('renders custom model provider id as editable', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      models: []
    }
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: customProvider.id
        }
      }
    }))
    const providerIdInput = html.match(/<input[^>]+value="custom-provider-2"[^>]*>/)?.[0]

    expect(providerIdInput).toBeTruthy()
    expect(providerIdInput).not.toContain('readOnly')
    expect(providerIdInput).not.toContain('readonly')
  })

  it('keeps advanced agent controls behind collapsed disclosures', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Assistant advanced settings')
    expect(html).toContain('Token-saving advanced settings')
    expect(html).toContain('MCP advanced settings')
    expect(html).not.toContain('<details open')
  })

  it('renders pure JSONL as a selectable storage backend', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Storage backend')
    expect(html).toContain('<option value="hybrid"')
    expect(html).toContain('Hybrid storage')
    expect(html).toContain('<option value="file"')
    expect(html).toContain('Pure JSONL file storage')
  })

  it('shows DeepSeek V4 model compaction thresholds from the model profile', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Current model context policy')
    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Built-in model config')
    expect(html).toContain('1,000,000')
    expect(html).toContain('980,000')
    expect(html).toContain('990,000')
    expect(html).toContain('Fallback compaction thresholds')
  })

  it('renders MCP, Skill, web, attachment, and memory diagnostics', () => {
    const ctx = {
      ...baseCtx(),
      runtimeInfo: {
        pid: 123,
        capabilities: {
          model: { id: 'deepseek-chat' },
          mcp: { status: 'available', configuredServers: 2, connectedServers: 2 },
          web: { status: 'available', provider: 'brave-search' },
          skills: { status: 'available' },
          subagents: { status: 'available' },
          attachments: { status: 'available' },
          memory: { status: 'available' }
        }
      },
      toolDiagnostics: {
        providers: [{ id: 'builtin' }, { id: 'mcp' }, { id: 'web' }, { id: 'memory' }],
        mcpServers: [{ id: 'github' }],
        skills: { skills: [{ id: 'skill_docs' }] },
        attachments: { count: 1 }
      },
      memoryRecords: [
        {
          id: 'mem_1',
          content: 'Prefer pnpm for this workspace',
          scope: 'workspace',
          tags: ['tooling']
        }
      ]
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Kun diagnostics')
    expect(html).toContain('MCP')
    expect(html).toContain('available')
    expect(html).toContain('2/2')
    expect(html).toContain('brave-search')
    expect(html).toContain('Providers')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Discovered Skills')
    expect(html).toContain('Prefer pnpm for this workspace')
    expect(html).toContain('mem_1')
    expect(html).toContain('Disable memory')
    expect(html).toContain('Delete memory')
  })

  it('describes MCP config as an external-tool JSON file instead of model credentials', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('External tool config path')
    expect(html).toContain('/tmp/project/.kun/mcp.json')
    expect(html).toContain('Model and API credentials do not live in this MCP file')
    expect(html).not.toContain('DeepSeek auth')
    expect(html).not.toContain('Base URL are stored in this file')
    expect(html).not.toContain('config.toml')
  })
})
