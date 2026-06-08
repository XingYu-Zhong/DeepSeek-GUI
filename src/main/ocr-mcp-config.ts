import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'

const OCR_MCP_SERVER_NAME = 'gui_ocr'
const OCR_MCP_NODE_ENTRY = 'out/main/ocr-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }

type JsonRecord = Record<string, unknown>

export type OcrMcpLaunchConfig = {
  appPath: string
  execPath: string
  isPackaged: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

function resolveKunMcpJsonPath(): string {
  return join(homedir(), '.kun', 'mcp.json')
}

export function resolveOcrMcpNodeEntryPath(launch: OcrMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, OCR_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, OCR_MCP_NODE_ENTRY)
}

function resolveOcrMcpCommand(
  launch: OcrMcpLaunchConfig,
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

function buildOcrMcpArgs(): string[] {
  return [resolveOcrMcpNodeEntryPath({ appPath: '', execPath: '', isPackaged: false }), '--gui-ocr-mcp-server']
}

export function buildOcrMcpServerConfig(launch: OcrMcpLaunchConfig): JsonRecord {
  return {
    command: resolveOcrMcpCommand(launch),
    args: [resolveOcrMcpNodeEntryPath(launch), '--gui-ocr-mcp-server'],
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

function buildSyncedOcrMcpJson(
  existing: unknown,
  launch: OcrMcpLaunchConfig
): JsonRecord {
  const base = isRecord(existing) ? existing : {}
  const servers = isRecord(base.servers) ? base.servers : {}
  const { [OCR_MCP_SERVER_NAME]: _existingOcrServer, ...userServers } = servers
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
      [OCR_MCP_SERVER_NAME]: buildOcrMcpServerConfig(launch)
    }
  }
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

export async function syncOcrMcpConfig(
  launch: OcrMcpLaunchConfig,
  mcpJsonPath: string = resolveKunMcpJsonPath()
): Promise<void> {
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedOcrMcpJson(current, launch)
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  const currentText = current === null ? '' : `${JSON.stringify(current, null, 2)}\n`
  if (nextText === currentText) return

  await mkdir(dirname(mcpJsonPath), { recursive: true })
  await writeFile(mcpJsonPath, nextText, 'utf8')
}
