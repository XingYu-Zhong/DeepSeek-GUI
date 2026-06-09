import type i18next from 'i18next'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet, InitialSetupMode, PluginHostRoute, SettingsRouteSection } from './chat-store-types'

type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  persistComposerModel: (model: string) => void
  readStoredComposerModel: (allowedIds: readonly string[]) => string
  mergeComposerPickList: (upstreamOk: boolean, upstreamIds: string[]) => string[]
  getComposerModelLoadPromise: () => Promise<void> | null
  setComposerModelLoadPromise: (promise: Promise<void> | null) => void
  applyTheme: (theme: AppSettingsV1['theme']) => void
  applyUiFontScale: (scale: AppSettingsV1['uiFontScale']) => void
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
    getComposerModelLoadPromise,
    setComposerModelLoadPromise,
    applyTheme,
    applyUiFontScale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot
  } = options

  return {
    setError: (message) => set({ error: message }),

    setComposerModel: (modelId) => {
      persistComposerModel(modelId)
      set({ composerModel: modelId })
    },

    loadComposerModels: async () => {
      if (getComposerModelLoadPromise()) return getComposerModelLoadPromise()!
      if (typeof window.dsGui === 'undefined') return
      const task = (async () => {
        const res = await window.dsGui.fetchUpstreamModels()
        const pick = mergeComposerPickList(res.ok, res.ok ? res.modelIds : [])
        const groups = res.ok ? res.modelGroups ?? [] : []
        const allowed = new Set(pick)
        set((state) => {
          let model = state.composerModel
          if (model !== '' && !allowed.has(model)) {
            model = readStoredComposerModel(pick)
          }
          if (model !== '' && !allowed.has(model)) model = ''
          if (model !== state.composerModel) persistComposerModel(model)
          return { composerPickList: pick, composerModel: model, composerModelGroups: groups }
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
    },

    reloadUiSettings: async () => {
      if (typeof window.dsGui === 'undefined') return
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
