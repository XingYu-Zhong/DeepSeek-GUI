import { randomUUID } from 'node:crypto'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  modelEndpointPath,
  resolveWriteInlineCompletionEndpointFormat,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type ModelEndpointFormat,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  upstreamDeepSeekFimCompletionsUrl,
  upstreamOpenAiChatCompletionsUrl
} from '../../shared/openai-compat-url'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode,
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from '../../shared/write-inline-completion'
import type { WriteInlineEditRecentEdit } from '../../shared/write-inline-edit'
import {
  retrieveWriteInlineCompletionContext,
  type WriteRetrievalContext,
  type WriteRetrievalSnippet
} from './write-retrieval-service'

const INLINE_COMPLETION_TIMEOUT_MS = 12_000
const MAX_INLINE_COMPLETION_DEBUG_ENTRIES = 120
const MAX_DEBUG_TEXT_CHARS = 80_000
const INPUT_BOUNDARY_MARKERS = ['PREFIX', 'SUFFIX', 'EDIT_SCOPE'] as const
const OUTPUT_ACTION_MARKERS = ['SHORT', 'LONG', 'EDIT'] as const

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
    text?: string
  }>
}

type ResponsesApiResponse = {
  output_text?: string
  output?: Array<Record<string, unknown>>
}

type AnthropicMessageResponse = {
  content?: Array<Record<string, unknown>>
}

type ChatCompletionMessage = {
  role: 'system' | 'user'
  content: string
}

type WriteInlineProviderResponseFormat = ModelEndpointFormat | 'fim_completions'

function shouldDisableThinkingForInlineCompletion(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('deepseek-v4') || normalized === 'deepseek-reasoner'
}

const inlineCompletionDebugEntries: WriteInlineCompletionDebugEntry[] = []

function clipDebugText(text = ''): string {
  const source = String(text || '')
  if (source.length <= MAX_DEBUG_TEXT_CHARS) return source
  const head = Math.floor(MAX_DEBUG_TEXT_CHARS * 0.62)
  const tail = MAX_DEBUG_TEXT_CHARS - head - 24
  return `${source.slice(0, head)}\n\n... debug text clipped ...\n\n${source.slice(source.length - tail)}`
}

function appendInlineCompletionDebugEntry(entry: WriteInlineCompletionDebugEntry): void {
  inlineCompletionDebugEntries.push({
    ...entry,
    prompt: clipDebugText(entry.prompt),
    suffix: clipDebugText(entry.suffix),
    rawResponse: clipDebugText(entry.rawResponse),
    completion: clipDebugText(entry.completion)
  })
  if (inlineCompletionDebugEntries.length > MAX_INLINE_COMPLETION_DEBUG_ENTRIES) {
    inlineCompletionDebugEntries.splice(0, inlineCompletionDebugEntries.length - MAX_INLINE_COMPLETION_DEBUG_ENTRIES)
  }
}

export function listWriteInlineCompletionDebugEntries(): WriteInlineCompletionDebugEntry[] {
  return [...inlineCompletionDebugEntries].reverse()
}

export function clearWriteInlineCompletionDebugEntries(): void {
  inlineCompletionDebugEntries.length = 0
}

function appendInlineCompletionPreflightFailure(
  startedAt: number,
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest,
  message: string
): void {
  const model = resolveModel(request, settings)
  const mode = resolveMode(request)
  const prompt = buildWriteInlineCompletionPrompt(request, null)
  appendInlineCompletionDebugEntry({
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    ok: false,
    model,
    mode,
    currentFilePath: request.currentFilePath,
    prompt,
    suffix: request.suffix,
    rawResponse: '',
    completion: '',
    actionKind: undefined,
    errorMessage: message,
    referenceCount: 0,
    recentEditCount: request.recentEdits?.length ?? 0,
    promptChars: prompt.length,
    suffixChars: request.suffix.length,
    responseChars: 0
  })
}

function resolveModel(request: WriteInlineCompletionRequest, settings: AppSettingsV1): string {
  return resolveWriteInlineCompletionModel(settings, request.model)
}

function resolveMode(request: WriteInlineCompletionRequest): WriteInlineCompletionMode {
  if (request.mode === 'edit') return 'edit'
  return request.mode === 'long' ? 'long' : 'short'
}

function flattenMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' || part?.text ? part?.text ?? '' : ''))
    .join('')
}

function cleanCompletionText(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
  const trimmed = normalized.trim()
  if (!trimmed) return ''

  const fenced = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/)
  if (fenced) return fenced[1]
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return normalized
}

function trimMarkerPadding(text = ''): string {
  return String(text || '').replace(/\n$/, '')
}

function markerBlock(marker: string, text = ''): string {
  return `<<<${marker}\n${sanitizePromptLine(text)}\n>>>`
}

function sanitizePromptLine(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/-->/g, '--\\>')
}

function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function clipPromptText(text = '', maxChars = 0): string {
  const source = sanitizePromptLine(text)
  if (!maxChars || source.length <= maxChars) return source
  const head = Math.max(1, Math.floor(maxChars * 0.58))
  const tail = Math.max(1, maxChars - head - 13)
  return `${source.slice(0, head)}\n... omitted ...\n${source.slice(source.length - tail)}`
}

function formatRecentEditAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function buildRecentEditsPromptBlock(edits: WriteInlineEditRecentEdit[] | undefined): string[] {
  const recentEdits = (edits ?? [])
    .filter((edit) => edit.deletedText || edit.insertedText || edit.instruction)
    .slice(-8)
  if (recentEdits.length === 0) return []

  const lines = [
    '',
    'Recent local edits in this file. Treat these as intent signals. If they clearly imply that the user is continuing a local rewrite, you may choose EDIT. If they only show ordinary typing, choose COMPLETION or return an empty completion.'
  ]

  recentEdits.forEach((edit, index) => {
    lines.push('')
    lines.push(`[${index + 1}] ${formatRecentEditAge(edit.ageMs)}; source=${edit.source}; range=${edit.from}-${edit.to}${edit.scopeKind ? `; scope=${edit.scopeKind}` : ''}`)
    if (edit.instruction) lines.push(`Instruction: ${clipPromptText(edit.instruction, 420)}`)
    if (edit.deletedText) lines.push(`Deleted: ${clipPromptText(edit.deletedText, 520)}`)
    if (edit.insertedText) lines.push(`Inserted: ${clipPromptText(edit.insertedText, 520)}`)
    const around = compactText(`${edit.beforeContext} [[edit]] ${edit.afterContext}`)
    if (around) lines.push(`Around: ${clipPromptText(around, 520)}`)
  })

  return lines
}

function buildEditCandidatePromptBlock(request: WriteInlineCompletionRequest): string[] {
  const candidate = request.editCandidate
  if (!candidate) return []
  const scopeLines = candidate.startLine === candidate.endLine
    ? `line ${candidate.startLine}`
    : `lines ${candidate.startLine}-${candidate.endLine}`
  return [
    '',
    'Editable local scope if EDIT is the best action.',
    'Choose EDIT when the user instruction or recent user changes make a replacement more useful than cursor completion.',
    `Edit candidate: ${candidate.kind}; ${scopeLines}; offsets ${candidate.from}-${candidate.to}.`,
    'Original editable scope boundary:',
    markerBlock('EDIT_SCOPE', candidate.original)
  ]
}

function buildEditActionGuidanceBlock(request: WriteInlineCompletionRequest): string[] {
  if (!request.editCandidate) return []
  return [
    '',
    'Edit action guidance:',
    'An editable scope is available in <<<EDIT_SCOPE ... >>>. Return <<<EDIT ... >>> only when replacing that exact scope is the best local action.',
    'If the user is simply continuing at the cursor, return <<<SHORT ... >>> or <<<LONG ... >>> instead.'
  ]
}

function buildResponseProtocolPromptBlock(): string[] {
  return [
    'Return exactly one TextIDE-style action block and nothing else:',
    '<<<SHORT',
    'short text to insert at the cursor',
    '>>>',
    '<<<LONG',
    'longer continuation to insert at the cursor',
    '>>>',
    '<<<EDIT',
    'replacement text for the editable local scope',
    '>>>'
  ]
}

function buildMarkedContextBlocks(request: WriteInlineCompletionRequest): string[] {
  return [
    '',
    'Boundary-marked cursor context:',
    markerBlock('PREFIX', request.prefix),
    markerBlock('SUFFIX', request.suffix)
  ]
}

