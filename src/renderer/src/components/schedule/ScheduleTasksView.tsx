import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Power,
  Timer,
  Trash2,
  X
} from 'lucide-react'
import {
  DEFAULT_SCHEDULE_MODEL,
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  SCHEDULE_MODEL_IDS,
  mergeScheduleSettings,
  normalizeScheduleSettings,
  type AppSettingsV1,
  type ScheduleKind,
  type ScheduleReasoningEffort,
  type ScheduleRuntimeStatus,
  type ScheduleSettingsV1,
  type ScheduledTaskV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { ScheduleDefaultsDialog } from './ScheduleDefaultsDialog'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread?: (threadId: string) => void
}

type TaskFilter = 'all' | 'enabled' | 'running' | 'done'
type TaskDialogState =
  | { mode: 'create'; draft: ScheduledTaskV1 }
  | { mode: 'edit'; taskId: string; draft: ScheduledTaskV1 }

const SCHEDULE_FILTERS: TaskFilter[] = ['all', 'enabled', 'running', 'done']
const SCHEDULE_KIND_OPTIONS: ScheduleKind[] = ['daily', 'at', 'interval', 'manual']
const SCHEDULE_REASONING_OPTIONS: ScheduleReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']
const EMPTY_SCHEDULE_TASKS: ScheduledTaskV1[] = []
const TIME_HOURS = Array.from({ length: 24 }, (_item, index) => String(index).padStart(2, '0'))
const TIME_MINUTES = Array.from({ length: 60 }, (_item, index) => String(index).padStart(2, '0'))
const RESULT_PREVIEW_CHAR_THRESHOLD = 360
const RESULT_PREVIEW_LINE_THRESHOLD = 5

function nowIso(): string {
  return new Date().toISOString()
}

export function newScheduledTask(workspaceRoot: string, defaults?: Partial<ScheduledTaskV1>): ScheduledTaskV1 {
  const now = nowIso()
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `schedule-${Date.now()}`,
    title: '',
    enabled: true,
    prompt: '',
    workspaceRoot,
    model: DEFAULT_SCHEDULE_MODEL,
    reasoningEffort: DEFAULT_SCHEDULE_REASONING_EFFORT,
    schedule: {
      kind: 'daily',
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
    lastThreadId: '',
    ...defaults,
    mode: 'agent'
  }
}

