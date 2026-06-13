import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalToolHost, defaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import {
  allBuiltinToolNames,
  allToolNames,
  buildCodingBuiltinLocalTools,
  buildBuiltinLocalToolRecord,
  buildReadOnlyBuiltinLocalTools,
  createBashTool,
  createBashToolDefinition,
  createToolDefinition,
  createAllToolDefinitions,
  createAllTools,
  createEditTool,
  createEditToolDefinition,
  createFindTool,
  createFindToolDefinition,
  createGrepTool,
  createGrepToolDefinition,
  createLocalBashOperations,
  defaultFindLocalToolOperations,
  defaultGrepLocalToolOperations,
  defaultReadLocalToolOperations,
  defaultWriteLocalToolOperations,
  defaultEditLocalToolOperations,
  defaultLsLocalToolOperations,
  createBashLocalTool,
  createCodingToolDefinitions,
  createCodingTools,
  createFindLocalTool,
  createGrepLocalTool,
  createReadLocalTool,
  createReadTool,
  createReadToolDefinition,
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createTool,
  createWriteTool,
  createWriteToolDefinition,
  createLsTool,
  createLsToolDefinition
} from '../src/adapters/tool/builtin-tools.js'
import { createReadTool as createReadToolFromModule } from '../src/adapters/tool/read.js'
import { createBashTool as createBashToolFromModule } from '../src/adapters/tool/bash.js'
import { createEditTool as createEditToolFromModule } from '../src/adapters/tool/edit.js'
import { createFindTool as createFindToolFromModule } from '../src/adapters/tool/find.js'
import { createGrepTool as createGrepToolFromModule } from '../src/adapters/tool/grep.js'
import { createLsTool as createLsToolFromModule } from '../src/adapters/tool/ls.js'
import { createWriteTool as createWriteToolFromModule } from '../src/adapters/tool/write.js'
import { computeEditDiff } from '../src/adapters/tool/edit-diff.js'
import { withFileMutationQueue } from '../src/adapters/tool/file-mutation-queue.js'
import { DEFAULT_MAX_BYTES } from '../src/adapters/tool/truncate.js'
import type { TurnItem } from '../src/contracts/items.js'
import type { FsStats } from '../src/adapters/tool/builtin-tool-types.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(workspace: string, overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

async function executeTool(
  host: LocalToolHost,
  workspace: string,
  toolName: string,
  args: Record<string, unknown>
) {
  const result = await host.execute(
    {
      callId: `call_${toolName}`,
      toolName,
      arguments: args
    },
    buildContext(workspace)
  )
  expect(result.item.kind).toBe('tool_result')
  if (result.item.kind !== 'tool_result') {
    throw new Error('expected tool_result')
  }
  return result.item.output as Record<string, unknown>
}

