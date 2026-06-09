import type { ReactElement } from 'react'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  ListTodo,
  PanelRightClose,
  PlayCircle,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import type { ThreadTodoItem, ThreadTodoStatus } from '../../agent/types'

type Props = {
  className?: string
  onCollapse: () => void
  onOpenPlan: () => void
}

const STATUS_ORDER: ThreadTodoStatus[] = ['pending', 'in_progress', 'completed']

export function TodoPanel({
  className = '',
  onCollapse,
  onOpenPlan
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadTodos = useChatStore((s) => s.activeThreadTodos)
  const setActiveThreadTodoStatus = useChatStore((s) => s.setActiveThreadTodoStatus)
  const clearActiveThreadTodos = useChatStore((s) => s.clearActiveThreadTodos)
  const items = activeThreadTodos?.items ?? []
  const completed = items.filter((item) => item.status === 'completed').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const pending = Math.max(0, items.length - completed - inProgress)

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ListTodo className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
            <span className="truncate text-[13px] font-semibold text-ds-ink">
              {t('todoPanelTitle')}
            </span>
          </div>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => void clearActiveThreadTodos()}
              className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-red-600"
              aria-label={t('todoClear')}
              title={t('todoClear')}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          <TodoStat label={t('todoStatusPending')} value={pending} />
          <TodoStat label={t('todoStatusInProgress')} value={inProgress} />
          <TodoStat label={t('todoStatusCompleted')} value={completed} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">
              <ListTodo className="h-6 w-6" strokeWidth={1.65} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-ds-ink">{t('todoEmptyTitle')}</div>
              <div className="mt-1 max-w-64 text-[12px] leading-5 text-ds-muted">
                {t('todoEmptyDescription')}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <TodoRow
                key={item.id}
                item={item}
                onOpenPlan={onOpenPlan}
                onStatus={(status) => void setActiveThreadTodoStatus(item.id, status)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function TodoStat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-lg bg-ds-surface-subtle px-2.5 py-2 dark:bg-white/6">
      <div className="text-[15px] font-semibold leading-none text-ds-ink">{value}</div>
      <div className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.04em] text-ds-faint">
        {label}
      </div>
    </div>
  )
}

function TodoRow({
  item,
  onStatus,
  onOpenPlan
}: {
  item: ThreadTodoItem
  onStatus: (status: ThreadTodoStatus) => void
  onOpenPlan: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-lg border border-ds-border-muted bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-ds-card">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onStatus(item.status === 'completed' ? 'pending' : 'completed')}
          className="mt-0.5 shrink-0 rounded-full text-ds-muted transition hover:text-accent"
          aria-label={item.status === 'completed' ? t('todoMarkPending') : t('todoMarkCompleted')}
          title={item.status === 'completed' ? t('todoMarkPending') : t('todoMarkCompleted')}
        >
          {item.status === 'completed' ? (
            <CheckCircle2 className="h-[18px] w-[18px] text-emerald-600" strokeWidth={1.85} />
          ) : item.status === 'in_progress' ? (
            <PlayCircle className="h-[18px] w-[18px] text-amber-600" strokeWidth={1.85} />
          ) : (
            <Circle className="h-[18px] w-[18px]" strokeWidth={1.85} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div
            className={`break-words text-[13px] leading-5 ${
              item.status === 'completed'
                ? 'text-ds-faint line-through decoration-ds-faint/60'
                : 'text-ds-ink'
            }`}
          >
            {item.content}
          </div>
          {item.source?.kind === 'plan' ? (
            <button
              type="button"
              onClick={onOpenPlan}
              className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ds-faint transition hover:bg-ds-hover hover:text-accent"
              title={item.source.relativePath}
            >
              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{item.source.relativePath}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 pl-6">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onStatus(status)}
            className={`rounded-full px-2 py-1 text-[11px] font-medium transition ${
              item.status === status
                ? 'bg-accent/12 text-accent'
                : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            {t(`todoStatus.${status}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
