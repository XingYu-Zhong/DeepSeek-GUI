import { useState, type ReactElement } from 'react'
import { SecretInput, SettingsCard, SettingRow, Toggle } from './settings-controls'

const DEFAULT_IMAGE_RECOGNITION = {
  enabled: false,
  enabledAt: '',
  protocol: 'openai-chat-completions',
  baseUrl: '',
  apiKey: '',
  model: '',
  prompt: 'Extract and summarize all visible text in this image. Include important labels, tables, UI text, and any context needed by a text-only model.',
  timeoutMs: 120000
}

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const compactInputClass =
  'w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function mergeImageRecognitionPatch(
  current: Record<string, any>,
  patch: Record<string, unknown>,
  now: () => string = () => new Date().toISOString()
): Record<string, unknown> {
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled === true
  const enabledAt = enabled
    ? (typeof patch.enabledAt === 'string' ? patch.enabledAt : current.enabledAt) || now()
    : ''
  return {
    ...current,
    ...patch,
    enabledAt
  }
}

export function ImageInputSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    kun,
    updateKun
  } = ctx
  const imageRecognition = {
    ...DEFAULT_IMAGE_RECOGNITION,
    ...(kun.imageRecognition ?? {})
  }
  const [showApiKey, setShowApiKey] = useState(false)

  const updateImageRecognition = (patch: Record<string, unknown>): void => {
    updateKun({
      imageRecognition: mergeImageRecognitionPatch(imageRecognition, patch)
    })
  }

  return (
    <div className="grid gap-6">
      <SettingsCard title={t('imageInput')}>
        <div className="px-5 py-4 text-[13px] leading-6 text-ds-muted">
          {t('imageInputDesc')}
        </div>
      </SettingsCard>

      <SettingsCard title={t('imageRecognition')}>
        <SettingRow
          title={t('imageRecognitionEnabled')}
          description={t('imageRecognitionEnabledDesc')}
          control={
            <Toggle
              checked={imageRecognition.enabled}
              onChange={(enabled) => updateImageRecognition({
                enabled,
                enabledAt: enabled ? (imageRecognition.enabledAt || new Date().toISOString()) : ''
              })}
            />
          }
        />
        {imageRecognition.enabled ? (
          <>
            <SettingRow
              title={t('imageRecognitionBaseUrl')}
              description={t('imageRecognitionBaseUrlDesc')}
              control={
                <input
                  className={inputClass}
                  value={imageRecognition.baseUrl}
                  placeholder={t('imageRecognitionBaseUrlPlaceholder')}
                  onChange={(e) => updateImageRecognition({ baseUrl: e.target.value })}
                />
              }
            />
            <SettingRow
              title={t('imageRecognitionApiKey')}
              description={t('imageRecognitionApiKeyDesc')}
              control={
                <SecretInput
                  value={imageRecognition.apiKey}
                  visible={showApiKey}
                  onToggleVisibility={() => setShowApiKey((value) => !value)}
                  onChange={(value) => updateImageRecognition({ apiKey: value })}
                  placeholder="sk-..."
                  showLabel={t('showApiKey')}
                  hideLabel={t('hideApiKey')}
                />
              }
            />
            <SettingRow
              title={t('imageRecognitionModel')}
              description={t('imageRecognitionModelDesc')}
              control={
                <input
                  className={`${inputClass} font-mono`}
                  value={imageRecognition.model}
                  placeholder={t('imageRecognitionModelPlaceholder')}
                  spellCheck={false}
                  onChange={(e) => updateImageRecognition({ model: e.target.value })}
                />
              }
            />
            <SettingRow
              title={t('imageRecognitionPrompt')}
              description={t('imageRecognitionPromptDesc')}
              control={
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={imageRecognition.prompt}
                  placeholder={t('imageRecognitionPromptPlaceholder')}
                  onChange={(e) => updateImageRecognition({ prompt: e.target.value })}
                />
              }
            />
            <SettingRow
              title={t('imageRecognitionTimeout')}
              description={t('imageRecognitionTimeoutDesc')}
              control={
                <input
                  className={compactInputClass}
                  type="number"
                  min={10000}
                  max={600000}
                  step={1000}
                  value={imageRecognition.timeoutMs}
                  onChange={(e) => updateImageRecognition({ timeoutMs: Number(e.target.value) || 120000 })}
                />
              }
            />
          </>
        ) : null}
      </SettingsCard>
    </div>
  )
}
