export const GUI_UPDATE_CHANNELS = ['frontier', 'stable'] as const

export type GuiUpdateChannel = (typeof GUI_UPDATE_CHANNELS)[number]

export const DEFAULT_GUI_UPDATE_CHANNEL: GuiUpdateChannel = 'stable'

export function normalizeGuiUpdateChannel(value: unknown): GuiUpdateChannel {
  return value === 'stable' || value === 'frontier' ? value : DEFAULT_GUI_UPDATE_CHANNEL
}

export type GuiUpdateFailureCode =
  | 'not_configured'
  | 'unsupported'
  | 'download_failed'
  | 'install_failed'
  | 'github_repo_not_found'
  | 'github_forbidden'
  | 'github_rate_limited'
  | 'no_stable_version'
  | 'unknown'

export type GuiUpdateProgress = {
  total: number
  delta: number
  transferred: number
  percent: number
  bytesPerSecond: number
}

export type GuiUpdateInfo =
  | {
      ok: true
      currentVersion: string
      latestVersion: string
      hasUpdate: boolean
      releaseUrl: string
      releaseDate?: string
      channel: GuiUpdateChannel
      manualOnly?: boolean
      downloaded?: boolean
    }
  | {
      ok: false
      currentVersion: string
      message: string
      code?: GuiUpdateFailureCode
      releaseUrl?: string
      channel?: GuiUpdateChannel
      /** owner/repo when relevant (e.g. not_found) */
      repo?: string
    }

export type GuiUpdateState =
  | { status: 'idle'; info?: GuiUpdateInfo }
  | { status: 'checking'; info?: GuiUpdateInfo }
  | { status: 'available'; info: Extract<GuiUpdateInfo, { ok: true }> }
  | { status: 'not_available'; info: Extract<GuiUpdateInfo, { ok: true }> }
  | { status: 'installing'; info?: Extract<GuiUpdateInfo, { ok: true }> }
  | {
      status: 'downloading'
      info?: Extract<GuiUpdateInfo, { ok: true }>
      progress: GuiUpdateProgress
    }
  | { status: 'downloaded'; info: Extract<GuiUpdateInfo, { ok: true }> }
  | { status: 'error'; info?: GuiUpdateInfo; message: string; code?: GuiUpdateFailureCode }

export type GuiUpdateDownloadResult =
  | { ok: true; paths: string[] }
  | { ok: false; currentVersion: string; message: string; code?: GuiUpdateFailureCode }

export type GuiUpdateInstallResult =
  | { ok: true }
  | { ok: false; currentVersion: string; message: string; code?: GuiUpdateFailureCode }
