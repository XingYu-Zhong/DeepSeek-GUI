import { describe, expect, it } from 'vitest'
import {
  applyKunRuntimePatch,
  kunSettingsEnvelope,
  kunSettingsPatch,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  buildClawRuntimePrompt,
  defaultClawSettings,
  defaultModelProviderSettings,
  mergeKunRuntimeSettings,
  mergeScheduleSettings,
  defaultKunRuntimeSettings,
  defaultScheduleSettings,
  defaultWriteSelectionAssistSettings,
  defaultWriteSettings,
  getModelProviderPreset,
  defaultKeyboardShortcuts,
  modelProviderPresetProfile,
  mergeWriteSettings,
  normalizeWriteSettings,
  isKunRuntimeInsecure,
  migrateLegacyAppSettings,
  normalizeAppSettings,
  parseClawUserPromptForDisplay,
  inferModelEndpointFormatFromUrl,
  normalizeScheduleSettings,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImProvider
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
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
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('model endpoint format inference', () => {
  it('treats /completions custom endpoints as Chat Completions-shaped', () => {
    expect(inferModelEndpointFormatFromUrl('https://api.example.com/custom/completions')).toBe('chat_completions')
    expect(inferModelEndpointFormatFromUrl('https://api.example.com/custom/completions?api-version=2026-01-01')).toBe(
      'chat_completions'
    )
  })
})

function clawChannel(provider: ClawImProvider, label: string, name = label): ClawImChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: `${provider}-${label}`,
    provider,
    label,
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '',
    agentProfile: {
      name,
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: now,
    updatedAt: now
  }
}

describe('kun defaults', () => {
  it('keeps a single shared default data directory source', () => {
    expect(defaultKunRuntimeSettings().dataDir).toBe(DEFAULT_KUN_DATA_DIR)
  })

  it('defaults the assistant model to v4 pro', () => {
    expect(defaultKunRuntimeSettings().model).toBe(DEFAULT_KUN_MODEL)
  })

  it('defaults approval policy to auto', () => {
    expect(defaultKunRuntimeSettings().approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(defaultKunRuntimeSettings().approvalPolicy).toBe('auto')
  })

  it('defaults sandbox mode to full access', () => {
    expect(defaultKunRuntimeSettings().sandboxMode).toBe(DEFAULT_SANDBOX_MODE)
    expect(defaultKunRuntimeSettings().sandboxMode).toBe('danger-full-access')
  })

  it('defaults token economy mode to off', () => {
    expect(defaultKunRuntimeSettings().tokenEconomyMode).toBe(false)
    expect(defaultKunRuntimeSettings().tokenEconomy).toMatchObject({
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
  })

  it('defaults MCP search discovery to off', () => {
    expect(defaultKunRuntimeSettings().mcpSearch).toMatchObject({
      enabled: false,
      mode: 'auto',
      autoThresholdToolCount: 24,
      topKDefault: 5,
      topKMax: 10
    })
  })

  it('defaults image generation to off with empty provider fields', () => {
    expect(defaultKunRuntimeSettings().imageGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: '',
      apiKey: '',
      model: '',
      defaultSize: '',
      timeoutMs: 180000
    })
  })

  it('defaults media generation to off with empty provider fields', () => {
    expect(defaultKunRuntimeSettings().textToSpeech).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'openai-speech',
      baseUrl: '',
      apiKey: '',
      model: '',
      voice: '',
      format: 'mp3',
      timeoutMs: 120000
    })
    expect(defaultKunRuntimeSettings().musicGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'minimax-music',
      baseUrl: '',
      apiKey: '',
      model: '',
      format: 'mp3',
      timeoutMs: 300000
    })
    expect(defaultKunRuntimeSettings().videoGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'minimax-video',
      baseUrl: '',
      apiKey: '',
      model: '',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
  })

  it('defaults advanced Kun runtime tuning to conservative values', () => {
    expect(defaultKunRuntimeSettings()).toMatchObject({
      storage: {
        backend: 'hybrid',
        sqlitePath: ''
      },
      contextCompaction: {
        defaultSoftThreshold: 16000,
        defaultHardThreshold: 24000,
        summaryMode: 'heuristic',
        summaryTimeoutMs: 15000,
        summaryMaxTokens: 1200,
        summaryInputMaxBytes: 98304
      },
      runtimeTuning: {
        toolStorm: {
          enabled: true,
          windowSize: 8,
          threshold: 3
        },
        toolArgumentRepair: {
          maxStringBytes: 524288
        }
      }
    })
  })
})