function buildRetrievalPromptBlock(
  retrieval: WriteRetrievalContext,
  mode: WriteInlineCompletionMode
): string[] {
  const lines = [
    '',
    'Reference snippets from the same writing workspace.',
    'Use these snippets only for local terminology, factual continuity, and style. Do not mention them in the returned action.',
    `Completion mode: ${mode}.`,
    `Retrieval: ${retrieval.source}; indexed ${retrieval.indexedFiles} files / ${retrieval.indexedChunks} chunks.`,
    `Query keywords: ${retrieval.keywords.join(', ')}`
  ]

  const formatSnippetLocation = (snippet: WriteRetrievalSnippet): string => {
    if (snippet.location.kind === 'pdf') {
      return snippet.location.pageStart === snippet.location.pageEnd
        ? `${snippet.path}#page=${snippet.location.pageStart}`
        : `${snippet.path}#page=${snippet.location.pageStart}-${snippet.location.pageEnd}`
    }
    return snippet.location.lineStart === snippet.location.lineEnd
      ? `${snippet.path}:${snippet.location.lineStart}`
      : `${snippet.path}:${snippet.location.lineStart}-${snippet.location.lineEnd}`
  }

  retrieval.snippets.forEach((snippet, index) => {
    const location = formatSnippetLocation(snippet)
    lines.push('')
    lines.push(`[${index + 1}] ${location}`)
    if (snippet.title) lines.push(`Title: ${sanitizePromptLine(snippet.title)}`)
    lines.push(`Matched: ${snippet.keywords.join(', ')}`)
    lines.push(sanitizePromptLine(snippet.text))
  })

  return lines
}

export function buildWriteInlineCompletionPrompt(
  request: WriteInlineCompletionRequest,
  retrieval: WriteRetrievalContext | null = null
): string {
  const mode = resolveMode(request)
  const lines = [
    '<!-- Kun inline completion.',
    'Complete the text at the cursor.',
    'The boundary blocks below identify local context, but the response must be plain insertable text only.',
    'Return only the text to insert at the cursor.',
    'Do not wrap the answer in quotes, Markdown fences, XML, JSON, or action markers.',
    'Do not echo <<<PREFIX ... >>>, <<<SUFFIX ... >>>, or these instructions.',
    mode === 'long'
      ? 'The user has paused for inspiration. Suggest one compact, grounded continuation only when it clearly fits.'
      : 'Prefer a short, precise continuation that looks like the next few keystrokes.',
    'Return an empty response only when there is no sensible local continuation.',
    `Trigger hint: ${mode}.`,
    `Cursor: line ${request.cursor.line}, column ${request.cursor.column}.`,
    `Language: ${sanitizePromptLine(request.context.language)}.`,
    `Policy: ${sanitizePromptLine(request.policy.name)}.`,
    sanitizePromptLine(request.policy.instruction),
    '',
    'Cursor context:',
    `Current line prefix: ${sanitizePromptLine(request.context.currentLinePrefix)}`,
    `Current line suffix: ${sanitizePromptLine(request.context.currentLineSuffix)}`,
    `Previous non-empty line: ${sanitizePromptLine(request.context.previousNonEmptyLine)}`,
    `Next line: ${sanitizePromptLine(request.context.nextLine)}`,
    `Signals: ${JSON.stringify(request.context.signals)}`,
    ...buildRecentEditsPromptBlock(request.recentEdits),
    ...(retrieval?.snippets.length ? buildRetrievalPromptBlock(retrieval, mode) : []),
    ...buildMarkedContextBlocks(request),
    'For the FIM engine, the raw prefix also follows this instruction block.',
    '-->',
    ''
  ]
  return `${lines.join('\n')}${request.prefix}`
}

function buildChatPromptSection(marker: string, text = ''): string {
  return markerBlock(marker, text)
}

