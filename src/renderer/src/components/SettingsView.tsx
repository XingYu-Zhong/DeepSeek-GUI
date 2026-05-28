import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CLAW_MODEL_IDS,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  DEFAULT_GUI_UPDATE_CHANNEL,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  DEFAULT_CLAW_MODEL,
  getActiveAgentRuntimeSettings,
  listAgents,
  mergeClawSettings,
  mergeWriteSettings,
  normalizeClawSettings,
  normalizeGuiUpdateChannel,
  normalizeWriteSettings,
  type ApprovalPolicy,
  type AppSettingsV1,
  type ClawRunMode,
  type ClawScheduleKind,
  type ClawSettingsPatchV1,
  type ClawTaskV1,
  type WriteSettingsPatchV1,
  type SandboxMode
} from '@shared/app-settings'
import type { DeepseekUpdateInfo, DeepseekUpdateInstallResult } from '@shared/deepseek-update'
import type {
  GuiUpdateChannel,
  GuiUpdateInfo,
  GuiUpdateProgress,
  GuiUpdateState
} from '@shared/gui-update'
import type { WriteInlineCompletionDebugEntry } from '@shared/write-inline-completion'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Loader2,
  PencilLine,
  Plus,
  RadioTower,
  RefreshCw,
  Settings,
  Trash2
} from 'lucide-react'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import {
  joinFsPath,
  loadPreferredSkillRootId,
  savePreferredSkillRootId,
  type SkillRootId
} from '../lib/skill-root-preference'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useChatStore, type SettingsRouteSection } from '../store/chat-store'

type SettingsCategory = 'general' | 'write' | 'agents' | 'claw'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = Partial<Omit<AppSettingsV1, 'agents' | 'log' | 'notifications' | 'write' | 'claw' | 'guiUpdate'>> & {
  agents?: { codewhale?: Partial<AppSettingsV1['agents']['codewhale']> }
  log?: Partial<AppSettingsV1['log']>
  notifications?: Partial<AppSettingsV1['notifications']>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  guiUpdate?: Partial<AppSettingsV1['guiUpdate']>
}
type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
}
type InlineNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
}
type RendererSettingsShape = Partial<Omit<AppSettingsV1, 'agents' | 'log' | 'notifications' | 'write' | 'claw' | 'guiUpdate'>> & {
  agents?: { codewhale?: Partial<AppSettingsV1['agents']['codewhale']> }
  log?: Partial<AppSettingsV1['log']>
  notifications?: Partial<AppSettingsV1['notifications']>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  guiUpdate?: Partial<AppSettingsV1['guiUpdate']>
}

const DEFAULT_WORKSPACE_ROOT = '~/.deepseekgui/default_workspace'
const CLAW_MODE_OPTIONS: Array<{ id: ClawRunMode; key: string }> = [
  { id: 'agent', key: 'clawModeAgent' },
  { id: 'plan', key: 'clawModePlan' }
]

function splitSettingsList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function listSettingsText(values: string[]): string {
  return values.join('\n')
}

