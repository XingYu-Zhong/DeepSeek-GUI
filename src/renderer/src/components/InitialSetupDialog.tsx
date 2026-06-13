import { type ReactElement, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  normalizeAppSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ModelProviderPreset
} from '@shared/app-settings'
import {
  buildInitialSetupSettings,
  INITIAL_SETUP_PROVIDER_PRESETS,
  initialSetupAutoWirePlan,
  initialSetupDrafts,
  initialSetupProfileId,
  initialSetupSelection,
  type InitialSetupDrafts,
  type InitialSetupSelection
} from './initial-setup-save'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { RuntimeConnectionStatus } from '../agent/types'
import { applyTheme } from '../lib/apply-theme'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { useChatStore } from '../store/chat-store'
import type { InitialSetupMode } from '../store/chat-store-types'
import {
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  X
} from 'lucide-react'

type ThemePref = AppSettingsV1['theme']
type SetupFormPatch = AppSettingsPatch
type InitialSetupCompletionState = {
  runtimeConnection: RuntimeConnectionStatus
  error: string | null
}

const themeOptions: { value: ThemePref; icon: typeof Sun; labelKey: string }[] = [
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' }
]
const DEEPSEEK_USAGE_URL = 'https://platform.deepseek.com/usage'

type SetupProviderCard = {
  presetId: string
  name: string
  descKey: string
  capability: 'speech' | 'image' | null
  preset: ModelProviderPreset | null
}

const PROVIDER_CARDS: SetupProviderCard[] = [
  {
    presetId: DEFAULT_MODEL_PROVIDER_ID,
    name: 'DeepSeek',
    descKey: 'firstRunProviderDeepseekDesc',
    capability: null,
    preset: null
  },
  ...INITIAL_SETUP_PROVIDER_PRESETS.map((preset) => ({
    presetId: preset.id,
    name: preset.name,
    descKey: preset.id === 'xiaomi' ? 'firstRunProviderXiaomiDesc' : 'firstRunProviderMinimaxDesc',
    capability: preset.speech ? ('speech' as const) : preset.image ? ('image' as const) : null,
    preset
  }))
]

function keyHintKey(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (card.presetId === DEFAULT_MODEL_PROVIDER_ID) return 'firstRunBuyApiHint'
  const suffix = mode === 'token-plan' ? 'TokenPlan' : 'Api'
  return card.presetId === 'xiaomi' ? `firstRunKeyHintXiaomi${suffix}` : `firstRunKeyHintMinimax${suffix}`
}

function keyPageUrl(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (!card.preset) return DEEPSEEK_USAGE_URL
  if (mode === 'token-plan' && card.preset.tokenPlan) return card.preset.tokenPlan.apiKeyUrl
  return card.preset.apiKeyUrl
}

function keyPlaceholder(card: SetupProviderCard, mode: InitialSetupSelection['mode']): string {
  if (mode === 'token-plan') {
    const prefix = card.preset?.tokenPlan?.keyPrefix
    return prefix ? `${prefix}...` : 'API Key'
  }
  return card.presetId === 'minimax' ? 'API Key' : 'sk-...'
}

export function canCloseInitialSetup(mode: InitialSetupMode): boolean {
  return mode === 'preview'
}

export async function completeInitialSetupAfterSave(input: {
  mode: InitialSetupMode
  reloadUiSettings: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  openCode: () => Promise<void>
  closeInitialSetup: () => void
  getState: () => InitialSetupCompletionState
  setDialogError: (message: string) => void
  fallbackRuntimeError: string
}): Promise<boolean> {
  await input.reloadUiSettings()
  if (input.mode === 'preview') {
    void input.probeRuntime('background')
    input.closeInitialSetup()
    return true
  }

  await input.probeRuntime('user')
  const state = input.getState()
  if (state.runtimeConnection !== 'ready') {
    input.setDialogError(state.error?.trim() || input.fallbackRuntimeError)
    return false
  }
  await input.openCode()
  input.closeInitialSetup()
  return true
}

