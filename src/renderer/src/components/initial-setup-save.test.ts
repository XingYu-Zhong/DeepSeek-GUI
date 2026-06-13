import { describe, expect, it } from 'vitest'
import {
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  buildInitialSetupSettings,
  initialSetupAutoWirePlan,
  initialSetupDrafts,
  initialSetupProfileId,
  initialSetupSelection
} from './initial-setup-save'

function settings(patch: Record<string, unknown> = {}): AppSettingsV1 {
  return normalizeAppSettings(patch as AppSettingsV1)
}

function settingsWithActiveXiaomiWithoutKey(): AppSettingsV1 {
  return settings({
    provider: {
      apiKey: 'sk-deepseek-key',
      baseUrl: 'https://api.deepseek.com',
      providers: [
        { id: 'xiaomi', name: 'Xiaomi', baseUrl: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.5'] }
      ]
    },
    agents: { kun: { providerId: 'xiaomi' } }
  })
}

describe('initialSetupSelection', () => {
  it('preselects the active provider card when it is a known preset', () => {
    const selection = initialSetupSelection(settingsWithActiveXiaomiWithoutKey())
    expect(selection).toEqual({ presetId: 'xiaomi', mode: 'api' })
  })

  it('preselects the token plan mode for token plan profiles', () => {
    const current = settings({ agents: { kun: { providerId: 'minimax-token-plan' } } })
    expect(initialSetupSelection(current)).toEqual({ presetId: 'minimax', mode: 'token-plan' })
  })

  it('falls back to deepseek for unknown or empty active providers', () => {
    expect(initialSetupSelection(settings())).toEqual({ presetId: 'deepseek', mode: 'api' })
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'custom-provider-2' } } })))
      .toEqual({ presetId: 'deepseek', mode: 'api' })
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'litellm' } } })))
      .toEqual({ presetId: 'deepseek', mode: 'api' })
  })
})

describe('initialSetupDrafts', () => {
  it('seeds drafts from saved profiles and preset defaults', () => {
    const drafts = initialSetupDrafts(settingsWithActiveXiaomiWithoutKey())
    expect(drafts.deepseek).toEqual({ apiKey: 'sk-deepseek-key', baseUrl: 'https://api.deepseek.com' })
    expect(drafts.xiaomi.apiKey).toBe('')
    expect(drafts['xiaomi-token-plan']).toEqual({
      apiKey: '',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1'
    })
    expect(drafts['minimax-token-plan'].baseUrl).toBe('https://api.minimaxi.com/anthropic')
  })

  it('does not seed LiteLLM as an onboarding provider', () => {
    expect(initialSetupDrafts(settings()).litellm).toBeUndefined()
  })
})

