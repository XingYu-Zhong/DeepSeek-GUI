import { z } from 'zod'
import {
  DEFAULT_SERVE_PORT,
  DEFAULT_SERVE_OPTIONS,
  ServeOptionsSchema,
  type ServeOptions
} from './cli-options.js'
import {
  kunConfigPathForDataDir,
  readKunConfigFile,
  readOptionalKunConfigFile,
  type LoadedKunConfig
} from '../config/kun-config.js'

/**
 * Parse the `kun serve` command line into validated options.
 *
 * Supports `--key=value` and `--key value` shapes, repeating flags
 * override defaults. Returns the parsed and validated options. Throws
 * a ZodError when the value is malformed.
 */
export function parseServeOptions(
  argv: readonly string[],
  env: Record<string, string | undefined> = {}
): ServeOptions {
  const raw: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eqIndex = token.indexOf('=')
    const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2)
    let value: string | boolean = 'true'
    if (eqIndex >= 0) {
      value = token.slice(eqIndex + 1)
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1]
      i += 1
    }
    raw[key] = value
  }
  const loadedConfig = loadServeConfig(raw, env)
  const configServe = loadedConfig?.config.serve ?? {}
  const portEnv = env.KUN_PORT
  const tokenEconomyMode =
    booleanFlag(raw, 'token-economy') ??
    booleanFlag(raw, 'token-economy-mode') ??
    booleanFlag(raw, 'tokenEconomyMode') ??
    envBoolean(env.KUN_TOKEN_ECONOMY_MODE) ??
    configServe.tokenEconomy?.enabled ??
    configServe.tokenEconomyMode ??
    DEFAULT_SERVE_OPTIONS.tokenEconomyMode
  const merged: ServeOptions = {
    ...DEFAULT_SERVE_OPTIONS,
    ...(loadedConfig ? { configPath: loadedConfig.path } : {}),
    host:
      typeof raw.host === 'string'
        ? raw.host
        : env.KUN_HOST ?? configServe.host ?? DEFAULT_SERVE_OPTIONS.host,
    port:
      typeof raw.port === 'string'
        ? Number(raw.port)
        : portEnv
          ? Number(portEnv)
          : configServe.port ?? DEFAULT_SERVE_OPTIONS.port,
    dataDir:
      typeof raw['data-dir'] === 'string'
        ? raw['data-dir']
        : typeof raw.dataDir === 'string'
          ? raw.dataDir
          : env.KUN_DATA_DIR ??
            configServe.dataDir ??
            DEFAULT_SERVE_OPTIONS.dataDir,
    runtimeToken:
      typeof raw['runtime-token'] === 'string'
        ? raw['runtime-token']
        : typeof raw.runtimeToken === 'string'
          ? raw.runtimeToken
          : env.KUN_RUNTIME_TOKEN ??
            configServe.runtimeToken ??
            DEFAULT_SERVE_OPTIONS.runtimeToken,
    apiKey:
      typeof raw['api-key'] === 'string'
        ? raw['api-key']
        : typeof raw.apiKey === 'string'
          ? raw.apiKey
          : env.DEEPSEEK_API_KEY ?? configServe.apiKey ?? DEFAULT_SERVE_OPTIONS.apiKey,
    baseUrl:
      typeof raw['base-url'] === 'string'
        ? raw['base-url']
        : typeof raw.baseUrl === 'string'
          ? raw.baseUrl
          : env.KUN_BASE_URL ??
            env.DEEPSEEK_BASE_URL ??
            configServe.baseUrl ??
            DEFAULT_SERVE_OPTIONS.baseUrl,
    model:
      typeof raw.model === 'string'
        ? raw.model
        : env.KUN_MODEL ?? configServe.model ?? DEFAULT_SERVE_OPTIONS.model,
    approvalPolicy:
      typeof raw['approval-policy'] === 'string'
        ? (raw['approval-policy'] as ServeOptions['approvalPolicy'])
        : configServe.approvalPolicy ?? DEFAULT_SERVE_OPTIONS.approvalPolicy,
    sandboxMode:
      typeof raw['sandbox-mode'] === 'string'
        ? (raw['sandbox-mode'] as ServeOptions['sandboxMode'])
        : configServe.sandboxMode ?? DEFAULT_SERVE_OPTIONS.sandboxMode,
    tokenEconomyMode,
    tokenEconomy: {
      ...(configServe.tokenEconomy ?? {}),
      enabled: tokenEconomyMode
    },
    insecure:
      typeof raw.insecure === 'string'
        ? raw.insecure !== 'false' && raw.insecure !== '0'
        : raw.insecure === true
          ? true
          : configServe.insecure ?? DEFAULT_SERVE_OPTIONS.insecure,
    storage: {
      backend:
        storageBackendFromRawOrEnv(raw, env) ??
        configServe.storage?.backend ??
        DEFAULT_SERVE_OPTIONS.storage.backend,
      ...((storageSqlitePathFromRawOrEnv(raw, env) ?? configServe.storage?.sqlitePath)
        ? { sqlitePath: storageSqlitePathFromRawOrEnv(raw, env) ?? configServe.storage?.sqlitePath }
        : {})
    },
    models: loadedConfig?.config.models,
    contextCompaction: loadedConfig?.config.contextCompaction,
    runtime: loadedConfig?.config.runtime,
    capabilities: loadedConfig?.config.capabilities ?? DEFAULT_SERVE_OPTIONS.capabilities
  }
  return ServeOptionsSchema.parse(merged)
}