export function buildWriteInlineCompletionChatMessages(
  request: WriteInlineCompletionRequest,
  retrieval: WriteRetrievalContext | null = null
): ChatCompletionMessage[] {
  const mode = resolveMode(request)
  const userLines = [
    `Trigger hint: ${mode}. The model must decide whether the returned type is short, long, or edit.`,
    `Cursor: line ${request.cursor.line}, column ${request.cursor.column}.`,
    `Language: ${sanitizePromptLine(request.context.language)}.`,
    `Policy: ${sanitizePromptLine(request.policy.name)}.`,
    sanitizePromptLine(request.policy.instruction),
    '',
    ...buildResponseProtocolPromptBlock(),
    '',
    'Choose SHORT for normal next-keystroke writing, sentence continuation, or list continuation.',
    'Choose LONG when the local context clearly needs a fuller next thought or paragraph.',
    'Choose EDIT when the user instruction or recent local edits imply an existing nearby scope should be rewritten.',
    'If neither action is useful, return an empty <<<SHORT ... >>> block.',
    'Do not echo <<<PREFIX ... >>>, <<<SUFFIX ... >>>, or <<<EDIT_SCOPE ... >>> in the response.',
    '',
    'Cursor context:',
    `Current line prefix: ${sanitizePromptLine(request.context.currentLinePrefix)}`,
    `Current line suffix: ${sanitizePromptLine(request.context.currentLineSuffix)}`,
    `Previous non-empty line: ${sanitizePromptLine(request.context.previousNonEmptyLine)}`,
    `Next line: ${sanitizePromptLine(request.context.nextLine)}`,
    `Signals: ${JSON.stringify(request.context.signals)}`,
    ...buildEditActionGuidanceBlock(request),
    ...buildRecentEditsPromptBlock(request.recentEdits),
    ...buildEditCandidatePromptBlock(request),
    ...(retrieval?.snippets.length ? buildRetrievalPromptBlock(retrieval, mode) : []),
    '',
    buildChatPromptSection('PREFIX', request.prefix),
    buildChatPromptSection('SUFFIX', request.suffix)
  ]

  return [
    {
      role: 'system',
      content: [
        'You are Kun inline writing. You perform local writing completion and in-place text edits.',
        'For edit tasks, reason from <<<PREFIX ... >>>, <<<EDIT_SCOPE ... >>>, and <<<SUFFIX ... >>>, then return only the replacement inside <<<EDIT ... >>>.',
        'Do not include explanations, markdown fences outside the marked action, before/after labels, or unchanged surrounding text outside the chosen action.'
      ].join('\n')
    },
    {
      role: 'user',
      content: userLines.join('\n')
    }
  ]
}

function debugPromptFromMessages(messages: ChatCompletionMessage[]): string {
  return messages
    .map((message) => `## ${message.role}\n${message.content}`)
    .join('\n\n')
}

function compatibleModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (endpointFormat === 'chat_completions') return upstreamOpenAiChatCompletionsUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  if (normalized.toLowerCase().endsWith(`/${path}`)) return normalized
  const withoutEndpoint = stripKnownModelEndpointPath(normalized)
  const lastSegment = withoutEndpoint.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${withoutEndpoint.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (/^v\d+$/.test(lastSegment)) {
    return `${withoutEndpoint}/${path}`
  }
  return `${withoutEndpoint}/v1/${path}`
}

function stripKnownModelEndpointPath(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  for (const path of ['chat/completions', 'responses', 'messages']) {
    if (lower.endsWith(`/${path}`)) {
      return baseUrl.slice(0, -path.length).replace(/\/+$/, '')
    }
  }
  return baseUrl
}

function isDeepSeekInlineCompletionBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl)
    return parsed.hostname.toLowerCase().endsWith('deepseek.com')
  } catch {
    return baseUrl.toLowerCase().includes('deepseek.com')
  }
}

function buildProviderHeaders(apiKey: string, responseFormat: WriteInlineProviderResponseFormat): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (responseFormat === 'messages') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  return headers
}

function buildAnthropicMessages(messages: ChatCompletionMessage[]): {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system: string[] = []
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }
    out.push({ role: 'user', content: message.content })
  }
  return { system: system.join('\n\n'), messages: out }
}

