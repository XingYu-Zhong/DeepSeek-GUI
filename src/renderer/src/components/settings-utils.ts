import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  defaultKunRuntimeSettings,
  applyKunRuntimePatch,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings,
  mergeClawSettings,
  mergeModelProviderSettings,
  mergeScheduleSettings,
  mergeWriteSettings,
  normalizeAppBehaviorSettings,
  normalizeClawSettings,
  normalizeGuiUpdateChannel,
  normalizeModelProviderSettings,
  normalizeScheduleSettings,
  normalizeWriteSettings,
  DEFAULT_BACKGROUND_IMAGE_SETTINGS,
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import type { GuiUpdateInfo } from '@shared/gui-update'

type RendererSettingsShape = AppSettingsPatch
type SettingsPatch = AppSettingsPatch

export const DEFAULT_WORKSPACE_ROOT = '~/.deepseekgui/default_workspace'

export function splitSettingsList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function listSettingsText(values: string[]): string {
  return values.join('\n')
}

export function hasValidPort(settings: AppSettingsV1): boolean {
  const port = getKunRuntimeSettings(settings).port
  return Number.isFinite(port) && port >= 1 && port <= 65535
}

export function mergeSettings(current: AppSettingsV1, patch: SettingsPatch): AppSettingsV1 {
  const safeCurrent = coerceRendererSettings(current)
  const { agents: agentsPatch, provider: providerPatch, backgroundImage: bgPatch, ...restPatch } = patch
  return {
    ...applyKunRuntimePatch(safeCurrent, agentsPatch?.kun),
    ...restPatch,
    backgroundImage: bgPatch
      ? { ...safeCurrent.backgroundImage, ...bgPatch }
      : safeCurrent.backgroundImage,
    provider: mergeModelProviderSettings(safeCurrent.provider, providerPatch),
    log: {
      ...safeCurrent.log,
      ...(patch.log ?? {})
    },
    notifications: {
      ...safeCurrent.notifications,
      ...(patch.notifications ?? {})
    },
    appBehavior: normalizeAppBehaviorSettings({
      ...safeCurrent.appBehavior,
      ...(patch.appBehavior ?? {})
    }),
    write: mergeWriteSettings(safeCurrent.write, patch.write),
    claw: mergeClawSettings(safeCurrent.claw, patch.claw),
    schedule: mergeScheduleSettings(safeCurrent.schedule, patch.schedule),
    guiUpdate: {
      ...safeCurrent.guiUpdate,
      ...(patch.guiUpdate ?? {})
    }
  }
}

export function coerceRendererSettings(settings: AppSettingsV1): AppSettingsV1 {
  const raw = settings as RendererSettingsShape
  const theme =
    raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark'
      ? raw.theme
      : 'system'
  const uiFontScale =
    raw.uiFontScale === 'small' || raw.uiFontScale === 'medium' || raw.uiFontScale === 'large'
      ? raw.uiFontScale
      : 'medium'
  return {
    version: 1,
    locale: raw.locale === 'zh' ? 'zh' : 'en',
    theme,
    uiFontScale,
    backgroundImage: {
      dataUrl: typeof raw.backgroundImage?.dataUrl === 'string' ? raw.backgroundImage.dataUrl : DEFAULT_BACKGROUND_IMAGE_SETTINGS.dataUrl,
      opacity: typeof raw.backgroundImage?.opacity === 'number' ? raw.backgroundImage.opacity : DEFAULT_BACKGROUND_IMAGE_SETTINGS.opacity,
      blur: typeof raw.backgroundImage?.blur === 'number' ? raw.backgroundImage.blur : DEFAULT_BACKGROUND_IMAGE_SETTINGS.blur
    },
    provider: normalizeModelProviderSettings(raw.provider),
    agents: kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), getKunRuntimeSettings(settings))),
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : DEFAULT_WORKSPACE_ROOT,
    log: {
      enabled: raw.log?.enabled !== false,
      retentionDays: typeof raw.log?.retentionDays === 'number' ? raw.log.retentionDays : 2
    },
    notifications: {
      turnComplete: raw.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(raw.appBehavior),
    write: normalizeWriteSettings(raw.write),
    claw: normalizeClawSettings(raw.claw),
    schedule: normalizeScheduleSettings(raw.schedule),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(raw.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL)
    }
  }
}

export function guiUpdateFailureMessage(
  info: Extract<GuiUpdateInfo, { ok: false }>,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  switch (info.code) {
    case 'not_configured':
      return t('guiUpdateErrNotConfigured')
    case 'unsupported':
      return t('guiUpdateErrUnsupported')
    case 'download_failed':
      return t('guiUpdateErrDownloadFailed', { message: info.message.trim() })
    case 'install_failed':
      return t('guiUpdateErrInstallFailed', { message: info.message.trim() })
    case 'github_repo_not_found':
      return t('guiUpdateErrRepoNotFound', { repo: info.repo?.trim() || 'owner/repo' })
    case 'github_forbidden':
      return t('guiUpdateErrForbidden')
    case 'github_rate_limited':
      return t('guiUpdateErrRateLimit')
    case 'no_stable_version':
      return t('guiUpdateErrNoStableVersion', { repo: info.repo?.trim() || '—' })
    default:
      return info.message.trim() || t('guiUpdateCheckFailed')
  }
}
