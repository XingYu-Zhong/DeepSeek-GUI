import {
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  DEFAULT_SCHEDULE_MODEL,
  type ScheduleSettingsPatchV1,
  type ScheduleSettingsV1,
  type ScheduledTaskV1
} from './app-settings-types'
import {
  compactStrings,
  normalizeAtTime,
  normalizeBoolean,
  normalizePositiveInteger,
  normalizeRunMode,
  normalizeScheduleKind,
  normalizeScheduleReasoningEffort,
  normalizeStatus,
  normalizeTimeOfDay
} from './app-settings-normalizers'

export function normalizeScheduledTask(
  task: Partial<ScheduledTaskV1>,
  index: number,
  now: string
): ScheduledTaskV1 {
  const schedule = task.schedule
  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : `task-${index + 1}`,
    title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : `Task ${index + 1}`,
    enabled: normalizeBoolean(task.enabled, true),
    prompt: typeof task.prompt === 'string' ? task.prompt : '',
    workspaceRoot: typeof task.workspaceRoot === 'string' ? task.workspaceRoot.trim() : '',
    model: typeof task.model === 'string' && task.model.trim() ? task.model.trim() : DEFAULT_SCHEDULE_MODEL,
    reasoningEffort: normalizeScheduleReasoningEffort(task.reasoningEffort),
    mode: normalizeRunMode(task.mode),
    schedule: {
      kind: normalizeScheduleKind(schedule?.kind),
      everyMinutes: normalizePositiveInteger(schedule?.everyMinutes, 60, 1, 10_080),
      timeOfDay: normalizeTimeOfDay(schedule?.timeOfDay),
      atTime: normalizeAtTime(schedule?.atTime)
    },
    createdAt: typeof task.createdAt === 'string' && task.createdAt ? task.createdAt : now,
    updatedAt: typeof task.updatedAt === 'string' && task.updatedAt ? task.updatedAt : now,
    lastRunAt: typeof task.lastRunAt === 'string' ? task.lastRunAt : '',
    nextRunAt: typeof task.nextRunAt === 'string' ? task.nextRunAt : '',
    lastStatus: normalizeStatus(task.lastStatus),
    lastMessage: typeof task.lastMessage === 'string' ? task.lastMessage : '',
    lastThreadId: typeof task.lastThreadId === 'string' ? task.lastThreadId : ''
  }
}

export function defaultScheduleSettings(): ScheduleSettingsV1 {
  return {
    enabled: false,
    defaultWorkspaceRoot: '',
    model: DEFAULT_SCHEDULE_MODEL,
    mode: 'agent',
    promptPrefix: '',
    skills: {
      defaultNames: [],
      extraDirs: []
    },
    keepAwake: false,
    internal: {
      port: DEFAULT_SCHEDULE_INTERNAL_PORT,
      secret: ''
    },
    tasks: []
  }
}

export function normalizeScheduleSettings(
  input: ScheduleSettingsPatchV1 | undefined
): ScheduleSettingsV1 {
  const defaults = defaultScheduleSettings()
  const source = input ?? {}
  const skills = source.skills ?? defaults.skills
  const internal = source.internal ?? defaults.internal
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    defaultWorkspaceRoot:
      typeof source.defaultWorkspaceRoot === 'string' ? source.defaultWorkspaceRoot.trim() : '',
    model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : DEFAULT_SCHEDULE_MODEL,
    mode: normalizeRunMode(source.mode),
    promptPrefix: typeof source.promptPrefix === 'string' ? source.promptPrefix : '',
    skills: {
      defaultNames: compactStrings(skills.defaultNames),
      extraDirs: compactStrings(skills.extraDirs)
    },
    keepAwake: normalizeBoolean(source.keepAwake, defaults.keepAwake),
    internal: {
      port: normalizePositiveInteger(internal.port, defaults.internal.port, 1024, 65_535),
      secret: typeof internal.secret === 'string' ? internal.secret.trim() : ''
    },
    tasks: Array.isArray(source.tasks)
      ? source.tasks.map((task, index) => normalizeScheduledTask(task as Partial<ScheduledTaskV1>, index, now))
      : []
  }
}

export function mergeScheduleSettings(
  current: ScheduleSettingsV1,
  patch: ScheduleSettingsPatchV1 | undefined
): ScheduleSettingsV1 {
  if (!patch) return normalizeScheduleSettings(current)
  return normalizeScheduleSettings({
    ...current,
    ...patch,
    skills: {
      ...current.skills,
      ...(patch.skills ?? {})
    },
    internal: {
      ...current.internal,
      ...(patch.internal ?? {})
    },
    tasks: patch.tasks ?? current.tasks
  })
}
