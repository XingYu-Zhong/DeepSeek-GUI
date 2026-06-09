import type { ReactElement } from 'react'
import { Bug, FolderOpen, Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type SuggestionTone = 'blue' | 'emerald' | 'violet'

const SUGGESTION_TONE: Record<SuggestionTone, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-ds-skill-soft dark:text-ds-skill'
}

const CHAT_STARTERS: Array<{
  icon: ReactElement
  tone: SuggestionTone
  titleKey: string
  subKey: string
  promptKey: string
}> = [
  {
    icon: <FolderOpen className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'blue',
    titleKey: 'promptStructureTitle',
    subKey: 'promptStructureSub',
    promptKey: 'promptStructurePrompt'
  },
  {
    icon: <Bug className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'emerald',
    titleKey: 'promptBugTitle',
    subKey: 'promptBugSub',
    promptKey: 'promptBugPrompt'
  },
  {
    icon: <Lightbulb className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'violet',
    titleKey: 'promptPlanTitle',
    subKey: 'promptPlanSub',
    promptKey: 'promptPlanPrompt'
  }
]

export function ChatStarterGrid({
  onSelectSuggestion,
  compact = false
}: {
  onSelectSuggestion?: (prompt: string) => void
  compact?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className={`${compact ? 'mt-5' : 'mt-12'} grid w-full gap-3 sm:grid-cols-2 ${compact ? 'max-w-none' : 'max-w-[980px]'}`}>
      {CHAT_STARTERS.map((starter) => (
        <button
          key={starter.titleKey}
          type="button"
          onClick={() => onSelectSuggestion?.(t(starter.promptKey))}
          className={`ds-empty-hero-card group flex min-h-[112px] items-center gap-4 rounded-[16px] border border-[rgba(15,23,42,0.1)] bg-[rgba(255,255,255,0.92)] px-5 py-4 text-left shadow-[0_16px_38px_rgba(86,103,136,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(0,136,255,0.18)] hover:shadow-[0_22px_48px_rgba(86,103,136,0.13)] dark:border-white/10 dark:bg-[rgba(24,24,24,0.9)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)] ${compact ? 'min-h-[92px]' : ''}`}
        >
          <span
            className={`ds-empty-hero-card-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${SUGGESTION_TONE[starter.tone]}`}
          >
            {starter.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="ds-empty-hero-card-title block truncate text-[16px] font-semibold tracking-[0] text-ds-ink">
              {t(starter.titleKey)}
            </span>
            <span className="ds-empty-hero-card-sub mt-1 block text-[13.5px] leading-5 text-ds-faint">
              {t(starter.subKey)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
