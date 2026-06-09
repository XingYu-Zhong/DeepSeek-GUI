import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import {
  CREATE_PLAN_INPUT_SCHEMA,
  CREATE_PLAN_TOOL_NAME,
  createCreatePlanTool,
  executeCreatePlanTool,
  isPlanToolContextActive
} from '../src/adapters/tool/create-plan-tool.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/ws',
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

function buildGuiPlan(relativePath = '.kunsdd/plan/login.md', operation: 'draft' | 'refine' = 'draft') {
  return {
    operation,
    workspaceRoot: '/tmp/ws',
    relativePath,
    planId: `plan_${operation}`
  }
}

describe('create_plan tool: advertisement', () => {
  it('advertises when a GUI plan context is present', () => {
    expect(
      isPlanToolContextActive(
        buildContext({
          threadMode: 'agent',
          guiPlan: buildGuiPlan()
        })
      )
    ).toBe(true)
  })

  it('advertises for plan-mode threads even without an explicit GUI plan context', () => {
    expect(isPlanToolContextActive(buildContext({ threadMode: 'plan' }))).toBe(true)
  })

  it('does not advertise for normal agent turns', () => {
    expect(isPlanToolContextActive(buildContext({ threadMode: 'agent' }))).toBe(false)
    expect(isPlanToolContextActive(undefined)).toBe(false)
  })

  it('omits create_plan from the local tool list during normal agent turns', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(buildContext({ threadMode: 'agent' }))
    expect(tools.map((t) => t.name)).not.toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('includes create_plan in the local tool list during plan turns', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan()
      })
    )
    expect(tools.map((t) => t.name)).toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('includes create_plan during plan turns without a GUI plan context', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    const tools = await host.listTools(buildContext({ threadMode: 'plan' }))
    expect(tools.map((t) => t.name)).toContain(CREATE_PLAN_TOOL_NAME)
  })
})

describe('create_plan tool: path validation', () => {
  it('rejects nested relative paths', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# nested',
        operation: 'draft',
        plan_relative_path: '.kunsdd/plan/nested/a.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/nested/a.md')
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/direct Markdown file/)
  })

  it('rejects traversal relative paths', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# escape',
        operation: 'draft',
        plan_relative_path: '../escape.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('../escape.md')
      })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects non-Markdown extensions', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# not md',
        operation: 'draft',
        plan_relative_path: '.kunsdd/plan/login.txt'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/login.txt')
      })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects an explicit plan_relative_path that differs from the reserved GUI plan path', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# mismatch',
        operation: 'refine',
        plan_relative_path: '.kunsdd/plan/other.md'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: {
          operation: 'refine',
          workspaceRoot: '/tmp/ws',
          relativePath: '.kunsdd/plan/login.md',
          planId: 'plan_login'
        }
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/does not match the reserved/)
  })

  it('rejects an operation that differs from the active GUI plan operation', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# mismatch',
        operation: 'draft'
      },
      buildContext({
        threadMode: 'plan',
        guiPlan: buildGuiPlan('.kunsdd/plan/login.md', 'refine')
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/operation does not match/)
  })
})

describe('create_plan tool: execution safety', () => {
  it('allows a free-form plan-mode call without a GUI plan context and self-allocates a path', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# allowed', operation: 'draft', title: 'disk cleanup' },
      buildContext({ threadMode: 'plan', workspace: '/tmp/ws' }),
      {
        listPlanFiles: () => [],
        writePlan: async (target) => ({ path: target.absolutePath, savedAt: 'now' })
      }
    )
    expect(result.isError).toBeFalsy()
    expect((result.output as { relative_path: string }).relative_path).toBe(
      '.kunsdd/plan/disk-cleanup.md'
    )
  })

  it('rejects a forged call when the active turn is not in plan mode', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# forged', operation: 'draft' },
      buildContext({ threadMode: 'agent' })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects a free-form legacy plan path as a new target', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# legacy',
        operation: 'draft',
        plan_relative_path: '.deepseekgui/plan/legacy.md'
      },
      buildContext({ threadMode: 'plan', workspace: '/tmp/ws' })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/\.kunsdd\/plan/)
  })

  it('rejects when the model tries to execute create_plan on a normal turn through the tool host', async () => {
    const host = new LocalToolHost({ tools: [createCreatePlanTool()] })
    await expect(
      host.execute(
        { callId: 'call_1', toolName: CREATE_PLAN_TOOL_NAME, arguments: { operation: 'draft', markdown: '# hi' } },
        buildContext({ threadMode: 'agent' })
      )
    ).rejects.toThrow(/not advertised/)
  })

  it('rejects when the workspace advertised in the GUI plan context does not match the active turn', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# hi', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace: '/tmp/other',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/tmp/ws',
          relativePath: '.kunsdd/plan/login.md',
          planId: 'plan_login'
        }
      })
    )
    expect(result.isError).toBe(true)
  })
})

