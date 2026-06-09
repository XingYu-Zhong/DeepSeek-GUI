import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the Kun executable. Kun ships as a TypeScript
 * package inside the DeepSeek-GUI workspace (`kun/`) and is
 * executed through the bundled Node.js runtime that Electron carries.
 *
 * Resolution order:
 * 1. User-supplied binary path (treated as a JS module when it ends
 *    in `.js` or is a directory containing `dist/cli/serve-entry.js`).
 * 2. Bundled `kun/dist/cli/serve-entry.js` (built by the root
 *    `build:kun` script before dev, build, install, and packaging).
 *
 * The resolver never throws on missing artifacts during the user
 * typing flow: it returns the bundled dist path even when the file
 * does not exist yet, and the calling layer is responsible for
 * surfacing a clear "runtime not built" diagnostic.
 */
export type KunBinaryResolution =
  | { kind: 'node-script'; command: string; args: string[]; dataDir: string }
  | { kind: 'custom'; command: string; args: string[]; dataDir: string }

const DIST_ENTRY_CANDIDATES = [
  'kun/dist/cli/serve-entry.js',
  'kun/dist/cli/serve.js'
]

function exists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isNodeScript(path: string): boolean {
  return /\.(?:cjs|mjs|js)$/i.test(path)
}

export function resolveKunExecutable(
  appRoot: string,
  userBinaryPath: string
): KunBinaryResolution {
  const trimmed = userBinaryPath?.trim() ?? ''
  if (trimmed) {
    if (isDirectory(trimmed)) {
      const entry = join(trimmed, 'dist/cli/serve-entry.js')
      return {
        kind: 'node-script',
        command: process.execPath,
        args: [entry],
        dataDir: ''
      }
    }
    if (isNodeScript(trimmed)) {
      return {
        kind: 'node-script',
        command: process.execPath,
        args: [trimmed],
        dataDir: ''
      }
    }
    return {
      kind: 'custom',
      command: trimmed,
      args: [],
      dataDir: ''
    }
  }
  for (const candidate of DIST_ENTRY_CANDIDATES) {
    const full = join(appRoot, candidate)
    if (exists(full)) {
      return {
        kind: 'node-script',
        command: process.execPath,
        args: [full],
        dataDir: ''
      }
    }
  }
  return {
    kind: 'node-script',
    command: process.execPath,
    args: [join(appRoot, DIST_ENTRY_CANDIDATES[0])],
    dataDir: ''
  }
}

/**
 * Build the full `kun serve` argv from resolved binary info
 * and Kun runtime settings. The function is pure: no I/O, no
 * side effects, easy to test.
 */
export function buildKunServeArgs(input: {
  resolution: KunBinaryResolution
  host: string
  port: number
  dataDir: string
  baseUrl?: string
  model: string
  approvalPolicy: string
  sandboxMode: string
  tokenEconomyMode: boolean
  insecure: boolean
}): string[] {
  return [
    ...input.resolution.args,
    '--host',
    input.host,
    '--port',
    String(input.port),
    '--data-dir',
    input.dataDir,
    ...(input.baseUrl ? ['--base-url', input.baseUrl] : []),
    '--model',
    input.model,
    '--approval-policy',
    input.approvalPolicy,
    '--sandbox-mode',
    input.sandboxMode,
    '--token-economy-mode',
    input.tokenEconomyMode ? 'true' : 'false',
    ...(input.insecure ? ['--insecure'] : [])
  ]
}
