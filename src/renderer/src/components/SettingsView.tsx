import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  kunSettingsPatch,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  type AppSettingsPatch,
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderSettings,
  isKunRuntimeInsecure,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { getProvider } from '../agent/registry'
import type {
  CoreMemoryRecordJson,
  CoreRuntimeInfoJson,
  CoreRuntimeToolDiagnosticsJson
} from '../agent/kun-contract'
import type { WriteInlineCompletionDebugEntry } from '@shared/write-inline-completion'
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
import { SettingsSidebar } from './SettingsSidebar'
import { WriteDebugLogModal } from './settings-debug-log'
import { useSettingsGuiUpdate } from './use-settings-gui-update'
import {
  DEFAULT_WORKSPACE_ROOT,
  coerceRendererSettings,
  hasValidPort,
  listSettingsText,
  mergeSettings,
  splitSettingsList
} from './settings-utils'
import { loadKunDiagnostics } from '../lib/load-kun-diagnostics'
import { SETTINGS_CHANGED_EVENT, emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import {
  AgentsSettingsSection,
  ClawSettingsSection,
  EasterEggSettingsSection,
  GeneralSettingsSection,
  ImageGenerationSettingsSection,
  ImageInputSettingsSection,
  KeyboardShortcutsSettingsSection,
  LlmDebugSettingsSection,
  MediaGenerationSettingsSection,
  ProvidersSettingsSection,
  SpeechToTextSettingsSection,
  UpdatesSettingsSection,
  WriteSettingsSection
} from './settings-sections'

type SettingsCategory = 'general' | 'providers' | 'write' | 'imageInput' | 'imageGeneration' | 'mediaGeneration' | 'speechToText' | 'agents' | 'permissions' | 'shortcuts' | 'easterEgg' | 'claw' | 'updates' | 'debug'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsPatch = AppSettingsPatch
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
export function SettingsView(): ReactElement {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const setRoute = useChatStore((s) => s.setRoute)
  const settingsReturnRoute = useChatStore((s) => s.settingsReturnRoute)
  const settingsSection = useChatStore((s) => s.settingsSection)
  const openCode = useChatStore((s) => s.openCode)
  const openWrite = useChatStore((s) => s.openWrite)
  const openClaw = useChatStore((s) => s.openClaw)
  const openSchedule = useChatStore((s) => s.openSchedule)
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
  const [showApiKey, setShowApiKey] = useState(false)
  const [showRuntimeToken, setShowRuntimeToken] = useState(false)
  const [logPath, setLogPath] = useState('')
  const [logDirOpenError, setLogDirOpenError] = useState<string | null>(null)
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [skillNotice, setSkillNotice] = useState<InlineNotice | null>(null)
  const [mcpConfigPath, setMcpConfigPath] = useState('~/.kun/mcp.json')
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpConfigExists, setMcpConfigExists] = useState(false)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<InlineNotice | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<CoreRuntimeToolDiagnosticsJson | null>(null)
  const [memoryRecords, setMemoryRecords] = useState<CoreMemoryRecordJson[]>([])
  const [runtimeDiagnosticsBusy, setRuntimeDiagnosticsBusy] = useState(false)
  const [runtimeDiagnosticsNotice, setRuntimeDiagnosticsNotice] = useState<InlineNotice | null>(null)
  const [writeDebugModalOpen, setWriteDebugModalOpen] = useState(false)
  const [writeCompletionDebugEntries, setWriteCompletionDebugEntries] = useState<WriteInlineCompletionDebugEntry[]>([])
  const [writeCompletionDebugSelectedId, setWriteCompletionDebugSelectedId] = useState<string | null>(null)
  const [writeDebugLoading, setWriteDebugLoading] = useState(false)
  const [writeDebugError, setWriteDebugError] = useState<string | null>(null)
  const initializedCategory = useRef(false)
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const draftVersion = useRef(0)
  const agentsSectionRef = useRef<HTMLDivElement | null>(null)
  const skillSectionRef = useRef<HTMLDivElement | null>(null)
  const mcpSectionRef = useRef<HTMLDivElement | null>(null)
  const permissionsSectionRef = useRef<HTMLDivElement | null>(null)
  const formTheme = form?.theme
  const formUiFontScale = form?.uiFontScale
  const formWorkspaceRoot = form?.workspaceRoot
  const formKun = form ? getKunRuntimeSettings(form) : null
  const formPort = formKun?.port
  const formGuiUpdateChannel = form?.guiUpdate?.channel
  const {
    checkingGuiUpdate,
    checkGuiUpdate,
    downloadingGuiUpdate,
    downloadGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateError,
    guiUpdateInfo,
    guiUpdateProgress,
    installingGuiUpdate,
    installGuiUpdate,
    resetGuiUpdateState
  } = useSettingsGuiUpdate({
    category,
    channel: formGuiUpdateChannel,
    form,
    t
  })

  useEffect(() => {
    let cancelled = false
    if (typeof window.kunGui === 'undefined') {
      setLoadError('PRELOAD_BRIDGE')
      return
    }
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
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
    const onSettingsChanged = (event: Event): void => {
      const next = (event as CustomEvent<AppSettingsV1>).detail
      if (next) setForm(coerceRendererSettings(next))
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  useEffect(() => {
    if (typeof window.kunGui?.getLogPath !== 'function') return
    void window.kunGui.getLogPath().then((p) => setLogPath(p)).catch(() => undefined)
  }, [category])

  const loadWriteDebugEntries = useCallback(async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      const completionEntries = typeof window.kunGui?.listWriteInlineCompletionDebugEntries === 'function'
        ? await window.kunGui.listWriteInlineCompletionDebugEntries()
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
    if (!getActiveAgentApiKey(form).trim()) {
      setCategory('providers')
    }
  }, [form])

  useEffect(() => {
    if (settingsSection === 'general') {
      setCategory('general')
      return
    }
    if (settingsSection === 'providers') {
      setCategory('providers')
      return
    }
    if (settingsSection === 'write') {
      setCategory('write')
      return
    }
    if (settingsSection === 'imageGeneration') {
      setCategory('imageGeneration')
      return
    }
    if (settingsSection === 'imageInput') {
      setCategory('imageInput')
      return
    }
    if (settingsSection === 'mediaGeneration') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'speechToText') {
      setCategory('speechToText')
      return
    }
    if (settingsSection === 'permissions') {
      setCategory('permissions')
      return
    }
    if (settingsSection === 'claw') {
      setCategory('claw')
      return
    }
    if (settingsSection === 'shortcuts') {
      setCategory('shortcuts')
      return
    }
    if (settingsSection === 'easterEgg') {
      setCategory('easterEgg')
      return
    }
    if (settingsSection === 'updates') {
      setCategory('updates')
      return
    }
    setCategory('agents')
  }, [settingsSection])

  useEffect(() => {
    if (!form) return
    if (
      settingsSection === 'general' ||
      settingsSection === 'providers' ||
      settingsSection === 'write' ||
      settingsSection === 'imageGeneration' ||
      settingsSection === 'imageInput' ||
      settingsSection === 'mediaGeneration' ||
      settingsSection === 'speechToText' ||
      settingsSection === 'claw' ||
      settingsSection === 'shortcuts' ||
      settingsSection === 'easterEgg' ||
      settingsSection === 'updates' ||
      (category !== 'agents' && category !== 'permissions')
    ) {
      return
    }
    const refs: Record<
      Exclude<SettingsRouteSection, 'general' | 'providers' | 'write' | 'imageGeneration' | 'imageInput' | 'mediaGeneration' | 'speechToText' | 'claw' | 'shortcuts' | 'easterEgg' | 'updates'>,
      HTMLDivElement | null
    > = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    const target = refs[settingsSection]
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [category, form, settingsSection])

  useEffect(() => {
    if (!form || category !== 'permissions') return
    const target = permissionsSectionRef.current
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [category, form])

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
        path: '~/.kun/skills',
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
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return
    setMcpLoading(true)
    setMcpNotice(null)
    try {
      const config = await window.kunGui.getKunConfigFile()
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
    if ((category !== 'agents' && category !== 'permissions') || mcpLoaded || mcpLoading) return
    void loadMcpConfig()
  }, [category, mcpLoaded, mcpLoading])

  const openSkillRoot = async (): Promise<void> => {
    if (!selectedSkillRoot?.path || !selectedSkillRoot.available) {
      setSkillNotice({ tone: 'error', message: t('skillsRootUnavailable') })
      return
    }
    if (typeof window.kunGui?.openSkillRoot !== 'function') return
    setSkillNotice(null)
    const result = await window.kunGui.openSkillRoot(selectedSkillRoot.path)
    if (!result.ok) {
      setSkillNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const saveMcpConfig = async (): Promise<void> => {
    if (typeof window.kunGui?.setKunConfigFile !== 'function') return
    setMcpBusy(true)
    setMcpNotice(null)
    try {
      const result = await window.kunGui.setKunConfigFile(mcpConfigText)
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
    if (typeof window.kunGui?.openKunConfigDir !== 'function') return
    const result = await window.kunGui.openKunConfigDir()
    if (!result.ok) {
      setMcpNotice({ tone: 'error', message: result.message ?? t('applyFailed') })
    }
  }

  const refreshKunDiagnostics = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    setRuntimeDiagnosticsBusy(true)
    setRuntimeDiagnosticsNotice(null)
    try {
      const loaded = await loadKunDiagnostics(provider, {
        workspace: normalizeWorkspaceRoot(formWorkspaceRoot)
      })
      if (loaded.runtimeInfo !== undefined) setRuntimeInfo(loaded.runtimeInfo)
      if (loaded.toolDiagnostics !== undefined) setToolDiagnostics(loaded.toolDiagnostics)
      if (loaded.memoryRecords !== undefined) setMemoryRecords(loaded.memoryRecords)
      if (loaded.errors.length > 0) {
        setRuntimeDiagnosticsNotice({
          tone: 'error',
          message: loaded.errors.join(' | ')
        })
      }
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setRuntimeDiagnosticsBusy(false)
    }
  }, [formWorkspaceRoot])

  useEffect(() => {
    if (category !== 'agents' && category !== 'permissions') return
    void refreshKunDiagnostics()
  }, [category, refreshKunDiagnostics])

  const disableMemoryRecord = async (memoryId: string): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.updateMemory !== 'function') return
    try {
      const memory = await provider.updateMemory(memoryId, { disabled: true })
      setMemoryRecords((records) => records.map((record) => record.id === memoryId ? memory : record))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const deleteMemoryRecord = async (memoryId: string): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.deleteMemory !== 'function') return
    try {
      await provider.deleteMemory(memoryId)
      setMemoryRecords((records) => records.filter((record) => record.id !== memoryId))
    } catch (error) {
      setRuntimeDiagnosticsNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
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
      const next = coerceRendererSettings(await rendererRuntimeClient.setSettings(snapshot))
      if (version !== draftVersion.current) return

      setForm(next)
      emitRendererSettingsChanged(next)
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
      const message = e instanceof Error ? e.message : String(e)
      setSaveError(message)
      setSaveStatus('error')
      void window.kunGui?.logError?.('settings', 'Failed to apply settings', { message }).catch(() => undefined)
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
      if (settingsReturnRoute === 'schedule') {
        openSchedule()
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

  const kun = getKunRuntimeSettings(form)
  const provider = getModelProviderSettings(form)
  const activeApiKey = getActiveAgentApiKey(form)

  const update = (partial: SettingsPatch): void => {
    const next = mergeSettings(form, partial)
    setForm(next)
    if (partial.locale) void applyI18n(partial.locale)
    if (partial.guiUpdate?.channel && partial.guiUpdate.channel !== form.guiUpdate.channel) {
      resetGuiUpdateState()
    }
    scheduleSave(next)
  }

  const sharedApiKey = provider.apiKey
  const sharedBaseUrl = provider.baseUrl
  const writeInlineApiKeyInherited = !form.write.inlineCompletion.apiKey.trim()
  const writeInlineBaseUrlInherited =
    !form.write.inlineCompletion.baseUrl.trim() ||
    form.write.inlineCompletion.baseUrl.trim() === DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL
  const writeInlineModelInherited = form.write.inlineCompletion.inheritModel !== false
  const effectiveWriteInlineBaseUrl = resolveWriteInlineCompletionBaseUrl(form)
  const effectiveWriteInlineApiKey = resolveWriteInlineCompletionApiKey(form)
  const effectiveWriteInlineModel = resolveWriteInlineCompletionModel(form)
  const updateSharedCredential = (patch: { apiKey?: string; baseUrl?: string }): void => {
    update({ provider: patch })
  }

  const updateKun = (patch: Partial<AppSettingsV1['agents']['kun']>): void => {
    update({ agents: kunSettingsPatch(patch) })
  }

  const pickWorkspace = async (): Promise<void> => {
    try {
      setWorkspacePickerError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(form.workspaceRoot || undefined)
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
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
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
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
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

  const clearWriteDebugEntries = async (): Promise<void> => {
    setWriteDebugLoading(true)
    setWriteDebugError(null)
    try {
      if (typeof window.kunGui?.clearWriteInlineCompletionDebugEntries === 'function') {
        await window.kunGui.clearWriteInlineCompletionDebugEntries()
      }
      setWriteCompletionDebugEntries([])
      setWriteCompletionDebugSelectedId(null)
    } catch (error) {
      setWriteDebugError(error instanceof Error ? error.message : String(error))
    } finally {
      setWriteDebugLoading(false)
    }
  }

  const selectControlClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  const settingsSectionContext = {
    t,
    tCommon,
    form,
    provider,
    kun,
    activeApiKey,
    update,
    updateKun,
    updateSharedCredential,
    sharedApiKey,
    sharedBaseUrl,
    showApiKey,
    setShowApiKey,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineApiKeyInherited,
    effectiveWriteInlineApiKey,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshKunDiagnostics,
    disableMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  }

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main">
      <SettingsSidebar category={category} setCategory={setCategory} goBack={goBack} t={t} />

      <div className="ds-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-3xl">
          {!activeApiKey.trim() ? (
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

          {saveStatus === 'error' && saveError ? (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-5 text-red-800 shadow-sm dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
            >
              {saveError}
            </div>
          ) : null}

          {category === 'general' ? <GeneralSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'providers' ? <ProvidersSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'write' ? <WriteSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'imageInput' ? <ImageInputSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'imageGeneration' ? <ImageGenerationSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'mediaGeneration' ? <MediaGenerationSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'speechToText' ? <SpeechToTextSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'agents' || category === 'permissions' ? <AgentsSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'shortcuts' ? <KeyboardShortcutsSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'easterEgg' ? <EasterEggSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'claw' ? <ClawSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'updates' ? <UpdatesSettingsSection ctx={settingsSectionContext} /> : null}
          {category === 'debug' ? <LlmDebugSettingsSection ctx={settingsSectionContext} /> : null}
        </div>
      </div>
      {saveStatus === 'error' && saveError ? (
        <div
          role="alert"
          className="ds-no-drag fixed bottom-6 right-8 z-30 flex max-w-[min(560px,calc(100vw-3rem))] items-center gap-3 rounded-2xl border border-red-300/70 bg-red-50/95 px-4 py-3 text-red-900 shadow-2xl shadow-red-950/10 backdrop-blur dark:border-red-500/30 dark:bg-red-950/90 dark:text-red-100"
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{t('applyFailed')}</div>
            <div className="mt-0.5 truncate text-[12px] text-red-800/85 dark:text-red-100/80">
              {saveError}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl bg-red-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(portError)}
            onClick={() => void flushPendingSave()}
          >
            {t('retrySave')}
          </button>
        </div>
      ) : null}
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