function buildProviderRequestBody(input: {
  responseFormat: WriteInlineProviderResponseFormat
  model: string
  messages: ChatCompletionMessage[] | null
  prompt: string
  suffix: string
  maxTokens: number
}): Record<string, unknown> {
  if (input.responseFormat === 'fim_completions') {
    return {
      model: input.model,
      prompt: input.prompt,
      suffix: input.suffix,
      max_tokens: input.maxTokens
    }
  }
  const messages = input.messages ?? [
    { role: 'user' as const, content: input.prompt }
  ]
  if (input.responseFormat === 'messages') {
    const converted = buildAnthropicMessages(messages)
    return {
      model: input.model,
      messages: converted.messages,
      max_tokens: input.maxTokens,
      ...(converted.system ? { system: converted.system } : {})
    }
  }
  if (input.responseFormat === 'responses') {
    return {
      model: input.model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      max_output_tokens: input.maxTokens
    }
  }
  return {
    model: input.model,
    messages,
    max_tokens: input.maxTokens,
    ...(shouldDisableThinkingForInlineCompletion(input.model)
      ? { thinking: { type: 'disabled' } }
      : {})
  }
}

function providerTextFromResponse(
  responseText: string,
  format: WriteInlineProviderResponseFormat = 'chat_completions'
): string {
  let parsed: ChatCompletionResponse | ResponsesApiResponse | AnthropicMessageResponse
  try {
    parsed = JSON.parse(responseText) as ChatCompletionResponse | ResponsesApiResponse | AnthropicMessageResponse
  } catch {
    throw new Error('Inline completion provider returned non-JSON data.')
  }
  if (format === 'responses') {
    return textFromResponsesPayload(parsed as ResponsesApiResponse)
  }
  if (format === 'messages') {
    return textFromAnthropicPayload(parsed as AnthropicMessageResponse)
  }
  const chatPayload = parsed as ChatCompletionResponse
  const firstChoice = chatPayload.choices?.[0]
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  const first = firstChoice?.message?.content
  return flattenMessageContent(first)
}

function textFromResponsesPayload(payload: ResponsesApiResponse): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const text = record.text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function textFromAnthropicPayload(payload: AnthropicMessageResponse): string {
  const parts: string[] = []
  for (const block of payload.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('')
}

export type WriteInlineActionEditTarget = {
  from: number
  to: number
  original: string
  scopeKind?: 'selection' | 'paragraph'
}

function completionAction(
  text: string,
  kind: Extract<WriteInlineCompletionMode, 'short' | 'long'> = 'short'
): WriteInlineCompletionAction {
  return { kind, text: cleanCompletionText(text) }
}

function editAction(
  replacement: string,
  target: WriteInlineActionEditTarget | undefined
): WriteInlineCompletionAction {
  const cleaned = cleanCompletionText(replacement)
  if (!target) return completionAction(cleaned)
  return {
    kind: 'edit',
    replacement: cleaned,
    from: target.from,
    to: target.to,
    original: target.original,
    scopeKind: target.scopeKind
  }
}

function actionFromJsonValue(
  value: unknown,
  options: { editTarget?: WriteInlineActionEditTarget }
): WriteInlineCompletionAction | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawKind = String(record.kind ?? record.action ?? record.type ?? '').trim().toLowerCase()
  const text = String(record.text ?? record.completion ?? record.insert ?? record.replacement ?? record.edit ?? '')
  if (rawKind === 'short' || rawKind === 'completion' || rawKind === 'insert') return completionAction(text, 'short')
  if (rawKind === 'long') return completionAction(text, 'long')
  if (rawKind === 'edit' || rawKind === 'replacement' || rawKind === 'replace') {
    return editAction(text, options.editTarget)
  }
  return null
}

function containsInputBoundaryEcho(text: string): boolean {
  return INPUT_BOUNDARY_MARKERS.some((marker) => new RegExp(`<<<\\s*${marker}\\b`, 'i').test(text)) ||
    text.includes('Return only the text to insert at the cursor.')
}

function parseMarkedActionBlock(
  text: string,
  options: { editTarget?: WriteInlineActionEditTarget }
): WriteInlineCompletionAction | null {
  for (const marker of OUTPUT_ACTION_MARKERS) {
    const exact = new RegExp(`^<<<[ \\t]*${marker}[ \\t]*\\n([\\s\\S]*?)\\n?>>>$`, 'i').exec(text)
    const embedded = exact ?? new RegExp(`<<<[ \\t]*${marker}[ \\t]*\\n([\\s\\S]*?)\\n?>>>`, 'i').exec(text)
    if (!embedded) continue
    const body = trimMarkerPadding(embedded[1])
    if (marker === 'SHORT') return completionAction(body, 'short')
    if (marker === 'LONG') return completionAction(body, 'long')
    return editAction(body, options.editTarget)
  }
  return null
}