export function InitialSetupDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const initialSetupMode = useChatStore((s) => s.initialSetupMode)
  const closeInitialSetup = useChatStore((s) => s.closeInitialSetup)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const openCode = useChatStore((s) => s.openCode)

  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [drafts, setDrafts] = useState<InitialSetupDrafts | null>(null)
  const [selection, setSelection] = useState<InitialSetupSelection>({
    presetId: DEFAULT_MODEL_PROVIDER_ID,
    mode: 'api'
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<AppSettingsV1 | null>(null)
  const isPreview = initialSetupMode === 'preview'
  const closeAllowed = canCloseInitialSetup(initialSetupMode)

  const setCurrentForm = (next: AppSettingsV1 | null): void => {
    formRef.current = next
    setForm(next)
  }

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (cancelled) return
        setCurrentForm(s)
        setDrafts(initialSetupDrafts(s))
        setSelection(initialSetupSelection(s))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [])

  const updateForm = (patch: SetupFormPatch) => {
    const current = formRef.current
    if (!current) return
    const next = normalizeAppSettings({
      ...current,
      ...patch
    } as AppSettingsV1)
    setCurrentForm(next)
  }

  const handleThemeChange = (theme: ThemePref) => {
    if (!formRef.current) return
    updateForm({ theme })
    applyTheme(theme)
  }

  const handleClose = () => {
    if (!closeAllowed) return
    setError(null)
    closeInitialSetup()
    void reloadUiSettings()
  }

  const handleOpenKeyPage = (url: string) => {
    if (typeof window.kunGui?.openExternal !== 'function') return
    void window.kunGui.openExternal(url).catch(() => undefined)
  }

  const selectedCard = PROVIDER_CARDS.find((card) => card.presetId === selection.presetId) ?? PROVIDER_CARDS[0]
  const selectedProfileId = initialSetupProfileId(selection)
  const selectedDraft = drafts?.[selectedProfileId] ?? { apiKey: '', baseUrl: '' }

  const updateSelectedDraft = (patch: Partial<typeof selectedDraft>): void => {
    setDrafts((current) => current
      ? { ...current, [selectedProfileId]: { ...current[selectedProfileId], ...patch } }
      : current)
  }

  const selectCard = (presetId: string): void => {
    setError(null)
    setSelection((current) => (current.presetId === presetId ? current : { presetId, mode: 'api' }))
  }

  const selectMode = (mode: InitialSetupSelection['mode']): void => {
    setError(null)
    setSelection((current) => ({ ...current, mode }))
  }

  const cardFilled = (card: SetupProviderCard): boolean => {
    if (!drafts) return false
    if (drafts[card.presetId]?.apiKey.trim()) return true
    if (!card.preset?.tokenPlan) return false
    return Boolean(drafts[initialSetupProfileId({ presetId: card.presetId, mode: 'token-plan' })]?.apiKey.trim())
  }

  const handleSave = async () => {
    const current = formRef.current
    if (!current || !drafts) return
    if (!selectedDraft.apiKey.trim()) {
      setError(t('firstRunApiKeyValidation', { provider: selectedCard.name }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await rendererRuntimeClient.setSettings(
        buildInitialSetupSettings(current, drafts, selection)
      )
      setCurrentForm(next)
      setDrafts(initialSetupDrafts(next))
      emitRendererSettingsChanged(next)
      await applyI18n(next.locale)
      await completeInitialSetupAfterSave({
        mode: initialSetupMode,
        reloadUiSettings,
        probeRuntime,
        openCode,
        closeInitialSetup,
        getState: useChatStore.getState,
        setDialogError: setError,
        fallbackRuntimeError: t('common:runtimeFetchFailed')
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!form || !drafts) {
    return (
      <div className="ds-no-drag fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md dark:bg-black/70">
        <div className="rounded-xl border border-ds-border bg-ds-card/95 px-5 py-4 text-sm text-ds-muted shadow-panel backdrop-blur-xl">
          {t('loading')}
        </div>
      </div>
    )
  }

  const selectedTheme = form.theme
  const tokenPlan = selectedCard.preset?.tokenPlan ?? null
  const showTokenPlanMode = Boolean(tokenPlan)
  const regions = selection.mode === 'token-plan' ? tokenPlan?.regions ?? [] : []
  const wire = initialSetupAutoWirePlan(form, drafts)
  const wireNote = (() => {
    if (!selectedCard.capability) return null
    const wiredProfileId = selectedCard.capability === 'speech' ? wire.speechProviderId : wire.imageProviderId
    if (wiredProfileId && wiredProfileId === selectedProfileId) {
      return {
        tone: 'success' as const,
        text: t(selectedCard.capability === 'speech' ? 'firstRunAutoWireSpeech' : 'firstRunAutoWireImage')
      }
    }
    if (selection.mode === 'token-plan' && selectedDraft.apiKey.trim()) {
      const planServesCapability = selectedCard.capability === 'speech'
        ? Boolean(tokenPlan?.speech)
        : selectedCard.capability === 'image' && Boolean(tokenPlan?.image)
      if (!planServesCapability) {
        return {
          tone: 'warning' as const,
          text: t(selectedCard.capability === 'speech' ? 'firstRunTokenPlanNoSpeech' : 'firstRunTokenPlanNoImage')
        }
      }
    }
    return null
  })()

  const choiceButtonClass = (active: boolean): string =>
    [
      'flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200 sm:min-h-11 sm:px-4',
      active
        ? 'border-[#1388ff] bg-[#1388ff]/[0.07] text-[#1377df] shadow-[0_0_0_1px_rgba(19,136,255,0.12),0_8px_18px_rgba(19,136,255,0.07)] dark:border-[#3aa0ff] dark:bg-[#3aa0ff]/[0.12] dark:text-[#88c8ff]'
        : 'border-slate-300/80 bg-white/72 text-slate-600 hover:border-slate-400/80 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/[0.055]'
    ].join(' ')
  const cardButtonClass = (active: boolean): string =>
    [
      'flex min-w-0 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
      active
        ? 'border-[#1388ff] bg-[#1388ff]/[0.07] shadow-[0_0_0_1px_rgba(19,136,255,0.12),0_8px_18px_rgba(19,136,255,0.07)] dark:border-[#3aa0ff] dark:bg-[#3aa0ff]/[0.12]'
        : 'border-slate-300/80 bg-white/72 hover:border-slate-400/80 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-white/16 dark:hover:bg-white/[0.055]'
    ].join(' ')
  const fieldClass =
    'w-full rounded-xl border border-slate-300/75 bg-white/88 px-4 py-3 text-[15px] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition focus:border-[#1388ff]/70 focus:ring-2 focus:ring-[#1388ff]/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:shadow-none dark:focus:border-[#3aa0ff]/70 dark:focus:ring-[#3aa0ff]/15 dark:placeholder:text-slate-500'
  const labelClass = 'text-sm font-semibold text-slate-700 dark:text-slate-200'
  return (
    <div className="ds-no-drag fixed inset-0 z-50 overflow-y-auto bg-[#eef2fb]/45 p-3 backdrop-blur-[18px] dark:bg-black/62 dark:backdrop-blur-[22px] sm:p-6">
      <div className="flex min-h-full items-center justify-center">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="initial-setup-title"
          className="flex h-[calc(100dvh-24px)] max-h-[calc(100dvh-24px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-white/75 bg-[rgba(255,255,255,0.94)] text-slate-900 shadow-[0_28px_86px_rgba(88,105,136,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(18,21,28,0.96)] dark:text-white dark:shadow-[0_28px_92px_rgba(0,0,0,0.55)] sm:h-auto sm:max-h-[calc(100dvh-48px)]"
        >
        <div className="shrink-0 border-b border-slate-200/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,253,0.9))] px-5 py-4 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(27,31,40,0.98),rgba(19,22,29,0.96))] sm:px-7 sm:py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-[#1388ff]/22 bg-[#1388ff]/[0.06] px-3 py-1.5 text-[12.5px] font-semibold text-[#1377df] dark:border-[#3aa0ff]/22 dark:bg-[#3aa0ff]/[0.12] dark:text-[#88c8ff]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              <span className="min-w-0 truncate">{t(isPreview ? 'firstRunPreviewBadge' : 'firstRunBadge')}</span>
            </div>
            {closeAllowed ? (
              <button
                type="button"
                onClick={handleClose}
                aria-label={t('firstRunClose')}
                title={t('firstRunClose')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300/80 bg-white/72 text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/18 dark:hover:text-slate-200"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ) : null}
          </div>
          <h1 id="initial-setup-title" className="mt-3 text-xl font-semibold leading-tight text-slate-900 dark:text-white sm:mt-4 sm:text-[22px]">
            {t('firstRunTitle')}
          </h1>
          <p className="mt-2.5 text-sm leading-6 text-slate-500 dark:text-slate-400 sm:text-[15px]">
            {t('firstRunSubtitle')}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:space-y-5 sm:px-7 sm:py-6">
          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('theme')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:gap-2.5 sm:grid-cols-3">
              {themeOptions.map(({ value, icon: Icon, labelKey }) => {
                const isActive = selectedTheme === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleThemeChange(value)}
                    className={choiceButtonClass(isActive)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 text-center leading-tight">{t(labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('language')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:gap-2.5 min-[440px]:grid-cols-2">
              {(['en', 'zh'] as const).map((lang) => {
                const isActive = form.locale === lang
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      updateForm({ locale: lang })
                      void applyI18n(lang)
                    }}
                    className={choiceButtonClass(isActive)}
                  >
                    <span className="min-w-0 text-center leading-tight">{lang === 'en' ? 'English' : '简体中文'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('firstRunProviderLabel')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:gap-2.5 min-[440px]:grid-cols-3">
              {PROVIDER_CARDS.map((card) => {
                const isActive = selection.presetId === card.presetId
                const filled = cardFilled(card)
                return (
                  <button
                    key={card.presetId}
                    type="button"
                    onClick={() => selectCard(card.presetId)}
                    className={cardButtonClass(isActive)}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {card.name}
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${filled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}
                      />
                    </span>
                    <span className="text-[12px] leading-tight text-slate-500 dark:text-slate-400">
                      {t(card.descKey)}
                    </span>
                    {card.capability ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {card.capability === 'speech'
                          ? <Mic className="h-3 w-3" strokeWidth={2} />
                          : <ImageIcon className="h-3 w-3" strokeWidth={2} />}
                        {t(card.capability === 'speech' ? 'firstRunCapabilitySpeech' : 'firstRunCapabilityImage')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                        <MessageCircle className="h-3 w-3" strokeWidth={2} />
                        {t('firstRunCapabilityChat')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {showTokenPlanMode && (
            <div className="space-y-2.5 sm:space-y-3.5">
              <label className={labelClass}>
                {t('firstRunModeLabel')}
              </label>
              <div className="grid grid-cols-1 gap-2 sm:gap-2.5 min-[440px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectMode('api')}
                  className={choiceButtonClass(selection.mode === 'api')}
                >
                  <span className="min-w-0 text-center leading-tight">{t('firstRunModeApi')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectMode('token-plan')}
                  className={choiceButtonClass(selection.mode === 'token-plan')}
                >
                  <span className="min-w-0 text-center leading-tight">{t('firstRunModeTokenPlan')}</span>
                </button>
              </div>
            </div>
          )}

          {regions.length > 0 && (
            <div className="space-y-2.5 sm:space-y-3.5">
              <label className={labelClass}>
                {t('firstRunRegionLabel')}
              </label>
              <div className="grid grid-cols-1 gap-2 sm:gap-2.5 min-[440px]:grid-cols-3">
                {regions.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => updateSelectedDraft({ baseUrl: region.baseUrl })}
                    className={choiceButtonClass(selectedDraft.baseUrl.trim() === region.baseUrl)}
                  >
                    <span className="min-w-0 text-center leading-tight">
                      {t(`firstRunRegion_${region.id}`)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('firstRunApiKeyLabel', { provider: selectedCard.name })}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={selectedDraft.apiKey}
                onChange={(e) => updateSelectedDraft({ apiKey: e.target.value })}
                placeholder={keyPlaceholder(selectedCard, selection.mode)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={`${fieldClass} pr-12 font-mono placeholder:font-sans`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/75 px-4 py-3 text-[13px] text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400 min-[560px]:grid-cols-[1fr_auto] min-[560px]:items-center">
              <p className="min-w-0 leading-6">
                {t(keyHintKey(selectedCard, selection.mode))}
              </p>
              <button
                type="button"
                onClick={() => handleOpenKeyPage(keyPageUrl(selectedCard, selection.mode))}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#1388ff]/24 bg-[#1388ff]/[0.06] px-3 py-1.5 text-[12.5px] font-semibold text-[#1377df] transition hover:bg-[#1388ff]/[0.1] dark:border-[#3aa0ff]/22 dark:bg-[#3aa0ff]/[0.12] dark:text-[#88c8ff] dark:hover:bg-[#3aa0ff]/[0.18]"
              >
                <span className="min-w-0 text-center leading-tight">{t('firstRunGetKeyAction')}</span>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
            {wireNote && (
              <div
                className={
                  wireNote.tone === 'success'
                    ? 'rounded-xl border border-emerald-300/60 bg-emerald-50/80 px-4 py-2.5 text-[12.5px] leading-5 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'rounded-xl border border-amber-300/60 bg-amber-50/80 px-4 py-2.5 text-[12.5px] leading-5 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300'
                }
              >
                {wireNote.text}
              </div>
            )}
          </div>

          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('baseUrl')}
            </label>
            <input
              type="text"
              value={selectedDraft.baseUrl}
              onChange={(e) => updateSelectedDraft({ baseUrl: e.target.value })}
              placeholder="https://"
              className={fieldClass}
            />
          </div>
        </div>

        <div className="shrink-0 space-y-3 border-t border-slate-200/72 bg-white/70 px-5 pb-4 pt-3.5 dark:border-white/10 dark:bg-white/[0.025] sm:space-y-4 sm:px-7 sm:pb-6 sm:pt-4">
          {error && (
            <div className="rounded-xl border border-red-500/18 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-700 dark:border-red-500/20 dark:bg-red-500/[0.12] dark:text-red-200">
              {error}
            </div>
          )}

          <div className={closeAllowed ? 'flex flex-col-reverse gap-3 sm:grid sm:grid-cols-[0.85fr_1fr]' : 'grid gap-3'}>
            {closeAllowed ? (
              <button
                type="button"
                onClick={handleClose}
                className="min-h-11 rounded-xl border border-slate-300/80 bg-white/75 px-4 py-2 text-[15px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/16 dark:hover:bg-white/[0.06]"
              >
                {t('firstRunClose')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="min-h-11 rounded-xl bg-[linear-gradient(180deg,#2392ff_0%,#0e7df0_100%)] px-4 py-2 text-[15px] font-semibold text-white shadow-[0_14px_30px_rgba(19,136,255,0.22)] transition hover:opacity-95 disabled:opacity-50 dark:bg-[linear-gradient(180deg,#2c9dff_0%,#1584f6_100%)] dark:shadow-[0_14px_30px_rgba(21,132,246,0.2)]"
            >
              {saving ? t('firstRunSaving') : t('firstRunSave')}
            </button>
          </div>

          <p className="text-center text-[12.5px] leading-6 text-slate-400 dark:text-slate-500">
            {t(isPreview ? 'firstRunPreviewHint' : 'firstRunChangeLater')}
          </p>
        </div>
        </section>
      </div>
    </div>
  )
}
