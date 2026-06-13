import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MediaGenerationSettingsSection } from './settings-section-media-generation'

const labels: Record<string, string> = {
  mediaGeneration: 'Media generation',
  mediaGenerationDesc: 'Expose media tools',
  textToSpeech: 'Speech generation',
  textToSpeechEnabled: 'Enable speech generation',
  textToSpeechEnabledDesc: 'Enable generate_speech',
  textToSpeechProvider: 'Speech provider',
  textToSpeechProviderDesc: 'Choose speech provider',
  textToSpeechProviderCustom: 'Custom speech API',
  textToSpeechProviderMissingKey: '{{provider}} missing key',
  textToSpeechModel: 'Speech model',
  textToSpeechModelDesc: 'Speech model desc',
  textToSpeechVoice: 'Voice',
  textToSpeechVoiceDesc: 'Voice desc',
  textToSpeechVoicePlaceholder: 'voice',
  textToSpeechFormat: 'Speech format',
  textToSpeechFormatDesc: 'Speech format desc',
  textToSpeechTimeout: 'Speech timeout',
  textToSpeechTimeoutDesc: 'Speech timeout desc',
  musicGeneration: 'Music generation',
  musicGenerationEnabled: 'Enable music generation',
  musicGenerationEnabledDesc: 'Enable generate_music',
  musicGenerationProvider: 'Music provider',
  musicGenerationProviderDesc: 'Choose music provider',
  musicGenerationProviderCustom: 'Custom music API',
  musicGenerationProviderMissingKey: '{{provider}} missing key',
  musicGenerationModel: 'Music model',
  musicGenerationModelDesc: 'Music model desc',
  musicGenerationFormat: 'Music format',
  musicGenerationFormatDesc: 'Music format desc',
  musicGenerationTimeout: 'Music timeout',
  musicGenerationTimeoutDesc: 'Music timeout desc',
  videoGeneration: 'Video generation',
  videoGenerationEnabled: 'Enable video generation',
  videoGenerationEnabledDesc: 'Enable generate_video',
  videoGenerationProvider: 'Video provider',
  videoGenerationProviderDesc: 'Choose video provider',
  videoGenerationProviderCustom: 'Custom video API',
  videoGenerationProviderMissingKey: '{{provider}} missing key',
  videoGenerationModel: 'Video model',
  videoGenerationModelDesc: 'Video model desc',
  videoGenerationDefaultDuration: 'Default duration',
  videoGenerationDefaultDurationDesc: 'Default duration desc',
  videoGenerationDefaultResolution: 'Default resolution',
  videoGenerationDefaultResolutionDesc: 'Default resolution desc',
  videoGenerationTimeout: 'Video timeout',
  videoGenerationTimeoutDesc: 'Video timeout desc',
  videoGenerationPollInterval: 'Poll interval',
  videoGenerationPollIntervalDesc: 'Poll interval desc',
  modelSelectDefaultOption: 'Default {{model}}'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

describe('MediaGenerationSettingsSection', () => {
  it('renders configured speech, music, and video provider controls', () => {
    const html = renderToStaticMarkup(createElement(MediaGenerationSettingsSection, {
      ctx: {
        t,
        selectControlClass: 'select',
        updateKun: vi.fn(),
        provider: {
          providers: [{
            id: 'minimax',
            name: 'MiniMax',
            apiKey: 'sk-test',
            textToSpeech: {
              protocol: 'minimax-t2a',
              baseUrl: 'https://api.minimax.io',
              models: ['speech-2.8-hd', 'speech-2.8-turbo']
            },
            music: {
              protocol: 'minimax-music',
              baseUrl: 'https://api.minimax.io',
              models: ['music-2.6']
            },
            video: {
              protocol: 'minimax-video',
              baseUrl: 'https://api.minimax.io',
              models: ['MiniMax-Hailuo-2.3']
            }
          }]
        },
        kun: {
          textToSpeech: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-t2a',
            baseUrl: '',
            apiKey: '',
            model: 'speech-2.8-hd',
            voice: '',
            format: 'mp3',
            timeoutMs: 120000
          },
          musicGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-music',
            baseUrl: '',
            apiKey: '',
            model: 'music-2.6',
            format: 'mp3',
            timeoutMs: 300000
          },
          videoGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-video',
            baseUrl: '',
            apiKey: '',
            model: 'MiniMax-Hailuo-2.3',
            defaultDuration: 6,
            defaultResolution: '1080P',
            timeoutMs: 900000,
            pollIntervalMs: 10000
          }
        }
      }
    }))

    expect(html).toContain('Media generation')
    expect(html).toContain('Speech generation')
    expect(html).toContain('speech-2.8-hd')
    expect(html).toContain('Music generation')
    expect(html).toContain('music-2.6')
    expect(html).toContain('Video generation')
    expect(html).toContain('MiniMax-Hailuo-2.3')
    expect(html).not.toContain('Image recognition fallback')
  })
})
