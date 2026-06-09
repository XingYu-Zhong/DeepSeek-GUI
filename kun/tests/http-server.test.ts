import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchRequest } from '../src/server/http-server.js'
import { createApprovalRequest } from '../src/domain/approval.js'
import { makeAssistantTextItem } from '../src/domain/item.js'
import { encodeSseEvent } from '../src/server/sse.js'
import { buildHarness, readJson, readSseEvents, usageSnapshot } from './http-server-test-harness.js'

describe('HTTP server', () => {
  let dataDir = ''
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-http-'))
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('returns 200 on /health without auth', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(h.router, new Request('http://localhost/health'))
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body).toEqual({ status: 'ok', service: 'kun', mode: 'serve' })
  })

  it('returns runtime info with disabled capability defaults', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      model?: string
      capabilities?: {
        contractVersion?: number
        mcp?: { available?: boolean; reason?: string }
        web?: { available?: boolean; fetch?: { available?: boolean } }
        attachments?: { available?: boolean; allowedMimeTypes?: string[] }
        cli?: { serve?: { available?: boolean }; run?: { available?: boolean; reason?: string } }
        model?: { inputModalities?: string[]; supportsToolCalling?: boolean; contextWindowTokens?: number }
      }
    }
    expect(body.model).toBe('deepseek-chat')
    expect(body.capabilities?.contractVersion).toBe(1)
    expect(body.capabilities?.model?.inputModalities).toContain('text')
    expect(body.capabilities?.model?.supportsToolCalling).toBe(true)
    expect(body.capabilities?.model?.contextWindowTokens).toBe(1_000_000)
    expect(body.capabilities?.mcp?.available).toBe(false)
    expect(body.capabilities?.mcp?.reason).toMatch(/disabled/)
    expect(body.capabilities?.web?.fetch?.available).toBe(false)
    expect(body.capabilities?.attachments?.allowedMimeTypes).toContain('image/png')
    expect(body.capabilities?.cli?.serve?.available).toBe(true)
    expect(body.capabilities?.cli?.run?.available).toBe(false)
  })

  it('requires auth for runtime info', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info')
    )

    expect(response.status).toBe(401)
  })

  it('returns structured validation errors for invalid JSON bodies', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: '{'
      })
    )

    expect(response.status).toBe(400)
    expect(await readJson(response)).toMatchObject({
      code: 'validation_error',
      message: 'invalid JSON body'
    })
  })

  it('returns runtime tool diagnostics', async () => {
    const h = buildHarness()
    h.runtime.toolDiagnostics = () => ({
      providers: [
        {
          id: 'mcp:github',
          kind: 'mcp',
          enabled: true,
          available: false,
          reason: 'token=provider-secret'
        }
      ],
      mcpServers: [
        {
          id: 'github',
          enabled: true,
          transport: 'stdio',
          trustScope: 'user',
          available: false,
          status: 'error',
          toolCount: 0,
          lastError: 'Authorization: Bearer server-secret'
        }
      ],
      webProviders: [],
      skills: {
        enabled: false,
        roots: [],
        skills: [],
        validationErrors: [],
        lastActivations: []
      },
      attachments: {
        enabled: false,
        rootDir: '',
        count: 0,
        totalBytes: 0
      },
      memory: {
        enabled: false,
        rootDir: '',
        activeCount: 0,
        tombstoneCount: 0,
        lastInjectedIds: []
      }
    })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as {
      providers: Array<{ id: string; reason?: string }>
      mcpServers: Array<{ id: string; lastError?: string }>
      webProviders: unknown[]
      skills: unknown
      attachments: unknown
      memory: unknown
    }
    expect(body.providers[0]).toMatchObject({ id: 'mcp:github', reason: 'token=<redacted>' })
    expect(body.mcpServers[0]).toMatchObject({
      id: 'github',
      lastError: 'Authorization=<redacted>'
    })
    expect(JSON.stringify(body)).not.toContain('provider-secret')
    expect(JSON.stringify(body)).not.toContain('server-secret')
  })

  it('requires auth for runtime tool diagnostics', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/tools')
    )

    expect(response.status).toBe(401)
  })

  it('lists discovered skills through the HTTP layer', async () => {
    const h = buildHarness()
    h.runtime.skills = () => ({
      enabled: true,
      roots: ['/tmp/skills'],
      skills: [
        {
          id: 'review',
          name: 'Review',
          description: 'Review the current change',
          version: '1.0.0',
          root: '/tmp/skills/review',
          legacy: false,
          triggers: { commands: ['/review'], promptPatterns: [], fileTypes: [] },
          allowedTools: ['read']
        }
      ],
      validationErrors: [],
      lastActivations: []
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/skills', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = await readJson(response) as { skills: Array<{ id: string; description?: string }> }
    expect(body.skills[0]).toMatchObject({
      id: 'review',
      description: 'Review the current change'
    })
  })

  it('returns the real user message item id when starting a turn', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    }, { id: 'thr_1', title: 'demo' })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_1/turns', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' })
      })
    )

    expect(response.status).toBe(202)
    const body = await readJson(response) as { turnId: string; userMessageItemId: string }
    expect(body.turnId).toMatch(/^turn_/)
    expect(body.userMessageItemId).toBe(`item_${body.turnId}_user`)
  })

  it('creates and lists threads through the HTTP layer', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const created = (await readJson(create)) as { id: string }
    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listed = (await readJson(list)) as { threads: { id: string }[] }
    expect(listed.threads.map((t) => t.id)).toContain(created.id)
  })

  it('sets, reads, and clears thread goals through the HTTP layer', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thr_goal', title: 'Goal' })

    const setGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ objective: 'ship goal mode', status: 'active' })
      })
    )
    expect(setGoal.status).toBe(200)
    const setBody = await readJson(setGoal) as { goal?: { objective?: string; status?: string } }
    expect(setBody.goal).toMatchObject({ objective: 'ship goal mode', status: 'active' })

    const readGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(readGoal.status).toBe(200)
    const readBody = await readJson(readGoal) as { goal?: { objective?: string } | null }
    expect(readBody.goal?.objective).toBe('ship goal mode')

    const clearGoal = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_goal/goal', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(clearGoal.status).toBe(200)
    expect(await readJson(clearGoal)).toEqual({ cleared: true })
  })

  it('sets, reads, and clears thread todos through the HTTP layer', async () => {
    const h = buildHarness()
    await h.threadService.create({
      workspace: '/tmp',
      model: 'deepseek-chat',
      mode: 'agent'
    }, { id: 'thr_todos', title: 'Todos' })

    const setTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          todos: [
            { content: 'Wire API', status: 'completed' },
            { content: 'Render panel', status: 'pending' }
          ]
        })
      })
    )
    expect(setTodos.status).toBe(200)
    const setBody = await readJson(setTodos) as { todos?: { items?: Array<{ content?: string; status?: string }> } }
    expect(setBody.todos?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Wire API', status: 'completed' })
    ]))

    const readTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(readTodos.status).toBe(200)
    const readBody = await readJson(readTodos) as { todos?: { items?: Array<{ content?: string }> } | null }
    expect(readBody.todos?.items?.[0]?.content).toBe('Wire API')

    const clearTodos = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_todos/todos', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(clearTodos.status).toBe(200)
    expect(await readJson(clearTodos)).toEqual({ cleared: true })
  })

  it('filters thread lists for search, archives, and limits', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/alpha', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_alpha', title: 'Alpha Project' }
    )
    await h.threadService.create(
      { workspace: '/tmp/beta', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_beta', title: 'Beta Archive' }
    )
    await h.threadService.update('thr_beta', { status: 'archived' })

    const active = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(active.status).toBe(200)
    const activeBody = (await readJson(active)) as { threads: Array<{ id: string }> }
    expect(activeBody.threads.map((thread) => thread.id)).toEqual(['thr_alpha'])

    const archived = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?archived_only=true', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const archivedBody = (await readJson(archived)) as { threads: Array<{ id: string }> }
    expect(archivedBody.threads.map((thread) => thread.id)).toEqual(['thr_beta'])

    const search = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true&search=archive', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const searchBody = (await readJson(search)) as { threads: Array<{ id: string }> }
    expect(searchBody.threads.map((thread) => thread.id)).toEqual(['thr_beta'])

    const limited = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true&limit=1', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const limitedBody = (await readJson(limited)) as { threads: Array<{ id: string }> }
    expect(limitedBody.threads).toHaveLength(1)
  })

  it('deletes threads through the HTTP layer', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp/delete-me', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const created = (await readJson(create)) as { id: string }

    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    expect(await readJson(deleted)).toEqual({ id: created.id, deleted: true })

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include_archived=true', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listed = (await readJson(list)) as { threads: Array<{ id: string }> }
    expect(listed.threads.map((thread) => thread.id)).not.toContain(created.id)

    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${created.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(detail.status).toBe(404)
  })

  it('returns 404 when deleting a missing thread', async () => {
    const h = buildHarness()
    const deleted = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/missing-thread', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(404)
    expect(await readJson(deleted)).toMatchObject({
      code: 'not_found',
      message: 'thread not found: missing-thread'
    })
  })

  it('rejects invalid thread creation bodies with 400', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '', model: '' })
      })
    )
    expect(response.status).toBe(400)
  })

  it('starts a turn and serves the SSE backlog', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { threadId: string; turnId: string }
    expect(turnBody.threadId).toBe(thread.id)
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const detailBody = (await readJson(detail)) as {
      latestSeq: number
      turns: Array<{ items: Array<{ kind: string }> }>
    }
    expect(detailBody.latestSeq).toBeGreaterThan(0)
    expect(detailBody.turns.at(-1)?.items.some((item) => item.kind === 'user_message')).toBe(true)
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events?since_seq=0`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const events = await readSseEvents(eventStream)
    const kinds = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('event:'))
        .map((line) => line.slice(7))
    )
    expect(kinds).toContain('turn_started')
  })

  it('hydrates thread detail items from the session log when the thread snapshot lags', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_lag', title: 'Lagging snapshot' }
    )
    const { turnId } = await h.turnService.startTurn({
      threadId: 'thr_lag',
      request: { prompt: 'hi' }
    })
    await h.sessionStore.appendItem('thr_lag', makeAssistantTextItem({
      id: 'item_answer',
      turnId,
      threadId: 'thr_lag',
      text: 'hello after reload',
      status: 'completed'
    }))
    const snapshot = await h.threadService.get('thr_lag')
    expect(snapshot?.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message'])

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_lag', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      turns: Array<{ items: Array<{ kind: string; text?: string }> }>
    }
    expect(body.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message', 'assistant_text'])
    expect(body.turns.at(-1)?.items.at(-1)).toMatchObject({
      kind: 'assistant_text',
      text: 'hello after reload'
    })
  })

  it('persists GUI plan context from start-turn requests', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: '/tmp',
            relativePath: '.deepseekgui/plan/auth.md',
            planId: '/tmp:.deepseekgui/plan/auth.md',
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns/${turnBody.turnId}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(detail.status).toBe(200)
    const detailBody = (await readJson(detail)) as { guiPlan?: { relativePath?: string; operation?: string } }
    expect(detailBody.guiPlan).toMatchObject({
      operation: 'draft',
      relativePath: '.deepseekgui/plan/auth.md'
    })
  })

  it('groups usage by the usage event model instead of the thread default model', async () => {
    const h = buildHarness()
    const today = new Date().toISOString().slice(0, 10)
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    await h.runtime.events.record({
      kind: 'usage',
      threadId: thread.id,
      turnId: turnBody.turnId,
      model: 'deepseek-v4-pro',
      usage: usageSnapshot({ promptTokens: 30, completionTokens: 10, totalTokens: 40 })
    })

    const usage = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/usage?group_by=model&from=${today}&to=${today}&timezone=UTC`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(usage.status).toBe(200)
    const body = (await readJson(usage)) as {
      buckets: Array<{ model: string; total_tokens: number }>
    }
    expect(body.buckets).toEqual([
      expect.objectContaining({
        model: 'deepseek-v4-pro',
        total_tokens: 40
      })
    ])
  })

  it('replays SSE backlog from Last-Event-ID when since_seq is omitted', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)

    const allEvents = await h.sessionStore.loadEventsSince(thread.id, 0)
    const secondSeq = allEvents[1]?.seq ?? 0
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events`, {
        headers: { authorization: 'Bearer tok-1', 'Last-Event-ID': String(secondSeq) }
      })
    )
    const events = await readSseEvents(eventStream)
    const ids = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('id:'))
        .map((line) => Number(line.slice(3).trim()))
    )
    expect(ids.every((id) => id > secondSeq)).toBe(true)
  })

  it('resolves an approval through the HTTP endpoint', async () => {
    const h = buildHarness()
    const approval = createApprovalRequest({
      id: 'appr_1',
      threadId: 'thr_1',
      turnId: 'turn_1',
      toolName: 'echo',
      summary: 'run echo'
    })
    const pending = h.approvalGate.request(approval)
    const decide = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/approvals/appr_1', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' })
      })
    )
    expect(decide.status).toBe(200)
    const body = (await readJson(decide)) as { decision: string }
    expect(body.decision).toBe('allow')
    await expect(pending).resolves.toBe('allow')
  })

  it('resolves GUI user input through both HTTP compatibility endpoints', async () => {
    const h = buildHarness()
    const pending = h.userInputGate.request({
      id: 'in_1',
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_in_1',
      prompt: 'Pick one',
      questions: []
    })
    const submit = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/user-inputs/in_1', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
        })
      })
    )
    expect(submit.status).toBe(200)
    await expect(pending).resolves.toEqual({
      status: 'submitted',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })

    const cancelPending = h.userInputGate.request({
      id: 'in_2',
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_in_2',
      prompt: 'Cancel?',
      questions: []
    })
    const cancel = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/user-input/in_2', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ cancelled: true })
      })
    )
    expect(cancel.status).toBe(200)
    await expect(cancelPending).resolves.toEqual({ status: 'cancelled' })
    const events = await h.sessionStore.loadEventsSince('thr_1', 0)
    expect(events.filter((event) => event.kind === 'user_input_resolved')).toHaveLength(2)
  })

  it('forks a thread with copied history and lineage metadata', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_parent', title: 'Parent' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_parent',
      request: { prompt: 'hello' }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_parent/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(201)
    const fork = (await readJson(response)) as {
      id: string
      forkedFromThreadId?: string
      forkedFromTitle?: string
      forkedFromMessageCount?: number
      forkedFromTurnCount?: number
      turns: Array<{ threadId: string; items: Array<{ threadId: string; kind: string }> }>
    }
    expect(fork.forkedFromThreadId).toBe('thr_parent')
    expect(fork.forkedFromTitle).toBe('Parent')
    expect(fork.forkedFromMessageCount).toBe(1)
    expect(fork.forkedFromTurnCount).toBe(1)
    expect(fork.turns[0]?.threadId).toBe(fork.id)
    expect(fork.turns[0]?.items[0]).toMatchObject({ threadId: fork.id, kind: 'user_message' })
    const copiedItems = await h.sessionStore.loadItems(fork.id)
    expect(copiedItems).toHaveLength(1)
    expect(copiedItems[0]).toMatchObject({ threadId: fork.id, kind: 'user_message' })
  })

  it('forks with relation: side, attaches parentThreadId, and is excluded from the default list', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_parent', title: 'Parent' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_parent',
      request: { prompt: 'seed turn' }
    })

    const forkResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_parent/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ relation: 'side' })
      })
    )
    expect(forkResponse.status).toBe(201)
    const fork = (await readJson(forkResponse)) as {
      id: string
      relation?: string
      parentThreadId?: string
      title: string
    }
    expect(fork.relation).toBe('side')
    expect(fork.parentThreadId).toBe('thr_parent')
    expect(fork.title).toBe('Parent · side')

    // Default list hides side threads.
    const listResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const listBody = (await readJson(listResponse)) as {
      threads: Array<{ id: string; relation?: string }>
    }
    expect(listBody.threads.find((t) => t.id === fork.id)).toBeUndefined()
    expect(listBody.threads.find((t) => t.id === 'thr_parent')).toBeDefined()

    // Opt-in include=side surfaces them.
    const includeResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads?include=side', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const includeBody = (await readJson(includeResponse)) as {
      threads: Array<{ id: string; relation?: string }>
    }
    expect(includeBody.threads.find((t) => t.id === fork.id)).toMatchObject({ relation: 'side' })
  })

  it('bodyless fork still defaults to relation: fork', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_default_fork', title: 'Forker' }
    )
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_default_fork/fork', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(201)
    const body = (await readJson(response)) as { relation?: string; parentThreadId?: string }
    expect(body.relation).toBe('fork')
    expect(body.parentThreadId).toBe('thr_default_fork')
  })

  it('resumes a persisted session into a new Kun thread', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_source', title: 'Source Thread' }
    )
    await h.turnService.startTurn({
      threadId: 'thr_source',
      request: { prompt: 'restore this' }
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/sessions/thr_source/resume-thread', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp/override', model: 'deepseek-coder', mode: 'plan' })
      })
    )

    expect(response.status).toBe(201)
    const body = (await readJson(response)) as {
      thread_id: string
      session_id: string
      message_count: number
      summary: string
    }
    expect(body.session_id).toBe('thr_source')
    expect(body.message_count).toBe(1)
    expect(body.summary).toBe('Source Thread resumed')
    const resumed = await h.threadService.get(body.thread_id)
    expect(resumed).toMatchObject({
      workspace: '/tmp/override',
      model: 'deepseek-coder',
      mode: 'plan',
      status: 'idle',
      forkedFromThreadId: 'thr_source'
    })
    expect(resumed?.turns[0]?.status).toBe('completed')
    expect(resumed?.turns[0]?.items[0]).toMatchObject({
      threadId: body.thread_id,
      kind: 'user_message',
      text: 'restore this'
    })
    const copiedItems = await h.sessionStore.loadItems(body.thread_id)
    expect(copiedItems).toHaveLength(1)
  })

  it('returns 404 when resuming an unknown session', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/sessions/missing/resume-thread', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )

    expect(response.status).toBe(404)
  })

  it('returns cumulative usage from /v1/usage', async () => {
    const h = buildHarness()
    h.runtime.usageService.record('thr_1', {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      cachedTokens: 2,
      cacheHitTokens: 2,
      cacheMissTokens: 3,
      cacheHitRate: 0.4,
      turns: 1
    })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(200)
    const body = (await readJson(response)) as { total: { promptTokens: number } }
    expect(body.total.promptTokens).toBe(5)
  })

  it('returns live thread-grouped usage buckets from /v1/usage?group_by=thread', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_live', title: 'Live usage' }
    )
    h.runtime.usageService.record('thr_live', usageSnapshot({ promptTokens: 12, completionTokens: 8 }))

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage?group_by=thread', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      group_by: string
      buckets: Array<{ thread_id: string; total_tokens: number; turns: number }>
    }
    expect(body.group_by).toBe('thread')
    expect(body.buckets).toEqual([
      expect.objectContaining({ thread_id: 'thr_live', total_tokens: 20, turns: 1 })
    ])
  })

  it('derives daily usage from persisted cumulative usage events', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp/project', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_usage', title: 'Persisted usage' }
    )
    await h.sessionStore.appendEvent('thr_usage', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-02T09:00:00.000Z',
      threadId: 'thr_usage',
      usage: usageSnapshot({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        turns: 1,
        tokenEconomySavingsTokens: 100,
        tokenEconomySavingsUsd: 0.001
      })
    })
    await h.sessionStore.appendEvent('thr_usage', {
      kind: 'usage',
      seq: 3,
      timestamp: '2026-06-02T09:05:00.000Z',
      threadId: 'thr_usage',
      usage: usageSnapshot({
        promptTokens: 30,
        completionTokens: 10,
        totalTokens: 40,
        turns: 2,
        tokenEconomySavingsTokens: 250,
        tokenEconomySavingsUsd: 0.0025
      })
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/usage?group_by=day&from=2026-06-02&to=2026-06-02&timezone=UTC', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      group_by: string
      buckets: Array<{ date: string; total_tokens: number; turns: number; thread_count: number }>
      totals: {
        total_tokens: number
        turns: number
        active_days: number
        token_economy_savings_tokens: number
        token_economy_savings_usd: number
      }
    }
    expect(body.group_by).toBe('day')
    expect(body.buckets[0]).toMatchObject({
      date: '2026-06-02',
      total_tokens: 40,
      turns: 2,
      thread_count: 1
    })
    expect(body.totals).toMatchObject({
      total_tokens: 40,
      turns: 2,
      active_days: 1,
      token_economy_savings_tokens: 250,
      token_economy_savings_usd: 0.0025
    })
  })

  it('encodes SSE events with sequence numbers and event names', () => {
    const frame = encodeSseEvent({
      kind: 'heartbeat',
      seq: 7,
      timestamp: 't',
      threadId: 'th'
    })
    expect(frame).toContain('id: 7')
    expect(frame).toContain('event: heartbeat')
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('returns a 404 for unknown routes', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/unknown')
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await readJson(response)).toEqual({
      code: 'not_found',
      message: 'route not found'
    })
  })

  it('streams a workspace status response', async () => {
    const h = buildHarness()
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/workspace/status?path=/tmp', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(response.status).toBe(200)
    const body = (await readJson(response)) as { path: string }
    expect(body.path).toBe('/tmp')
  })
})
