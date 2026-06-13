import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImageInputSettingsSection, mergeImageRecognitionPatch } from './settings-section-image-input'

const labels: Record<string, string> = {
  imageInput: 'Image input',
  imageInputDesc: 'Configure image input',
  imageRecognition: 'Image recognition fallback',
  imageRecognitionEnabled: 'Enable image recognition fallback',
  imageRecognitionEnabledDesc: 'Enable fallback',
  imageRecognitionBaseUrl: 'API base URL',
  imageRecognitionBaseUrlDesc: 'API base URL desc',
  imageRecognitionBaseUrlPlaceholder: 'https://api.openai.com/v1',
  imageRecognitionApiKey: 'API key',
  imageRecognitionApiKeyDesc: 'API key desc',
  imageRecognitionModel: 'Multimodal model',
  imageRecognitionModelDesc: 'Model desc',
  imageRecognitionModelCustom: 'Custom model',
  imageRecognitionModelPlaceholder: 'gpt-4o-mini',
  imageRecognitionPrompt: 'Recognition prompt',
  imageRecognitionPromptDesc: 'Prompt desc',
  imageRecognitionPromptPlaceholder: 'Summarize image',
  imageRecognitionTimeout: 'Timeout',
  imageRecognitionTimeoutDesc: 'Timeout desc',
  showApiKey: 'Show',
  hideApiKey: 'Hide'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('ImageInputSettingsSection', () => {
  it('backfills enabledAt for legacy enabled image recognition settings', () => {
    expect(mergeImageRecognitionPatch(
      { enabled: true, enabledAt: '', model: 'old-model' },
      { model: 'new-model' },
      () => '2026-06-13T11:30:00.000Z'
    )).toMatchObject({
      enabled: true,
      enabledAt: '2026-06-13T11:30:00.000Z',
      model: 'new-model'
    })
    expect(mergeImageRecognitionPatch(
      { enabled: true, enabledAt: '2026-06-13T08:00:00.000Z' },
      { prompt: 'Read text.' },
      () => '2026-06-13T11:30:00.000Z'
    )).toMatchObject({
      enabled: true,
      enabledAt: '2026-06-13T08:00:00.000Z',
      prompt: 'Read text.'
    })
    expect(mergeImageRecognitionPatch(
      { enabled: true, enabledAt: '2026-06-13T08:00:00.000Z' },
      { enabled: false },
      () => '2026-06-13T11:30:00.000Z'
    )).toMatchObject({
      enabled: false,
      enabledAt: ''
    })
  })

  it('renders image input fallback controls when enabled', () => {
    const html = renderToStaticMarkup(createElement(ImageInputSettingsSection, {
      ctx: {
        t,
        selectControlClass: 'select',
        updateKun: vi.fn(),
        kun: {
          imageRecognition: {
            enabled: true,
            protocol: 'openai-chat-completions',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-test',
            model: 'vision-model',
            prompt: 'Read the image text.',
            timeoutMs: 120000
          }
        }
      }
    }))
    expect(html).toContain('Image input')
    expect(html).toContain('Image recognition fallback')
    expect(html).toContain('https://api.example.com/v1')
    expect(html).toContain('vision-model')
    expect(html).toContain('Read the image text.')
  })
})
