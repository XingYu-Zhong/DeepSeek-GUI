import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'
import type { ModelClient, ModelRequest } from '../src/ports/model-client.js'
import { SkillRuntime } from '../src/skills/skill-runtime.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

describe('SkillRuntime', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-skills-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('loads manifests, legacy SKILL.md packages, and validation diagnostics', async () => {
    await writeSkill('review', {
      name: 'Review Skill',
      description: 'Review changes in the current workspace',
      version: '1.0.0',
      entry: 'REVIEW.md',
      triggers: { commands: ['/review'] }
    }, 'Review instructions')
    await mkdir(join(root, 'legacy'), { recursive: true })
    await writeFile(join(root, 'legacy', 'SKILL.md'), '# Legacy\n\nLegacy instructions', 'utf8')
    await mkdir(join(root, 'bad'), { recursive: true })
    await writeFile(join(root, 'bad', 'skill.json'), JSON.stringify({ id: 'bad' }), 'utf8')

    const runtime = await createRuntime()
    const diagnostics = runtime.diagnostics()

    expect(diagnostics.skills.map((skill) => skill.id).sort()).toEqual(['legacy', 'review-skill'])
    expect(diagnostics.skills.find((skill) => skill.id === 'review-skill')).toMatchObject({
      description: 'Review changes in the current workspace',
      version: '1.0.0'
    })
    expect(diagnostics.skills.find((skill) => skill.id === 'legacy')?.legacy).toBe(true)
    expect(diagnostics.validationErrors[0]?.message).toMatch(/expected string/i)
  })

  it('uses Chinese legacy frontmatter names for diagnostics without changing folder ids', async () => {
    const skillRoot = join(root, 'tdd')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: 测试驱动开发(TDD)',
      'description: 用测试先行推进实现。',
      '---',
      '',
      '# TDD',
      '',
      '先写失败测试，再实现。'
    ].join('\n'), 'utf8')

    const runtime = await createRuntime()
    const diagnostics = runtime.diagnostics()

    expect(diagnostics.skills).toContainEqual(expect.objectContaining({
      id: 'tdd',
      name: '测试驱动开发(TDD)',
      description: '用测试先行推进实现。',
      legacy: true
    }))
  })

  it('keeps skill.json manifests with Chinese names from collapsing to one id', async () => {
    await writeSkill('review-cn', {
      name: '代码审查',
      triggers: { commands: ['/review-cn'] }
    }, 'review instructions')
    await writeSkill('requirements-cn', {
      name: '需求分析',
      triggers: { commands: ['/requirements-cn'] }
    }, 'requirements instructions')

    const runtime = await createRuntime()
    const diagnostics = runtime.diagnostics()

    expect(diagnostics.skills.map((skill) => skill.id).sort()).toEqual(['代码审查', '需求分析'])
    expect(diagnostics.validationErrors).toEqual([])
  })

  it('matches triggers deterministically and respects injection budgets', async () => {
    await writeSkill('big', {
      id: 'big',
      name: 'Big',
      priority: 10,
      triggers: { promptPatterns: ['typescript'] }
    }, 'x'.repeat(2_000))
    await writeSkill('small', {
      id: 'small',
      name: 'Small',
      triggers: { fileTypes: ['.ts'] }
    }, 'small instructions')
    const runtime = await createRuntime({ instructionBudgetBytes: 600 })

    const resolution = runtime.resolveTurn({
      prompt: 'Please handle TypeScript in src/app.ts',
      workspace: root
    })

    expect(resolution.activations.map((activation) => activation.skillId)).toEqual(['big', 'small'])
    expect(resolution.activeSkillIds).toEqual(['small'])
    expect(resolution.instructions[0]).toContain('small instructions')
  })

  it('injects allowed tool constraints and blocks omitted tools', async () => {
    await writeSkill('readonly', {
      id: 'readonly',
      name: 'Readonly',
      triggers: { commands: ['/readonly'] },
      allowedTools: ['read']
    }, 'Use read only')
    await writeSkill('mutating', {
      id: 'mutating',
      name: 'Mutating',
      triggers: { commands: ['/mutating'] },
      allowedTools: ['bash']
    }, 'Use bash')
    const runtime = await createRuntime()
    const resolution = runtime.resolveTurn({
      prompt: '/readonly inspect',
      workspace: root
    })

    expect(resolution.allowedToolNames).toEqual(['read'])
    expect(runtime.diagnostics().lastInjection?.blockedToolNames).toEqual(['bash'])

    const readTool = LocalToolHost.defineTool({
      name: 'read',
      description: 'read',
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: { ok: true } })
    })
    const bashTool = LocalToolHost.defineTool({
      name: 'bash',
      description: 'bash',
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: { ok: true } })
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry([
        { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: [readTool, bashTool] }
      ])
    })
    const context = {
      threadId: 'thr',
      turnId: 'turn',
      workspace: root,
      approvalPolicy: 'auto' as const,
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const,
      allowedToolNames: resolution.allowedToolNames
    }

    expect((await host.listTools(context)).map((tool) => tool.name)).toEqual(['read'])
    await expect(
      host.execute({ callId: 'call_1', toolName: 'bash', arguments: {} }, context)
    ).rejects.toThrow(/active tool policy/)
  })

  it('refreshes Skill roots without recreating the runtime', async () => {
    const runtime = await createRuntime()
    expect(runtime.count()).toBe(0)

    await writeSkill('new-skill', {
      id: 'new',
      name: 'New',
      triggers: { commands: ['/new'] }
    }, 'new instructions')
    await runtime.refresh()

    expect(runtime.count()).toBe(1)
    expect(runtime.resolveTurn({ prompt: '/new run', workspace: root }).activeSkillIds).toEqual(['new'])
  })

  it('injects active Skills into AgentLoop context and turn metadata', async () => {
    await writeSkill('review', {
      id: 'review',
      name: 'Review',
      triggers: { promptPatterns: ['review'] },
      allowedTools: ['read']
    }, 'Always inspect the diff first.')
    const skillRuntime = await createRuntime()
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      skillRuntime,
      tools: [
        LocalToolHost.defineTool({
          name: 'read',
          description: 'read',
          inputSchema: { type: 'object' },
          policy: 'auto',
          execute: async () => ({ output: {} })
        }),
        LocalToolHost.defineTool({
          name: 'bash',
          description: 'bash',
          inputSchema: { type: 'object' },
          policy: 'auto',
          execute: async () => ({ output: {} })
        })
      ]
    })
    await bootstrapThread(h, { workspace: root, request: { prompt: 'please review this change' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequest?.contextInstructions?.[0]).toContain('Always inspect the diff first.')
    expect(seenRequest?.tools.map((tool) => tool.name)).toEqual(['read'])
    const turn = await h.turns.getTurn(h.threadId, h.turnId)
    expect(turn?.activeSkillIds).toEqual(['review'])
    expect(turn?.skillInjectionBytes).toBeGreaterThan(0)
  })

  async function createRuntime(options: Parameters<typeof SkillRuntime.create>[1] = {}) {
    const config = KunCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        roots: [root],
        legacySkillMd: true
      }
    })
    return SkillRuntime.create(config.skills, options)
  }

  async function writeSkill(
    folder: string,
    manifest: Record<string, unknown>,
    entry: string
  ): Promise<void> {
    const dir = join(root, folder)
    await mkdir(dir, { recursive: true })
    const entryName = typeof manifest.entry === 'string' ? manifest.entry : 'SKILL.md'
    await writeFile(join(dir, 'skill.json'), JSON.stringify(manifest), 'utf8')
    await writeFile(join(dir, entryName), entry, 'utf8')
  }
})
