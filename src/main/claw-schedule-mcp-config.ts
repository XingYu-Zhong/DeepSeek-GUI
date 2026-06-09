import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'

const CLAW_SCHEDULE_MCP_MARKER_START = '# DeepSeek GUI plugin:mcp:claw-schedule START'
const CLAW_SCHEDULE_MCP_MARKER_END = '# DeepSeek GUI plugin:mcp:claw-schedule END'
export const GUI_SCHEDULE_MCP_SERVER_NAME = 'gui_schedule'
const LEGACY_CLAW_SCHEDULE_MCP_SERVER_NAME = 'claw_schedule'
const GUI_SCHEDULE_MCP_NODE_ENTRY = 'out/main/claw-schedule-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }

type JsonRecord = Record<string, unknown>

export type ClawScheduleMcpLaunchConfig = {
  appPath: string
  execPath: string
  isPackaged: boolean
}

type ClawScheduleMcpConfigPaths = {
  configTomlPath?: string
  mcpJsonPath?: string
}

export function resolveKunConfigPath(): string {
  return join(homedir(), '.kun', 'config.toml')
}

export function resolveDeepseekConfigPath(): string {
  return resolveKunConfigPath()
}

export function resolveKunMcpJsonPath(): string {
  return join(homedir(), '.kun', 'mcp.json')
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function buildClawScheduleMcpArgs(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): string[] {
  const args: string[] = [
    resolveClawScheduleMcpNodeEntryPath(launch),
    '--gui-schedule-mcp-server',
    '--base-url',
    `http://127.0.0.1:${settings.schedule.internal.port}`
  ]
  const secret = settings.schedule.internal.secret.trim()
  if (secret) {
    args.push('--secret', secret)
  }
  return args
}

export function resolveClawScheduleMcpNodeEntryPath(launch: ClawScheduleMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_SCHEDULE_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_SCHEDULE_MCP_NODE_ENTRY)
}

export function resolveClawScheduleMcpCommand(
  launch: ClawScheduleMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'darwin') return launch.execPath
  if (!launch.execPath.includes('/Contents/MacOS/')) return launch.execPath

  const appContentsDir = posix.dirname(posix.dirname(launch.execPath))
  const appName = posix.basename(launch.execPath)
  const helperName = `${appName} Helper`
  return posix.join(
    appContentsDir,
    'Frameworks',
    `${helperName}.app`,
    'Contents',
    'MacOS',
    helperName
  )
}

export function buildClawScheduleMcpServerConfig(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): JsonRecord {
  return {
    command: resolveClawScheduleMcpCommand(launch),
    args: buildClawScheduleMcpArgs(settings, launch),
    env: ELECTRON_RUN_AS_NODE_ENV,
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: [],
    disabled_tools: []
  }
}

export function buildSyncedClawScheduleMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): JsonRecord {
  const base = isRecord(existing) ? existing : {}
  const servers = isRecord(base.servers) ? base.servers : {}
  const { [LEGACY_CLAW_SCHEDULE_MCP_SERVER_NAME]: _legacyScheduleServer, ...userServers } = servers
  const timeouts = isRecord(base.timeouts)
    ? base.timeouts
    : {
        connect_timeout: 10,
        execute_timeout: 60,
        read_timeout: 120
      }

  return {
    ...base,
    timeouts,
    servers: {
      ...userServers,
      [GUI_SCHEDULE_MCP_SERVER_NAME]: buildClawScheduleMcpServerConfig(settings, launch)
    }
  }
}

function removeMarkedTomlBlock(content: string, markerStart: string, markerEnd: string): string {
  const startIndex = content.indexOf(markerStart)
  const endIndex = content.indexOf(markerEnd)
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = content.slice(0, startIndex).trimEnd()
    const after = content.slice(endIndex + markerEnd.length).trimStart()
    return `${before}${before && after ? '\n\n' : ''}${after}`.trim()
  }
  return content.trim()
}

function stripTomlTable(content: string, tableHeader: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!skipping && trimmed === tableHeader) {
      skipping = true
      continue
    }
    if (skipping) {
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        skipping = false
        out.push(line)
      }
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

export function removeLegacyClawScheduleTomlConfig(content: string): string {
  const hasLegacyConfig =
    content.includes(CLAW_SCHEDULE_MCP_MARKER_START) ||
    content.split('\n').some((line) => line.trim() === '[mcp_servers.claw_schedule]')
  if (!hasLegacyConfig) return content

  const withoutMarked = removeMarkedTomlBlock(
    content,
    CLAW_SCHEDULE_MCP_MARKER_START,
    CLAW_SCHEDULE_MCP_MARKER_END
  )
  const withoutLegacyTable = stripTomlTable(withoutMarked, '[mcp_servers.claw_schedule]')
  return withoutLegacyTable ? `${withoutLegacyTable}\n` : ''
}

async function readJsonFile(path: string): Promise<unknown | null> {
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw error
  }

  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Kun MCP config at ${path}: ${message}`, { cause: error })
  }
}

async function cleanupLegacyTomlConfig(path: string): Promise<void> {
  let current = ''
  try {
    current = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return
    throw error
  }

  const next = removeLegacyClawScheduleTomlConfig(current)
  if (next === current) return
  await writeFile(path, next, 'utf8')
}

export function clawScheduleMcpSettingsChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return (
    prev.schedule.internal.port !== next.schedule.internal.port ||
    prev.schedule.internal.secret.trim() !== next.schedule.internal.secret.trim()
  )
}

export async function syncClawScheduleMcpConfig(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig,
  paths: ClawScheduleMcpConfigPaths = {}
): Promise<void> {
  const configTomlPath = paths.configTomlPath ?? resolveKunConfigPath()
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()

  await cleanupLegacyTomlConfig(configTomlPath)

  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedClawScheduleMcpJson(current, settings, launch)
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  const currentText = current === null ? '' : `${JSON.stringify(current, null, 2)}\n`
  if (nextText === currentText) return

  await mkdir(dirname(mcpJsonPath), { recursive: true })
  await writeFile(mcpJsonPath, nextText, 'utf8')
}
