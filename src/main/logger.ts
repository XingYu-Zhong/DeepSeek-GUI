import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export type LogLevel = 'error' | 'warn' | 'info'
export type ManagedLogFilePrefix = 'deepseek-gui' | 'kun'

type LoggerConfig = {
  /** Directory where log files are stored. */
  dir: string
  /** Whether logging is enabled. */
  enabled: boolean
  /** Delete log files older than this many days. */
  retentionDays: number
}

let cfg: LoggerConfig = { dir: '', enabled: true, retentionDays: 2 }
const MANAGED_LOG_FILE_PREFIXES: ManagedLogFilePrefix[] = ['deepseek-gui', 'kun']

export function configureLogger(config: Partial<LoggerConfig>): void {
  cfg = { ...cfg, ...config }
}

function logFileName(prefix: ManagedLogFilePrefix, timestamp: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix}-${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}.log`
}

function isManagedLogFile(entry: string): boolean {
  return MANAGED_LOG_FILE_PREFIXES.some(
    (prefix) => entry.startsWith(`${prefix}-`) && entry.endsWith('.log')
  )
}

/**
 * Best-effort prune of old log files. Runs on every write so it stays
 * tidy without a dedicated timer.
 */
async function pruneOldLogs(): Promise<void> {
  try {
    const entries = await readdir(cfg.dir)
    const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      if (!isManagedLogFile(entry)) continue
      try {
        const info = await stat(join(cfg.dir, entry))
        if (info.mtimeMs < cutoff) {
          await unlink(join(cfg.dir, entry))
        }
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* directory may not exist yet — that's fine */
  }
}

export async function appendManagedLogLine(
  prefix: ManagedLogFilePrefix,
  line: string
): Promise<void> {
  if (!cfg.enabled || !cfg.dir) return

  const text = line.endsWith('\n') ? line : `${line}\n`

  try {
    await mkdir(cfg.dir, { recursive: true })
    await appendFile(join(cfg.dir, logFileName(prefix, new Date())), text, 'utf8')
    // prune after write — cheap since most writes succeed pruning
    await pruneOldLogs()
  } catch {
    /* never crash the app because of logging */
  }
}

async function writeLogLine(level: LogLevel, category: string, message: string): Promise<void> {
  const stamp = new Date().toISOString()
  const line = `[${stamp}] [${level.toUpperCase()}] [${category}] ${message}\n`
  await appendManagedLogLine('deepseek-gui', line)
}

export function logError(category: string, message: string, detail?: unknown): void {
  const full = detail !== undefined
    ? `${message} — detail: ${safeStringify(detail)}`
    : message
  void writeLogLine('error', category, full)
}

export function logWarn(category: string, message: string, detail?: unknown): void {
  const full = detail !== undefined
    ? `${message} — detail: ${safeStringify(detail)}`
    : message
  void writeLogLine('warn', category, full)
}

export function logInfo(category: string, message: string): void {
  void writeLogLine('info', category, message)
}

/**
 * On startup, prune old logs immediately and log the action.
 */
export async function pruneOnStartup(): Promise<void> {
  await pruneOldLogs()
  logInfo('logger', `Pruned logs older than ${cfg.retentionDays} day(s) on startup`)
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return value.slice(0, 2000)
    return JSON.stringify(value, null, 2).slice(0, 2000)
  } catch {
    return String(value).slice(0, 2000)
  }
}