describe('app behavior settings', () => {
  it('defaults desktop behavior to off', () => {
    const raw = {
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    })
  })

  it('only keeps start minimized when open at login is enabled', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      appBehavior: {
        openAtLogin: false,
        startMinimized: true,
        closeToTray: true
      }
    })

    expect(normalized.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: true
    })
  })
})

describe('keyboard shortcut settings', () => {
  it('defaults shortcut overrides to empty', () => {
    const raw = {
      ...settings(),
      keyboardShortcuts: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).keyboardShortcuts).toEqual({
      bindings: {}
    })
  })
})

describe('claw settings', () => {
  it('stores the WeChat bridge URL in Claw IM settings', () => {
    const defaults = defaultClawSettings()
    expect(defaults.im.weixinBridgeUrl).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)

    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '  http://127.0.0.1:8787/rpc  '
        }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:8787/rpc')
  })

  it('migrates the legacy OpenClaw Gateway URL into the WeChat bridge URL', () => {
    const defaults = defaultClawSettings()
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '',
          openClawGatewayUrl: '  http://127.0.0.1:8787/rpc  '
        } as typeof defaults.im & { openClawGatewayUrl: string }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:8787/rpc')
  })

  it('normalizes phone agent default names without touching custom names', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [
          clawChannel('weixin', 'WeChat Agent', 'WeChat Agent'),
          clawChannel('feishu', 'Feishu / Lark', 'Feishu Agent'),
          clawChannel('weixin', 'Support Bot', '')
        ]
      }
    })

    expect(normalized.claw.channels.map((channel) => ({
      label: channel.label,
      name: channel.agentProfile.name
    }))).toEqual([
      { label: 'weixin agent', name: 'weixin agent' },
      { label: 'feishu agent', name: 'feishu agent' },
      { label: 'Support Bot', name: 'Support Bot' }
    ])
  })

  it('keeps the channel welcomeSentAt marker and drops empty values', () => {
    const welcomed = { ...clawChannel('weixin', 'WeChat Agent'), welcomeSentAt: '2026-06-10T00:00:00.000Z' }
    const fresh = { ...clawChannel('feishu', 'Feishu / Lark'), welcomeSentAt: '' }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [welcomed, fresh]
      }
    })

    expect(normalized.claw.channels[0].welcomeSentAt).toBe('2026-06-10T00:00:00.000Z')
    expect(normalized.claw.channels[1]).not.toHaveProperty('welcomeSentAt')
  })
})

describe('isKunRuntimeInsecure', () => {
  it('treats an empty runtime token as effectively insecure', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: ''
      })
    ).toBe(true)
  })

  it('keeps auth enabled when a token exists and insecure is false', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: 'tok-1'
      })
    ).toBe(false)
  })
})

