import { spawn } from 'node:child_process'
import { getActiveAgentRuntimeSettings, type AppSettingsV1 } from '../shared/app-settings'
import { resolveDeepseekExecutable } from './resolve-deepseek-binary'

type DeepseekCommand = {
  args: string[]
  stdin?: string
}

const DEEPSEEK_CONFIG_COMMAND_TIMEOUT_MS = 15_000

function deepseekConfigFieldsChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = prev.agents.codewhale
  const b = next.agents.codewhale
  return (
    a.apiKey !== b.apiKey ||
    a.baseUrl !== b.baseUrl ||
    a.approvalPolicy !== b.approvalPolicy ||
    a.sandboxMode !== b.sandboxMode
  )
}

async function resolveConfigBinary(userBinaryPath: string): Promise<string> {
  const preferred = userBinaryPath.trim()
  if (preferred) {
    try {
      return await resolveDeepseekExecutable(preferred)
    } catch {
      // Fall back to the managed binary so partially edited custom paths do not
      // block config sync while the user is typing in Settings.
    }
  }
  return resolveDeepseekExecutable('')
}

async function runDeepseekCommand(bin: string, command: DeepseekCommand): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, command.args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        proc.kill()
        reject(
          new Error(
            `deepseek ${command.args.join(' ')} timed out after ${DEEPSEEK_CONFIG_COMMAND_TIMEOUT_MS}ms`
          )
        )
      })
    }, DEEPSEEK_CONFIG_COMMAND_TIMEOUT_MS)

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    proc.once('error', (error) => finish(() => reject(error)))
    proc.once('exit', (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve()
          return
        }
        const detail = stderr.trim() || stdout.trim() || `signal ${signal ?? 'null'}`
        reject(new Error(`deepseek ${command.args.join(' ')} failed: ${detail}`))
      })
    })

    proc.stdin.end(command.stdin ?? '')
  })
}

export function deepseekTuiConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return deepseekConfigFieldsChanged(prev, next)
}

export async function syncDeepseekTuiConfig(
  settings: AppSettingsV1,
  previous?: AppSettingsV1
): Promise<void> {
  if (previous && !deepseekConfigFieldsChanged(previous, settings)) return

  const commands: DeepseekCommand[] = [{ args: ['config', 'set', 'provider', 'deepseek'] }]
  const current = getActiveAgentRuntimeSettings(settings)
  const prev = previous ? getActiveAgentRuntimeSettings(previous) : undefined

  if (!prev || prev.approvalPolicy !== current.approvalPolicy) {
    commands.push({
      args: ['config', 'set', 'approval_policy', current.approvalPolicy]
    })
  }

  if (!prev || prev.sandboxMode !== current.sandboxMode) {
    commands.push({
      args: ['config', 'set', 'sandbox_mode', current.sandboxMode]
    })
  }

  if (!prev || prev.baseUrl !== current.baseUrl) {
    const baseUrl = current.baseUrl.trim()
    commands.push(
      baseUrl
        ? { args: ['config', 'set', 'base_url', baseUrl] }
        : { args: ['config', 'unset', 'base_url'] }
    )
  }

  if (!prev || prev.apiKey !== current.apiKey) {
    const apiKey = current.apiKey.trim()
    if (apiKey) {
      commands.push({
        args: ['auth', 'set', '--provider', 'deepseek', '--api-key-stdin'],
        stdin: `${apiKey}\n`
      })
    } else {
      commands.push({ args: ['auth', 'clear', '--provider', 'deepseek'] })
      commands.push({ args: ['config', 'unset', 'auth_mode'] })
    }
  }

  if (commands.length === 0) return

  const bin = await resolveConfigBinary(getActiveAgentRuntimeSettings(settings).binaryPath)
  for (const command of commands) {
    await runDeepseekCommand(bin, command)
  }
}
