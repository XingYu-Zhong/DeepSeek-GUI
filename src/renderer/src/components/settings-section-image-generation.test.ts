import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import { SettingsSidebar } from './SettingsSidebar'
import { ImageGenerationSettingsSection } from './settings-section-image-generation'

const labels: Record<string, string> = {
  back: 'Back',
  general: 'General',
  write: 'Write',
  agents: 'AI assistant',
  keyboardShortcuts: 'Keyboard shortcuts',
  claw: 'Connect phone',
  settingsFooter: 'Settings',
  imageGen: 'Image generation',
  imageGenEnabled: 'Enable image generation',
  imageGenEnabledDesc: 'Enables agent chats and Write infographics',
  imageGenBaseUrl: 'API base URL',
  imageGenBaseUrlDesc: 'OpenAI-compatible endpoint root',
  imageGenBaseUrlPlaceholder: 'https://api.example.com/v1',
  imageGenApiKey: 'API key',
  imageGenApiKeyDesc: 'Independent image provider key',
  imageGenModel: 'Image model',
  imageGenModelDesc: 'Model id sent to the provider',
  imageGenModelQualityHint: 'Prefer GPT Image or Gemini image models for design drafts and infographics',
  imageGenModelPlaceholder: 'gpt-image-1',
  imageGenDefaultSize: 'Default size',
  imageGenDefaultSizeDesc: 'Default size description',
  imageGenTimeout: 'Timeout (ms)',
  imageGenTimeoutDesc: 'Timeout description',
  showSecret: 'Show',
  hideSecret: 'Hide'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('ImageGenerationSettingsSection', () => {
  it('renders image generation as a standalone shared settings section', () => {
    const html = renderToStaticMarkup(createElement(ImageGenerationSettingsSection, {
      ctx: {
        t,
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            enabled: true,
            baseUrl: 'https://images.example.com/v1',
            apiKey: 'sk-image',
            model: 'image-model',
            defaultSize: '1536x1024',
            timeoutMs: 240000
          }
        },
        updateKun: () => undefined
      }
    }))

    expect(html).toContain('Image generation')
    expect(html).toContain('Enables agent chats and Write infographics')
    expect(html).toContain('Prefer GPT Image or Gemini image models for design drafts and infographics')
    expect(html).toContain('value="https://images.example.com/v1"')
    expect(html).toContain('value="sk-image"')
    expect(html).toContain('value="image-model"')
    expect(html).toContain('value="1536x1024"')
    expect(html).toContain('value="240000"')
  })

  it('places the image generation tab between Write and AI assistant', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'imageGeneration',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    const writeIndex = html.indexOf('Write')
    const imageIndex = html.indexOf('Image generation')
    const agentsIndex = html.indexOf('AI assistant')
    expect(writeIndex).toBeGreaterThanOrEqual(0)
    expect(imageIndex).toBeGreaterThan(writeIndex)
    expect(agentsIndex).toBeGreaterThan(imageIndex)
  })
})