describe('mergeKunRuntimeSettings', () => {
  it('merges a direct kun patch without the envelope wrapper', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      model: 'deepseek-reasoner',
      port: 9000,
      tokenEconomyMode: true
    })
    expect(next.model).toBe('deepseek-reasoner')
    expect(next.port).toBe(9000)
    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.baseUrl).toBe(current.baseUrl)
  })

  it('deep-merges token economy settings and keeps the legacy switch synced', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      tokenEconomy: {
        enabled: true,
        compressToolResults: false,
        historyHygiene: {
          maxToolResultLines: 120
        }
      }
    })

    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.tokenEconomy.compressToolDescriptions).toBe(true)
    expect(next.tokenEconomy.compressToolResults).toBe(false)
    expect(next.tokenEconomy.historyHygiene.maxToolResultLines).toBe(120)
    expect(next.tokenEconomy.historyHygiene.maxToolResultBytes).toBe(
      current.tokenEconomy.historyHygiene.maxToolResultBytes
    )

    const legacySwitch = mergeKunRuntimeSettings(next, { tokenEconomyMode: false })
    expect(legacySwitch.tokenEconomyMode).toBe(false)
    expect(legacySwitch.tokenEconomy.enabled).toBe(false)
  })

  it('deep-merges MCP search settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      mcpSearch: {
        enabled: true,
        mode: 'search',
        topKDefault: 3
      }
    })

    expect(next.mcpSearch.enabled).toBe(true)
    expect(next.mcpSearch.mode).toBe('search')
    expect(next.mcpSearch.topKDefault).toBe(3)
    expect(next.mcpSearch.topKMax).toBe(current.mcpSearch.topKMax)
  })

  it('deep-merges advanced Kun settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      storage: {
        sqlitePath: ' /tmp/kun.sqlite3 '
      },
      contextCompaction: {
        defaultSoftThreshold: 64000
      },
      runtimeTuning: {
        toolStorm: {
          threshold: 5
        }
      }
    })

    expect(next.storage.backend).toBe('hybrid')
    expect(next.storage.sqlitePath).toBe('/tmp/kun.sqlite3')
    expect(next.contextCompaction.defaultSoftThreshold).toBe(64000)
    expect(next.contextCompaction.defaultHardThreshold).toBe(64000)
    expect(next.contextCompaction.summaryMode).toBe('heuristic')
    expect(next.runtimeTuning.toolStorm.enabled).toBe(true)
    expect(next.runtimeTuning.toolStorm.windowSize).toBe(current.runtimeTuning.toolStorm.windowSize)
    expect(next.runtimeTuning.toolStorm.threshold).toBe(5)
    expect(next.runtimeTuning.toolArgumentRepair).toEqual(current.runtimeTuning.toolArgumentRepair)
  })

  it('deep-merges image generation settings and normalizes invalid values', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      imageGeneration: {
        enabled: true,
        baseUrl: ' https://api.siliconflow.cn/v1 ',
        apiKey: 'sk-image',
        model: 'Kwai-Kolors/Kolors'
      }
    })

    expect(next.imageGeneration).toEqual({
      enabled: true,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-image',
      model: 'Kwai-Kolors/Kolors',
      defaultSize: '',
      timeoutMs: 180000
    })

    const sized = mergeKunRuntimeSettings(next, {
      imageGeneration: { defaultSize: '1536x1024', timeoutMs: 240000 }
    })
    expect(sized.imageGeneration.defaultSize).toBe('1536x1024')
    expect(sized.imageGeneration.timeoutMs).toBe(240000)
    expect(sized.imageGeneration.apiKey).toBe('sk-image')

    const invalidSize = mergeKunRuntimeSettings(sized, {
      imageGeneration: { defaultSize: 'huge', timeoutMs: -5 }
    })
    expect(invalidSize.imageGeneration.defaultSize).toBe('')
    expect(invalidSize.imageGeneration.timeoutMs).toBe(180000)
  })

  it('preserves image recognition enabledAt only while enabled', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      imageRecognition: {
        enabled: true,
        enabledAt: '2026-06-13T08:00:00.000Z',
        baseUrl: ' https://api.example.com/v1 ',
        apiKey: 'sk-image',
        model: 'vision-model'
      }
    })

    expect(next.imageRecognition).toMatchObject({
      enabled: true,
      enabledAt: '2026-06-13T08:00:00.000Z',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-image',
      model: 'vision-model'
    })

    const edited = mergeKunRuntimeSettings(next, {
      imageRecognition: { prompt: 'Read text.' }
    })
    expect(edited.imageRecognition.enabledAt).toBe('2026-06-13T08:00:00.000Z')

    const disabled = mergeKunRuntimeSettings(edited, {
      imageRecognition: { enabled: false }
    })
    expect(disabled.imageRecognition.enabled).toBe(false)
    expect(disabled.imageRecognition.enabledAt).toBeUndefined()
  })

  it('backfills image recognition enabledAt for legacy enabled settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      imageRecognition: {
        enabled: true,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-image',
        model: 'vision-model'
      }
    })

    expect(next.imageRecognition.enabled).toBe(true)
    expect(next.imageRecognition.enabledAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
  })

  it('deep-merges media generation settings and normalizes invalid values', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      textToSpeech: {
        enabled: true,
        protocol: 'minimax-t2a',
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-tts',
        model: 'speech-2.8-hd',
        voice: ' male-qn-qingse ',
        format: 'wav'
      },
      musicGeneration: {
        enabled: true,
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-music',
        model: 'music-2.6'
      },
      videoGeneration: {
        enabled: true,
        baseUrl: ' https://api.minimax.io ',
        apiKey: 'sk-video',
        model: 'MiniMax-Hailuo-2.3',
        defaultDuration: 10,
        pollIntervalMs: 20000
      }
    })

    expect(next.textToSpeech).toMatchObject({
      enabled: true,
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-tts',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'wav'
    })
    expect(next.musicGeneration).toMatchObject({
      enabled: true,
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music',
      model: 'music-2.6',
      format: 'mp3'
    })
    expect(next.videoGeneration).toMatchObject({
      enabled: true,
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 10,
      defaultResolution: '1080P',
      pollIntervalMs: 20000
    })

    const invalid = mergeKunRuntimeSettings(next, {
      textToSpeech: { format: 'aac', timeoutMs: -1 },
      videoGeneration: { defaultDuration: -1, pollIntervalMs: -1 }
    })
    expect(invalid.textToSpeech.format).toBe('mp3')
    expect(invalid.textToSpeech.timeoutMs).toBe(120000)
    expect(invalid.videoGeneration.defaultDuration).toBe(6)
    expect(invalid.videoGeneration.pollIntervalMs).toBe(10000)
  })

  it('defaults missing MiniMax media generation settings to the configured MiniMax provider', () => {
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProfile = modelProviderPresetProfile(minimax!, 'sk-minimax')
    const {
      textToSpeech: _textToSpeech,
      musicGeneration: _musicGeneration,
      videoGeneration: _videoGeneration,
      ...legacyKun
    } = defaultKunRuntimeSettings()
    void _textToSpeech
    void _musicGeneration
    void _videoGeneration
    const normalized = normalizeAppSettings({
      ...settings(),
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          ...defaultModelProviderSettings().providers,
          minimaxProfile
        ]
      },
      agents: { kun: legacyKun as AppSettingsV1['agents']['kun'] }
    })
    const resolved = resolveKunRuntimeSettings(normalized)

    expect(normalized.agents.kun.textToSpeech).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-t2a',
      model: 'speech-2.8-hd'
    }))
    expect(normalized.agents.kun.musicGeneration).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-music',
      model: 'music-2.6'
    }))
    expect(normalized.agents.kun.videoGeneration).toEqual(expect.objectContaining({
      enabled: true,
      providerId: 'minimax',
      protocol: 'minimax-video',
      model: 'MiniMax-Hailuo-2.3'
    }))
    expect(resolved.textToSpeech.apiKey).toBe('sk-minimax')
    expect(resolved.musicGeneration.baseUrl).toBe('https://api.minimax.io')
    expect(resolved.videoGeneration.baseUrl).toBe('https://api.minimax.io')
  })
})

