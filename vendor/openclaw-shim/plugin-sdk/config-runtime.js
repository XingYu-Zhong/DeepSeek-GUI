import fs from 'node:fs'
import path from 'node:path'

function configPath() {
  return process.env.OPENCLAW_CONFIG_PATH || process.env.OPENCLAW_CONFIG || path.join(process.cwd(), 'openclaw.json')
}

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

export async function writeConfigFile(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export function resolveStorePath() {
  return path.join(process.env.OPENCLAW_STATE_DIR || process.cwd(), 'sessions.json')
}

export function applyModelOverrideToSessionEntry(entry) {
  return entry
}

export async function updateSessionStore() {
  return undefined
}