describe('buildInitialSetupSettings', () => {
  it('activates deepseek so the boot gate sees the key the user typed', () => {
    const current = settingsWithActiveXiaomiWithoutKey()
    const drafts = initialSetupDrafts(current)
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'deepseek', mode: 'api' })

    expect(getKunRuntimeSettings(next).providerId).toBe('deepseek')
    expect(getActiveAgentApiKey(next)).toBe('sk-deepseek-key')
  })

  it('syncs the deepseek draft into the provider profile used by settings', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-old',
        baseUrl: 'https://old.example/v1'
      },
      agents: { kun: { providerId: 'deepseek' } }
    })
    const drafts = initialSetupDrafts(current)
    drafts.deepseek = {
      apiKey: 'sk-new',
      baseUrl: 'https://new.example/v1'
    }

    const next = buildInitialSetupSettings(current, drafts, { presetId: 'deepseek', mode: 'api' })
    const provider = getModelProviderSettings(next)
    const deepseek = provider.providers.find((profile) => profile.id === 'deepseek')

    expect(provider.apiKey).toBe('sk-new')
    expect(provider.baseUrl).toBe('https://new.example/v1')
    expect(deepseek?.apiKey).toBe('sk-new')
    expect(deepseek?.baseUrl).toBe('https://new.example/v1')
  })

  it('creates a token plan profile and activates it', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts['xiaomi-token-plan'] = {
      apiKey: 'tp-subscription-key',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'token-plan' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi-token-plan')
    expect(profile?.apiKey).toBe('tp-subscription-key')
    expect(profile?.baseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1')
    expect(profile?.endpointFormat).toBe('chat_completions')
    expect(profile?.speech).toEqual({
      protocol: 'mimo-asr',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      models: ['mimo-v2.5-asr']
    })
    expect(profile?.modelProfiles['mimo-v2.5']).toEqual(expect.objectContaining({
      inputModalities: expect.arrayContaining(['image']),
      messageParts: expect.arrayContaining(['image_url'])
    }))
    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('xiaomi-token-plan')
    expect(runtime.model).toBe(profile?.models[0])
    expect(getActiveAgentApiKey(next)).toBe('tp-subscription-key')
  })

  it('auto-wires speech and image to filled pay-as-you-go profiles', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    drafts.minimax = { ...drafts.minimax, apiKey: 'mm-key' }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'api' })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.speechToText.enabled).toBe(true)
    expect(runtime.speechToText.providerId).toBe('xiaomi')
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.imageGeneration.providerId).toBe('minimax')
    expect(getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi')?.speech?.protocol)
      .toBe('mimo-asr')
  })

  it('wires speech from a xiaomi token plan key and image from a minimax token plan key', () => {
    const tokenPlanOnly = initialSetupDrafts(settings())
    tokenPlanOnly['xiaomi-token-plan'] = { ...tokenPlanOnly['xiaomi-token-plan'], apiKey: 'tp-key' }
    tokenPlanOnly['minimax-token-plan'] = { ...tokenPlanOnly['minimax-token-plan'], apiKey: 'mm-tp-key' }
    expect(initialSetupAutoWirePlan(settings(), tokenPlanOnly))
      .toEqual({ speechProviderId: 'xiaomi-token-plan', imageProviderId: 'minimax-token-plan' })
  })

  it('creates a MiniMax token plan profile with image generation and activates it', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts['minimax-token-plan'] = {
      apiKey: 'mm-tp-key',
      baseUrl: 'https://api.minimaxi.com/anthropic'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'minimax', mode: 'token-plan' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'minimax-token-plan')
    expect(profile?.apiKey).toBe('mm-tp-key')
    expect(profile?.image).toEqual({
      protocol: 'minimax-image',
      baseUrl: 'https://api.minimaxi.com',
      models: ['image-01', 'image-01-live']
    })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('minimax-token-plan')
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.imageGeneration.providerId).toBe('minimax-token-plan')
    expect(getActiveAgentApiKey(next)).toBe('mm-tp-key')
  })

  it('never overrides existing speech or image generation config while auto-wiring', () => {
    const configured = settings({ agents: { kun: { speechToText: { providerId: 'custom' } } } })
    const drafts = initialSetupDrafts(configured)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    const next = buildInitialSetupSettings(configured, drafts, { presetId: 'xiaomi', mode: 'api' })
    expect(getKunRuntimeSettings(next).speechToText.providerId).toBe('custom')

    const imageConfigured = settings({ agents: { kun: { imageGeneration: { providerId: 'custom-image' } } } })
    const imageDrafts = initialSetupDrafts(imageConfigured)
    imageDrafts['minimax-token-plan'] = { ...imageDrafts['minimax-token-plan'], apiKey: 'mm-tp-key' }
    const nextImage = buildInitialSetupSettings(imageConfigured, imageDrafts, { presetId: 'minimax', mode: 'token-plan' })
    expect(getKunRuntimeSettings(nextImage).imageGeneration.providerId).toBe('custom-image')
  })

  it('prefers the pay-as-you-go profile for speech when both keys are filled', () => {
    const drafts = initialSetupDrafts(settings())
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    drafts['xiaomi-token-plan'] = { ...drafts['xiaomi-token-plan'], apiKey: 'tp-key' }
    expect(initialSetupAutoWirePlan(settings(), drafts).speechProviderId).toBe('xiaomi')
  })

  it('keeps the model override when the provider does not change', () => {
    const current = settings({
      provider: { apiKey: 'sk-deepseek-key' },
      agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-flash' } }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api'
    })
    expect(getKunRuntimeSettings(next).model).toBe('deepseek-v4-flash')
  })

  it('preserves unrelated custom providers', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-deepseek-key',
        providers: [
          { id: 'custom-provider-2', name: 'zenmux', apiKey: 'z-key', baseUrl: 'https://zenmux.ai/api' }
        ]
      }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api'
    })
    const zenmux = getModelProviderSettings(next).providers.find((p) => p.id === 'custom-provider-2')
    expect(zenmux?.apiKey).toBe('z-key')
  })
})

describe('initialSetupProfileId', () => {
  it('maps selection to profile ids', () => {
    expect(initialSetupProfileId({ presetId: 'deepseek', mode: 'api' })).toBe('deepseek')
    expect(initialSetupProfileId({ presetId: 'xiaomi', mode: 'token-plan' })).toBe('xiaomi-token-plan')
    expect(initialSetupProfileId({ presetId: 'minimax', mode: 'api' })).toBe('minimax')
  })
})
