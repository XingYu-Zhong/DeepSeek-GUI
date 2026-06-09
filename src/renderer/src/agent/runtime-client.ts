import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import type {
  RuntimeRequestResult,
  SseEndPayload,
  SseErrorPayload,
  SseEventPayload
} from '@shared/ds-gui-api'

class RendererRuntimeClient {
  private cachedSettings: AppSettingsV1 | null = null
  private settingsPromise: Promise<AppSettingsV1> | null = null

  async getSettings(options?: { forceRefresh?: boolean }): Promise<AppSettingsV1> {
    if (options?.forceRefresh) {
      this.invalidateSettings()
    }
    if (this.cachedSettings) return this.cachedSettings
    if (this.settingsPromise) return this.settingsPromise
    const task = window.dsGui.getSettings().then((settings) => {
      this.cachedSettings = settings
      return settings
    })
    this.settingsPromise = task.finally(() => {
      if (this.settingsPromise === task) this.settingsPromise = null
    })
    return task
  }

  async setSettings(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    const settings = await window.dsGui.setSettings(partial)
    this.cachedSettings = settings
    this.settingsPromise = null
    return settings
  }

  invalidateSettings(): void {
    this.cachedSettings = null
    this.settingsPromise = null
  }

  runtimeRequest(path: string, method?: string, body?: string): Promise<RuntimeRequestResult> {
    if (body === undefined) {
      if (method === undefined) return window.dsGui.runtimeRequest(path)
      return window.dsGui.runtimeRequest(path, method)
    }
    return window.dsGui.runtimeRequest(path, method, body)
  }

  startSse(threadId: string, sinceSeq: number, streamId?: string): Promise<{ streamId: string }> {
    return window.dsGui.startSse(threadId, sinceSeq, streamId)
  }

  stopSse(streamId: string): Promise<boolean> {
    return window.dsGui.stopSse(streamId)
  }

  onSseEvent(handler: (payload: SseEventPayload) => void): () => void {
    return window.dsGui.onSseEvent(handler)
  }

  onSseEnd(handler: (payload: SseEndPayload) => void): () => void {
    return window.dsGui.onSseEnd(handler)
  }

  onSseError(handler: (payload: SseErrorPayload) => void): () => void {
    return window.dsGui.onSseError(handler)
  }
}

export const rendererRuntimeClient = new RendererRuntimeClient()
