import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { AudioLines, Bot, Bug, ChevronLeft, FileImage, Globe, ImageIcon, Keyboard, Mic, PencilLine, RefreshCw, ServerCog, Settings, ShieldCheck, Smartphone, Sparkles } from 'lucide-react'

type SettingsCategory = 'general' | 'providers' | 'write' | 'imageInput' | 'imageGeneration' | 'mediaGeneration' | 'speechToText' | 'agents' | 'permissions' | 'shortcuts' | 'easterEgg' | 'claw' | 'updates' | 'debug'

export function SettingsSidebar({
  category,
  goBack,
  setCategory,
  t
}: {
  category: SettingsCategory
  goBack: () => void
  setCategory: Dispatch<SetStateAction<SettingsCategory>>
  t: (key: string) => string
}): ReactElement {
  const catCls = (c: SettingsCategory): string =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition ${
      category === c
        ? 'bg-ds-subtle text-ds-ink shadow-sm ring-1 ring-ds-border-muted'
        : 'text-ds-muted hover:bg-ds-hover'
    }`

  return (
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
        <button type="button" className={catCls('providers')} onClick={() => setCategory('providers')}>
          <ServerCog className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('providers')}
        </button>
        <button type="button" className={catCls('write')} onClick={() => setCategory('write')}>
          <PencilLine className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('write')}
        </button>
        <button
          type="button"
          className={catCls('imageInput')}
          onClick={() => setCategory('imageInput')}
        >
          <FileImage className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('imageInput')}
        </button>
        <button
          type="button"
          className={catCls('imageGeneration')}
          onClick={() => setCategory('imageGeneration')}
        >
          <ImageIcon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('imageGen')}
        </button>
        <button
          type="button"
          className={catCls('mediaGeneration')}
          onClick={() => setCategory('mediaGeneration')}
        >
          <AudioLines className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('mediaGeneration')}
        </button>
        <button
          type="button"
          className={catCls('speechToText')}
          onClick={() => setCategory('speechToText')}
        >
          <Mic className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('speechToText')}
        </button>
        <button type="button" className={catCls('agents')} onClick={() => setCategory('agents')}>
          <Bot className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('agents')}
        </button>
        <button type="button" className={catCls('permissions')} onClick={() => setCategory('permissions')}>
          <ShieldCheck className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('permissions')}
        </button>
        <button type="button" className={catCls('shortcuts')} onClick={() => setCategory('shortcuts')}>
          <Keyboard className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('keyboardShortcuts')}
        </button>
        <button type="button" className={catCls('easterEgg')} onClick={() => setCategory('easterEgg')}>
          <Sparkles className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('easterEgg')}
        </button>
        <button type="button" className={catCls('updates')} onClick={() => setCategory('updates')}>
          <RefreshCw className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('updates')}
        </button>
        <button type="button" className={catCls('claw')} onClick={() => setCategory('claw')}>
          <Smartphone className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('claw')}
        </button>
        <button type="button" className={catCls('debug')} onClick={() => setCategory('debug')}>
          <Bug className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('debug')}
        </button>
      </nav>
      <div className="ds-no-drag mt-auto border-t border-ds-border p-3">
        <div className="flex items-center gap-2 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-subtle text-ds-muted">
            <Settings className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 text-[12px] text-ds-muted">
            <div className="truncate font-medium text-ds-ink">Kun</div>
            <div className="truncate">{t('settingsFooter')}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