describe('create_plan tool: success and atomic write', () => {
  let workspace: string
  let previousMarkdown = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-plan-'))
    previousMarkdown = '# previous plan\n'
    await mkdir(join(workspace, '.deepseekgui/plan'), { recursive: true })
    await writeFile(join(workspace, '.deepseekgui/plan/login.md'), previousMarkdown, 'utf8')
    await mkdir(join(workspace, '.kunsdd/plan'), { recursive: true })
    await writeFile(join(workspace, '.kunsdd/plan/login.md'), previousMarkdown, 'utf8')
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes a fresh plan to the reserved path and returns structured metadata', async () => {
    const result = await executeCreatePlanTool(
      {
        markdown: '# Login plan\n\n- step 1',
        operation: 'draft',
        title: 'Login flow',
        source_request: 'Add login'
      },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.kunsdd/plan/login.md',
          planId: `${workspace}:.kunsdd/plan/login.md`,
          sourceRequest: 'Add login',
          title: 'Login flow'
        }
      })
    )
    expect(result.isError).toBeFalsy()
    const output = result.output as {
      plan_id: string
      relative_path: string
      absolute_path: string
      operation: string
      summary: string
      content_hash: string
      byte_size: number
      saved_at: string
    }
    expect(output.relative_path).toBe('.kunsdd/plan/login.md')
    expect(output.operation).toBe('draft')
    expect(output.summary).toContain('.kunsdd/plan/login.md')
    expect(output.content_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(output.byte_size).toBe(Buffer.byteLength('# Login plan\n\n- step 1', 'utf8'))
    expect(output.absolute_path).toBe(join(workspace, '.kunsdd/plan/login.md'))
    const persisted = await readFile(output.absolute_path, 'utf8')
    expect(persisted).toBe('# Login plan\n\n- step 1')
  })

  it('rejects a legacy reserved path when drafting a new plan', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# legacy draft', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.deepseekgui/plan/login.md',
          planId: `${workspace}:.deepseekgui/plan/login.md`
        }
      })
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.output)).toMatch(/legacy/)
  })

  it('overwrites an existing plan when the same reserved path is reused', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# refined', operation: 'refine' },
      buildContext({
        threadMode: 'plan',
        workspace,
        guiPlan: {
          operation: 'refine',
          workspaceRoot: workspace,
          relativePath: '.deepseekgui/plan/login.md',
          planId: `${workspace}:.deepseekgui/plan/login.md`
        }
      })
    )
    expect(result.isError).toBeFalsy()
    const persisted = await readFile(join(workspace, '.deepseekgui/plan/login.md'), 'utf8')
    expect(persisted).toBe('# refined')
  })

  it('self-allocates a non-colliding path when plan mode has no reserved context', async () => {
    const result = await executeCreatePlanTool(
      { markdown: '# fresh', operation: 'draft', title: 'login' },
      buildContext({ threadMode: 'plan', workspace })
    )
    expect(result.isError).toBeFalsy()
    const output = result.output as { relative_path: string; absolute_path: string }
    // `.kunsdd/plan/login.md` already exists in this workspace.
    expect(output.relative_path).toBe('.kunsdd/plan/login-2.md')
    const persisted = await readFile(output.absolute_path, 'utf8')
    expect(persisted).toBe('# fresh')
  })

  it('leaves the previous plan untouched when the abort signal fires before rename', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await executeCreatePlanTool(
      { markdown: '# new', operation: 'draft' },
      buildContext({
        threadMode: 'plan',
        workspace,
        abortSignal: controller.signal,
        guiPlan: {
          operation: 'draft',
          workspaceRoot: workspace,
          relativePath: '.kunsdd/plan/login.md',
          planId: `${workspace}:.kunsdd/plan/login.md`
        }
      })
    )
    expect(result.isError).toBe(true)
    const persisted = await readFile(join(workspace, '.kunsdd/plan/login.md'), 'utf8')
    expect(persisted).toBe(previousMarkdown)
  })
})

describe('create_plan tool: schema surface', () => {
  it('exposes a stable JSON schema with required fields', () => {
    expect(CREATE_PLAN_INPUT_SCHEMA.type).toBe('object')
    expect((CREATE_PLAN_INPUT_SCHEMA as { required: string[] }).required).toEqual(
      expect.arrayContaining(['markdown', 'operation'])
    )
    const properties = (CREATE_PLAN_INPUT_SCHEMA as { properties: Record<string, { type?: string; enum?: string[] }> }).properties
    expect(properties.operation.enum).toEqual(['draft', 'refine'])
    expect(properties.markdown.type).toBe('string')
  })
})
