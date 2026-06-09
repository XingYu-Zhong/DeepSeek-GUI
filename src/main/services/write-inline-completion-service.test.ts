import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import {
  buildWriteInlineCompletionPrompt,
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  parseWriteInlineAction,
  requestWriteInlineCompletion
} from './write-inline-completion-service'
import { clearWriteRetrievalCache } from './write-retrieval-service'

function createSettings(patch: Partial<AppSettingsV1['write']['inlineCompletion']> = {}): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'sk-test'
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    write: {
      ...write,
      inlineCompletion: {
        ...write.inlineCompletion,
        ...patch
      }
    },
    schedule: defaultScheduleSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    claw: defaultClawSettings()
  }
}

function createRequest(): WriteInlineCompletionRequest {
  return {
    prefix: '# Draft\n\nThis is',
    suffix: ' a test.',
    currentFilePath: '/tmp/workspace/draft.md',
    cursor: {
      line: 3,
      column: 7
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'This is',
      currentLineSuffix: ' a test.',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: false,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'This is',
      documentTail: '# Draft This is'
    },
    model: 'deepseek-v4-flash'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearWriteRetrievalCache()
  clearWriteInlineCompletionDebugEntries()
})

describe('requestWriteInlineCompletion', () => {
  it('calls DeepSeek FIM completions directly instead of chat completions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' only a test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ maxTokens: 64 }), createRequest())

    expect(result).toEqual({
      ok: true,
      completion: ' only a test',
      action: {
        kind: 'short',
        text: ' only a test'
      },
      model: 'deepseek-v4-flash',
      mode: 'short'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/beta/completions')
    expect(url).not.toContain('/chat/completions')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test'
    })
    const body = JSON.parse(String(init.body)) as { prompt: string; suffix: string; max_tokens: number }
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      suffix: ' a test.',
      max_tokens: 64
    })
    expect(body.prompt).toContain('DeepSeek GUI inline completion')
    expect(body.prompt).toContain('Return only the text to insert at the cursor')
    expect(body.prompt).not.toContain('<<<SHORT')
    expect(body.prompt).toContain('<<<PREFIX')
    expect(body.prompt).toContain('<<<SUFFIX')
    expect(body.prompt.endsWith('# Draft\n\nThis is')).toBe(true)
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: true,
      completion: ' only a test',
      mode: 'short',
      model: 'deepseek-v4-flash'
    })
  })

  it('does not request the API when inline completion is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ enabled: false }), createRequest())

    expect(result).toEqual({ ok: false, message: 'Inline completion is disabled.' })
    expect(fetchMock).not.toHaveBeenCalled()
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: false,
      errorMessage: 'Inline completion is disabled.',
      completion: '',
      responseChars: 0
    })
  })

  it('records missing API key failures in the debug log', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings()
    settings.agents.kun.apiKey = ''

    const result = await requestWriteInlineCompletion(settings, createRequest())

    expect(result).toEqual({ ok: false, message: 'Missing API key for inline completion.' })
    expect(fetchMock).not.toHaveBeenCalled()
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: false,
      errorMessage: 'Missing API key for inline completion.',
      mode: 'short',
      suffix: ' a test.',
      responseChars: 0
    })
    expect(debugEntries[0].prompt).toContain('DeepSeek GUI inline completion')
    expect(debugEntries[0].prompt.endsWith('# Draft\n\nThis is')).toBe(true)
  })

  it('preserves an explicit pro completion model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' flash text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      model: 'deepseek-v4-pro'
    }
    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-pro'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-pro'
    })
  })

  it('falls back to the General baseUrl and Kun model when write keeps defaults', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' fallback text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings()
    settings.provider.baseUrl = 'https://general.example/v1'
    settings.agents.kun.model = 'deepseek-chat'
    settings.write.inlineCompletion.baseUrl = 'https://api.deepseek.com/beta'
    settings.write.inlineCompletion.model = 'deepseek-v4-flash'

    const result = await requestWriteInlineCompletion(settings, {
      ...createRequest(),
      model: ''
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-chat'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://general.example')
    expect(url).toContain('/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-chat'
    })
  })

  it('uses an explicit flash override when write disables model inheritance', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' explicit flash' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings({
      inheritModel: false,
      model: 'deepseek-v4-flash'
    })
    settings.provider.baseUrl = 'https://general.example/v1'
    settings.agents.kun.model = 'deepseek-chat'

    const result = await requestWriteInlineCompletion(settings, {
      ...createRequest(),
      model: ''
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-flash'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://general.example')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash'
    })
  })

  it('uses the long-completion prompt and token budget for inspiration mode', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: '\n\nA longer continuation.' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      mode: 'long' as const,
      suffix: '',
      context: {
        ...createRequest().context,
        currentLineSuffix: ''
      }
    }
    const result = await requestWriteInlineCompletion(
      createSettings({ longMaxTokens: 320 }),
      request
    )

    expect(result).toMatchObject({
      ok: true,
      mode: 'long'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string; max_tokens: number }
    expect(body.max_tokens).toBe(320)
    expect(body.prompt).toContain('Trigger hint: long')
    expect(body.prompt).toContain('paused for inspiration')
    expect(body.prompt.endsWith(request.prefix)).toBe(true)
  })

  it('records plain long completions from the FIM request', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: '\n\nA fuller continuation.' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings(), {
      ...createRequest(),
      mode: 'long'
    })

    expect(result).toMatchObject({
      ok: true,
      completion: '\n\nA fuller continuation.',
      action: {
        kind: 'long',
        text: '\n\nA fuller continuation.'
      },
      mode: 'long'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string }
    expect(body.prompt).toContain('Return only the text to insert at the cursor')
    expect(body.prompt).not.toContain('<<<LONG')
  })

  it('adds BM25 retrieval snippets to the FIM prompt when workspace context is available', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-write-rag-'))
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'notes', 'retrieval.md'),
      [
        '# RAG notes',
        '',
        'BM25 keyword retrieval keeps inline completion grounded in project terminology.',
        'Use retrieved snippets as reference-only context for local text completion.'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, 'draft.md'),
      '# Draft\n\nBM25 keyword',
      'utf8'
    )

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' retrieval can improve continuity' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      workspaceRoot,
      currentFilePath: join(workspaceRoot, 'draft.md'),
      prefix: '# Draft\n\nBM25 keyword',
      suffix: '',
      context: {
        ...createRequest().context,
        currentLinePrefix: 'BM25 keyword',
        currentLineSuffix: '',
        previousNonEmptyLine: '# Draft'
      },
      preview: {
        local: 'BM25 keyword',
        documentTail: '# Draft BM25 keyword'
      }
    }

    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({ ok: true })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string }
    expect(body.prompt).toContain('Reference snippets from the same writing workspace')
    expect(body.prompt).toContain('notes/retrieval.md')
    expect(body.prompt).toContain('BM25 keyword retrieval keeps inline completion grounded')
    expect(body.prompt.endsWith(request.prefix)).toBe(true)
  })

  it('uses chat completions when the unified request may return an edit action', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: '<<<EDIT\nWrite mode keeps text editing local.\n>>>'
          }
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      editCandidate: {
        kind: 'paragraph' as const,
        from: 9,
        to: 47,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 38,
        original: 'DeepSeek GUI keeps text editing local.'
      },
      recentEdits: [{
        source: 'user' as const,
        ageMs: 1_200,
        filePath: '/tmp/workspace/draft.md',
        from: 9,
        to: 21,
        deletedText: 'DeepSeek GUI',
        insertedText: 'Write mode',
        beforeContext: '',
        afterContext: ' keeps text editing local.'
      }]
    }

    const result = await requestWriteInlineCompletion(createSettings({ longMaxTokens: 320 }), request)

    expect(result).toMatchObject({
      ok: true,
      completion: 'Write mode keeps text editing local.',
      action: {
        kind: 'edit',
        replacement: 'Write mode keeps text editing local.',
        from: 9,
        to: 47,
        original: 'DeepSeek GUI keeps text editing local.',
        scopeKind: 'paragraph'
      }
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>
      prompt?: string
      suffix?: string
      max_tokens: number
      thinking?: { type: string }
    }
    expect(body.max_tokens).toBe(320)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.prompt).toBeUndefined()
    expect(body.suffix).toBeUndefined()
    expect(body.messages[1].content).toContain('Recent local edits in this file')
    expect(body.messages[1].content).toContain('Editable local scope if EDIT is the best action')
    expect(body.messages[1].content).toContain('<<<EDIT_SCOPE')
  })

  it('uses chat completions for explicit edit mode even without recent edit signals', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: '<<<EDIT\nWrite mode keeps text editing local.\n>>>'
          }
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      mode: 'edit' as const,
      editCandidate: {
        kind: 'paragraph' as const,
        from: 9,
        to: 47,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 38,
        original: 'DeepSeek GUI keeps text editing local.'
      }
    }

    const result = await requestWriteInlineCompletion(createSettings({ longMaxTokens: 320 }), request)

    expect(result).toMatchObject({
      ok: true,
      mode: 'edit',
      completion: 'Write mode keeps text editing local.'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>
      suffix?: string
      thinking?: { type: string }
    }
    expect(body.suffix).toBeUndefined()
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.messages[1].content).toContain('Trigger hint: edit')
    expect(body.messages[1].content).toContain('<<<PREFIX')
    expect(body.messages[1].content).toContain('<<<SUFFIX')
  })

  it('does not send DeepSeek thinking controls for custom chat completion models', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: '<<<EDIT\nWrite mode keeps text editing local.\n>>>'
          }
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      model: 'gpt-4.1-mini',
      mode: 'edit' as const,
      editCandidate: {
        kind: 'paragraph' as const,
        from: 9,
        to: 47,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 38,
        original: 'DeepSeek GUI keeps text editing local.'
      }
    }

    const result = await requestWriteInlineCompletion(createSettings({ longMaxTokens: 320 }), request)

    expect(result).toMatchObject({
      ok: true,
      model: 'gpt-4.1-mini',
      mode: 'edit'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { thinking?: { type: string } }
    expect(body.thinking).toBeUndefined()
  })

  it('builds the unified action prompt without retrieval snippets when none are supplied', () => {
    const request = createRequest()

    const prompt = buildWriteInlineCompletionPrompt(request, null)
    expect(prompt).toContain('DeepSeek GUI inline completion')
    expect(prompt).toContain('<<<PREFIX')
    expect(prompt).toContain('<<<SUFFIX')
    expect(prompt).not.toContain('<<<SHORT')
    expect(prompt).not.toContain('Reference snippets from the same writing workspace')
    expect(prompt.endsWith(request.prefix)).toBe(true)
  })
})