describe('kun envelope helpers', () => {
  it('wraps runtime settings and patches into the compatibility shell', () => {
    const runtime = defaultKunRuntimeSettings()
    expect(kunSettingsEnvelope(runtime)).toEqual({ kun: runtime })
    expect(kunSettingsPatch({ model: 'deepseek-reasoner' })).toEqual({
      kun: { model: 'deepseek-reasoner' }
    })
  })

  it('applies a kun patch onto full app settings', () => {
    const current = settings()
    const next = applyKunRuntimePatch(current, { model: 'deepseek-reasoner' })
    expect(next.agents.kun.model).toBe('deepseek-reasoner')
    expect(next.write).toEqual(current.write)
  })
})

describe('legacy Kun defaults migration', () => {
  it('normalizes old master settings without an agents.kun envelope', () => {
    const normalized = normalizeAppSettings({
      version: 1,
      locale: 'zh',
      theme: 'dark',
      uiFontScale: 'small',
      agentProvider: 'deepseek-runtime',
      deepseek: {
        binaryPath: '/usr/local/bin/deepseek',
        port: 8787,
        autoStart: false,
        apiKey: 'sk-old',
        baseUrl: 'https://api.deepseek.com',
        runtimeToken: 'old-token',
        extraCorsOrigins: [],
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only'
      },
      workspaceRoot: '/tmp/legacy-workspace',
      log: { enabled: true, retentionDays: 2 },
      notifications: { turnComplete: true },
      guiUpdate: { channel: 'frontier' },
      claw: defaultClawSettings()
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun).toEqual(expect.objectContaining({
      binaryPath: '',
      port: 8787,
      autoStart: false,
      runtimeToken: 'old-token',
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only'
    }))
    expect(normalized.provider).toEqual(expect.objectContaining({
      apiKey: 'sk-old',
      baseUrl: 'https://api.deepseek.com'
    }))
    expect('agentProvider' in normalized).toBe(false)
    expect('deepseek' in normalized).toBe(false)
  })

  it('moves the legacy local HTTP default port to the Kun default port', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        port: 7878
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.port).toBe(8899)
  })

  it('fills image generation defaults for settings stored before the feature existed', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {}
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.imageGeneration).toEqual({
      enabled: false,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: '',
      apiKey: '',
      model: '',
      defaultSize: '',
      timeoutMs: 180000
    })
  })

  it('uses the current approval policy default for missing legacy local HTTP settings', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {}
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
  })

  it('upgrades old persisted Kun defaults to the current defaults', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '~/.deepseekgui/coreagent',
          model: 'deepseek-chat'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: DEFAULT_KUN_DATA_DIR,
      model: DEFAULT_KUN_MODEL
    }))
  })

  it('preserves a non-legacy Kun model override', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '/tmp/custom-kun',
          model: 'deepseek-v4-flash'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: '/tmp/custom-kun',
      model: 'deepseek-v4-flash'
    }))
  })

  it('preserves custom model providers while migrating legacy settings', () => {
    const migrated = normalizeAppSettings({
      ...settings(),
      agentProvider: 'deepseek-runtime',
      provider: {
        apiKey: 'sk-default',
        baseUrl: 'https://api.deepseek.com',
        providers: [
          ...defaultModelProviderSettings().providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.example/v1',
            endpointFormat: 'responses',
            models: ['custom-model']
          }
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'custom-provider-2',
          model: 'custom-model'
        }
      }
    } as unknown as AppSettingsV1)

    expect(migrated.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'responses',
          models: ['custom-model']
        })
      ])
    )
    expect(migrated.agents.kun.providerId).toBe('custom-provider-2')
    expect(resolveKunRuntimeSettings(migrated)).toEqual(
      expect.objectContaining({
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.example/v1',
        endpointFormat: 'responses'
      })
    )
  })
})

