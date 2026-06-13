import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { ProviderModelsManager } from './settings-section-provider-models'

const labels: Record<string, string> = {
  providerModelListDesc: 'Models list description',
  providerModelEmpty: 'No models yet',
  providerModelAdd: 'Add model',
  modelProviderVisionBadge: 'Vision',
  providerModelReasoningBadge: 'Reasoning',
  providerModelNoToolsBadge: 'No tool calling',
  providerModelDefaultProfileBadge: 'Default profile',
  providerModelContextBadge: '{{size}} context',
  providerModelKindChat: 'Text chat',
  providerModelKindImage: 'Image generation',
  providerModelKindSpeech: 'Speech to text',
  providerModelKindTts: 'Text to speech',
  providerModelKindMusic: 'Music generation',
  providerModelKindVideo: 'Video generation'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'custom-provider-1',
    name: 'Custom',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function renderManager(target: ModelProviderProfileV1): string {
  return renderToStaticMarkup(createElement(ProviderModelsManager, {
    provider: target,
    t,
    selectControlClass: 'select',
    onChange: () => undefined
  }))
}

describe('ProviderModelsManager', () => {
  it('renders the empty state with an add button', () => {
    const html = renderManager(provider())
    expect(html).toContain('No models yet')
    expect(html).toContain('Add model')
  })

  it('renders capability badges from the model profile', () => {
    const html = renderManager(provider({
      models: ['vision-thinker', 'bare-model'],
      modelProfiles: {
        'vision-thinker': {
          contextWindowTokens: 1_000_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: false,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'deepseek-chat-completions'
          }
        }
      }
    }))
    expect(html).toContain('vision-thinker')
    expect(html).toContain('1M context')
    expect(html).toContain('Vision')
    expect(html).toContain('Reasoning')
    expect(html).toContain('No tool calling')
    expect(html).toContain('Default profile')
  })

  it('keeps model names on a separate row from compact capability badges', () => {
    const html = renderManager(provider({
      models: ['deepseek-v4-pro'],
      modelProfiles: {
        'deepseek-v4-pro': {
          contextWindowTokens: 1_000_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'deepseek-chat-completions'
          }
        }
      }
    }))

    expect(html).toContain('grid min-w-0 flex-1 gap-1.5')
    expect(html).toContain('flex min-w-0 flex-wrap items-center gap-1')
    expect(html).toContain('text-[10.5px]')
  })

  it('exposes the complete model name on hover for truncated rows', () => {
    const longModelId = 'MiniMax-Text-01-very-long-model-name-with-extra-tags-and-context'
    const html = renderManager(provider({ models: [longModelId] }))

    expect(html).toContain(`title="${longModelId}"`)
    expect(html).toContain('group-hover/model-name:opacity-100')
  })

  it('renders image and speech capability models in the unified list', () => {
    const html = renderManager(provider({
      models: ['chat-model'],
      image: { protocol: 'openai-images', baseUrl: 'https://api.example.com/v1', models: ['image-01'] },
      speech: { protocol: 'mimo-asr', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-asr'] }
    }))

    expect(html).toContain('chat-model')
    expect(html).toContain('Text chat')
    expect(html).toContain('image-01')
    expect(html).toContain('Image generation')
    expect(html).toContain('mimo-v2.5-asr')
    expect(html).toContain('Speech to text')
  })

  it('renders media generation capability models in the unified list', () => {
    const html = renderManager(provider({
      textToSpeech: { protocol: 'mimo-tts', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-tts'] },
      music: { protocol: 'minimax-music', baseUrl: 'https://api.example.com/v1', models: ['music-2.6'] },
      video: { protocol: 'minimax-video', baseUrl: 'https://api.example.com/v1', models: ['MiniMax-Hailuo-2.3'] }
    }))

    expect(html).toContain('mimo-v2.5-tts')
    expect(html).toContain('Text to speech')
    expect(html).toContain('music-2.6')
    expect(html).toContain('Music generation')
    expect(html).toContain('MiniMax-Hailuo-2.3')
    expect(html).toContain('Video generation')
  })
})
