import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function resolvePreferredOpenClawTmpDir() {
  return process.env.OPENCLAW_TMP_DIR?.trim() || path.join(os.tmpdir(), 'deepseek-gui-openclaw-shim')
}

export async function withFileLock(filePath, _options, operation) {
  await mkdir(path.dirname(filePath), { recursive: true })
  return operation()
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

export async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
