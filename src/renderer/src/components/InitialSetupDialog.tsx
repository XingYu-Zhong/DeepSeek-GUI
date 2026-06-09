import { type CSSProperties, type ReactElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getActiveAgentApiKey,
  getModelProviderSettings,
  normalizeAppSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { applyTheme } from '../lib/apply-theme'
import { useChatStore } from '../store/chat-store'
import { Eye, EyeOff, ExternalLink, Sparkles, Sun, Moon, Monitor, X } from 'lucide-react'

type ThemePref = AppSettingsV1['theme']
type SetupFormPatch = AppSettingsPatch
type MaskedInputStyle = CSSProperties & { WebkitTextSecurity?: 'disc' }

const themeOptions: { value: ThemePref; icon: typeof Sun; labelKey: string }[] = [
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' }
]
const DEEPSEEK_USAGE_URL = 'https://platform.deepseek.com/usage'

export function InitialSetupDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const initialSetupMode = useChatStore((s) => s.initialSetupMode)
  const closeInitialSetup = useChatStore((s) => s.closeInitialSetup)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)

  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPreview = initialSetupMode === 'preview'
  const provider = form ? getModelProviderSettings(form) : null

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (!cancelled) setForm(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [])

  const updateForm = (patch: SetupFormPatch) => {
    if (!form) return
    const next = normalizeAppSettings({
      ...form,
      ...patch,
      provider: {
        ...form.provider,
        ...(patch.provider ?? {})
      }
    } as AppSettingsV1)
    setForm(next)
  }

  const updateProvider = (patch: Partial<AppSettingsV1['provider']>): void => {
    updateForm({ provider: patch })
  }

  const handleThemeChange = (theme: ThemePref) => {
    if (!form) return
    updateForm({ theme })
    applyTheme(theme)
  }

  const handleClose = () => {
    setError(null)
    closeInitialSetup()
    void reloadUiSettings()
  }

  const handleOpenOfficialApiPage = () => {
    if (typeof window.dsGui?.openExternal !== 'function') return
    void window.dsGui.openExternal(DEEPSEEK_USAGE_URL).catch(() => undefined)
  }

  const handleSave = async () => {
    if (!form) return
    if (!getActiveAgentApiKey(form).trim()) {
      setError(t('firstRunApiKeyValidation'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await rendererRuntimeClient.setSettings(form)
      setForm(next)
      await applyI18n(next.locale)
      void reloadUiSettings()
      void probeRuntime('background')
      closeInitialSetup()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return (
      <div className="ds-no-drag fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md dark:bg-black/70">
        <div className="rounded-xl border border-ds-border bg-ds-card/95 px-5 py-4 text-sm text-ds-muted shadow-panel backdrop-blur-xl">
          {t('loading')}
        </div>
      </div>
    )
  }

  const selectedTheme = form.theme
  const choiceButtonClass = (active: boolean): string =>
    [
      'flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200 sm:min-h-11 sm:px-4',
      active
        ? 'border-[#1388ff] bg-[#1388ff]/[0.07] text-[#1377df] shadow-[0_0_0_1px_rgba(19,136,255,0.12),0_8px_18px_rgba(19,136,255,0.07)] dark:border-[#3aa0ff] dark:bg-[#3aa0ff]/[0.12] dark:text-[#88c8ff]'
        : 'border-slate-300/80 bg-white/72 text-slate-600 hover:border-slate-400/80 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/[0.055]'
    ].join(' ')
  const fieldClass =
    'w-full rounded-xl border border-slate-300/75 bg-white/88 px-4 py-3 text-[15px] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition focus:border-[#1388ff]/70 focus:ring-2 focus:ring-[#1388ff]/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:shadow-none dark:focus:border-[#3aa0ff]/70 dark:focus:ring-[#3aa0ff]/15 dark:placeholder:text-slate-500'
  const labelClass = 'text-sm font-semibold text-slate-700 dark:text-slate-200'
  const apiKeyMaskStyle: MaskedInputStyle | undefined =
    !showApiKey && provider?.apiKey ? { WebkitTextSecurity: 'disc' } : undefined

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
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('firstRunClose')}
              title={t('firstRunClose')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300/80 bg-white/72 text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/18 dark:hover:text-slate-200"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
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
              {t('apiKey')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={provider?.apiKey ?? ''}
                onChange={(e) => updateProvider({ apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={apiKeyMaskStyle}
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
                {t('firstRunBuyApiHint')}
              </p>
              <button
                type="button"
                onClick={handleOpenOfficialApiPage}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#1388ff]/24 bg-[#1388ff]/[0.06] px-3 py-1.5 text-[12.5px] font-semibold text-[#1377df] transition hover:bg-[#1388ff]/[0.1] dark:border-[#3aa0ff]/22 dark:bg-[#3aa0ff]/[0.12] dark:text-[#88c8ff] dark:hover:bg-[#3aa0ff]/[0.18]"
              >
                <span className="min-w-0 text-center leading-tight">{t('firstRunBuyApiAction')}</span>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="space-y-2.5 sm:space-y-3.5">
            <label className={labelClass}>
              {t('baseUrl')}
            </label>
            <input
              type="text"
              value={provider?.baseUrl ?? ''}
              onChange={(e) => updateProvider({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
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

          <div className="flex flex-col-reverse gap-3 sm:grid sm:grid-cols-[0.85fr_1fr]">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-11 rounded-xl border border-slate-300/80 bg-white/75 px-4 py-2 text-[15px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/16 dark:hover:bg-white/[0.06]"
            >
              {t('firstRunClose')}
            </button>
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
