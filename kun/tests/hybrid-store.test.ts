import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { HybridSessionStore, HybridThreadStore } from '../src/adapters/hybrid/index.js'
import { makeUserItem } from '../src/domain/item.js'
import { appendTurnItem, createTurnRecord, startTurn } from '../src/domain/turn.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { TurnService } from '../src/services/turn-service.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'

describe('HybridThreadStore', () => {
  let dataDir = ''
  let openStores: HybridThreadStore[] = []
  let sqliteAvailable = false

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-hybrid-'))
    openStores = []
    sqliteAvailable = await canOpenBetterSqlite()
  })

  afterEach(async () => {
    for (const store of openStores) store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('keeps item bodies in JSONL and uses SQLite metadata indexing when available', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const record = await seedThreadWithMessage(threadStore, sessionStore, 'hello from jsonl')

    const summaries = await threadStore.list({ search: 'Hybrid demo' })
    expect(summaries.map((thread) => thread.id)).toEqual([record.id])
    if (sqliteAvailable) {
      await expect(stat(join(dataDir, 'index.sqlite3'))).resolves.toBeTruthy()
    } else {
      await expect(stat(join(dataDir, 'index.sqlite3'))).rejects.toMatchObject({ code: 'ENOENT' })
    }

    const metadata = await readFile(
      join(dataDir, 'threads', record.id, 'metadata.jsonl'),
      'utf-8'
    )
    const messages = await readFile(
      join(dataDir, 'threads', record.id, 'messages.jsonl'),
      'utf-8'
    )
    expect(metadata).not.toContain('hello from jsonl')
    expect(messages).toContain('hello from jsonl')

    const fetched = await threadStore.get(record.id)
    expect(fetched?.turns[0]?.prompt).toBe('hello from jsonl')
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'hello from jsonl'
    })
  })

  it('rebuilds the SQLite index from JSONL after the database is deleted', async () => {
    const first = await createHybridStores()
    const record = await seedThreadWithMessage(first.threadStore, first.sessionStore, 'recover me')
    first.threadStore.close()

    await rm(join(dataDir, 'index.sqlite3'), { force: true })
    await rm(join(dataDir, 'index.sqlite3-wal'), { force: true })
    await rm(join(dataDir, 'index.sqlite3-shm'), { force: true })

    const rebuilt = await createHybridStores()
    const summaries = await rebuilt.threadStore.list({ search: 'Hybrid demo' })
    expect(summaries.map((thread) => thread.id)).toEqual([record.id])

    const fetched = await rebuilt.threadStore.get(record.id)
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'recover me'
    })
  })

  it('recovers turn attachment ids from user messages when metadata is stripped', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_attach',
      title: 'Attachment demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = createTurnRecord({
      id: 'turn_attach',
      threadId: thread.id,
      prompt: 'describe',
      model: thread.model,
      createdAt: '2026-06-04T00:00:01.000Z'
    })
    const item = makeUserItem({
      id: 'item_turn_attach_user',
      turnId: turn.id,
      threadId: thread.id,
      text: 'describe',
      attachmentIds: ['att_image']
    })
    const record = {
      ...thread,
      updatedAt: '2026-06-04T00:00:02.000Z',
      turns: [startTurn(appendTurnItem(turn, item), '2026-06-04T00:00:01.000Z')]
    }
    await sessionStore.appendItem(record.id, item)
    await threadStore.upsert(record)

    const fetched = await threadStore.get(record.id)

    expect(fetched?.turns[0]?.attachmentIds).toEqual(['att_image'])
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
  })

  it('does not synthesize duplicate turns when startTurn writes through the hybrid store', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_start',
      title: 'Start demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    await threadStore.upsert(thread)
    const turns = createTurnService(threadStore, sessionStore)

    const response = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'describe this data',
        model: 'deepseek-v4-pro',
        attachmentIds: ['att_image'],
        mode: 'agent'
      }
    })
    const fetched = await threadStore.get(thread.id)
    const items = await sessionStore.loadItems(thread.id)

    expect(fetched?.turns.map((turn) => turn.id)).toEqual([response.turnId])
    expect(fetched?.turns[0]).toMatchObject({
      id: response.turnId,
      attachmentIds: ['att_image'],
      model: 'deepseek-v4-pro'
    })
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
  })

  it('deduplicates damaged turn metadata and recovers attachment ids from earlier metadata lines', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_damaged',
      title: 'Damaged metadata',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = startTurn(
      createTurnRecord({
        id: 'turn_damaged',
        threadId: thread.id,
        prompt: 'describe',
        model: 'deepseek-v4-pro',
        attachmentIds: ['att_from_history'],
        createdAt: '2026-06-04T00:00:01.000Z'
      }),
      '2026-06-04T00:00:01.500Z'
    )
    const damagedTurn = {
      ...turn,
      status: 'completed' as const,
      prompt: '',
      items: [],
      attachmentIds: [],
      finishedAt: '2026-06-04T00:00:03.000Z'
    }
    await mkdir(join(dataDir, 'threads', thread.id), { recursive: true })
    await writeFile(
      join(dataDir, 'threads', thread.id, 'metadata.jsonl'),
      [
        {
          kind: 'thread_metadata',
          version: 1,
          timestamp: '2026-06-04T00:00:02.000Z',
          thread: { ...thread, status: 'running', turns: [{ ...turn, prompt: '', items: [] }] }
        },
        {
          kind: 'thread_metadata',
          version: 1,
          timestamp: '2026-06-04T00:00:03.000Z',
          thread: {
            ...thread,
            status: 'idle',
            updatedAt: '2026-06-04T00:00:03.000Z',
            turns: [damagedTurn, damagedTurn]
          }
        }
      ].map((line) => JSON.stringify(line)).join('\n') + '\n',
      'utf8'
    )
    await sessionStore.appendItem(thread.id, makeUserItem({
      id: 'item_turn_damaged_user',
      turnId: turn.id,
      threadId: thread.id,
      text: 'describe'
    }))

    const fetched = await threadStore.get(thread.id)

    expect(fetched?.turns).toHaveLength(1)
    expect(fetched?.turns[0]).toMatchObject({
      id: turn.id,
      attachmentIds: ['att_from_history']
    })
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'describe'
    })
  })

  async function createHybridStores(): Promise<{
    threadStore: HybridThreadStore
    sessionStore: HybridSessionStore
  }> {
    const threadStore = new HybridThreadStore({ dataDir })
    await threadStore.ready()
    openStores.push(threadStore)
    return {
      threadStore,
      sessionStore: new HybridSessionStore({ dataDir, index: threadStore })
    }
  }

  async function seedThreadWithMessage(
    threadStore: HybridThreadStore,
    sessionStore: HybridSessionStore,
    text: string
  ) {
    const thread = createThreadRecord({
      id: 'thr_hybrid',
      title: 'Hybrid demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = createTurnRecord({
      id: 'turn_hybrid',
      threadId: thread.id,
      prompt: text,
      model: thread.model,
      createdAt: '2026-06-04T00:00:01.000Z'
    })
    const item = makeUserItem({
      id: 'item_turn_hybrid_user',
      turnId: turn.id,
      threadId: thread.id,
      text
    })
    const record = {
      ...thread,
      updatedAt: '2026-06-04T00:00:02.000Z',
      turns: [startTurn(appendTurnItem(turn, item), '2026-06-04T00:00:01.000Z')]
    }
    await sessionStore.appendItem(record.id, item)
    await threadStore.upsert(record)
    return record
  }

  function createTurnService(
    threadStore: HybridThreadStore,
    sessionStore: HybridSessionStore
  ): TurnService {
    const bus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => '2026-06-04T00:00:02.000Z'
    })
    return new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-06-04T00:00:02.000Z'
    })
  }

  async function canOpenBetterSqlite(): Promise<boolean> {
    try {
      const sqlite = await import('better-sqlite3')
      const Database = sqlite.default
      const db = new Database(':memory:')
      db.close()
      return true
    } catch {
      return false
    }
  }
})