function newClawTask(workspaceRoot: string): ClawTaskV1 {
  const now = new Date().toISOString()
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}`,
    title: 'New Claw task',
    enabled: true,
    prompt: '',
    workspaceRoot,
    model: DEFAULT_CLAW_MODEL,
    mode: 'agent',
    schedule: {
      kind: 'manual',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: ''
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: ''
  }
}

function clawScheduleSummary(
  task: ClawTaskV1,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (task.schedule.kind === 'at') {
    return t('clawScheduleAt', {
      datetime: task.schedule.atTime ? new Date(task.schedule.atTime).toLocaleString() : '—'
    })
  }
  if (task.schedule.kind === 'interval') {
    return t('clawScheduleEvery', { minutes: task.schedule.everyMinutes })
  }
  if (task.schedule.kind === 'daily') {
    return t('clawScheduleDaily', { time: task.schedule.timeOfDay })
  }
  return t('clawScheduleManual')
}

function hasValidPort(settings: AppSettingsV1): boolean {
  const port = getActiveAgentRuntimeSettings(settings).port
  return Number.isFinite(port) && port >= 1 && port <= 65535
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function dateTimeLocalValueFromIso(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('')
}

function isoFromDateTimeLocalValue(value: string): string {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function mergeSettings(current: AppSettingsV1, patch: SettingsPatch): AppSettingsV1 {
  const safeCurrent = coerceRendererSettings(current)
  return {
    ...safeCurrent,
    ...patch,
    agents: {
      codewhale: {
        ...safeCurrent.agents.codewhale,
        ...(patch.agents?.codewhale ?? {})
      }
    },
    agentProvider: patch.agentProvider ?? safeCurrent.agentProvider,
    log: {
      ...safeCurrent.log,
      ...(patch.log ?? {})
    },
    notifications: {
      ...safeCurrent.notifications,
      ...(patch.notifications ?? {})
    },
    write: mergeWriteSettings(safeCurrent.write, patch.write),
    claw: mergeClawSettings(safeCurrent.claw, patch.claw),
    guiUpdate: {
      ...safeCurrent.guiUpdate,
      ...(patch.guiUpdate ?? {})
    }
  }
}

function coerceRendererSettings(settings: AppSettingsV1): AppSettingsV1 {
  const raw = settings as RendererSettingsShape
  return {
    ...settings,
    log: {
      enabled: raw.log?.enabled !== false,
      retentionDays: typeof raw.log?.retentionDays === 'number' ? raw.log.retentionDays : 2
    },
    notifications: {
      turnComplete: raw.notifications?.turnComplete !== false
    },
    write: normalizeWriteSettings(raw.write),
    claw: normalizeClawSettings(raw.claw),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(raw.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL)
    }
  }
}

function guiUpdateFailureMessage(
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

export function SettingsView(): ReactElement {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const setRoute = useChatStore((s) => s.setRoute)
  const settingsReturnRoute = useChatStore((s) => s.settingsReturnRoute)
  const settingsSection = useChatStore((s) => s.settingsSection)
  const openCode = useChatStore((s) => s.openCode)
  const openWrite = useChatStore((s) => s.openWrite)
  const openClaw = useChatStore((s) => s.openClaw)
  const openInitialSetup = useChatStore((s) => s.openInitialSetup)
  const openPlugins = useChatStore((s) => s.openPlugins)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null)
  const [writeWorkspacePickerError, setWriteWorkspacePickerError] = useState<string | null>(null)
  const [clawWorkspacePickerError, setClawWorkspacePickerError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<DeepseekUpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [installResult, setInstallResult] = useState<DeepseekUpdateInstallResult | null>(null)
  const [guiUpdateInfo, setGuiUpdateInfo] = useState<GuiUpdateInfo | null>(null)
  const [checkingGuiUpdate, setCheckingGuiUpdate] = useState(false)
  const [downloadingGuiUpdate, setDownloadingGuiUpdate] = useState(false)
  const [installingGuiUpdate, setInstallingGuiUpdate] = useState(false)
  const [guiUpdateDownloaded, setGuiUpdateDownloaded] = useState(false)
  const [guiUpdateProgress, setGuiUpdateProgress] = useState<GuiUpdateProgress | null>(null)
  const [guiUpdateError, setGuiUpdateError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showRuntimeToken, setShowRuntimeToken] = useState(false)
  const [logPath, setLogPath] = useState('')
  const [logDirOpenError, setLogDirOpenError] = useState<string | null>(null)
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [skillNotice, setSkillNotice] = useState<InlineNotice | null>(null)
  const [mcpConfigPath, setMcpConfigPath] = useState('~/.deepseek/config.toml')
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpConfigExists, setMcpConfigExists] = useState(false)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<InlineNotice | null>(null)
  const [writeDebugModalOpen, setWriteDebugModalOpen] = useState(false)
  const [writeCompletionDebugEntries, setWriteCompletionDebugEntries] = useState<WriteInlineCompletionDebugEntry[]>([])
  const [writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId] = useState<string | null>(null)
  const [writeDebugLoading, setWriteDebugLoading] = useState(false)
  const [writeDebugError, setWriteDebugError] = useState<string | null>(null)
  const initializedCategory = useRef(false)
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  const checkedRuntimeUpdateKey = useRef<string | null>(null)
  const checkedGuiUpdateChannel = useRef<GuiUpdateChannel | null>(null)
  const agentsSectionRef = useRef<HTMLDivElement | null>(null)
  const skillSectionRef = useRef<HTMLDivElement | null>(null)
  const mcpSectionRef = useRef<HTMLDivElement | null>(null)
  const permissionsSectionRef = useRef<HTMLDivElement | null>(null)
  const formTheme = form?.theme
  const formUiFontScale = form?.uiFontScale
  const formWorkspaceRoot = form?.workspaceRoot
  const formPort = form?.agents.codewhale?.port
  const formCodewhaleBinaryPath = form?.agents.codewhale?.binaryPath ?? ''
  const agentOptions = useMemo(() => listAgents(), [])
  const formGuiUpdateChannel = form?.guiUpdate?.channel

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui === 'undefined') {
      setLoadError('PRELOAD_BRIDGE')
      return
    }
    void window.dsGui
      .getSettings()
      .then((s) => {
        if (!cancelled) setForm(coerceRendererSettings(s))
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!formTheme || !formUiFontScale) return
    applyTheme(formTheme)
    applyUiFontScale(formUiFontScale)
  }, [formTheme, formUiFontScale])

  useEffect(() => {
    if (typeof window.dsGui?.getLogPath !== 'function') return
    void window.dsGui.getLogPath().then((p) => setLogPath(p))
  }, [category])

  const loadWriteDebugEntries = useCallback(async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      const completionEntries = typeof window.dsGui?.listWriteInlineCompletionDebugEntries === 'function'
        ? await window.dsGui.listWriteInlineCompletionDebugEntries()
        : []
      setWriteCompletionDebugEntries(completionEntries)
      setWriteCompletionDebugSelectedId((current) =>
        current && completionEntries.some((entry) => entry.id === current)
          ? current
          : completionEntries[0]?.id ?? null
      )
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }, [])

  useEffect(() => {
    if (category !== 'write') return
    void loadWriteDebugEntries()
  }, [category, loadWriteDebugEntries])

  useEffect(() => {
    if (!form || initializedCategory.current) return
    initializedCategory.current = true
    if (!form.agents.codewhale.apiKey?.trim()) {
      setCategory('agents')
    }
  }, [form])

  useEffect(() => {
    if (settingsSection === 'general') {
      setCategory('general')
      return
    }
    if (settingsSection === 'write') {
      setCategory('write')
      return
    }
    if (settingsSection === 'claw') {
      setCategory('claw')
      return
    }
    setCategory('agents')
  }, [settingsSection])

  useEffect(() => {
    if (!form) return
    if (
      settingsSection === 'general' ||
      settingsSection === 'write' ||
      settingsSection === 'claw' ||
      category !== 'agents'
    ) {
      return
    }
    const refs: Record<Exclude<SettingsRouteSection, 'general' | 'write' | 'claw'>, HTMLDivElement | null> = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current
    }
    const target = refs[settingsSection]
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [category, form, settingsSection])

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
    }
  }, [])

  const portError = useMemo(() => {
    if (!form || typeof formPort !== 'number') return null
    if (!hasValidPort(form)) return t('portInvalid')
    return null
  }, [form, formPort, t])

  const skillRootOptions = useMemo<SkillRootOption[]>(() => {
    const workspaceRoot = normalizeWorkspaceRoot(formWorkspaceRoot)
    const hasWorkspace = !!workspaceRoot
    return [
      {
        id: 'workspace-agents',
        label: tCommon('pluginSkillRootWorkspaceAgents'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, '.agents/skills') : '',
        available: hasWorkspace
      },
      {
        id: 'workspace-skills',
        label: tCommon('pluginSkillRootWorkspaceSkills'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, 'skills') : '',
        available: hasWorkspace
      },
      {
        id: 'global-agents',
        label: tCommon('pluginSkillRootGlobalAgents'),
        path: '~/.agents/skills',
        available: true
      },
      {
        id: 'global-deepseek',
        label: tCommon('pluginSkillRootGlobalDeepseek'),
        path: '~/.deepseek/skills',
        available: true
      }
    ]
  }, [formWorkspaceRoot, tCommon])

  const selectedSkillRoot =
    skillRootOptions.find((option) => option.id === skillRootId && option.available) ??
    skillRootOptions.find((option) => option.available)

  useEffect(() => {
    const selectedOption = skillRootOptions.find((option) => option.id === skillRootId && option.available)
    if (selectedOption) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.available)
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const loadMcpConfig = async (): Promise<void> => {
    if (typeof window.dsGui?.getDeepseekConfigFile !== 'function') return
    setMcpLoading(true)
    setMcpNotice(null)
    try {
      const config = await window.dsGui.getDeepseekConfigFile()
      setMcpConfigPath(config.path)
      setMcpConfigText(config.content)
      setMcpConfigExists(config.exists)
      setMcpLoaded(true)
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpLoading(false)
    }
  }

  useEffect(() => {
    if (category !== 'agents' || mcpLoaded || mcpLoading) return
    void loadMcpConfig()
  }, [category, mcpLoaded, mcpLoading])

  const openSkillRoot = async (): Promise<void> => {
    if (!selectedSkillRoot?.path || !selectedSkillRoot.available) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.dsGui?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.dsGui.openSkillRoot(selectedSkillRoot.path)
    if (!result.ok) {
      setSkillNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const saveMcpConfig = async (): Promise<void> => {
    if (typeof window.dsGui?.setDeepseekConfigFile !== 'function') return
    setMcpBusy(true)
    setMcpNotice(null)
    try {
      const result = await window.dsGui.setDeepseekConfigFile(mcpConfigText)
      setMcpConfigPath(result.path)
      setMcpConfigExists(true)
      setMcpNotice({
        tone: 'success',
        message: t('mcpSaved', { path: result.path })
      })
    } catch (e) {
      setMcpNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setMcpBusy(false)
    }
  }

  const openMcpConfigDir = async (): Promise<void> => {
    if (typeof window.dsGui?.openDeepseekConfigDir !== 'function') return
    const result = await window.dsGui.openDeepseekConfigDir()
    if (!result.ok) {
      setMcpNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const scrollToAgentSection = (target: 'agents' | 'skill' | 'mcp' | 'permissions'): void => {
    const refs = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    refs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const persistSettings = async (snapshot: AppSettingsV1, version: number): Promise<void> => {
    if (!hasValidPort(snapshot)) return
    setSaveStatus('saving')
    setSaveError(null)

    try {
      const next = coerceRendererSettings(await window.dsGui.setSettings(snapshot))
      if (version !== draftVersion.current) return

      setForm(next)
      await applyI18n(next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
      if (version !== draftVersion.current) return

      setSaveStatus('saved')
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => {
        if (version === draftVersion.current) setSaveStatus('idle')
        statusTimer.current = null
      }, 1500)
    } catch (e) {
      if (version !== draftVersion.current) return
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  const scheduleSave = (next: AppSettingsV1): void => {
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = null
    setSaveError(null)

    if (!hasValidPort(next)) {
      setSaveStatus('idle')
      return
    }

    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persistSettings(next, version)
    }, 450)
  }

  const flushPendingSave = async (): Promise<void> => {
    if (!form || !hasValidPort(form)) return
    draftVersion.current += 1
    const version = draftVersion.current

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current)
      statusTimer.current = null
    }

    await persistSettings(form, version)
  }

  const goBack = (): void => {
    void (async () => {
      await flushPendingSave()
      await reloadUiSettings()
      if (settingsReturnRoute === 'write') {
        await openWrite()
        return
      }
      if (settingsReturnRoute === 'claw') {
        openClaw()
        return
      }
      if (settingsReturnRoute === 'plugins') {
        setRoute('plugins')
        return
      }
      await openCode()
    })()
  }

  const openOnboardingPreview = (): void => {
    void (async () => {
      await flushPendingSave()
      openInitialSetup('preview')
    })()
  }

  const checkRuntimeUpdate = useCallback(async (preserveInstallResult = false): Promise<void> => {
    if (typeof window.dsGui?.checkDeepseekUpdate !== 'function') return
    setCheckingUpdate(true)
    setUpdateError(null)
    try {
      const info = await window.dsGui.checkDeepseekUpdate()
      setUpdateInfo(info)
      if (!preserveInstallResult) setInstallResult(null)
      if (!info.ok) setUpdateError(info.message)
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCheckingUpdate(false)
    }
  }, [])

  const installRuntimeUpdate = async (): Promise<void> => {
    if (typeof window.dsGui?.installDeepseekUpdate !== 'function') return
    setInstallingUpdate(true)
    setUpdateError(null)
    setInstallResult(null)
    try {
      const result = await window.dsGui.installDeepseekUpdate()
      setInstallResult(result)
      if (!result.ok) {
        setUpdateError(result.message)
        return
      }
      void probeRuntime('background')
      await checkRuntimeUpdate(true)
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstallingUpdate(false)
    }
  }

  const applyGuiUpdateState = useCallback((state: GuiUpdateState): void => {
    if ('info' in state && state.info) {
      setGuiUpdateInfo(state.info)
    }
    if (state.status === 'checking') {
      setCheckingGuiUpdate(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'available' || state.status === 'not_available') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(Boolean(state.info.downloaded))
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloading') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(true)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(state.progress)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloaded') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'installing') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(true)
      setGuiUpdateProgress(null)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'error') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateError(state.message)
    }
  }, [])

  const checkGuiUpdate = useCallback(async (): Promise<void> => {
    if (typeof window.dsGui?.checkGuiUpdate !== 'function') return
    const channel = formGuiUpdateChannel
    setCheckingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const info = await window.dsGui.checkGuiUpdate(channel)
      setGuiUpdateInfo(info)
      if (!info.ok) {
        if (info.code === 'not_configured') {
          setGuiUpdateError(null)
        } else {
          setGuiUpdateError(guiUpdateFailureMessage(info, t))
        }
      }
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCheckingGuiUpdate(false)
    }
  }, [formGuiUpdateChannel, t])

  const downloadGuiUpdate = async (): Promise<void> => {
    if (typeof window.dsGui?.downloadGuiUpdate !== 'function') return
    const channel = form?.guiUpdate?.channel
    setDownloadingGuiUpdate(true)
    setGuiUpdateProgress(null)
    setGuiUpdateError(null)
    try {
      const result = await window.dsGui.downloadGuiUpdate(channel)
      if (!result.ok) {
        setGuiUpdateError(result.message)
        return
      }
      setGuiUpdateDownloaded(true)
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloadingGuiUpdate(false)
    }
  }

  const installGuiUpdate = async (): Promise<void> => {
    if (typeof window.dsGui?.installGuiUpdate !== 'function') return
    setInstallingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const result = await window.dsGui.installGuiUpdate()
      if (!result.ok) {
        setGuiUpdateError(result.message)
        setInstallingGuiUpdate(false)
      }
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
      setInstallingGuiUpdate(false)
    }
  }

  useEffect(() => {
    if (typeof window.dsGui?.onGuiUpdateState !== 'function') return
    const unsubscribe = window.dsGui.onGuiUpdateState(applyGuiUpdateState)
    if (typeof window.dsGui?.getGuiUpdateState === 'function') {
      void window.dsGui.getGuiUpdateState().then(applyGuiUpdateState)
    }
    return unsubscribe
  }, [applyGuiUpdateState])

  useEffect(() => {
    if (!form || category !== 'agents') return
    const key = formCodewhaleBinaryPath.trim() || '<managed>'
    if (checkedRuntimeUpdateKey.current === key) return
    checkedRuntimeUpdateKey.current = key
    void checkRuntimeUpdate()
  }, [category, checkRuntimeUpdate, form, formCodewhaleBinaryPath])

  useEffect(() => {
    if (!form || category !== 'general') return
    const channel = formGuiUpdateChannel
    if (checkedGuiUpdateChannel.current === (channel ?? null)) return
    checkedGuiUpdateChannel.current = channel ?? null
    void checkGuiUpdate()
  }, [category, checkGuiUpdate, form, formGuiUpdateChannel])

  if (loadError) {
    const msg =
      loadError === 'PRELOAD_BRIDGE' ? t('preloadBridgeError') : t('loadFailed', { message: loadError })
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-ds-main p-6 text-center">
        <p className="max-w-md text-sm text-red-700 dark:text-red-300">{msg}</p>
        <button
          type="button"
          className="rounded-xl bg-ds-userbubble px-4 py-2 text-sm font-medium text-ds-userbubbleFg"
          onClick={goBack}
        >
          {t('back')}
        </button>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="flex h-full items-center justify-center bg-ds-main text-ds-faint">
        {t('loading')}
      </div>
    )
  }

  const corsValue = (form.agents.codewhale.extraCorsOrigins ?? []).join(', ')

  const update = (partial: SettingsPatch): void => {
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (partial.guiUpdate?.channel && partial.guiUpdate.channel !== form.guiUpdate.channel) {
      setGuiUpdateInfo(null)
      setGuiUpdateError(null)
      setGuiUpdateDownloaded(false)
      setGuiUpdateProgress(null)
    }
    scheduleSave(next)
  }

  const pickWorkspace = async (): Promise<void> => {
    try {
      setWorkspacePickerError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(form.workspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        update({ workspaceRoot: picked.path })
      }
    } catch (e) {
      setWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetWorkspaceToDefault = (): void => {
    setWorkspacePickerError(null)
    update({ workspaceRoot: DEFAULT_WORKSPACE_ROOT })
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setWriteWorkspacePickerError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(
        form.write.defaultWorkspaceRoot || DEFAULT_WRITE_WORKSPACE_ROOT
      )
      if (!picked.canceled && picked.path) {
        const workspaces = [
          picked.path,
          form.write.activeWorkspaceRoot,
          ...form.write.workspaces
        ].filter((value, index, list) => value.trim() && list.indexOf(value) === index)
        update({
          write: {
            defaultWorkspaceRoot: picked.path,
            activeWorkspaceRoot: picked.path,
            workspaces
          }
        })
      }
    } catch (e) {
      setWriteWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetWriteWorkspaceToDefault = (): void => {
    setWriteWorkspacePickerError(null)
    update({
      write: {
        defaultWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
        activeWorkspaceRoot: DEFAULT_WRITE_WORKSPACE_ROOT,
        workspaces: [DEFAULT_WRITE_WORKSPACE_ROOT, ...form.write.workspaces]
      }
    })
  }

  const pickClawWorkspace = async (): Promise<void> => {
    try {
      setClawWorkspacePickerError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(
        form.claw.im.workspaceRoot || form.workspaceRoot || undefined
      )
      if (!picked.canceled && picked.path) {
        update({ claw: { im: { workspaceRoot: picked.path } } })
      }
    } catch (e) {
      setClawWorkspacePickerError(formatWorkspacePickerError(e))
    }
  }

  const resetClawWorkspaceToDefault = (): void => {
    setClawWorkspacePickerError(null)
    update({ claw: { im: { workspaceRoot: '' } } })
  }

  const updateClawTask = (taskId: string, patch: Partial<ClawTaskV1>): void => {
    const now = new Date().toISOString()
    const shouldRecomputeNextRun =
      Object.prototype.hasOwnProperty.call(patch, 'enabled') || patch.schedule !== undefined
    update({
      claw: {
        tasks: form.claw.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...patch,
                ...(shouldRecomputeNextRun ? { nextRunAt: '' } : {}),
                updatedAt: now
              }
            : task
        )
      }
    })
  }

  const updateClawTaskSchedule = (
    taskId: string,
    patch: Partial<ClawTaskV1['schedule']>
  ): void => {
    const current = form.claw.tasks.find((task) => task.id === taskId)
    if (!current) return
    updateClawTask(taskId, {
      schedule: {
        ...current.schedule,
        ...patch
      }
    })
  }

  const addClawTask = (): void => {
    update({
      claw: {
        tasks: [...form.claw.tasks, newClawTask(form.workspaceRoot)]
      }
    })
  }

  const deleteClawTask = (taskId: string): void => {
    update({
      claw: {
        tasks: form.claw.tasks.filter((task) => task.id !== taskId)
      }
    })
  }

  const clearWriteDebugEntries = async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      if (typeof window.dsGui?.clearWriteInlineCompletionDebugEntries === 'function') {
        await window.dsGui.clearWriteInlineCompletionDebugEntries()
      }
      setWriteCompletionDebugEntries([])
      setWriteCompletionDebugSelectedId(null)
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }

  const catCls = (c: SettingsCategory): string =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition ${
      category === c
        ? 'bg-ds-subtle text-ds-ink shadow-sm ring-1 ring-ds-border-muted'
        : 'text-ds-muted hover:bg-ds-hover'
    }`
  const selectControlClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <aside className="ds-drag flex w-[248px] shrink-0 flex-col border-r border-ds-border bg-ds-sidebar backdrop-blur-md">
        <div className="px-3 pb-3 pt-3">
          <div aria-hidden className="ds-titlebar-safe-block" />
          <button
            type="button"
            onClick={goBack}
            className="ds-no-drag flex items-center gap-2 rounded-xl px-2 py-2 text-[14px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            {t('back')}
          </button>
        </div>
        <nav className="ds-no-drag flex flex-col gap-0.5 px-2">
          <button type="button" className={catCls('general')} onClick={() => setCategory('general')}>
            <Globe className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t('general')}
          </button>
          <button type="button" className={catCls('write')} onClick={() => setCategory('write')}>
            <PencilLine className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t('write')}
          </button>
          <button type="button" className={catCls('agents')} onClick={() => setCategory('agents')}>
            <Bot className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t('agents')}
          </button>
          <button type="button" className={catCls('claw')} onClick={() => setCategory('claw')}>
            <RadioTower className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t('claw')}
          </button>
        </nav>
        <div className="ds-no-drag mt-auto border-t border-ds-border p-3">
          <div className="flex items-center gap-2 rounded-xl px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-subtle text-ds-muted">
              <Settings className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 text-[12px] text-ds-muted">
              <div className="truncate font-medium text-ds-ink">DeepSeek-GUI</div>
              <div className="truncate">{t('settingsFooter')}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="ds-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-3xl">
          {!form.agents.codewhale.apiKey.trim() ? (
            <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
              <div className="text-[15px] font-semibold">{t('apiKeyRequiredTitle')}</div>
              <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
                {t('apiKeyRequiredBody')}
              </p>
            </div>
          ) : null}

          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ds-ink">{t('title')}</h1>
              <p className="mt-1 text-[14px] text-ds-muted">{t('subtitle')}</p>
            </div>
            <span
              title={saveStatus === 'error' && saveError ? saveError : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                portError
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                  : saveStatus === 'saved'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : saveStatus === 'error'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-200'
                      : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {portError
                ? t('autoApplyBlocked')
                : saveStatus === 'saving'
                  ? t('applying')
                  : saveStatus === 'saved'
                    ? t('applied')
                    : saveStatus === 'error'
                      ? t('applyFailed')
                      : t('autoApplyHint')}
            </span>
          </div>

          {category === 'general' && (
            <>
              <SettingsCard title={t('sectionGeneral')}>
                <SettingRow
                  title={t('language')}
                  description={t('languageDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.locale}
                      onChange={(e) => update({ locale: e.target.value as 'en' | 'zh' })}
                    >
                      <option value="en">English</option>
                      <option value="zh">简体中文</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('theme')}
                  description={t('themeDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.theme}
                      onChange={(e) => update({ theme: e.target.value as AppSettingsV1['theme'] })}
                    >
                      <option value="system">{t('themeSystem')}</option>
                      <option value="light">{t('themeLight')}</option>
                      <option value="dark">{t('themeDark')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('onboardingPreview')}
                  description={t('onboardingPreviewDesc')}
                  control={
                    <button
                      type="button"
                      onClick={openOnboardingPreview}
                      className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      {t('onboardingPreviewOpen')}
                    </button>
                  }
                />
                <SettingRow
                  title={t('fontScale')}
                  description={t('fontScaleDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.uiFontScale}
                      onChange={(e) =>
                        update({
                          uiFontScale: e.target.value as AppSettingsV1['uiFontScale']
                        })
                      }
                    >
                      <option value="small">{t('fontScaleSmall')}</option>
                      <option value="medium">{t('fontScaleMedium')}</option>
                      <option value="large">{t('fontScaleLarge')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('turnCompleteNotification')}
                  description={t('turnCompleteNotificationDesc')}
                  control={
                    <Toggle
                      checked={form.notifications.turnComplete}
                      onChange={(v) => update({ notifications: { turnComplete: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('workspaceRoot')}
                  description={t('workspaceRootDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={form.workspaceRoot}
                          onChange={(e) => update({ workspaceRoot: e.target.value })}
                          placeholder={t('workspaceRootPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={resetWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {workspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {workspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('guiUpdate')} className="mt-6">
                <SettingRow
                  title={t('guiUpdateChannel')}
                  description={t('guiUpdateChannelDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.guiUpdate.channel}
                      onChange={(e) =>
                        update({
                          guiUpdate: { channel: e.target.value as GuiUpdateChannel }
                        })
                      }
                    >
                      <option value="frontier">{t('guiUpdateChannelFrontier')}</option>
                      <option value="stable">{t('guiUpdateChannelStable')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('guiUpdate')}
                  description={t('guiUpdateDesc')}
                  control={
                    <GuiUpdateControl
                      info={guiUpdateInfo}
                      checking={checkingGuiUpdate}
                      downloading={downloadingGuiUpdate}
                      installing={installingGuiUpdate}
                      downloaded={guiUpdateDownloaded}
                      progress={guiUpdateProgress}
                      error={guiUpdateError}
                      onCheck={checkGuiUpdate}
                      onDownload={downloadGuiUpdate}
                      onInstall={installGuiUpdate}
                      t={t}
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('logTitle')} className="mt-6">
                <SettingRow
                  title={t('logEnabled')}
                  description={t('logEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.log.enabled}
                      onChange={(v) => update({ log: { enabled: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('logRetention')}
                  description={t('logRetentionDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.log.retentionDays}
                      onChange={(e) =>
                        update({ log: { retentionDays: Number(e.target.value) } })
                      }
                    >
                      <option value={1}>{t('logRetentionOne')}</option>
                      <option value={2}>{t('logRetentionTwo')}</option>
                      <option value={3}>{t('logRetentionThree')}</option>
                      <option value={5}>{t('logRetentionFive')}</option>
                      <option value={7}>{t('logRetentionSeven')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('logDir')}
                  description={t('logDirDesc')}
                  wideControl
                  control={
                    <div className="flex w-full min-w-0 flex-col items-start gap-2">
                      {logPath ? (
                        <code className="block w-full max-w-full break-all rounded-xl bg-ds-main/70 px-3 py-2 font-mono text-[12px] text-ds-muted shadow-sm">
                          {logPath}
                        </code>
                      ) : (
                        <span className="text-[13px] text-ds-faint">…</span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
                        disabled={typeof window.dsGui?.openLogDir !== 'function'}
                        onClick={async () => {
                          if (typeof window.dsGui?.openLogDir !== 'function') return
                          setLogDirOpenError(null)
                          try {
                            const result = await window.dsGui.openLogDir()
                            if (!result.ok) setLogDirOpenError(result.message ?? 'Unknown error')
                          } catch (e) {
                            setLogDirOpenError(e instanceof Error ? e.message : String(e))
                          }
                        }}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t('logDirOpen')}
                      </button>
                      {logDirOpenError ? (
                        <p className="text-[12px] text-red-700 dark:text-red-300">
                          {logDirOpenError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>
            </>
          )}

          {category === 'write' && (
            <>
              <SettingsCard title={t('sectionWrite')}>
                <SettingRow
                  title={t('writeWorkspaceRoot')}
                  description={t('writeWorkspaceRootDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={form.write.defaultWorkspaceRoot}
                          onChange={(e) =>
                            update({
                              write: {
                                defaultWorkspaceRoot: e.target.value,
                                activeWorkspaceRoot: e.target.value,
                                workspaces: [e.target.value, ...form.write.workspaces]
                              }
                            })
                          }
                          placeholder={t('writeWorkspaceRootPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={resetWriteWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWriteWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {writeWorkspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {writeWorkspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeApiKey')}
                  description={t('writeApiKeyDesc')}
                  control={
                    <SecretInput
                      value={form.agents.codewhale.apiKey}
                      onChange={(value) => update({ agents: { codewhale: { apiKey: value } } })}
                      visible={showApiKey}
                      onToggleVisibility={() => setShowApiKey((value) => !value)}
                      placeholder="sk-…"
                      autoComplete="off"
                      invalid={!form.agents.codewhale.apiKey.trim()}
                      showLabel={t('showSecret')}
                      hideLabel={t('hideSecret')}
                      className="md:max-w-md"
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('writeInlineCompletion')} className="mt-5">
                <SettingRow
                  title={t('writeInlineCompletionEnabled')}
                  description={t('writeInlineCompletionEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.enabled}
                      onChange={(enabled) => update({ write: { inlineCompletion: { enabled } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionRetrieval')}
                  description={t('writeInlineCompletionRetrievalDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.retrievalEnabled}
                      onChange={(retrievalEnabled) => update({ write: { inlineCompletion: { retrievalEnabled } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionBaseUrl')}
                  description={t('writeInlineCompletionBaseUrlDesc')}
                  control={
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                      value={form.write.inlineCompletion.baseUrl}
                      placeholder={DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL}
                      onChange={(e) => update({ write: { inlineCompletion: { baseUrl: e.target.value } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionModel')}
                  description={t('writeInlineCompletionModelDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                    <input
                      list="write-inline-completion-model-options"
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.model || DEFAULT_WRITE_INLINE_COMPLETION_MODEL}
                      placeholder={DEFAULT_WRITE_INLINE_COMPLETION_MODEL}
                      onChange={(e) => update({ write: { inlineCompletion: { model: e.target.value } } })}
                    />
                    <datalist id="write-inline-completion-model-options">
                      {WRITE_INLINE_COMPLETION_MODEL_IDS.map((model) => (
                        <option
                          key={model}
                          value={model}
                          label={t(
                            model === DEFAULT_WRITE_INLINE_COMPLETION_MODEL
                              ? 'writeInlineCompletionModelFlash'
                              : 'writeInlineCompletionModelPro'
                          )}
                        />
                      ))}
                    </datalist>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionDebounce')}
                  description={t('writeInlineCompletionDebounceDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.debounceMs}
                      onChange={(e) => update({
                        write: { inlineCompletion: { debounceMs: Number(e.target.value) } }
                      })}
                    >
                      <option value={300}>{t('writeInlineCompletionDelayFast')}</option>
                      <option value={650}>{t('writeInlineCompletionDelayBalanced')}</option>
                      <option value={1000}>{t('writeInlineCompletionDelayCalm')}</option>
                      <option value={1500}>{t('writeInlineCompletionDelaySlow')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionThreshold')}
                  description={t('writeInlineCompletionThresholdDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.minAcceptScore}
                      onChange={(e) => update({
                        write: { inlineCompletion: { minAcceptScore: Number(e.target.value) } }
                      })}
                    >
                      <option value={0.38}>{t('writeInlineCompletionThresholdCreative')}</option>
                      <option value={0.52}>{t('writeInlineCompletionThresholdBalanced')}</option>
                      <option value={0.68}>{t('writeInlineCompletionThresholdStrict')}</option>
                      <option value={0.82}>{t('writeInlineCompletionThresholdVeryStrict')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionMaxTokens')}
                  description={t('writeInlineCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={16}
                      max={512}
                      step={8}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.maxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { maxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletion')}
                  description={t('writeInlineLongCompletionDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.longCompletionEnabled}
                      onChange={(longCompletionEnabled) => update({
                        write: { inlineCompletion: { longCompletionEnabled } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletionMaxTokens')}
                  description={t('writeInlineLongCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={64}
                      max={1024}
                      step={16}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.longMaxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { longMaxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                <div className="px-3 py-3 text-[12.5px] leading-5 text-ds-muted">
                  {t('writeInlineCompletionApiNote')}
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeDebugLogTitle')} className="mt-5">
                <SettingRow
                  title={t('writeDebugLogOpen')}
                  description={t('writeDebugLogDesc')}
                  control={
                    <button
                      type="button"
                      onClick={() => {
                        setWriteDebugModalOpen(true)
                        void loadWriteDebugEntries()
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      <PencilLine className="h-4 w-4" strokeWidth={1.75} />
                      {t('writeDebugLogOpenButton')}
                    </button>
                  }
                />
              </SettingsCard>
            </>
          )}

          {category === 'agents' && (
            <>
              <SettingsCard title={t('agentProviderTitle')} className="mb-6">
                <SettingRow
                  title={t('agentProviderLabel')}
                  description={t('agentProviderDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.agentProvider}
                      onChange={(e) =>
                        update({
                          agentProvider: e.target.value as AppSettingsV1['agentProvider']
                        })
                      }
                    >
                      {agentOptions.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </option>
                      ))}
                    </select>
                  }
                />
              </SettingsCard>

              <div className="mb-6 flex flex-wrap gap-2">
                <SectionJumpButton label={t('agentsQuickBase')} onClick={() => scrollToAgentSection('agents')} />
                <SectionJumpButton label={t('agentsQuickSkill')} onClick={() => scrollToAgentSection('skill')} />
                <SectionJumpButton label={t('agentsQuickMcp')} onClick={() => scrollToAgentSection('mcp')} />
                <SectionJumpButton
                  label={t('agentsQuickPermissions')}
                  onClick={() => scrollToAgentSection('permissions')}
                />
              </div>

              <div ref={agentsSectionRef}>
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('configFilePathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm md:max-w-md">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          ~/.deepseek/config.toml
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('apiKey')}
                    description={t('apiKeyDesc')}
                    control={
                      <SecretInput
                        value={form.agents.codewhale.apiKey}
                        onChange={(value) => update({ agents: { codewhale: { apiKey: value } } })}
                        visible={showApiKey}
                        onToggleVisibility={() => setShowApiKey((value) => !value)}
                        placeholder="sk-…"
                        autoComplete="off"
                        invalid={!form.agents.codewhale.apiKey.trim()}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('baseUrl')}
                    description={t('baseUrlDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('baseUrlPlaceholder')}
                        value={form.agents.codewhale.baseUrl}
                        onChange={(e) => update({ agents: { codewhale: { baseUrl: e.target.value } } })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={form.agents.codewhale.autoStart}
                        onChange={(v) => update({ agents: { codewhale: { autoStart: v } } })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={form.agents.codewhale.port}
                          onChange={(e) => update({ agents: { codewhale: { port: Number(e.target.value) } } })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('deepseekBinary')}
                    description={t('deepseekBinaryHint')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('deepseekBinaryPlaceholder')}
                        value={form.agents.codewhale.binaryPath}
                        onChange={(e) => update({ agents: { codewhale: { binaryPath: e.target.value } } })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('tuiUpdate')}
                    description={t('tuiUpdateDesc')}
                    control={
                      <DeepseekUpdateControl
                        info={updateInfo}
                        checking={checkingUpdate}
                        installing={installingUpdate}
                        error={updateError}
                        installResult={installResult}
                        onCheck={checkRuntimeUpdate}
                        onInstall={installRuntimeUpdate}
                        t={t}
                      />
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={form.agents.codewhale.runtimeToken}
                        onChange={(value) => update({ agents: { codewhale: { runtimeToken: value } } })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('corsOrigins')}
                    description={t('corsOriginsDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={corsValue}
                        onChange={(e) =>
                          update({
                            agents: {
                              codewhale: {
                                extraCorsOrigins: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              }
                            }
                          })
                        }
                      />
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={skillSectionRef} className="mt-6">
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsLocation')}
                    description={t('skillsLocationDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={selectedSkillRoot?.id ?? skillRootId}
                        onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
                      >
                        {skillRootOptions.map((option) => (
                          <option key={option.id} value={option.id} disabled={!option.available}>
                            {option.available ? option.label : `${option.label} · ${tCommon('pluginSkillRootNeedsWorkspace')}`}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('skillsPath')}
                    description={t('skillsPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {selectedSkillRoot?.path || t('skillsRootUnavailable')}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={listSettingsText(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: splitSettingsList(event.target.value)
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={selectedSkillRoot?.path || '~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void openSkillRoot()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('skillsOpenRoot')}
                          </button>
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={mcpSectionRef} className="mt-6">
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {mcpConfigPath}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <textarea
                          value={mcpConfigText}
                          onChange={(e) => setMcpConfigText(e.target.value)}
                          spellCheck={false}
                          placeholder={mcpLoading ? t('loading') : ''}
                          className="min-h-[320px] w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={permissionsSectionRef} className="mt-6">
                <SettingsCard title={t('permissions')}>
                  <SettingRow
                    title={t('approvalPolicy')}
                    description={t('approvalPolicyDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={form.agents.codewhale.approvalPolicy}
                        onChange={(e) =>
                          update({
                            agents: {
                              codewhale: {
                                approvalPolicy: e.target.value as ApprovalPolicy
                              }
                            }
                          })
                        }
                      >
                        <option value="auto">{t('approvalAuto')}</option>
                        <option value="on-request">{t('approvalOnRequest')}</option>
                        <option value="untrusted">{t('approvalUntrusted')}</option>
                        <option value="suggest">{t('approvalSuggest')}</option>
                        <option value="never">{t('approvalNever')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('sandboxMode')}
                    description={t('sandboxModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={form.agents.codewhale.sandboxMode}
                        onChange={(e) =>
                          update({
                            agents: {
                              codewhale: {
                                sandboxMode: e.target.value as SandboxMode
                              }
                            }
                          })
                        }
                      >
                        <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
                        <option value="read-only">{t('sandboxReadOnly')}</option>
                        <option value="danger-full-access">{t('sandboxFullAccess')}</option>
                        <option value="external-sandbox">{t('sandboxExternal')}</option>
                      </select>
                    }
                  />
                </SettingsCard>
              </div>
            </>
          )}

          {category === 'claw' && (
            <>
              <SettingsCard title={t('clawRuntime')}>
                <SettingRow
                  title={t('clawEnabled')}
                  description={t('clawEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.claw.enabled}
                      onChange={(value) => update({ claw: { enabled: value } })}
                    />
                  }
                />
                <SettingRow
                  title={t('clawDefaultWorkspace')}
                  description={t('clawDefaultWorkspaceDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={form.claw.im.workspaceRoot}
                          onChange={(e) =>
                            update({
                              claw: {
                                im: {
                                  workspaceRoot: e.target.value
                                }
                              }
                            })
                          }
                          placeholder={t('clawDefaultWorkspacePlaceholder', { path: form.workspaceRoot })}
                        />
                        <button
                          type="button"
                          onClick={resetClawWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('clawDefaultWorkspaceReset')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickClawWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {clawWorkspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {clawWorkspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('clawTasksTitle')} className="mt-6">
                <SettingRow
                  title={t('clawTasksTitle')}
                  description={t('clawTasksDesc')}
                  wideControl
                  control={
                    <div className="flex w-full flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[13px] leading-5 text-ds-muted">
                          {form.claw.tasks.length === 0 ? t('clawTasksEmpty') : t('clawTasksCount', { count: form.claw.tasks.length })}
                        </div>
                        <button
                          type="button"
                          onClick={addClawTask}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                          {t('clawTaskAdd')}
                        </button>
                      </div>
                      {form.claw.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-xl border border-ds-border-muted bg-ds-main/45 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <input
                              className="min-w-[220px] flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-medium text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                              value={task.title}
                              onChange={(event) => updateClawTask(task.id, { title: event.target.value })}
                            />
                            <Toggle
                              checked={task.enabled}
                              onChange={(value) => updateClawTask(task.id, { enabled: value })}
                            />
                            <button
                              type="button"
                              onClick={() => deleteClawTask(task.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-red-600"
                              title={t('clawTaskDelete')}
                              aria-label={t('clawTaskDelete')}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                            </button>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <select
                              className={selectControlClass}
                              value={task.schedule.kind}
                              onChange={(event) =>
                                updateClawTaskSchedule(task.id, {
                                  kind: event.target.value as ClawScheduleKind
                                })
                              }
                              title={t('clawScheduleKind')}
                            >
                              <option value="manual">{t('clawScheduleManual')}</option>
                              <option value="interval">{t('clawScheduleInterval')}</option>
                              <option value="daily">{t('clawScheduleDailyShort')}</option>
                              <option value="at">{t('clawScheduleAtShort')}</option>
                            </select>
                            {task.schedule.kind === 'daily' ? (
                              <input
                                type="time"
                                className={selectControlClass}
                                value={task.schedule.timeOfDay}
                                onChange={(event) =>
                                  updateClawTaskSchedule(task.id, { timeOfDay: event.target.value })
                                }
                                title={t('clawTimeOfDay')}
                              />
                            ) : task.schedule.kind === 'at' ? (
                              <input
                                type="datetime-local"
                                className={selectControlClass}
                                value={dateTimeLocalValueFromIso(task.schedule.atTime)}
                                onChange={(event) =>
                                  updateClawTaskSchedule(task.id, {
                                    atTime: isoFromDateTimeLocalValue(event.target.value)
                                  })
                                }
                                title={t('clawAtTime')}
                              />
                            ) : (
                              <input
                                type="number"
                                min={1}
                                max={10080}
                                className={selectControlClass}
                                value={task.schedule.everyMinutes}
                                onChange={(event) =>
                                  updateClawTaskSchedule(task.id, {
                                    everyMinutes: Number(event.target.value)
                                  })
                                }
                                title={t('clawEveryMinutes')}
                              />
                            )}
                            <select
                              className={selectControlClass}
                              value={task.mode}
                              onChange={(event) =>
                                updateClawTask(task.id, { mode: event.target.value as ClawRunMode })
                              }
                              title={t('clawRunMode')}
                            >
                              {CLAW_MODE_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {t(option.key)}
                                </option>
                              ))}
                            </select>
                            <select
                              className={selectControlClass}
                              value={task.model}
                              onChange={(event) => updateClawTask(task.id, { model: event.target.value })}
                              title={t('clawModel')}
                            >
                              {CLAW_MODEL_IDS.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                          </div>
                          <input
                            className="mt-3 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={task.workspaceRoot}
                            onChange={(event) => updateClawTask(task.id, { workspaceRoot: event.target.value })}
                            placeholder={t('clawWorkspaceInherit', { path: form.workspaceRoot })}
                          />
                          <textarea
                            className="mt-3 min-h-28 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 text-[14px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={task.prompt}
                            onChange={(event) => updateClawTask(task.id, { prompt: event.target.value })}
                            placeholder={t('clawTaskPromptPlaceholder')}
                          />
                          <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-ds-faint">
                            <span className="rounded-full bg-ds-subtle px-2.5 py-1">
                              {clawScheduleSummary(task, t)}
                            </span>
                            <span className="rounded-full bg-ds-subtle px-2.5 py-1">
                              {t('clawLastStatus')}: {task.lastStatus}
                            </span>
                            {task.lastThreadId ? (
                              <span className="max-w-full truncate rounded-full bg-ds-subtle px-2.5 py-1">
                                {t('clawLastThread')}: {task.lastThreadId}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  }
                />
              </SettingsCard>
            </>
          )}
        </div>
      </div>
      {writeDebugModalOpen ? (
        <WriteDebugLogModal
          completionEntries={writeCompletionDebugEntries}
          completionSelectedId={writeCompletionDebugSelectedId}
          loading={writeDebugLoading}
          error={writeDebugError}
          onSelectCompletion={setWriteCompletionDebugSelectedId}
          onRefresh={() => void loadWriteDebugEntries()}
          onClear={() => void clearWriteDebugEntries()}
          onClose={() => setWriteDebugModalOpen(false)}
          t={t}
        />
      ) : null}
    </div>
  )
}

function DeepseekUpdateControl({
  info,
  checking,
  installing,
  error,
  installResult,
  onCheck,
  onInstall,
  t
}: {
  info: DeepseekUpdateInfo | null
  checking: boolean
  installing: boolean
  error: string | null
  installResult: DeepseekUpdateInstallResult | null
  onCheck: () => Promise<void>
  onInstall: () => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const managed = info?.ok && info.managed ? info : null
  const custom = info?.ok && !info.managed ? info : null
  const failed = error || (info && !info.ok ? info.message : null)
  const canInstall = Boolean(managed?.updateAvailable && !checking && !installing)
  const showInstall = Boolean(managed?.updateAvailable || installing)
  const busy = checking || installing

  let title = t('tuiUpdateUnknown')
  let detail: string | null = null
  let tone: 'neutral' | 'good' | 'warn' | 'error' = 'neutral'

  if (installing) {
    title = t('tuiUpdateInstalling')
    detail = t('tuiUpdateInstallingDesc')
  } else if (checking && !info) {
    title = t('tuiUpdateChecking')
  } else if (failed) {
    title = t('tuiUpdateCheckFailed')
    detail = failed
    tone = 'error'
  } else if (installResult?.ok) {
    title = t('tuiUpdateInstalled', { version: installResult.version })
    detail = installResult.restarted
      ? installResult.healthy
        ? t('tuiUpdateRestarted')
        : t('tuiUpdateRestartPending')
      : t('tuiUpdateNextLaunch')
    tone = 'good'
  } else if (custom) {
    title = t('tuiUpdateCustomBinary')
    detail = custom.binaryPath
    tone = 'warn'
  } else if (managed?.updateAvailable) {
    title = t('tuiUpdateAvailable', {
      current: managed.currentVersion ?? t('tuiUpdateUnknownVersion'),
      latest: managed.latestVersion
    })
    detail = t('tuiUpdateSource', {
      source: t(`tuiUpdateSource_${managed.currentSource}`)
    })
    tone = 'warn'
  } else if (managed) {
    title = t('tuiUpdateCurrent', {
      version: managed.currentVersion ?? managed.latestVersion
    })
    detail = t('tuiUpdateSource', {
      source: t(`tuiUpdateSource_${managed.currentSource}`)
    })
    tone = 'good'
  }

  const panelClass =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-950 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-100'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100'
        : tone === 'good'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700/70 dark:bg-emerald-950/30 dark:text-emerald-100'
          : 'border-ds-border bg-ds-card text-ds-ink'

  return (
    <div className="w-full min-w-0 md:max-w-md">
      <div className={`rounded-xl border px-3 py-2.5 shadow-sm ${panelClass}`}>
        <div className="flex items-start gap-2">
          {busy ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          ) : failed ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          )}
          <div className="min-w-0">
            <div className="break-words text-[13px] font-semibold">{title}</div>
            {detail ? (
              <div className="mt-0.5 break-words text-[12px] leading-5 opacity-75">{detail}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onCheck()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          {t('tuiUpdateCheck')}
        </button>
        {showInstall ? (
          <button
            type="button"
            onClick={() => void onInstall()}
            disabled={!canInstall}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('tuiUpdateInstall')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function GuiUpdateControl({
  info,
  checking,
  downloading,
  installing,
  downloaded,
  progress,
  error,
  onCheck,
  onDownload,
  onInstall,
  t
}: {
  info: GuiUpdateInfo | null
  checking: boolean
  downloading: boolean
  installing: boolean
  downloaded: boolean
  progress: GuiUpdateProgress | null
  error: string | null
  onCheck: () => Promise<void>
  onDownload: () => Promise<void>
  onInstall: () => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const busy = checking || downloading || installing

  let title = ''
  let detail: string | null = null
  let tone: 'neutral' | 'good' | 'warn' | 'error' = 'neutral'

  if (downloading) {
    title = t('guiUpdateDownloading', { percent: Math.max(0, Math.round(progress?.percent ?? 0)) })
    detail = progress
      ? t('guiUpdateDownloadProgress', {
          transferred: formatBytes(progress.transferred),
          total: formatBytes(progress.total),
          speed: formatBytes(progress.bytesPerSecond)
        })
      : null
    tone = 'warn'
  } else if (installing) {
    title = t('guiUpdateInstalling')
    tone = 'warn'
  } else if (downloaded && info?.ok) {
    title = t('guiUpdateDownloaded', { version: info.latestVersion })
    detail = t('guiUpdateDownloadedDesc')
    tone = 'warn'
  } else if (checking && !info) {
    title = t('guiUpdateChecking')
  } else if (error) {
    title = t('guiUpdateCheckFailed')
    detail = error
    tone = 'error'
  } else if (info && !info.ok && info.code === 'not_configured') {
    title = t('guiUpdateNotConfiguredTitle')
    detail = t('guiUpdateErrNotConfigured')
    tone = 'warn'
  } else if (info?.ok && info.hasUpdate) {
    title = info.manualOnly
      ? t('guiUpdateAvailableManual', { current: info.currentVersion, latest: info.latestVersion })
      : t('guiUpdateAvailable', { current: info.currentVersion, latest: info.latestVersion })
    tone = 'warn'
  } else if (info?.ok) {
    title = t('guiUpdateCurrent', { version: info.currentVersion })
    tone = 'good'
  }

  const releaseUrl: string | null =
    info?.ok && info.hasUpdate ? info.releaseUrl : !info?.ok && info?.releaseUrl ? info.releaseUrl : null
  const canDownload = Boolean(info?.ok && info.hasUpdate && !info.manualOnly && !downloaded)
  const canInstall = Boolean(info?.ok && downloaded)

  const panelClass =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-950 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-100'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100'
        : tone === 'good'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700/70 dark:bg-emerald-950/30 dark:text-emerald-100'
          : 'border-ds-border bg-ds-card text-ds-ink'

  return (
    <div className="w-full min-w-0 md:max-w-md">
      <div className={`rounded-xl border px-3 py-2.5 shadow-sm ${panelClass}`}>
        <div className="flex items-start gap-2">
          {busy ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          ) : error ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          )}
          <div className="min-w-0">
            <div className="break-words text-[13px] font-semibold">{title}</div>
            {detail ? (
              <div className="mt-0.5 break-words text-[12px] leading-5 opacity-75">{detail}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onCheck()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          {t('guiUpdateCheck')}
        </button>
        {canDownload || downloading ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={!canDownload || busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('guiUpdateDownload')}
          </button>
        ) : null}
        {canInstall || installing ? (
          <button
            type="button"
            onClick={() => void onInstall()}
            disabled={!canInstall || installing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('guiUpdateInstall')}
          </button>
        ) : null}
        {releaseUrl ? (
          <button
            type="button"
            onClick={() => void window.dsGui.openExternal(releaseUrl)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
          >
            {t('guiUpdateOpenRelease')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function formatWriteEditDebugTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function WriteInlineEditDebugText({
  label,
  value
}: {
  label: string
  value: string
}): ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
        {label}
      </div>
      <pre className="max-h-72 min-h-[88px] overflow-auto whitespace-pre-wrap rounded-xl border border-ds-border-muted bg-ds-main/72 p-3 font-mono text-[11.5px] leading-5 text-ds-ink">
        {value || '—'}
      </pre>
    </div>
  )
}

function WriteDebugLogModal({
  completionEntries,
  completionSelectedId,
  loading,
  error,
  onSelectCompletion,
  onRefresh,
  onClear,
  onClose,
  t
}: {
  completionEntries: WriteInlineCompletionDebugEntry[]
  completionSelectedId: string | null
  loading: boolean
  error: string | null
  onSelectCompletion: (id: string | null) => void
  onRefresh: () => void
  onClear: () => void
  onClose: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const completionSelected =
    completionEntries.find((entry) => entry.id === completionSelectedId) ?? completionEntries[0] ?? null

  return (
    <div className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="flex h-[min(86vh,820px)] w-[min(1180px,96vw)] min-w-0 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-[0_26px_80px_rgba(15,23,42,0.28)]">
        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-ds-border-muted px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-ds-ink">{t('writeDebugLogTitle')}</h2>
            <p className="mt-1 text-[12.5px] text-ds-muted">{t('writeDebugLogModalDesc')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {t('writeInlineEditDebugRefresh')}
            </button>
            <button type="button" onClick={onClear} disabled={loading || completionEntries.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('writeInlineEditDebugClear')}
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover">
              {t('close')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-[12.5px] text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {completionEntries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-[13px] text-ds-muted">
            {t('writeCompletionDebugEmpty')}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-ds-border-muted lg:grid-cols-[260px_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
            <div className="min-h-0 overflow-auto py-2">
              {completionEntries.map((entry) => (
                <WriteDebugLogListButton
                  key={entry.id}
                  active={completionSelected?.id === entry.id}
                  ok={entry.ok}
                  title={`${entry.mode} · ${entry.completion || entry.errorMessage || entry.model}`}
                  subtitle={formatWriteEditDebugTime(entry.createdAt)}
                  durationMs={entry.durationMs}
                  onClick={() => onSelectCompletion(entry.id)}
                  t={t}
                />
              ))}
            </div>
            <div className="min-h-0 min-w-0 overflow-auto px-4 py-4">
              {completionSelected ? <WriteCompletionDebugDetail entry={completionSelected} t={t} /> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WriteDebugLogListButton({
  active,
  ok,
  title,
  subtitle,
  durationMs,
  onClick,
  t
}: {
  active: boolean
  ok: boolean
  title: string
  subtitle: string
  durationMs: number
  onClick: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-2.5 text-left transition ${active ? 'bg-ds-hover text-ds-ink' : 'hover:bg-ds-hover/70'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ok ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/12 text-red-700 dark:text-red-300'}`}>
          {ok ? t('writeInlineEditDebugOk') : t('writeInlineEditDebugFailed')}
        </span>
        <span className="text-[10.5px] text-ds-faint">{durationMs}ms</span>
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium text-ds-ink">{title}</div>
      <div className="mt-1 truncate text-[11px] text-ds-faint">{subtitle}</div>
    </button>
  )
}

function WriteCompletionDebugDetail({
  entry,
  t
}: {
  entry: WriteInlineCompletionDebugEntry
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div className="space-y-3">
      <WriteDebugMeta
        filePath={entry.currentFilePath}
        model={`${entry.model} · ${entry.mode}`}
        context={t('writeCompletionDebugContextCounts', {
          references: entry.referenceCount,
          edits: entry.recentEditCount ?? 0
        })}
        error={entry.errorMessage}
        t={t}
      />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugPrompt')} value={entry.prompt} />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugSuffix')} value={entry.suffix} />
      <WriteInlineEditDebugText label={t('writeCompletionDebugCompletion')} value={entry.completion} />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugRawResponse')} value={entry.rawResponse} />
    </div>
  )
}

function WriteDebugMeta({
  filePath,
  model,
  context,
  error,
  t
}: {
  filePath?: string
  model: string
  context: string
  error?: string
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div className="grid gap-2 text-[11.5px] text-ds-muted sm:grid-cols-2">
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugModel')}</span>
        <span className="ml-2 font-mono">{model}</span>
      </div>
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugContext')}</span>
        <span className="ml-2">{context}</span>
      </div>
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2 sm:col-span-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugFile')}</span>
        <span className="ml-2 break-all font-mono">{filePath || '—'}</span>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200 sm:col-span-2">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function SecretInput({
  value,
  onChange,
  visible,
  onToggleVisibility,
  placeholder,
  autoComplete,
  invalid = false,
  showLabel,
  hideLabel,
  className = ''
}: {
  value: string
  onChange: (value: string) => void
  visible: boolean
  onToggleVisibility: () => void
  placeholder?: string
  autoComplete?: string
  invalid?: boolean
  showLabel: string
  hideLabel: string
  className?: string
}): ReactElement {
  return (
    <div
      className={`flex w-full min-w-0 items-stretch overflow-hidden rounded-xl bg-ds-card shadow-sm ${className} ${
        invalid
          ? 'border border-amber-300 focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-200'
          : 'border border-ds-border focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/30'
      }`}
    >
      <input
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[14px] text-ds-ink focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        onClick={onToggleVisibility}
        className="shrink-0 border-l border-ds-border-muted px-3 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        {visible ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
      </button>
    </div>
  )
}

function SectionJumpButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
    >
      {label}
    </button>
  )
}

function InlineNoticeView({
  notice
}: {
  notice: InlineNotice
}): ReactElement {
  const className =
    notice.tone === 'error'
      ? 'border-red-300/80 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-200'
      : notice.tone === 'success'
        ? 'border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/25 dark:text-emerald-200'
        : 'border-ds-border bg-ds-main/50 text-ds-muted'

  return (
    <div className={`rounded-xl border px-3 py-2 text-[12.5px] leading-5 ${className}`}>
      {notice.message}
    </div>
  )
}

function SettingsCard({
  title,
  children,
  className = ''
}: {
  title: string
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <section
      className={`rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25 ${className}`}
    >
      <div className="border-b border-ds-border-muted px-5 py-3">
        <h2 className="text-[16px] font-semibold text-ds-ink">{title}</h2>
      </div>
      <div className="divide-y divide-ds-border-muted px-2 py-1">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  control,
  wideControl = false
}: {
  title: string
  description?: string
  control: ReactNode
  wideControl?: boolean
}): ReactElement {
  return (
    <div
      className={`flex gap-3 px-3 py-4 ${
        wideControl
          ? 'flex-col sm:gap-3.5'
          : 'flex-col sm:flex-row sm:items-start sm:justify-between sm:gap-8'
      }`}
    >
      <div className={`min-w-0 ${wideControl ? 'w-full max-w-none shrink-0' : 'flex-1'}`}>
        <div className="text-[14px] font-semibold text-ds-ink">{title}</div>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-ds-muted">{description}</p>
        ) : null}
      </div>
      <div className={`w-full min-w-0 ${wideControl ? '' : 'sm:max-w-[420px]'}`}>
        {control}
      </div>
    </div>
  )
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
        checked ? 'bg-emerald-500' : 'bg-ds-faint'
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
          checked ? 'left-6' : 'left-0.5'
        }`}
      />
    </button>
  )
}
