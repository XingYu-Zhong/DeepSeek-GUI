import { type ReactElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettingsV1 } from '@shared/app-settings'
import { applyTheme } from '../lib/apply-theme'
import { useChatStore } from '../store/chat-store'
import { Eye, EyeOff, ExternalLink, Sparkles, Sun, Moon, Monitor, X } from 'lucide-react'

type ThemePref = AppSettingsV1['theme']
type SetupFormPatch = Partial<Omit<AppSettingsV1, 'agents'>> & {
  agents?: { codewhale?: Partial<AppSettingsV1['agents']['codewhale']> }
}

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

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui === 'undefined') return
    void window.dsGui.getSettings().then((s) => {
      if (!cancelled) setForm(s)
    })
    return () => { cancelled = true }
  }, [])

  const updateForm = (patch: SetupFormPatch) => {
    if (!form) return
    const next: AppSettingsV1 = {
      ...form,
      ...patch,
      agents: {
        codewhale: { ...form.agents.codewhale, ...(patch.agents?.codewhale ?? {}) }
      }
    }
    setForm(next)
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
    void window.dsGui.openExternal(DEEPSEEK_USAGE_URL)
  }

  const handleSave = async () => {
    if (!form) return
    if (!form.agents.codewhale.apiKey.trim()) {
      setError(t('firstRunApiKeyValidation'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (typeof window.dsGui === 'undefined') throw new Error('Preload bridge missing')
      const next = await window.dsGui.setSettings(form)
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md dark:bg-black/70">
        <div className="rounded-2xl border border-ds-border bg-ds-card/95 px-5 py-4 text-sm text-ds-muted shadow-panel backdrop-blur-xl">
          {t('loading')}
        </div>
      </div>
    )
  }

  const selectedTheme = form.theme
  const choiceButtonClass = (active: boolean): string =>
    [
      'flex h-12 items-center justify-center gap-2 rounded-[16px] border px-4 text-[15px] font-medium transition-all duration-200',
      active
        ? 'border-[#1388ff] bg-[#1388ff]/[0.06] text-[#1388ff] shadow-[0_0_0_1px_rgba(19,136,255,0.14),0_10px_24px_rgba(19,136,255,0.08)] dark:border-[#3aa0ff] dark:bg-[#3aa0ff]/[0.12] dark:text-[#7dc1ff]'
        : 'border-slate-300/80 bg-white/70 text-slate-600 hover:border-slate-400/80 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/16 dark:hover:bg-white/[0.045]'
    ].join(' ')
  const fieldClass =
    'w-full rounded-[18px] border border-slate-300/75 bg-white/88 px-4 py-3 text-[15px] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition focus:border-[#1388ff]/70 focus:ring-2 focus:ring-[#1388ff]/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:shadow-none dark:focus:border-[#3aa0ff]/70 dark:focus:ring-[#3aa0ff]/15 dark:placeholder:text-slate-500'
  const labelClass = 'text-[15px] font-medium text-slate-700 dark:text-slate-200'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#eef2fb]/38 p-4 backdrop-blur-[18px] dark:bg-black/60 dark:backdrop-blur-[22px]">
      <div className="w-full max-w-[592px] overflow-hidden rounded-[28px] border border-white/75 bg-[rgba(255,255,255,0.92)] text-slate-900 shadow-[0_38px_96px_rgba(119,135,172,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(18,21,28,0.94)] dark:text-white dark:shadow-[0_34px_110px_rgba(0,0,0,0.55)]">
        <div className="bg-[radial-gradient(circle_at_top_right,rgba(19,136,255,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0.88))] px-8 pb-7 pt-8 dark:bg-[radial-gradient(circle_at_top_right,rgba(58,160,255,0.12),transparent_28%),linear-gradient(180deg,rgba(24,28,37,0.98),rgba(18,21,28,0.96))]">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1388ff]/22 bg-[#1388ff]/[0.06] px-3.5 py-1.5 text-[13px] font-semibold text-[#1388ff] dark:border-[#3aa0ff]/22 dark:bg-[#3aa0ff]/[0.12] dark:text-[#7dc1ff]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t(isPreview ? 'firstRunPreviewBadge' : 'firstRunBadge')}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('firstRunClose')}
              title={t('firstRunClose')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/80 bg-white/72 text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/18 dark:hover:text-slate-200"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
          <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
            {t('firstRunTitle')}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-slate-500 dark:text-slate-400">
            {t('firstRunSubtitle')}
          </p>
        </div>

        <div className="space-y-6 px-8 py-7">
          <div className="border-t border-slate-200/80 dark:border-white/10" />

          <div className="space-y-3">
            <label className={labelClass}>
              {t('theme')}
            </label>
            <div className="grid grid-cols-3 gap-3">
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
                    <span>{t(labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <label className={labelClass}>
              {t('language')}
            </label>
            <div className="grid grid-cols-2 gap-3">
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
                    {lang === 'en' ? 'English' : '简体中文'}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <label className={labelClass}>
              {t('apiKey')}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={form.agents.codewhale.apiKey}
                onChange={(e) => updateForm({ agents: { codewhale: { apiKey: e.target.value } } })}
                placeholder="sk-..."
                className={`${fieldClass} pr-12 font-mono tracking-[0.02em] placeholder:font-sans`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex flex-col gap-2 rounded-[18px] border border-slate-200/80 bg-slate-50/75 px-4 py-3 text-[13px] text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="leading-6">
                {t('firstRunBuyApiHint')}
              </p>
              <button
                type="button"
                onClick={handleOpenOfficialApiPage}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#1388ff]/24 bg-[#1388ff]/[0.06] px-3 py-1.5 text-[12.5px] font-semibold text-[#1388ff] transition hover:bg-[#1388ff]/[0.1] dark:border-[#3aa0ff]/22 dark:bg-[#3aa0ff]/[0.12] dark:text-[#7dc1ff] dark:hover:bg-[#3aa0ff]/[0.18]"
              >
                <span>{t('firstRunBuyApiAction')}</span>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <label className={labelClass}>
              {t('baseUrl')}
            </label>
            <input
              type="text"
              value={form.agents.codewhale.baseUrl}
              onChange={(e) => updateForm({ agents: { codewhale: { baseUrl: e.target.value } } })}
              placeholder="https://api.deepseek.com/beta"
              className={fieldClass}
            />
          </div>
        </div>

        <div className="space-y-4 px-8 pb-8 pt-1">
          {error && (
            <div className="rounded-[18px] border border-red-500/18 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-700 dark:border-red-500/20 dark:bg-red-500/[0.12] dark:text-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={handleClose}
              className="h-11 rounded-[16px] border border-slate-300/80 bg-white/75 px-4 text-[15px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/16 dark:hover:bg-white/[0.06]"
            >
              {t('firstRunClose')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="h-11 rounded-[16px] bg-[linear-gradient(180deg,#2392ff_0%,#0e7df0_100%)] px-4 text-[15px] font-semibold text-white shadow-[0_16px_34px_rgba(19,136,255,0.24)] transition hover:opacity-95 disabled:opacity-50 dark:bg-[linear-gradient(180deg,#2c9dff_0%,#1584f6_100%)] dark:shadow-[0_16px_34px_rgba(21,132,246,0.22)]"
            >
              {saving ? t('firstRunSaving') : t('firstRunSave')}
            </button>
          </div>

          <p className="text-center text-[12.5px] leading-6 text-slate-400 dark:text-slate-500">
            {t(isPreview ? 'firstRunPreviewHint' : 'firstRunChangeLater')}
          </p>
        </div>
      </div>
    </div>
  )
}