describe('schedule settings', () => {
  it('provides independent top-level schedule defaults', () => {
    const defaults = defaultScheduleSettings()

    expect(defaults.enabled).toBe(false)
    expect(defaults.keepAwake).toBe(false)
    expect(defaults.internal.port).toBe(DEFAULT_SCHEDULE_INTERNAL_PORT)
    expect(defaults.tasks).toEqual([])
  })

  it('normalizes and merges schedule patches without reading legacy claw tasks', () => {
    const legacyTask = {
      id: 'legacy-claw-task',
      title: 'Legacy task',
      enabled: true,
      prompt: 'Old Claw task',
      workspaceRoot: '/tmp/workspace',
      clawChannelId: 'channel-1',
      model: 'auto',
      reasoningEffort: 'medium' as const,
      mode: 'agent' as const,
      schedule: { kind: 'daily' as const, everyMinutes: 60, timeOfDay: '08:00', atTime: '' },
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle' as const,
      lastMessage: '',
      lastThreadId: ''
    }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        tasks: [legacyTask]
      },
      schedule: undefined as unknown as AppSettingsV1['schedule']
    })

    expect(normalized.claw.tasks).toHaveLength(1)
    expect(normalized.schedule.tasks).toEqual([])

    const merged = mergeScheduleSettings(normalizeScheduleSettings(undefined), {
      enabled: true,
      defaultWorkspaceRoot: ' /tmp/schedule ',
      internal: { port: 99, secret: ' secret ' },
      tasks: [{
        title: 'Daily',
        prompt: 'Run',
        schedule: { kind: 'daily', everyMinutes: 0, timeOfDay: 'bad', atTime: 'not-a-date' }
      }]
    })

    expect(merged.enabled).toBe(true)
    expect(merged.defaultWorkspaceRoot).toBe('/tmp/schedule')
    expect(merged.internal.port).toBe(1024)
    expect(merged.internal.secret).toBe('secret')
    expect(merged.tasks[0].schedule.everyMinutes).toBe(1)
    expect(merged.tasks[0].schedule.timeOfDay).toBe('09:00')
    expect(merged.tasks[0].schedule.atTime).toBe('')
    expect(merged.tasks[0].clawChannelId).toBe('')
    expect(merged.tasks[0].reasoningEffort).toBe('medium')
  })
})