describe('Kun built-in tools', () => {
  let workspace: string
  let host: LocalToolHost

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-tools-'))
    host = new LocalToolHost({ tools: defaultLocalTools })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('advertises the pi-style built-in tool family by default', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const toolNames = new Set(tools.map((tool) => tool.name))
    expect([...allBuiltinToolNames].every((name) => toolNames.has(name))).toBe(true)
  })

  it('converts a throwing tool execute into an error tool result instead of failing the turn', async () => {
    const explosive = LocalToolHost.defineTool({
      name: 'explode',
      description: 'always throws',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => {
        throw new Error('MCP error -32603: Validation Error: Validation Failed')
      }
    })
    const throwingHost = new LocalToolHost({ tools: [explosive] })

    const result = await throwingHost.execute(
      { callId: 'call_explode', toolName: 'explode', arguments: {} },
      buildContext(workspace)
    )

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(result.item.isError).toBe(true)
    expect(result.item.output).toMatchObject({
      code: 'tool_execution_failed',
      error: expect.stringContaining('-32603')
    })
  })

  it('still propagates aborts raised while a tool executes', async () => {
    const abortController = new AbortController()
    const abortingTool = LocalToolHost.defineTool({
      name: 'abort_self',
      description: 'aborts mid-flight',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => {
        abortController.abort()
        throw new Error('aborted mid tool')
      }
    })
    const abortHost = new LocalToolHost({ tools: [abortingTool] })

    await expect(
      abortHost.execute(
        { callId: 'call_abort', toolName: 'abort_self', arguments: {} },
        buildContext(workspace, { abortSignal: abortController.signal })
      )
    ).rejects.toThrow('aborted mid tool')
  })

  it('hides mutating and shell tools in read-only sandbox mode', async () => {
    const tools = await host.listTools(buildContext(workspace, { sandboxMode: 'read-only' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls']))
    expect(names).not.toContain('bash')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('write')
  })

  it('allows file tools but hides host shell commands in workspace-write sandbox mode', async () => {
    const tools = await host.listTools(buildContext(workspace, { sandboxMode: 'workspace-write' }))
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'edit', 'write']))
    expect(names).not.toContain('bash')
  })

  it('blocks direct file writes in read-only sandbox mode', async () => {
    const result = await host.execute(
      {
        callId: 'call_write',
        toolName: 'write',
        arguments: { path: 'blocked.md', content: 'nope' }
      },
      buildContext(workspace, { sandboxMode: 'read-only' })
    )

    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'write',
      isError: true,
      output: {
        code: 'sandbox_read_only'
      }
    })
    await expect(readFile(join(workspace, 'blocked.md'), 'utf8')).rejects.toThrow()
  })

  it('answers truncated tool arguments with actionable chunking guidance', async () => {
    // tool-argument-repair wraps unparseable JSON (usually cut off by the
    // model output limit mid-payload) as { __raw }.
    const truncated = '{"content": "<!DOCTYPE html><html><body>cut off mid stri'
    const writeResult = await host.execute(
      {
        callId: 'call_write_raw',
        toolName: 'write',
        arguments: { __raw: truncated }
      },
      buildContext(workspace)
    )
    expect(writeResult.item).toMatchObject({ kind: 'tool_result', isError: true })
    const writeError = String((writeResult.item as { output?: { error?: string } }).output?.error)
    expect(writeError).toContain('truncated')
    expect(writeError).toContain('smaller')

    const editResult = await host.execute(
      {
        callId: 'call_edit_raw',
        toolName: 'edit',
        arguments: { __raw: truncated }
      },
      buildContext(workspace)
    )
    expect(editResult.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(String((editResult.item as { output?: { error?: string } }).output?.error)).toContain('truncated')
  })

  it('blocks host shell execution in workspace-write sandbox mode', async () => {
    const result = await host.execute(
      {
        callId: 'call_bash',
        toolName: 'bash',
        arguments: { command: 'echo hello' }
      },
      buildContext(workspace, { sandboxMode: 'workspace-write' })
    )

    expect(result.approved).toBe(false)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'bash',
      isError: true,
      output: {
        code: 'sandbox_command_blocked'
      }
    })
  })

  it('advertises structured GUI input choices and normalizes single-question options', async () => {
    const tools = await host.listTools(
      buildContext(workspace, { awaitUserInput: async () => ({ status: 'cancelled' }) })
    )
    const requestInputTool = tools.find((tool) => tool.name === 'request_user_input')
    expect(requestInputTool?.inputSchema).toMatchObject({
      properties: {
        options: { type: 'array' },
        questions: { type: 'array' }
      }
    })

    const seenInputs: Array<{ questions: Array<{ options: Array<{ label: string; description: string }> }> }> = []
    const result = await host.execute(
      {
        callId: 'call_input',
        toolName: 'request_user_input',
        arguments: {
          prompt: 'Pick a direction',
          question: 'North or south?',
          options: ['South', { label: 'North', description: 'Cooler weather' }]
        }
      },
      {
        ...buildContext(workspace),
        awaitUserInput: async (input) => {
          seenInputs.push(input)
          return {
            status: 'submitted',
            answers: [{ id: input.questions[0]?.id ?? 'choice', label: 'South', value: 'South' }]
          }
        }
      }
    )

    expect(seenInputs[0]?.questions[0]?.options).toEqual([
      { label: 'South', description: '' },
      { label: 'North', description: 'Cooler weather' }
    ])
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'request_user_input',
      isError: false
    })
  })

  it('hides GUI input tools when the turn context has no user-input gate', async () => {
    const tools = await host.listTools(buildContext(workspace))
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain('user_input')
    expect(names).not.toContain('request_user_input')
  })

  it('exposes pi-style coding and read-only tool groups', () => {
    expect(buildCodingBuiltinLocalTools().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(buildReadOnlyBuiltinLocalTools().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('supports pi-style configurable built-in tool factory APIs', async () => {
    const toolRecord = buildBuiltinLocalToolRecord({
      read: { maxLines: 1 },
      grep: { defaultLimit: 1 },
      find: { defaultLimit: 1 },
      ls: { defaultLimit: 1 },
      bash: { defaultTimeoutSeconds: 5 }
    })
    expect(Object.keys(toolRecord).sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'])

    await writeFile(join(workspace, 'limited.txt'), 'one\ntwo\nthree\n', 'utf8')
    const customHost = new LocalToolHost({ tools: [toolRecord.read, toolRecord.ls] })
    const readOutput = await executeTool(customHost, workspace, 'read', { path: 'limited.txt' })
    expect(String(readOutput.content)).toContain('Use offset=2 to continue')
  })

  it('exposes pi-style alias composition helpers and tool-name set', async () => {
    expect(allToolNames).toBe(allBuiltinToolNames)
    expect(defaultReadLocalToolOperations.readFile).toBeTypeOf('function')
    expect(defaultWriteLocalToolOperations.writeFile).toBeTypeOf('function')
    expect(defaultEditLocalToolOperations.readFile).toBeTypeOf('function')
    expect(defaultFindLocalToolOperations).toEqual({})
    expect(defaultGrepLocalToolOperations).toEqual({})
    expect(defaultLsLocalToolOperations.readdir).toBeTypeOf('function')
    expect(createCodingTools().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(createReadOnlyTools().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls'])
    expect(createCodingToolDefinitions().map((tool) => tool.name)).toEqual(['read', 'bash', 'edit', 'write'])
    expect(createReadOnlyToolDefinitions().map((tool) => tool.name)).toEqual(['read', 'grep', 'find', 'ls'])
    const allTools = createAllTools()
    const allDefinitions = createAllToolDefinitions()
    expect(Object.keys(allTools).sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'])
    expect(Object.keys(allDefinitions).sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'])
    expect(createReadTool).toBe(createReadLocalTool)
    expect(createReadToolDefinition).toBe(createReadLocalTool)
    expect(createWriteTool).toBeTypeOf('function')
    expect(createWriteToolDefinition).toBeTypeOf('function')
    expect(createEditTool).toBeTypeOf('function')
    expect(createEditToolDefinition).toBeTypeOf('function')
    expect(createFindTool).toBeTypeOf('function')
    expect(createFindToolDefinition).toBeTypeOf('function')
    expect(createGrepTool).toBeTypeOf('function')
    expect(createGrepToolDefinition).toBeTypeOf('function')
    expect(createLsTool).toBeTypeOf('function')
    expect(createLsToolDefinition).toBeTypeOf('function')
    expect(createBashTool).toBeTypeOf('function')
    expect(createBashToolDefinition).toBeTypeOf('function')
    expect(createReadToolFromModule).toBe(createReadTool)
    expect(createBashToolFromModule).toBe(createBashTool)
    expect(createEditToolFromModule).toBe(createEditTool)
    expect(createFindToolFromModule).toBe(createFindTool)
    expect(createGrepToolFromModule).toBe(createGrepTool)
    expect(createLsToolFromModule).toBe(createLsTool)
    expect(createWriteToolFromModule).toBe(createWriteTool)

    const singleToolHost = new LocalToolHost({
      tools: [
        createTool('read', { read: { maxLines: 1 } }),
        createToolDefinition('ls', { ls: { defaultLimit: 1 } })
      ]
    })
    await writeFile(join(workspace, 'alias.txt'), 'a\nb\n', 'utf8')
    const output = await executeTool(singleToolHost, workspace, 'read', { path: 'alias.txt' })
    expect(String(output.content)).toContain('Use offset=2 to continue')
  })

  it('supports injected backend operations like pi tool factories', async () => {
    const customRead = createReadLocalTool({
      operations: {
        stat: async (): Promise<FsStats> =>
          ({
            isDirectory: () => false
          } as FsStats),
        readFile: async () => Buffer.from('virtual file\n', 'utf8')
      }
    })
    const customFind = createFindLocalTool({
      operations: {
        glob: async () => [{ path: '/virtual/demo.ts', relative_path: 'demo.ts' }]
      }
    })
    const customGrep = createGrepLocalTool({
      operations: {
        search: async () => [
          {
            path: '/virtual/demo.ts',
            relative_path: 'demo.ts',
            line: 1,
            column: 1,
            text: 'needle'
          }
        ]
      }
    })
    const customBash = createBashLocalTool({
      operations: {
        exec: async (_command, _cwd, options) => {
          options.onData?.(Buffer.from('streamed from custom bash\n'))
          return { exitCode: 0 }
        }
      }
    })
    const customHost = new LocalToolHost({
      tools: [customRead, customFind, customGrep, customBash]
    })
    const readOutput = await executeTool(customHost, workspace, 'read', { path: 'virtual.txt' })
    expect(String(readOutput.content)).toContain('virtual file')
    const findOutput = await executeTool(customHost, workspace, 'find', { pattern: '*.ts' })
    expect(findOutput.backend).toBe('custom')
    const grepOutput = await executeTool(customHost, workspace, 'grep', { pattern: 'needle' })
    expect(grepOutput.backend).toBe('custom')
    const bashOutput = await executeTool(customHost, workspace, 'bash', { command: 'echo ignored' })
    expect(String(bashOutput.output)).toContain('streamed from custom bash')
  })

  it('exposes a reusable local bash backend constructor like pi', async () => {
    await writeFile(join(workspace, 'local-bash.txt'), 'hello local bash\n', 'utf8')
    const hostWithLocalBash = new LocalToolHost({
      tools: [
        createBashLocalTool({
          operations: createLocalBashOperations()
        })
      ]
    })
    const output = await executeTool(hostWithLocalBash, workspace, 'bash', {
      command: 'cat local-bash.txt'
    })
    expect(String(output.output)).toContain('hello local bash')
  })

  it('prefers the fd backend path when an fd executable candidate is provided', async () => {
    await mkdir(join(workspace, 'notes'), { recursive: true })
    await writeFile(join(workspace, 'notes', 'demo.txt'), 'demo\n', 'utf8')
    const fdHost = new LocalToolHost({
      tools: [
        createFindLocalTool({
          fdExecutableCandidates: ['/bin/echo'],
          rgExecutableCandidates: []
        })
      ]
    })
    const output = await executeTool(fdHost, workspace, 'find', {
      pattern: '*.txt',
      path: '.'
    })
    expect(output.backend).toBe('fd')
    expect(output.matches).toHaveLength(1)
  })

  it('writes, reads, edits, and searches workspace files', async () => {
    const writeOutput = await executeTool(host, workspace, 'write', {
      path: 'notes/demo.txt',
      content: 'alpha\nhello world\nsecond line\nomega\n'
    })
    expect(writeOutput.path).toBe(join(workspace, 'notes/demo.txt'))

    const disk = await readFile(join(workspace, 'notes/demo.txt'), 'utf8')
    expect(disk).toContain('hello world')

    const readOutput = await executeTool(host, workspace, 'read', {
      path: 'notes/demo.txt'
    })
    expect(readOutput).toMatchObject({
      path: join(workspace, 'notes/demo.txt'),
      relative_path: 'notes/demo.txt'
    })
    expect(String(readOutput.content)).toContain('hello world')

    const editOutput = await executeTool(host, workspace, 'edit', {
      path: 'notes/demo.txt',
      edits: [
        { oldText: 'hello world', newText: 'hello kun' },
        { oldText: 'omega', newText: 'done' }
      ]
    })
    expect(editOutput.replacements).toBe(2)

    const editedDisk = await readFile(join(workspace, 'notes/demo.txt'), 'utf8')
    expect(editedDisk).toContain('hello kun')
    expect(editedDisk).toContain('done')
    expect(String(editOutput.diff)).toContain('+2 hello kun')
    expect(String(editOutput.patch)).toContain('+++ b/notes/demo.txt')
    expect(typeof editOutput.first_changed_line === 'number' || editOutput.first_changed_line === undefined).toBe(true)

    const grepOutput = await executeTool(host, workspace, 'grep', {
      pattern: 'kun',
      path: '.',
      context: 1
    })
    expect(Array.isArray(grepOutput.matches)).toBe(true)
    expect((grepOutput.matches as Array<Record<string, unknown>>)[0]?.relative_path).toBe('notes/demo.txt')
    expect(Array.isArray((grepOutput.matches as Array<Record<string, unknown>>)[0]?.context_before)).toBe(true)
    expect(['rg', 'scan']).toContain(String(grepOutput.backend))

    const findOutput = await executeTool(host, workspace, 'find', {
      pattern: '**/*.txt',
      path: '.'
    })
    expect((findOutput.matches as Array<Record<string, unknown>>)[0]?.relative_path).toBe('notes/demo.txt')
    expect(['fd', 'rg', 'scan']).toContain(String(findOutput.backend))

    const lsOutput = await executeTool(host, workspace, 'ls', {
      path: 'notes'
    })
    expect((lsOutput.entries as Array<Record<string, unknown>>)[0]?.name).toBe('demo.txt')
    expect((lsOutput.names as Array<string>)[0]).toBe('demo.txt')
  })

  it('executes bash commands in the workspace', async () => {
    await writeFile(join(workspace, 'cmd.txt'), 'from bash\n', 'utf8')
    const output = await executeTool(host, workspace, 'bash', {
      command: 'cat cmd.txt'
    })
    expect(output.command).toBe('cat cmd.txt')
    expect(typeof output.shell).toBe('string')
    expect(String(output.output)).toContain('from bash')
    expect(output.truncation).toBe(null)
  })

  it('finishes bash commands after the shell exits even when a background child keeps stdio open', async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'sleep 5 & echo done',
      timeout: 2
    })

    expect(output.exit_code).toBe(0)
    expect(String(output.output)).toContain('done')
    expect(Date.now() - startedAt).toBeLessThan(1500)
  })

  it('returns a pollable bash session for foreground long-running commands', async () => {
    const startedAt = Date.now()
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 5',
      yield_seconds: 1,
      timeout: 10
    })

    expect(output.exit_code).toBe(null)
    expect(output.status).toBe('running')
    expect(typeof output.session_id).toBe('string')
    expect(String(output.output)).toContain('ready')
    expect(Date.now() - startedAt).toBeLessThan(2500)

    const stopped = await executeTool(host, workspace, 'bash', {
      action: 'stop',
      session_id: String(output.session_id)
    })
    expect(stopped.status).toBe('stopped')
    expect(stopped.stop_sent).toBe(true)
  })

  it('polls completed bash sessions for final output', async () => {
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 2; echo done',
      yield_seconds: 1,
      timeout: 10
    })

    expect(output.status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const polled = await executeTool(host, workspace, 'bash', {
      action: 'poll',
      session_id: String(output.session_id)
    })
    expect(polled.status).toBe('completed')
    expect(polled.exit_code).toBe(0)
    expect(String(polled.output)).toContain('done')
  })

  it('blocks the poll action for at least yield_seconds while the session keeps running', async () => {
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 5; echo done',
      yield_seconds: 1,
      timeout: 10
    })
    expect(output.status).toBe('running')

    const startedAt = Date.now()
    const polled = await executeTool(host, workspace, 'bash', {
      action: 'poll',
      session_id: String(output.session_id),
      yield_seconds: 2
    })
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeGreaterThanOrEqual(1800)
    expect(polled.status).toBe('running')

    await executeTool(host, workspace, 'bash', {
      action: 'stop',
      session_id: String(output.session_id)
    })
  })

  it('returns from poll early once the session exits before yield_seconds', async () => {
    const output = await executeTool(host, workspace, 'bash', {
      command: 'echo ready; sleep 1; echo done',
      yield_seconds: 1,
      timeout: 10
    })
    expect(output.status).toBe('running')

    const startedAt = Date.now()
    const polled = await executeTool(host, workspace, 'bash', {
      action: 'poll',
      session_id: String(output.session_id),
      yield_seconds: 10
    })
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeLessThan(3000)
    expect(polled.status).toBe('completed')
    expect(polled.exit_code).toBe(0)
    expect(String(polled.output)).toContain('done')
  })

  it('includes the active shell in bash partial updates', async () => {
    const updates: TurnItem[] = []
    const result = await host.execute(
      {
        callId: 'call_bash_partial',
        toolName: 'bash',
        arguments: {
          command: 'node -e "process.stdout.write(\'partial-shell\')"'
        }
      },
      buildContext(workspace),
      (item) => {
        updates.push(item)
      }
    )

    expect(result.item.kind).toBe('tool_result')
    const partial = updates.find((item) => item.kind === 'tool_result')
    expect(partial?.kind === 'tool_result' ? (partial.output as { shell?: string }).shell : undefined).toEqual(
      expect.any(String)
    )
  })

  it('rejects file paths outside the workspace root', async () => {
    const result = await host.execute(
      {
        callId: 'call_escape',
        toolName: 'read',
        arguments: { path: '../escape.txt' }
      },
      buildContext(workspace)
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'read',
      isError: true
    })
  })

  it('rejects ambiguous multi-match edits like pi edit does', async () => {
    await writeFile(join(workspace, 'ambiguous.txt'), 'same\nsame\n', 'utf8')
    const result = await host.execute(
      {
        callId: 'call_edit_ambiguous',
        toolName: 'edit',
        arguments: {
          path: 'ambiguous.txt',
          oldText: 'same',
          newText: 'different'
        }
      },
      buildContext(workspace)
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'edit',
      isError: true
    })
  })

  it('supports pi-style fuzzy text matching in edit', async () => {
    await writeFile(join(workspace, 'fuzzy.txt'), 'const title = “Hello World”;\n', 'utf8')
    const output = await executeTool(host, workspace, 'edit', {
      path: 'fuzzy.txt',
      oldText: 'const title = "Hello World";',
      newText: 'const title = "Hi";'
    })
    expect(output.replacements).toBe(1)
    const disk = await readFile(join(workspace, 'fuzzy.txt'), 'utf8')
    expect(disk).toContain('const title = "Hi";')
  })

  it('preserves original CRLF line endings when editing', async () => {
    await writeFile(join(workspace, 'windows.txt'), 'alpha\r\nbeta\r\n', 'utf8')
    await executeTool(host, workspace, 'edit', {
      path: 'windows.txt',
      oldText: 'beta',
      newText: 'gamma'
    })
    const disk = await readFile(join(workspace, 'windows.txt'), 'utf8')
    expect(disk).toContain('\r\n')
    expect(disk).toBe('alpha\r\ngamma\r\n')
  })

  it('reports pi-style read truncation hints for oversized first lines', async () => {
    const hugeLine = 'x'.repeat(DEFAULT_MAX_BYTES + 1024)
    await writeFile(join(workspace, 'huge.txt'), `${hugeLine}\nsecond line\n`, 'utf8')
    const output = await executeTool(host, workspace, 'read', {
      path: 'huge.txt'
    })
    expect(output.truncated).toBe(true)
    expect(output.first_line_exceeds_limit).toBe(true)
    expect(String(output.content)).toContain('first line exceeds')
  })

  it('adds continuation guidance for user-limited reads like pi read', async () => {
    await writeFile(join(workspace, 'paged.txt'), 'one\ntwo\nthree\nfour\n', 'utf8')
    const output = await executeTool(host, workspace, 'read', {
      path: 'paged.txt',
      offset: 2,
      limit: 2
    })
    expect(output.start_line).toBe(2)
    expect(String(output.content)).toContain('Use offset=4 to continue')
  })

  it('reads supported images with pi-style structured image metadata', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02
    ])
    await writeFile(join(workspace, 'tiny.png'), png)
    const output = await executeTool(host, workspace, 'read', {
      path: 'tiny.png'
    })
    expect(output.kind).toBe('image')
    expect(output.mime_type).toBe('image/png')
    expect(output.width).toBe(1)
    expect(output.height).toBe(2)
    expect(typeof output.data_base64).toBe('string')
    expect(String(output.note)).toContain('Read image file')
  })

  it('supports pi-style injected image resize handling for read', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x32
    ])
    await writeFile(join(workspace, 'resize.png'), png)
    const customRead = createReadLocalTool({
      autoResizeImages: true,
      operations: {
        resizeImage: async () => ({
          dataBase64: Buffer.from('tiny').toString('base64'),
          mimeType: 'image/png',
          width: 10,
          height: 5,
          originalWidth: 100,
          originalHeight: 50,
          wasResized: true
        })
      }
    })
    const customHost = new LocalToolHost({ tools: [customRead] })
    const output = await executeTool(customHost, workspace, 'read', { path: 'resize.png' })
    expect(output.resized).toBe(true)
    expect(output.width).toBe(10)
    expect(output.height).toBe(5)
    expect(String(output.note)).toContain('original 100x50')
  })

  it('reports omitted images when injected resize fails', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ])
    await writeFile(join(workspace, 'omit.png'), png)
    const customRead = createReadLocalTool({
      autoResizeImages: true,
      operations: {
        resizeImage: async () => null
      }
    })
    const customHost = new LocalToolHost({ tools: [customRead] })
    const output = await executeTool(customHost, workspace, 'read', { path: 'omit.png' })
    expect(String(output.note)).toContain('Image omitted')
    expect(output.data_base64).toBeUndefined()
  })

  it('classifies SKILL.md and AGENTS.md reads like pi resources', async () => {
    await mkdir(join(workspace, 'feature'), { recursive: true })
    await writeFile(join(workspace, 'feature', 'SKILL.md'), '# skill\n', 'utf8')
    await writeFile(join(workspace, 'AGENTS.md'), '# agents\n', 'utf8')
    const skillRead = await executeTool(host, workspace, 'read', {
      path: 'feature/SKILL.md'
    })
    const agentsRead = await executeTool(host, workspace, 'read', {
      path: 'AGENTS.md'
    })
    expect(skillRead.classification).toMatchObject({
      kind: 'skill',
      label: 'feature'
    })
    expect(agentsRead.classification).toMatchObject({
      kind: 'resource'
    })
  })

  it('exposes pi-style shared edit diff helpers', async () => {
    await writeFile(join(workspace, 'preview.txt'), 'alpha\nbeta\n', 'utf8')
    const diff = await computeEditDiff('preview.txt', 'beta', 'gamma', workspace)
    expect('error' in diff).toBe(false)
    if ('error' in diff) return
    expect(diff.firstChangedLine).toBe(2)
    expect(diff.diff).toContain('+2 gamma')
  })

  it('serializes same-file mutations like pi file-mutation-queue', async () => {
    const target = join(workspace, 'serial.txt')
    const order: string[] = []

    let releaseFirst!: () => void
    const first = withFileMutationQueue(target, async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })

    const second = withFileMutationQueue(target, async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('persists a full bash output file when truncated', async () => {
    const output = await executeTool(host, workspace, 'bash', {
      command: "node -e \"for (let i = 0; i < 8000; i++) console.log('line-' + i)\""
    })
    expect(output.full_output_path === null || typeof output.full_output_path === 'string').toBe(true)
    expect(output.truncation === null || typeof output.truncation === 'object').toBe(true)
    if (output.truncation) {
      expect(output.full_output_path).not.toBe(null)
      expect(String(output.output)).toContain('truncated')
    }
  })
})