/**
 * Validate a pre-constructed options object. Used by tests and by the
 * main process when Kun is started programmatically.
 */
export function validateServeOptions(input: unknown): ServeOptions {
  return ServeOptionsSchema.parse(input)
}

/** Human-readable usage string, used by the CLI when no args are given. */
export const SERVE_USAGE = `kun serve [options]

Options:
  --config <path>          JSON config file (default: {data-dir}/config.json when present)
  --host <host>            Bind address (default 127.0.0.1)
  --port <port>            HTTP port (default ${DEFAULT_SERVE_PORT})
  --data-dir <path>        Root directory for threads, events, and usage
  --runtime-token <token>  Bearer token for /v1/* requests
  --api-key <key>          DeepSeek-compatible API key
  --base-url <url>         DeepSeek-compatible base URL
  --model <model>          Default model id
  --approval-policy <p>    on-request | untrusted | never | auto | suggest
  --sandbox-mode <mode>    read-only | workspace-write | danger-full-access | external-sandbox
  --token-economy          Compress safe tool context before model calls
  --insecure               Disable bearer token check (local dev only)
  --storage-backend <b>    hybrid | file (default hybrid)
  --sqlite-path <path>     SQLite index path for hybrid storage
`

export const ServeExitCode = {
  ok: 0,
  usage: 64,
  config: 78,
  runtime: 70
} as const

export type ServeExitCode = (typeof ServeExitCode)[keyof typeof ServeExitCode]

/**
 * Convenience helper for CLI entrypoints: parse argv and return the final options or a
 * structured error.
 */
export type ParseServeResult =
  | { ok: true; options: ServeOptions }
  | { ok: false; exitCode: ServeExitCode; message: string; issues?: unknown }

export function parseServeOptionsSafe(
  argv: readonly string[],
  env: Record<string, string | undefined> = {}
): ParseServeResult {
  try {
    const parsed = parseServeOptions(argv, env)
    if (!parsed.dataDir) {
      return {
        ok: false,
        exitCode: ServeExitCode.config,
        message: 'serve requires --data-dir <path>'
      }
    }
    return { ok: true, options: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        exitCode: ServeExitCode.config,
        message: 'invalid serve options',
        issues: error.issues
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, exitCode: ServeExitCode.config, message }
  }
}

function loadServeConfig(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): LoadedKunConfig | null {
  const explicitConfigPath =
    stringFlag(raw, 'config') ??
    stringFlag(raw, 'config-file') ??
    env.KUN_CONFIG
  if (explicitConfigPath) {
    return readKunConfigFile(explicitConfigPath)
  }
  const dataDir = dataDirFromRawOrEnv(raw, env)
  return readOptionalKunConfigFile(kunConfigPathForDataDir(dataDir))
}

function dataDirFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): string | undefined {
  return stringFlag(raw, 'data-dir') ??
    stringFlag(raw, 'dataDir') ??
    env.KUN_DATA_DIR
}

function storageBackendFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): ServeOptions['storage']['backend'] | undefined {
  const value =
    stringFlag(raw, 'storage-backend') ??
    stringFlag(raw, 'storageBackend') ??
    env.KUN_STORAGE_BACKEND
  if (value === 'hybrid' || value === 'file') return value
  return value ? (value as ServeOptions['storage']['backend']) : undefined
}

function storageSqlitePathFromRawOrEnv(
  raw: Record<string, string | boolean>,
  env: Record<string, string | undefined>
): string | undefined {
  return stringFlag(raw, 'sqlite-path') ??
    stringFlag(raw, 'sqlitePath') ??
    env.KUN_SQLITE_PATH
}

function stringFlag(
  raw: Record<string, string | boolean>,
  key: string
): string | undefined {
  const value = raw[key]
  return typeof value === 'string' && value !== 'true' ? value : undefined
}

function booleanFlag(
  raw: Record<string, string | boolean>,
  key: string
): boolean | undefined {
  const value = raw[key]
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  return envBoolean(value)
}

function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false
  }
  return true
}