describe('parseWriteInlineAction', () => {
  it('parses TextIDE-style marked short, long, and edit blocks', () => {
    expect(parseWriteInlineAction('<<<SHORT\n next words\n>>>')).toEqual({
      kind: 'short',
      text: ' next words'
    })
    expect(parseWriteInlineAction('<<<LONG\n\nA fuller continuation.\n>>>')).toEqual({
      kind: 'long',
      text: '\nA fuller continuation.'
    })
    expect(parseWriteInlineAction('<<<EDIT\nWrite mode\n>>>', {
      editTarget: {
        from: 9,
        to: 21,
        original: 'DeepSeek GUI',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Write mode',
      from: 9,
      to: 21,
      original: 'DeepSeek GUI',
      scopeKind: 'selection'
    })
  })

  it('suppresses echoed boundary-marker prompts', () => {
    expect(parseWriteInlineAction('<<<PREFIX\nThis is\n>>>\n<<<SUFFIX\n a test.\n>>>')).toEqual({
      kind: 'short',
      text: ''
    })
  })

  it('parses JSON action payloads', () => {
    expect(parseWriteInlineAction(JSON.stringify({ kind: 'long', text: 'Continue the paragraph.' }))).toEqual({
      kind: 'long',
      text: 'Continue the paragraph.'
    })
    expect(parseWriteInlineAction(JSON.stringify({ action: 'edit', replacement: 'Rewrite locally.' }), {
      editTarget: {
        from: 3,
        to: 11,
        original: 'Old text',
        scopeKind: 'paragraph'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Rewrite locally.',
      from: 3,
      to: 11,
      original: 'Old text',
      scopeKind: 'paragraph'
    })
  })

  it('parses XML-style action wrappers', () => {
    expect(parseWriteInlineAction('<short>next words</short>')).toEqual({
      kind: 'short',
      text: 'next words'
    })
    expect(parseWriteInlineAction('<long>Two sentences.\nMaybe three.</long>')).toEqual({
      kind: 'long',
      text: 'Two sentences.\nMaybe three.'
    })
    expect(parseWriteInlineAction('<edit>Replace this scope</edit>', {
      editTarget: {
        from: 12,
        to: 20,
        original: 'old value',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Replace this scope',
      from: 12,
      to: 20,
      original: 'old value',
      scopeKind: 'selection'
    })
  })

  it('parses labeled plain-text fallbacks', () => {
    expect(parseWriteInlineAction('completion: next sentence')).toEqual({
      kind: 'short',
      text: 'next sentence'
    })
    expect(parseWriteInlineAction('long: A fuller continuation.')).toEqual({
      kind: 'long',
      text: 'A fuller continuation.'
    })
    expect(parseWriteInlineAction('edit: Rewrite this block', {
      editTarget: {
        from: 1,
        to: 4,
        original: 'old',
        scopeKind: 'paragraph'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Rewrite this block',
      from: 1,
      to: 4,
      original: 'old',
      scopeKind: 'paragraph'
    })
  })

  it('falls back to the requested mode for unstructured plain text', () => {
    expect(parseWriteInlineAction('Raw continuation text')).toEqual({
      kind: 'short',
      text: 'Raw continuation text'
    })
    expect(parseWriteInlineAction('Raw long continuation', { fallbackKind: 'long' })).toEqual({
      kind: 'long',
      text: 'Raw long continuation'
    })
    expect(parseWriteInlineAction('Raw edit replacement', {
      fallbackKind: 'edit',
      editTarget: {
        from: 8,
        to: 15,
        original: 'old text',
        scopeKind: 'selection'
      }
    })).toEqual({
      kind: 'edit',
      replacement: 'Raw edit replacement',
      from: 8,
      to: 15,
      original: 'old text',
      scopeKind: 'selection'
    })
  })
})