describe('claw runtime prompts', () => {
  it('does not duplicate default Schedule MCP tool instructions in managed prompts', () => {
    const state = settings()
    state.claw.channels = [{
      id: 'channel-1',
      provider: 'feishu',
      label: 'kun',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    const prompt = buildClawRuntimePrompt(state, 'hi', { channel: state.claw.channels[0] })

    expect(prompt).toContain('[Claw managed instructions]')
    expect(prompt).toContain('[Agent name]\nkun')
    expect(prompt).not.toContain('gui_schedule')
    expect(prompt).not.toContain('scheduled-task tools')
  })

  it('tells Claw agents to use the image tool when image generation is configured', () => {
    const state = settings()
    state.agents.kun.imageGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-image',
      model: 'test-image-model',
      defaultSize: '1024x1024',
      timeoutMs: 180000
    }

    const prompt = buildClawRuntimePrompt(state, 'draw a small logo')

    expect(prompt).toContain('Image generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_image')
  })

  it('tells Claw agents to use media tools when media generation is configured', () => {
    const state = settings()
    state.agents.kun.textToSpeech = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-speech',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'mp3',
      timeoutMs: 120000
    }
    state.agents.kun.musicGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music',
      model: 'music-2.6',
      format: 'mp3',
      timeoutMs: 300000
    }
    state.agents.kun.videoGeneration = {
      enabled: true,
      providerId: '',
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    }

    const prompt = buildClawRuntimePrompt(state, 'make a voiceover, jingle, and video')

    expect(prompt).toContain('Text-to-speech generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_speech')
    expect(prompt).toContain('Music generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_music')
    expect(prompt).toContain('Video generation is enabled for this Claw agent')
    expect(prompt).toContain('generate_video')
  })

  it('parses managed IM prompts into compact display text', () => {
    const parsed = parseClawUserPromptForDisplay([
      '[Claw managed instructions]',
      '',
      '[Claw IM agent instructions]',
      '',
      '[Agent name]',
      'kun',
      '',
      '---',
      '[Current user request]',
      '[Feishu / Lark inbound message]',
      'Chat type: p2p',
      'Sender: user-1',
      '',
      'hi'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: 'hi',
      managed: true,
      inbound: true,
      sender: 'user-1',
      chatType: 'p2p'
    })
  })
})

describe('write inline completion runtime config', () => {
  it('falls back to the General baseUrl when write has no override', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://general.example/v1')
  })

  it('preserves an explicit write-only baseUrl override', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    state.write.inlineCompletion.baseUrl = 'https://write-only.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://write-only.example/v1')
  })

  it('falls back to the kun model when write keeps the default inline model', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })

  it('keeps an explicit flash override when write disables inheritance', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    state.write.inlineCompletion.inheritModel = false
    state.write.inlineCompletion.model = 'deepseek-v4-flash'

    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-v4-flash')
  })

  it('preserves an explicit request model before any fallback', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state, 'deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it('tolerates legacy write inline settings without new override fields', () => {
    const state = settings()
    state.provider.apiKey = 'general-key'
    state.provider.baseUrl = 'https://general.example/v1'
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = { ...state.write.inlineCompletion } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.apiKey
    delete legacyInlineCompletion.baseUrl
    delete legacyInlineCompletion.inheritModel
    delete legacyInlineCompletion.model
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionApiKey(state)).toBe('general-key')
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('https://general.example/v1')
    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })

  it('treats legacy flash defaults without an inherit flag as inherited', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = {
      ...state.write.inlineCompletion,
      model: 'deepseek-v4-flash'
    } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.inheritModel
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionModel(state)).toBe('deepseek-chat')
  })
})