export function parseWriteInlineAction(
  raw: string,
  options: {
    fallbackKind?: WriteInlineCompletionAction['kind']
    editTarget?: WriteInlineActionEditTarget
  } = {}
): WriteInlineCompletionAction {
  const fallbackKind = options.fallbackKind ?? 'short'
  const normalized = raw.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
  const trimmed = normalized.trim()
  if (!trimmed) {
    return fallbackKind === 'edit'
      ? editAction('', options.editTarget)
      : completionAction('', fallbackKind === 'long' ? 'long' : 'short')
  }

  if (containsInputBoundaryEcho(trimmed)) {
    return fallbackKind === 'edit'
      ? editAction('', options.editTarget)
      : completionAction('', fallbackKind === 'long' ? 'long' : 'short')
  }

  const marked = parseMarkedActionBlock(trimmed, { editTarget: options.editTarget })
  if (marked) return marked

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const action = actionFromJsonValue(parsed, { editTarget: options.editTarget })
    if (action) return action
  } catch {
    /* XML/plain-text fallbacks below. */
  }

  const short = trimmed.match(/^<short(?:\s[^>]*)?>([\s\S]*?)<\/short>$/i) ??
    trimmed.match(/<short(?:\s[^>]*)?>([\s\S]*?)<\/short>/i)
  if (short) return completionAction(short[1], 'short')

  const long = trimmed.match(/^<long(?:\s[^>]*)?>([\s\S]*?)<\/long>$/i) ??
    trimmed.match(/<long(?:\s[^>]*)?>([\s\S]*?)<\/long>/i)
  if (long) return completionAction(long[1], 'long')

  const completion = trimmed.match(/^<completion(?:\s[^>]*)?>([\s\S]*?)<\/completion>$/i) ??
    trimmed.match(/<completion(?:\s[^>]*)?>([\s\S]*?)<\/completion>/i)
  if (completion) return completionAction(completion[1], fallbackKind === 'long' ? 'long' : 'short')

  const edit = trimmed.match(/^<edit(?:\s[^>]*)?>([\s\S]*?)<\/edit>$/i) ??
    trimmed.match(/<edit(?:\s[^>]*)?>([\s\S]*?)<\/edit>/i)
  if (edit) return editAction(edit[1], options.editTarget)

  const labeledCompletion = trimmed.match(/^(?:completion|insert)[:：]\s*([\s\S]*)$/i)
  if (labeledCompletion) return completionAction(labeledCompletion[1], fallbackKind === 'long' ? 'long' : 'short')
  const labeledShort = trimmed.match(/^(?:short)[:：]\s*([\s\S]*)$/i)
  if (labeledShort) return completionAction(labeledShort[1], 'short')
  const labeledLong = trimmed.match(/^(?:long)[:：]\s*([\s\S]*)$/i)
  if (labeledLong) return completionAction(labeledLong[1], 'long')
  const labeledEdit = trimmed.match(/^(?:edit|replacement|replace|new text|edited text|替换文本|修改后|修改|替换)[:：]\s*([\s\S]*)$/i)
  if (labeledEdit) return editAction(labeledEdit[1], options.editTarget)

  return fallbackKind === 'edit'
    ? editAction(normalized, options.editTarget)
    : completionAction(normalized, fallbackKind === 'long' ? 'long' : 'short')
}

export function extractWriteInlineAction(
  responseText: string,
  options: {
    fallbackKind?: WriteInlineCompletionAction['kind']
    editTarget?: WriteInlineActionEditTarget
    responseFormat?: WriteInlineProviderResponseFormat
  } = {}
): WriteInlineCompletionAction {
  return parseWriteInlineAction(providerTextFromResponse(responseText, options.responseFormat), options)
}

