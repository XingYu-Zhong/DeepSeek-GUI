import type i18next from 'i18next'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet, InitialSetupMode, PluginHostRoute, SettingsRouteSection } from './chat-store-types'
import {
  persistComposerProviderId,
  providerIdForComposerModel,
  readStoredComposerProviderId
} from './chat-store-helpers'

type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  persistComposerModel: (model: string) => void
  readStoredComposerModel: (allowedIds: readonly string[]) => string
  mergeComposerPickList: (upstreamOk: boolean, upstreamIds: string[]) => string[]
  fallbackComposerModel: (pickList: readonly string[], runtimeDefault: string) => string
  getComposerModelLoadPromise: () => Promise<void> | null
  setComposerModelLoadPromise: (promise: Promise<void> | null) => void
  applyTheme: (theme: AppSettingsV1['theme']) => void
  applyUiFontScale: (scale: AppSettingsV1['uiFontScale']) => void
  applyDocumentLocale: (locale: AppSettingsV1['locale']) => void
  workspaceLabelFromPath: (workspaceRoot: string) => string
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
}

export function createAppActions(options: CreateAppActionsOptions): Pick<
  ChatState,
  | 'setError'
  | 'setComposerModel'
  | 'loadComposerModels'
  | 'setRoute'
  | 'openWrite'
  | 'openSettings'
  | 'openPlugins'
  | 'openClaw'
  | 'openSchedule'
  | 'openInitialSetup'
  | 'closeInitialSetup'
  | 'selectInspectorItem'
  | 'applyI18nFromSettings'
  | 'reloadUiSettings'
> {
  const {
    set,
    get,
    i18n,
    persistComposerModel,
    readStoredComposerModel,
    mergeComposerPickList,
    fallbackComposerModel,
    getComposerModelLoadPromise,
    setComposerModelLoadPromise,
    applyTheme,
    applyUiFontScale,
    applyDocumentLocale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot
  } = options

  return {
    setError: (message) => set({ error: message }),

    setComposerModel: (modelId, providerId) => {
      persistComposerModel(modelId)
      const nextProviderId = providerId?.trim() || providerIdForComposerModel(get().composerModelGroups, modelId)
      persistComposerProviderId(nextProviderId)
      set({ composerModel: modelId, composerProviderId: nextProviderId })
      const trimmed = modelId.trim()
      if (trimmed && trimmed.toLowerCase() !== 'auto' && typeof window.kunGui !== 'undefined') {
        void window.kunGui.saveSettingsSilent({ agents: { kun: { model: trimmed } } })
      }
    },

    loadComposerModels: async () => {
      if (getComposerModelLoadPromise()) return getComposerModelLoadPromise()!
      if (typeof window.kunGui === 'undefined') return
      const task = (async () => {
        const res = await window.kunGui.fetchUpstreamModels()
        const pick = mergeComposerPickList(res.ok, res.ok ? res.modelIds : [])
        const groups = res.ok ? res.modelGroups ?? [] : []
        const allowed = new Set(pick)
        const runtimeDefault = res.ok ? res.defaultModelId?.trim() ?? '' : ''
        set((state) => {
          const currentModel = state.composerModel.trim()
          const normalizedCurrentModel = currentModel.toLowerCase() === 'auto' ? '' : currentModel
          const storedModel = readStoredComposerModel(pick)
          let model = normalizedCurrentModel
          let shouldPersist = model !== state.composerModel
          if (model === '' || !allowed.has(model)) {
            model = storedModel
            shouldPersist = false
          }
          if (model === '' || !allowed.has(model)) {
            model = fallbackComposerModel(pick, runtimeDefault)
            shouldPersist = false
          }
          if (shouldPersist) persistComposerModel(model)
          const storedProviderId = readStoredComposerProviderId(groups, model)
          const providerId = storedProviderId || providerIdForComposerModel(groups, model)
          if (providerId !== state.composerProviderId) persistComposerProviderId(providerId)
          return {
            composerPickList: pick,
            composerModel: model,
            composerProviderId: providerId,
            composerModelGroups: groups
          }
        })
      })().finally(() => {
        setComposerModelLoadPromise(null)
      })
      setComposerModelLoadPromise(task)
      return task
    },

    setRoute: (route) => set({ route }),

    openWrite: async () => {
      set({ route: 'write' })
    },

    openSettings: (section: SettingsRouteSection = 'general') =>
      set((state) => ({
        route: 'settings',
        settingsSection: section,
        settingsReturnRoute: state.route === 'settings' ? state.settingsReturnRoute : state.route
      })),

    openPlugins: (host?: PluginHostRoute) =>
      set((state) => ({
        route: 'plugins',
        pluginHostRoute: host ?? (state.route === 'claw' ? 'claw' : 'chat')
      })),

    openClaw: () => {
      set({ route: 'claw' })
      void get().refreshClawChannels()
    },

    openSchedule: () => {
      set({ route: 'schedule' })
    },

    openInitialSetup: (mode: InitialSetupMode = 'required') =>
      set({ initialSetupOpen: true, initialSetupMode: mode }),

    closeInitialSetup: () => set({ initialSetupOpen: false, initialSetupMode: 'required' }),

    selectInspectorItem: (id) => set({ inspectorSelectedId: id }),

    applyI18nFromSettings: async (locale) => {
      await i18n.changeLanguage(locale)
      applyDocumentLocale(locale)
    },

    reloadUiSettings: async () => {
      if (typeof window.kunGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
      applyTheme(settings.theme)
      applyUiFontScale(settings.uiFontScale)
      set({
        workspaceRoot,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        clawChannels: settings.claw.channels,
        activeClawChannelId: settings.claw.channels.some(
          (channel) => channel.id === get().activeClawChannelId && channel.enabled
        )
          ? get().activeClawChannelId
          : settings.claw.channels.find((channel) => channel.enabled)?.id ?? ''
      })
      await get().applyI18nFromSettings(settings.locale)
      if (get().runtimeConnection === 'ready') {
        void get().refreshThreads()
      }
      void get().loadComposerModels()
    }
  }
}