describe('write selection assist settings', () => {
  it('defaults to the built-in quick actions with empty overrides', () => {
    const write = defaultWriteSettings()
    expect(write.selectionAssist.infographicPrompt).toBe('')
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'explain', label: '', prompt: '', mode: 'chat' },
      { id: 'reformat', label: '', prompt: '', mode: 'edit' }
    ])
  })

  it('keeps the defaults when legacy settings lack selectionAssist', () => {
    const write = normalizeWriteSettings({ defaultWorkspaceRoot: '/tmp/w' })
    expect(write.selectionAssist).toEqual(defaultWriteSelectionAssistSettings())
  })

  it('replaces quick actions wholesale through a merge patch', () => {
    const current = defaultWriteSettings()
    const next = mergeWriteSettings(current, {
      selectionAssist: {
        quickActions: [{ id: 'polish', label: '提升写作', prompt: '改写得更好' }]
      }
    })
    expect(next.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '提升写作', prompt: '改写得更好', mode: 'chat' }
    ])
    expect(next.selectionAssist.infographicPrompt).toBe('')
  })

  it('honors an explicit quick action mode and defaults custom actions to chat', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '', prompt: '', mode: 'chat' },
          { id: 'custom-1', label: 'x', prompt: 'y' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'custom-1', label: 'x', prompt: 'y', mode: 'chat' }
    ])
  })

  it('preserves quick actions when only the infographic prompt changes', () => {
    const current = mergeWriteSettings(defaultWriteSettings(), {
      selectionAssist: {
        quickActions: [{ id: 'custom-1', label: '重写', prompt: '重写这段' }]
      }
    })
    const next = mergeWriteSettings(current, {
      selectionAssist: { infographicPrompt: '手绘风格' }
    })
    expect(next.selectionAssist.infographicPrompt).toBe('手绘风格')
    expect(next.selectionAssist.quickActions).toEqual([
      { id: 'custom-1', label: '重写', prompt: '重写这段', mode: 'chat' }
    ])
  })

  it('carries the design and prototype prompts through normalization', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        designDraftPrompt: '移动端高保真。',
        prototypePrompt: '暗色主题原型。'
      }
    })
    expect(write.selectionAssist.designDraftPrompt).toBe('移动端高保真。')
    expect(write.selectionAssist.prototypePrompt).toBe('暗色主题原型。')

    const next = mergeWriteSettings(defaultWriteSettings(), {
      selectionAssist: { prototypePrompt: '原型用 vue 风格组件。' }
    })
    expect(next.selectionAssist.prototypePrompt).toBe('原型用 vue 风格组件。')
    expect(next.selectionAssist.designDraftPrompt).toBe('')
  })

  it('drops duplicate and id-less quick actions but keeps unfinished custom rows', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '', prompt: '' },
          { id: 'polish', label: 'dupe', prompt: 'dupe' },
          { id: '', label: 'no-id', prompt: 'no-id' },
          { id: 'custom-1', label: '', prompt: '' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'custom-1', label: '', prompt: '', mode: 'chat' }
    ])
  })

  it('does not trim label or prompt text during normalization', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [{ id: 'polish', label: 'hello ', prompt: 'world ' }]
      }
    })
    expect(write.selectionAssist.quickActions[0]).toEqual({
      id: 'polish',
      label: 'hello ',
      prompt: 'world ',
      mode: 'chat'
    })
  })

  it('drops pristine retired built-ins and migrates pristine polish to the sidebar mode', () => {
    // Stored rows from before proofread was retired and polish moved to chat.
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'polish', label: '', prompt: '', mode: 'edit' },
          { id: 'proofread', label: '', prompt: '', mode: 'edit' },
          { id: 'explain', label: '', prompt: '', mode: 'chat' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'polish', label: '', prompt: '', mode: 'chat' },
      { id: 'explain', label: '', prompt: '', mode: 'chat' }
    ])
  })

  it('keeps customized retired or edit-mode rows as explicit user choices', () => {
    const write = normalizeWriteSettings({
      selectionAssist: {
        quickActions: [
          { id: 'proofread', label: '校对', prompt: '修正错别字', mode: 'edit' },
          { id: 'polish', label: '', prompt: '自定义润色提示', mode: 'edit' }
        ]
      }
    })
    expect(write.selectionAssist.quickActions).toEqual([
      { id: 'proofread', label: '校对', prompt: '修正错别字', mode: 'edit' },
      { id: 'polish', label: '', prompt: '自定义润色提示', mode: 'edit' }
    ])
  })
})