export function dateTimeLocalValueFromIso(value: string): string {
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

export function isoFromDateTimeLocalValue(value: string): string {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

export function scheduleTaskSummary(
  task: ScheduledTaskV1,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (task.schedule.kind === 'at') {
    return t('scheduleAt', {
      datetime: task.schedule.atTime ? new Date(task.schedule.atTime).toLocaleString() : '-'
    })
  }
  if (task.schedule.kind === 'interval') {
    return t('scheduleEvery', { minutes: task.schedule.everyMinutes })
  }
  if (task.schedule.kind === 'daily') {
    return t('scheduleDailyAt', { time: task.schedule.timeOfDay })
  }
  return t('scheduleManual')
}

function scheduleReasoningLabel(
  value: ScheduleReasoningEffort,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  return t(`scheduleReasoning_${value}`)
}

export function validateScheduledTaskDraft(
  task: ScheduledTaskV1,
  t: (key: string, values?: Record<string, unknown>) => string,
  now = new Date()
): string | null {
  if (!task.title.trim()) return t('scheduleTaskNameRequired')
  if (task.title.trim().length > 50) return t('scheduleTaskNameTooLong')
  if (!task.prompt.trim()) return t('scheduleTaskPromptRequired')
  if (task.prompt.length > 8_000) return t('scheduleTaskPromptTooLong')
  if (task.schedule.kind === 'interval' && (!Number.isFinite(task.schedule.everyMinutes) || task.schedule.everyMinutes < 1)) {
    return t('scheduleIntervalInvalid')
  }
  if (task.schedule.kind === 'daily' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.schedule.timeOfDay)) {
    return t('scheduleDailyTimeInvalid')
  }
  if (task.schedule.kind === 'at') {
    const runAt = Date.parse(task.schedule.atTime)
    if (!Number.isFinite(runAt)) return t('scheduleAtTimeInvalid')
    if (task.enabled && runAt <= now.getTime()) return t('scheduleAtTimePast')
  }
  return null
}

export function filterScheduledTasks(tasks: ScheduledTaskV1[], filter: TaskFilter): ScheduledTaskV1[] {
  const filtered = tasks.filter((task) => {
    if (filter === 'enabled') return task.enabled
    if (filter === 'running') return task.lastStatus === 'running'
    if (filter === 'done') return task.lastStatus === 'success' || task.lastStatus === 'error'
    return true
  })
  return [...filtered].sort((a, b) => {
    const aNext = Date.parse(a.nextRunAt)
    const bNext = Date.parse(b.nextRunAt)
    if (Number.isFinite(aNext) && Number.isFinite(bNext)) return aNext - bNext
    if (Number.isFinite(aNext)) return -1
    if (Number.isFinite(bNext)) return 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

export function scheduledTaskLastThreadId(task: Pick<ScheduledTaskV1, 'lastThreadId'>): string {
  return task.lastThreadId.trim()
}

export function scheduledTaskResultIsExpandable(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  return trimmed.length > RESULT_PREVIEW_CHAR_THRESHOLD ||
    trimmed.split(/\r?\n/u).length > RESULT_PREVIEW_LINE_THRESHOLD
}

function formatDateTime(value: string, fallback: string): string {
  if (!value.trim()) return fallback
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  return date.toLocaleString()
}

function statusTone(status: ScheduledTaskV1['lastStatus']): string {
  if (status === 'running') return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  if (status === 'success') return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-100'
  if (status === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-100'
  return 'bg-ds-subtle text-ds-muted'
}

export function ScheduleTasksView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenThread
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [status, setStatus] = useState<ScheduleRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [dialog, setDialog] = useState<TaskDialogState | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [expandedResultTaskIds, setExpandedResultTaskIds] = useState<Set<string>>(() => new Set())

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        rendererRuntimeClient.getSettings({ forceRefresh: true }),
        typeof window.dsGui?.getScheduleStatus === 'function'
          ? window.dsGui.getScheduleStatus()
          : Promise.resolve(null)
      ])
      setSettings(nextSettings)
      setStatus(nextStatus)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(id)
  }, [load])

  const schedule = settings ? normalizeScheduleSettings(settings.schedule) : null
  const tasks = schedule?.tasks ?? EMPTY_SCHEDULE_TASKS
  const runningTaskIds = useMemo(() => new Set(status?.runningTaskIds ?? []), [status])
  const visibleTasks = useMemo(() => filterScheduledTasks(tasks, filter), [filter, tasks])

  const persistSchedule = async (patch: Parameters<typeof mergeScheduleSettings>[1]): Promise<void> => {
    if (!settings) return
    const nextSchedule = mergeScheduleSettings(settings.schedule, patch)
    setSettings({ ...settings, schedule: nextSchedule })
    const saved = await rendererRuntimeClient.setSettings({ schedule: nextSchedule })
    setSettings(saved)
    if (typeof window.dsGui?.getScheduleStatus === 'function') {
      setStatus(await window.dsGui.getScheduleStatus())
    }
  }

  const resolveDialogWorkspaceRoot = useCallback((workspaceRoot?: string): string => {
    const explicit = workspaceRoot?.trim() || ''
    if (explicit) return explicit
    return schedule?.defaultWorkspaceRoot.trim() || settings?.workspaceRoot.trim() || ''
  }, [schedule?.defaultWorkspaceRoot, settings?.workspaceRoot])

  const openCreateDialog = (): void => {
    const workspaceRoot = resolveDialogWorkspaceRoot()
    setDialog({ mode: 'create', draft: newScheduledTask(workspaceRoot, {
      model: schedule?.model || DEFAULT_SCHEDULE_MODEL
    }) })
    setDialogError(null)
  }

  const openEditDialog = (task: ScheduledTaskV1): void => {
    setDialog({
      mode: 'edit',
      taskId: task.id,
      draft: {
        ...task,
        workspaceRoot: resolveDialogWorkspaceRoot(task.workspaceRoot),
        schedule: { ...task.schedule }
      }
    })
    setDialogError(null)
  }

  const pickDialogWorkspace = async (): Promise<void> => {
    if (!dialog) return
    try {
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error(t('workspacePickerUnavailable'))
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot) || undefined)
      if (picked.canceled || !picked.path) return
      onDraftChangeInDialog({ workspaceRoot: picked.path })
      setDialogError(null)
    } catch (error) {
      setDialogError(formatWorkspacePickerError(error))
    }
  }

  const onDraftChangeInDialog = (patch: Partial<ScheduledTaskV1>): void => {
    setDialog((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current)
  }

  const saveDialog = async (): Promise<void> => {
    if (!dialog || !schedule || !settings) return
    const validation = validateScheduledTaskDraft(dialog.draft, t)
    if (validation) {
      setDialogError(validation)
      return
    }
    const now = nowIso()
    const workspaceRoot = resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot)
    const task = {
      ...dialog.draft,
      title: dialog.draft.title.trim(),
      prompt: dialog.draft.prompt,
      workspaceRoot,
      mode: 'agent' as const,
      updatedAt: now,
      nextRunAt: ''
    }
    if (dialog.mode === 'create') {
      await persistSchedule({
        enabled: true,
        tasks: [...schedule.tasks, { ...task, createdAt: now }]
      })
    } else {
      await persistSchedule({
        tasks: schedule.tasks.map((item) => item.id === dialog.taskId ? task : item)
      })
    }
    setDialog(null)
    setDialogError(null)
  }

  const updateTask = async (taskId: string, patch: Partial<ScheduledTaskV1>): Promise<void> => {
    if (!schedule) return
    const now = nowIso()
    await persistSchedule({
      tasks: schedule.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...patch,
              ...(patch.schedule ? { schedule: { ...task.schedule, ...patch.schedule } } : {}),
              nextRunAt: patch.enabled !== undefined || patch.schedule ? '' : task.nextRunAt,
              updatedAt: now
            }
          : task
      )
    })
  }

  const deleteTask = async (taskId: string): Promise<void> => {
    if (!schedule) return
    if (!window.confirm(t('scheduleDeleteConfirm'))) return
    await persistSchedule({ tasks: schedule.tasks.filter((task) => task.id !== taskId) })
  }

  const runTask = async (taskId: string): Promise<void> => {
    if (typeof window.dsGui?.runScheduleTask !== 'function') return
    const result = await window.dsGui.runScheduleTask(taskId)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await load()
  }

  const toggleKeepAwake = async (value: boolean): Promise<void> => {
    await persistSchedule({ keepAwake: value })
  }

  const toggleResultPreview = (taskId: string): void => {
    setExpandedResultTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
              }`}
            >
              {leftSidebarCollapsed ? (
                <SidebarTitlebarToggleButton
                  onClick={onToggleLeftSidebar}
                  title={t('sidebarExpand')}
                  ariaLabel={t('sidebarExpand')}
                />
              ) : null}
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">
                {t('schedule')}
              </h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] leading-6 text-ds-faint">
              {t('scheduleSubtitle')}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as TaskFilter)}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
              >
                {SCHEDULE_FILTERS.map((item) => (
                  <option key={item} value={item}>{t(`scheduleFilter_${item}`)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSettingsDialogOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                title={t('scheduleDefaultsTitle')}
                aria-label={t('scheduleDefaultsTitle')}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                {t('scheduleNewTask')}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Clock3 className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
              <span className="min-w-0 text-[14px] text-ds-ink">
                {t('scheduleAwakeNotice')}
              </span>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ds-muted">
              {t('scheduleKeepAwake')}
              <input
                type="checkbox"
                checked={Boolean(schedule?.keepAwake)}
                onChange={(event) => void toggleKeepAwake(event.target.checked)}
                className="sr-only"
              />
              <span className={`relative h-5 w-9 rounded-full transition ${schedule?.keepAwake ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${schedule?.keepAwake ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </label>
          </div>

          {loading ? (
            <div className="py-20 text-center text-[14px] text-ds-faint">{t('loading')}</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="flex min-h-[340px] items-center justify-center text-[13px] text-ds-faint">
              {tasks.length === 0 ? t('scheduleEmpty') : t('scheduleFilterEmpty')}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleTasks.map((task) => {
                const running = runningTaskIds.has(task.id) || task.lastStatus === 'running'
                const lastThreadId = scheduledTaskLastThreadId(task)
                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-ds-border bg-ds-card px-4 py-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h2 className="truncate text-[15px] font-semibold text-ds-ink">
                            {task.title || t('scheduleUntitled')}
                          </h2>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(task.lastStatus)}`}>
                            {running ? t('scheduleStatus_running') : t(`scheduleStatus_${task.lastStatus}`)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ds-faint">
                          <span>{scheduleTaskSummary(task, t)}</span>
                          <span>{t('scheduleNextRun')}: {formatDateTime(task.nextRunAt, t('scheduleNotScheduled'))}</span>
                          <span>{t('scheduleLastRun')}: {formatDateTime(task.lastRunAt, t('scheduleNeverRun'))}</span>
                          <span>{task.model} · {scheduleReasoningLabel(task.reasoningEffort, t)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {lastThreadId ? (
                          <button
                            type="button"
                            onClick={() => onOpenThread?.(lastThreadId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            title={t('scheduleOpenLastThread')}
                            aria-label={t('scheduleOpenLastThread')}
                          >
                            <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void runTask(task.id)}
                          disabled={running}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                          title={t('scheduleRunNow')}
                          aria-label={t('scheduleRunNow')}
                        >
                          <Play className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditDialog(task)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          title={t('scheduleEditTask')}
                          aria-label={t('scheduleEditTask')}
                        >
                          <PencilLine className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTask(task.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                          title={t('scheduleDeleteTask')}
                          aria-label={t('scheduleDeleteTask')}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <label className="ml-1 inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={task.enabled}
                            onChange={(event) => void updateTask(task.id, { enabled: event.target.checked })}
                            className="sr-only"
                          />
                          <span className={`relative h-5 w-9 rounded-full transition ${task.enabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${task.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                          </span>
                        </label>
                      </div>
                    </div>
                    {task.lastMessage ? (
                      <div className="mt-3 rounded-lg border border-ds-border-muted bg-ds-main/45 px-3 py-2.5">
                        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[12px] font-semibold text-ds-faint">
                            {task.lastStatus === 'error'
                              ? t('scheduleLastError')
                              : task.lastStatus === 'running'
                                ? t('scheduleCurrentStatus')
                                : t('scheduleLastResult')}
                          </span>
                          {scheduledTaskResultIsExpandable(task.lastMessage) ? (
                            <button
                              type="button"
                              onClick={() => toggleResultPreview(task.id)}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                              aria-expanded={expandedResultTaskIds.has(task.id)}
                            >
                              {expandedResultTaskIds.has(task.id) ? (
                                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                              )}
                              {expandedResultTaskIds.has(task.id) ? t('scheduleCollapseResult') : t('scheduleExpandResult')}
                            </button>
                          ) : null}
                        </div>
                        <div
                          className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ds-muted ${
                            expandedResultTaskIds.has(task.id)
                              ? 'max-h-80 overflow-y-auto pr-1'
                              : 'line-clamp-5 overflow-hidden'
                          }`}
                        >
                          {task.lastMessage}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {dialog ? (
        <ScheduleTaskDialog
          dialog={dialog}
          error={dialogError}
          onClose={() => setDialog(null)}
          onDraftChange={(draft) => setDialog((current) => current ? { ...current, draft } : current)}
          onPickWorkspace={() => void pickDialogWorkspace()}
          onSubmit={() => void saveDialog()}
          onOpenSettings={() => setSettingsDialogOpen(true)}
          t={t}
        />
      ) : null}

      {settingsDialogOpen && schedule ? (
        <ScheduleDefaultsDialog
          schedule={schedule}
          onClose={() => setSettingsDialogOpen(false)}
          onSave={async (patch) => {
            await persistSchedule(patch)
            setSettingsDialogOpen(false)
          }}
          t={t}
        />
      ) : null}
    </div>
  )
}

function ScheduleTaskDialog({
  dialog,
  error,
  onClose,
  onDraftChange,
  onPickWorkspace,
  onSubmit,
  onOpenSettings,
  t
}: {
  dialog: TaskDialogState
  error: string | null
  onClose: () => void
  onDraftChange: (draft: ScheduledTaskV1) => void
  onPickWorkspace: () => void
  onSubmit: () => void
  onOpenSettings: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const draft = dialog.draft
  const updateDraft = (patch: Partial<ScheduledTaskV1>): void => {
    onDraftChange({ ...draft, ...patch })
  }
  const updateSchedule = (patch: Partial<ScheduledTaskV1['schedule']>): void => {
    onDraftChange({ ...draft, schedule: { ...draft.schedule, ...patch } })
  }
  const promptCount = draft.prompt.length
  const title = dialog.mode === 'create' ? t('scheduleCreateTask') : t('scheduleEditTask')

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/58 px-4 py-2"
      onMouseDown={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-1rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px] border border-white/55 bg-ds-card shadow-[0_30px_90px_rgba(15,23,42,0.28)] dark:border-white/10"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-ds-border-muted px-6 py-3">
          <div className="min-w-0">
            <h2 id="schedule-task-dialog-title" className="truncate text-[17px] font-semibold text-ds-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('close')}
            title={t('close')}
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-4">
            <ScheduleDialogSection
              icon={<Timer className="h-4 w-4" strokeWidth={1.8} />}
              title={t('scheduleTaskSectionContent')}
            >
              <label className="grid gap-2">
                <FieldLabel required>{t('scheduleTaskName')}</FieldLabel>
                <div className="relative">
                  <input
                    value={draft.title}
                    maxLength={50}
                    onChange={(event) => updateDraft({ title: event.target.value })}
                    placeholder={t('scheduleTaskNamePlaceholder')}
                    className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 pr-14 text-[14px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ds-faint">
                    {draft.title.length}/50
                  </span>
                </div>
              </label>

              <label className="grid gap-2">
                <FieldLabel required>{t('scheduleTaskPrompt')}</FieldLabel>
                <div className="relative">
                  <textarea
                    value={draft.prompt}
                    maxLength={8_000}
                    onChange={(event) => updateDraft({ prompt: event.target.value })}
                    placeholder={t('scheduleTaskPromptPlaceholder')}
                    className="min-h-[108px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/55 px-3 py-3 pb-8 text-[14px] leading-6 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                  />
                  <span className="pointer-events-none absolute bottom-3 right-3 text-[12px] text-ds-faint">
                    {promptCount}/8000
                  </span>
                </div>
              </label>
            </ScheduleDialogSection>

            <ScheduleDialogSection
              icon={<Brain className="h-4 w-4" strokeWidth={1.8} />}
              title={t('scheduleTaskSectionModel')}
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <label className="grid gap-2">
                  <FieldLabel required>{t('scheduleModel')}</FieldLabel>
                  <select
                    value={draft.model}
                    onChange={(event) => updateDraft({ model: event.target.value })}
                    className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                  >
                    {SCHEDULE_MODEL_IDS.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-2">
                  <FieldLabel>{t('scheduleReasoning')}</FieldLabel>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {SCHEDULE_REASONING_OPTIONS.map((effort) => (
                      <SegmentButton
                        key={effort}
                        selected={draft.reasoningEffort === effort}
                        onClick={() => updateDraft({ reasoningEffort: effort })}
                      >
                        {scheduleReasoningLabel(effort, t)}
                      </SegmentButton>
                    ))}
                  </div>
                </div>
              </div>
            </ScheduleDialogSection>

            <ScheduleDialogSection
              icon={<CalendarClock className="h-4 w-4" strokeWidth={1.8} />}
              title={t('scheduleTaskSectionTiming')}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="grid gap-2">
                  <FieldLabel required>{t('scheduleRunAt')}</FieldLabel>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SCHEDULE_KIND_OPTIONS.map((kind) => (
                      <SegmentButton
                        key={kind}
                        selected={draft.schedule.kind === kind}
                        onClick={() => updateSchedule({ kind })}
                      >
                        {t(`scheduleKind_${kind}`)}
                      </SegmentButton>
                    ))}
                  </div>
                </div>

                {draft.schedule.kind === 'daily' ? (
                  <div className="grid gap-2">
                    <FieldLabel>{t('scheduleDailyTime')}</FieldLabel>
                    <ScheduleTimePicker
                      value={draft.schedule.timeOfDay}
                      onChange={(timeOfDay) => updateSchedule({ timeOfDay })}
                      t={t}
                    />
                  </div>
                ) : draft.schedule.kind === 'at' ? (
                  <label className="grid gap-2">
                    <FieldLabel>{t('scheduleAtTime')}</FieldLabel>
                    <input
                      type="datetime-local"
                      value={dateTimeLocalValueFromIso(draft.schedule.atTime)}
                      onChange={(event) => updateSchedule({ atTime: isoFromDateTimeLocalValue(event.target.value) })}
                      className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                    />
                  </label>
                ) : draft.schedule.kind === 'interval' ? (
                  <label className="grid gap-2">
                    <FieldLabel>{t('scheduleEveryMinutes')}</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={draft.schedule.everyMinutes}
                      onChange={(event) => updateSchedule({ everyMinutes: Number(event.target.value) })}
                      className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                    />
                  </label>
                ) : (
                  <div className="flex min-h-10 items-center rounded-xl bg-ds-subtle px-3 text-[13px] text-ds-muted">
                    {t('scheduleManualHint')}
                  </div>
                )}
              </div>
            </ScheduleDialogSection>

            <ScheduleDialogSection
              icon={<Folder className="h-4 w-4" strokeWidth={1.8} />}
              title={t('scheduleTaskSectionEnvironment')}
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                <label className="grid gap-2">
                  <FieldLabel>{t('scheduleWorkspace')}</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_138px]">
                    <input
                      value={draft.workspaceRoot}
                      onChange={(event) => updateDraft({ workspaceRoot: event.target.value })}
                      placeholder={t('scheduleWorkspacePlaceholder')}
                      className="h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/15"
                    />
                    <button
                      type="button"
                      onClick={onPickWorkspace}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <FolderOpen className="h-4 w-4" strokeWidth={1.75} />
                      {draft.workspaceRoot.trim() ? t('changeWorkspace') : t('selectWorkspace')}
                    </button>
                  </div>
                </label>

                <div className="grid gap-2">
                  <FieldLabel>{t('scheduleTaskEnabled')}</FieldLabel>
                  <button
                    type="button"
                    onClick={() => updateDraft({ enabled: !draft.enabled })}
                    className="flex h-10 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-pressed={draft.enabled}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Power className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">{t('scheduleTaskEnabled')}</span>
                    </span>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.enabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </span>
                  </button>
                </div>
              </div>
            </ScheduleDialogSection>
          </div>

          {error ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted bg-ds-card px-6 py-3">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-8 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
            {t('scheduleAdvancedSettings')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-xl border border-ds-border bg-ds-card px-4 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="h-8 rounded-xl bg-ds-userbubble px-5 text-[13px] font-semibold text-ds-userbubbleFg transition hover:opacity-90"
            >
              {t('confirm')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function ScheduleDialogSection({
  icon,
  title,
  children
}: {
  icon: ReactElement
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="grid gap-3 border-t border-ds-border-muted pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-ds-subtle text-ds-muted">
          {icon}
        </span>
        <span>{title}</span>
      </div>
      {children}
    </section>
  )
}

function FieldLabel({
  children,
  required = false
}: {
  children: ReactNode
  required?: boolean
}): ReactElement {
  return (
    <span className="flex min-h-5 items-center gap-1 text-[13px] font-medium text-ds-ink">
      <span className="min-w-0 truncate">{children}</span>
      {required ? <span className="text-red-500">*</span> : null}
    </span>
  )
}

function SegmentButton({
  selected,
  onClick,
  children
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 min-w-0 rounded-xl border px-2.5 text-[12.5px] font-semibold transition ${
        selected
          ? 'border-accent/45 bg-accent/10 text-ds-ink shadow-sm'
          : 'border-ds-border bg-ds-main/55 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="block truncate">{children}</span>
    </button>
  )
}

function ScheduleTimePicker({
  value,
  onChange,
  t
}: {
  value: string
  onChange: (value: string) => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const [hour, minute] = splitTimeOfDay(value)
  const selectClass = 'h-10 w-full rounded-xl border border-ds-border bg-ds-main/55 px-3 text-[14px] text-ds-ink outline-none transition focus:border-accent/45 focus:ring-2 focus:ring-accent/15'

  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={hour}
        onChange={(event) => onChange(`${event.target.value}:${minute}`)}
        className={selectClass}
        aria-label={t('scheduleTimeHour')}
      >
        {TIME_HOURS.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(event) => onChange(`${hour}:${event.target.value}`)}
        className={selectClass}
        aria-label={t('scheduleTimeMinute')}
      >
        {TIME_MINUTES.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
    </div>
  )
}

function splitTimeOfDay(value: string): [string, string] {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u.exec(value)
  return [match?.groups?.hour ?? '09', match?.groups?.minute ?? '00']
}
