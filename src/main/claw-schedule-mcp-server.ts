import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

type McpLaunchOptions = {
  baseUrl: string
  secret: string
}

function parseArgValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

function parseLaunchOptions(argv: string[]): McpLaunchOptions | null {
  if (!argv.includes('--gui-schedule-mcp-server') && !argv.includes('--claw-schedule-mcp-server')) return null
  const baseUrl = parseArgValue(argv, '--base-url').trim() || 'http://127.0.0.1:8787'
  const secret = parseArgValue(argv, '--secret').trim()
  return { baseUrl, secret }
}

async function postJson(
  options: McpLaunchOptions,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.secret) {
    headers.Authorization = `Bearer ${options.secret}`
  }
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = { message: text.trim() || `HTTP ${response.status}` }
  }
  if (!response.ok) {
    const message =
      (typeof parsed.message === 'string' && parsed.message.trim()) ||
      (typeof parsed.error === 'string' && parsed.error.trim()) ||
      `HTTP ${response.status}`
    throw new Error(message)
  }
  return parsed
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}

export async function runClawScheduleMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const options = parseLaunchOptions(argv)
  if (!options) return false

  const server = new McpServer(
    { name: 'deepseek-gui-schedule', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  const registerListTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. List scheduled tasks managed by the currently running DeepSeek GUI app.'
        : 'List scheduled tasks managed by the currently running DeepSeek GUI app.'
    }, async () => {
      try {
        const result = await postJson(options, '/schedule/internal/list', {})
        const tasks = Array.isArray(result.tasks) ? result.tasks : []
        return textResult(
          tasks.length
            ? `Found ${tasks.length} scheduled task(s).`
            : 'No scheduled tasks are configured.',
          { tasks }
        )
      } catch (error) {
        return errorResult(`Failed to list scheduled tasks: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  registerListTool('claw_schedule_list')
  registerListTool('gui_schedule_list')

  const registerCreateTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Create a scheduled task in DeepSeek GUI. Supports one-time (`at`), daily, or interval schedules.'
        : 'Create a scheduled task in DeepSeek GUI. Supports one-time (`at`), daily, or interval schedules.',
      inputSchema: {
        title: z.string().min(1).describe('Short task title shown in the GUI'),
        prompt: z.string().min(1).describe('The prompt/instruction the agent should run at schedule time'),
        schedule_kind: z.enum(['at', 'daily', 'interval']).describe('Schedule type'),
        at_time: z.string().optional().describe('ISO 8601 timestamp with timezone offset, required when schedule_kind is `at`'),
        time_of_day: z.string().optional().describe('24h time like 09:00, required when schedule_kind is `daily`'),
        every_minutes: z.number().int().min(1).max(10080).optional().describe('Interval in minutes, required when schedule_kind is `interval`'),
        workspace_root: z.string().optional().describe('Optional workspace directory override'),
        model: z.string().optional().describe('Optional model id, e.g. auto / deepseek-v4-pro / deepseek-v4-flash'),
        reasoning_effort: z.enum(['off', 'low', 'medium', 'high', 'max']).optional().describe('Optional reasoning strength'),
        mode: z.enum(['agent', 'plan']).optional().describe('Execution mode'),
        enabled: z.boolean().optional().describe('Whether the task should be enabled immediately')
      }
    }, async (args) => {
      try {
        const result = await postJson(options, '/schedule/internal/create', {
          input: {
            title: args.title,
            prompt: args.prompt,
            workspaceRoot: args.workspace_root,
            model: args.model,
            reasoningEffort: args.reasoning_effort,
            mode: args.mode,
            enabled: args.enabled,
            schedule: {
              kind: args.schedule_kind,
              atTime: args.at_time,
              timeOfDay: args.time_of_day,
              everyMinutes: args.every_minutes
            }
          }
        })
        const task = (result.task ?? null) as Record<string, unknown> | null
        return textResult(
          `Scheduled task created: ${typeof task?.title === 'string' ? task.title : args.title}`,
          task ? { task } : undefined
        )
      } catch (error) {
        return errorResult(`Failed to create scheduled task: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  registerCreateTool('claw_schedule_create')
  registerCreateTool('gui_schedule_create')

  const registerUpdateTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Update an existing DeepSeek GUI scheduled task.'
        : 'Update an existing DeepSeek GUI scheduled task.',
      inputSchema: {
        task_id: z.string().min(1).describe('Task id returned by gui_schedule_list or gui_schedule_create'),
        title: z.string().optional(),
        prompt: z.string().optional(),
        enabled: z.boolean().optional(),
        workspace_root: z.string().optional(),
        model: z.string().optional(),
        reasoning_effort: z.enum(['off', 'low', 'medium', 'high', 'max']).optional(),
        mode: z.enum(['agent', 'plan']).optional(),
        schedule_kind: z.enum(['manual', 'at', 'daily', 'interval']).optional(),
        at_time: z.string().optional(),
        time_of_day: z.string().optional(),
        every_minutes: z.number().int().min(1).max(10080).optional()
      }
    }, async (args) => {
      try {
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = args.title
        if (args.prompt !== undefined) patch.prompt = args.prompt
        if (args.enabled !== undefined) patch.enabled = args.enabled
        if (args.workspace_root !== undefined) patch.workspaceRoot = args.workspace_root
        if (args.model !== undefined) patch.model = args.model
        if (args.reasoning_effort !== undefined) patch.reasoningEffort = args.reasoning_effort
        if (args.mode !== undefined) patch.mode = args.mode
        if (
          args.schedule_kind !== undefined ||
          args.at_time !== undefined ||
          args.time_of_day !== undefined ||
          args.every_minutes !== undefined
        ) {
          patch.schedule = {
            ...(args.schedule_kind !== undefined ? { kind: args.schedule_kind } : {}),
            ...(args.at_time !== undefined ? { atTime: args.at_time } : {}),
            ...(args.time_of_day !== undefined ? { timeOfDay: args.time_of_day } : {}),
            ...(args.every_minutes !== undefined ? { everyMinutes: args.every_minutes } : {})
          }
        }
        const result = await postJson(options, '/schedule/internal/update', {
          taskId: args.task_id,
          patch
        })
        const task = (result.task ?? null) as Record<string, unknown> | null
        return textResult(
          `Scheduled task updated: ${typeof task?.title === 'string' ? task.title : args.task_id}`,
          task ? { task } : undefined
        )
      } catch (error) {
        return errorResult(`Failed to update scheduled task: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  registerUpdateTool('claw_schedule_update')
  registerUpdateTool('gui_schedule_update')

  const registerDeleteTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Delete a scheduled task from DeepSeek GUI.'
        : 'Delete a scheduled task from DeepSeek GUI.',
      inputSchema: {
        task_id: z.string().min(1).describe('Task id returned by gui_schedule_list or gui_schedule_create')
      }
    }, async ({ task_id }) => {
      try {
        await postJson(options, '/schedule/internal/delete', { taskId: task_id })
        return textResult(`Scheduled task deleted: ${task_id}`)
      } catch (error) {
        return errorResult(`Failed to delete scheduled task: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  registerDeleteTool('claw_schedule_delete')
  registerDeleteTool('gui_schedule_delete')

  // The `gui_plan_create` MCP tool has been retired in favour of the
  // native Kun `create_plan` tool. See RETIRED_CLAW_GUI_PLAN_TOOL_NAMES
  // for the list of removed tool names.

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}

/**
 * List of MCP tool names that used to act as the GUI plan bridge. The
 * names are kept here as a single source of truth for migration
 * scripts; the actual tools are no longer registered.
 */
export const RETIRED_CLAW_GUI_PLAN_TOOL_NAMES: readonly string[] = ['gui_plan_create'] as const
