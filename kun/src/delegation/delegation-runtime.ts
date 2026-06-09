import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'

const ChildRunUsage = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  turns: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional()
})

export const ChildRunRecord = z.object({
  id: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1),
  label: z.string().optional(),
  prompt: z.string().min(1),
  workspace: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  summary: z.string().optional(),
  error: z.string().optional(),
  usage: ChildRunUsage.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ChildRunRecord = z.infer<typeof ChildRunRecord>

export type ChildRunExecutor = (input: {
  childId: string
  parentThreadId: string
  parentTurnId: string
  label?: string
  prompt: string
  workspace?: string
  model?: string
  signal: AbortSignal
}) => Promise<{ summary: string; usage?: ChildRunRecord['usage'] }>

export type ChildRunAggregate = {
  key: string
  label?: string
  model?: string
  runs: number
  completed: number
  failed: number
  aborted: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  costCny?: number
  averageTotalTokens: number
  averageCostUsd?: number
  averageCostCny?: number
}

export class FileDelegationStore {
  constructor(private readonly rootDir: string) {}

  async upsert(record: ChildRunRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await writeFile(join(this.rootDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8')
  }

  async list(parentThreadId?: string): Promise<ChildRunRecord[]> {
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.rootDir, entry), 'utf8')
        .then((text) => ChildRunRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records
      .filter((record): record is ChildRunRecord => Boolean(record))
      .filter((record) => !parentThreadId || record.parentThreadId === parentThreadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

export class DelegationRuntime {
  private active = 0
  private childSeq = 0

  constructor(private readonly options: {
    config: SubagentsCapabilityConfig
    store: FileDelegationStore
    events?: RuntimeEventRecorder
    nowIso?: () => string
    idGenerator?: () => string
    executor?: ChildRunExecutor
    recordExternalUsage?: (threadId: string, usage: UsageSnapshot) => void
  }) {}

  async runChild(input: {
    parentThreadId: string
    parentTurnId: string
    label?: string
    prompt: string
    workspace?: string
    model?: string
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    if (!this.options.config.enabled) throw new Error('delegation is disabled by config')
    if (this.active >= this.options.config.maxParallel) throw new Error('delegation parallel budget exhausted')
    const existing = await this.options.store.list(input.parentThreadId)
    if (existing.length >= this.options.config.maxChildRuns) throw new Error('delegation child-run budget exhausted')
    const now = this.now()
    const id = this.options.idGenerator?.() ?? `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    let record = ChildRunRecord.parse({
      id,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      label: input.label,
      prompt: input.prompt,
      workspace: input.workspace,
      model: input.model,
      status: 'running',
      createdAt: now,
      updatedAt: now
    })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    this.active += 1
    try {
      const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
      const result = await executor({
        childId: id,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        ...(input.label ? { label: input.label } : {}),
        prompt: input.prompt,
        workspace: input.workspace,
        model: input.model,
        signal: input.signal
      })
      record = ChildRunRecord.parse({
        ...record,
        status: 'completed',
        summary: result.summary,
        usage: result.usage ?? record.usage,
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      this.recordExternalUsage(record)
      return record
    } catch (error) {
      record = ChildRunRecord.parse({
        ...record,
        status: input.signal.aborted ? 'aborted' : 'failed',
        error: errorMessage(error),
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    } finally {
      this.active -= 1
    }
  }

  async diagnostics(parentThreadId?: string): Promise<{
    enabled: boolean
    active: number
    childRuns: ChildRunRecord[]
    aggregates: ChildRunAggregate[]
  }> {
    const childRuns = await this.options.store.list(parentThreadId)
    return {
      enabled: this.options.config.enabled,
      active: this.active,
      childRuns,
      aggregates: aggregateChildRuns(childRuns)
    }
  }

  private async recordChildEvent(record: ChildRunRecord): Promise<void> {
    await this.options.events?.record({
      kind: record.status === 'completed' ? 'turn_completed' : record.status === 'failed' ? 'turn_failed' : record.status === 'aborted' ? 'turn_aborted' : 'turn_started',
      threadId: record.parentThreadId,
      turnId: record.parentTurnId,
      status: record.status,
      text: record.summary ?? record.error,
      child: {
        parentThreadId: record.parentThreadId,
        parentTurnId: record.parentTurnId,
        childId: record.id,
        childLabel: record.label,
        childStatus: record.status,
        childSeq: ++this.childSeq
      }
    })
  }

  private recordExternalUsage(record: ChildRunRecord): void {
    if (record.status !== 'completed') return
    const usage = toUsageSnapshot(record.usage)
    if (usage.totalTokens <= 0 && usage.costUsd === undefined && usage.costCny === undefined) return
    this.options.recordExternalUsage?.(record.parentThreadId, usage)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function toUsageSnapshot(usage: ChildRunRecord['usage']): UsageSnapshot {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    cacheHitRate: usage.cacheHitRate ?? null,
    turns: usage.turns ?? 0,
    costUsd: usage.costUsd,
    costCny: usage.costCny,
    cacheSavingsUsd: usage.cacheSavingsUsd,
    cacheSavingsCny: usage.cacheSavingsCny,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: usage.tokenEconomySavingsCny
  }
}

export function aggregateChildRuns(records: readonly ChildRunRecord[]): ChildRunAggregate[] {
  const buckets = new Map<string, ChildRunAggregate>()
  for (const record of records) {
    const label = record.label?.trim() || undefined
    const model = record.model?.trim() || undefined
    const key = `${label ?? 'unlabeled'}:${model ?? 'default'}`
    const bucket = buckets.get(key) ?? {
      key,
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      runs: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      averageTotalTokens: 0
    }
    bucket.runs += 1
    if (record.status === 'completed') bucket.completed += 1
    else if (record.status === 'failed') bucket.failed += 1
    else if (record.status === 'aborted') bucket.aborted += 1
    bucket.promptTokens += record.usage.promptTokens
    bucket.completionTokens += record.usage.completionTokens
    bucket.totalTokens += record.usage.totalTokens
    if (record.usage.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + record.usage.costUsd
    if (record.usage.costCny !== undefined) bucket.costCny = (bucket.costCny ?? 0) + record.usage.costCny
    bucket.averageTotalTokens = bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0
    bucket.averageCostUsd = bucket.costUsd !== undefined && bucket.runs > 0 ? bucket.costUsd / bucket.runs : undefined
    bucket.averageCostCny = bucket.costCny !== undefined && bucket.runs > 0 ? bucket.costCny / bucket.runs : undefined
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) =>
    b.runs - a.runs ||
    b.totalTokens - a.totalTokens ||
    a.key.localeCompare(b.key)
  )
}

const defaultExecutor: ChildRunExecutor = async (input) => {
  return { summary: `Child result: ${input.prompt}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