export async function requestWriteInlineCompletion(
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest
): Promise<WriteInlineCompletionResult> {
  const startedAt = Date.now()
  if (settings.write.inlineCompletion.enabled === false) {
    appendInlineCompletionPreflightFailure(startedAt, settings, request, 'Inline completion is disabled.')
    return { ok: false, message: 'Inline completion is disabled.' }
  }

  const apiKey = resolveWriteInlineCompletionApiKey(settings)
  if (!apiKey) {
    appendInlineCompletionPreflightFailure(startedAt, settings, request, 'Missing API key for inline completion.')
    return { ok: false, message: 'Missing API key for inline completion.' }
  }

  const model = resolveModel(request, settings)
  const mode = resolveMode(request)
  const actionMayEdit = Boolean(request.editCandidate && request.recentEdits?.length)
  const useChatCompletions = mode === 'edit' || actionMayEdit
  const baseUrl = resolveWriteInlineCompletionBaseUrl(settings)
  const endpointFormat = resolveWriteInlineCompletionEndpointFormat(settings)
  const useFimCompletions =
    !useChatCompletions &&
    endpointFormat === 'chat_completions' &&
    isDeepSeekInlineCompletionBaseUrl(baseUrl)
  const responseFormat: WriteInlineProviderResponseFormat = useFimCompletions
    ? 'fim_completions'
    : endpointFormat
  const url = useFimCompletions
    ? upstreamDeepSeekFimCompletionsUrl(baseUrl)
    : compatibleModelEndpointUrl(baseUrl, endpointFormat)
  const maxTokens = mode === 'long' || mode === 'edit' || actionMayEdit
    ? settings.write.inlineCompletion.longMaxTokens || settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
    : settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
  const retrieval = settings.write.inlineCompletion.retrievalEnabled === false
    ? null
    : await retrieveWriteInlineCompletionContext(request, {
        maxSnippets: mode === 'long' || mode === 'edit' || actionMayEdit ? 5 : 3
      }).catch(() => null)
  const messages = useFimCompletions
    ? null
    : buildWriteInlineCompletionChatMessages(request, retrieval)
  const prompt = messages
    ? debugPromptFromMessages(messages)
    : buildWriteInlineCompletionPrompt(request, retrieval)
  const debugBase = {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    model,
    mode,
    currentFilePath: request.currentFilePath,
    prompt,
    suffix: request.suffix,
    referenceCount: retrieval?.snippets.length ?? 0,
    recentEditCount: request.recentEdits?.length ?? 0,
    promptChars: prompt.length,
    suffixChars: request.suffix.length
  }

  try {
    const body = buildProviderRequestBody({
      responseFormat,
      model,
      messages,
      prompt,
      suffix: request.suffix,
      maxTokens
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: buildProviderHeaders(apiKey, responseFormat),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INLINE_COMPLETION_TIMEOUT_MS)
    })
    const text = await response.text()
    if (!response.ok) {
      appendInlineCompletionDebugEntry({
        ...debugBase,
        durationMs: Date.now() - startedAt,
        ok: false,
        rawResponse: text,
        completion: '',
        responseChars: text.length,
        errorMessage: `Inline completion request failed (${response.status})`
      })
      return {
        ok: false,
        message: `Inline completion request failed (${response.status}): ${text.slice(0, 300)}`
      }
    }

    const action = extractWriteInlineAction(text, {
      fallbackKind: mode,
      responseFormat,
      editTarget: request.editCandidate
        ? {
            from: request.editCandidate.from,
            to: request.editCandidate.to,
            original: request.editCandidate.original,
            scopeKind: request.editCandidate.kind
          }
        : undefined
    })
    const completion = action.kind === 'edit' ? action.replacement : action.text
    const finalMode = action.kind
    appendInlineCompletionDebugEntry({
      ...debugBase,
      mode: finalMode,
      durationMs: Date.now() - startedAt,
      ok: true,
      rawResponse: text,
      completion,
      actionKind: finalMode,
      responseChars: text.length
    })

    return {
      ok: true,
      completion,
      action,
      model,
      mode: finalMode
    }
  } catch (error) {
    appendInlineCompletionDebugEntry({
      ...debugBase,
      durationMs: Date.now() - startedAt,
      ok: false,
      rawResponse: '',
      completion: '',
      responseChars: 0,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
