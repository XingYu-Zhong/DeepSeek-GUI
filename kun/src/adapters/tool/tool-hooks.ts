import { spawn } from 'node:child_process'
import type { ToolCallLike, ToolHostContext } from '../../ports/tool-host.js'
import { terminateSpawnTree } from './builtin-tool-utils.js'

export type ToolHookPhase = 'PreToolUse' | 'PostToolUse'

export type ToolHookInvocation = {
  phase: ToolHookPhase
  call: ToolCallLike
  context: Pick<ToolHostContext, 'threadId' | 'turnId' | 'workspace' | 'threadMode' | 'approvalPolicy'>
  result?: {
    output: unknown
    isError?: boolean
  }
}

export type ToolHookResult = {
  decision?: 'allow' | 'deny'
  message?: string
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
}

export type ResolvedToolHook =
  | {
      phase: ToolHookPhase
      toolNames?: readonly string[]
      timeoutMs?: number
      run: (invocation: ToolHookInvocation) => Promise<ToolHookResult | void> | ToolHookResult | void
    }
  | {
      phase: ToolHookPhase
      toolNames?: readonly string[]
      timeoutMs?: number
      command: string
      cwd?: string
    }

export async function runToolHooks(input: {
  hooks: readonly ResolvedToolHook[]
  invocation: ToolHookInvocation
}): Promise<ToolHookResult[]> {
  const matching = input.hooks.filter((hook) => hook.phase === input.invocation.phase && hookMatchesTool(hook, input.invocation.call.toolName))
  const results: ToolHookResult[] = []
  for (const hook of matching) {
    const result = 'run' in hook
      ? await runFunctionHook(hook, input.invocation)
      : await runCommandHook(hook, input.invocation)
    if (result) results.push(result)
  }
  return results
}

export function applyPreToolHookResults(
  call: ToolCallLike,
  results: readonly ToolHookResult[]
): { call: ToolCallLike; denied?: string } {
  let next = call
  for (const result of results) {
    if (result.decision === 'deny') {
      return { call: next, denied: result.message || 'tool call denied by PreToolUse hook' }
    }
    if (result.arguments && typeof result.arguments === 'object') {
      next = { ...next, arguments: result.arguments }
    }
  }
  return { call: next }
}

export function applyPostToolHookResults(
  result: { output: unknown; isError?: boolean },
  results: readonly ToolHookResult[]
): { output: unknown; isError?: boolean } {
  let next = result
  for (const hookResult of results) {
    if ('output' in hookResult) {
      next = {
        output: hookResult.output,
        isError: hookResult.isError ?? next.isError
      }
    } else if (hookResult.isError !== undefined) {
      next = { ...next, isError: hookResult.isError }
    }
  }
  return next
}

function hookMatchesTool(hook: Pick<ResolvedToolHook, 'toolNames'>, toolName: string): boolean {
  if (!hook.toolNames || hook.toolNames.length === 0) return true
  return hook.toolNames.includes(toolName)
}

async function runFunctionHook(
  hook: Extract<ResolvedToolHook, { run: unknown }>,
  invocation: ToolHookInvocation
): Promise<ToolHookResult | void> {
  return withTimeout(
    Promise.resolve(hook.run(invocation)),
    hook.timeoutMs ?? 5_000,
    `${hook.phase} hook timed out`
  )
}

async function runCommandHook(
  hook: Extract<ResolvedToolHook, { command: string }>,
  invocation: ToolHookInvocation
): Promise<ToolHookResult | void> {
  const payload = JSON.stringify(invocation)
  const child = spawn(hook.command, {
    cwd: hook.cwd || invocation.context.workspace || undefined,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin.end(payload)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const exitCode = await withTimeout(
    new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0))
    }),
    hook.timeoutMs ?? 5_000,
    `${hook.phase} command hook timed out`
  ).catch((error) => {
    terminateSpawnTree(child)
    throw error
  })
  if (exitCode !== 0) {
    return {
      decision: hook.phase === 'PreToolUse' ? 'deny' : undefined,
      isError: hook.phase === 'PostToolUse' ? true : undefined,
      message: stderr.trim() || `${hook.phase} command hook exited with ${exitCode}`
    }
  }
  const text = stdout.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text) as ToolHookResult
  } catch {
    return { message: text }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs))
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
