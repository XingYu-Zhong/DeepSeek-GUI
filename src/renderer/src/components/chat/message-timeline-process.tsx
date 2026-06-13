import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement, RefObject } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Minimize2 } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useChatStore } from '../../store/chat-store'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { MessageBubble } from './message-timeline-bubbles'
import { blockHasPendingRuntimeWork, splitThink } from './message-timeline-turns'
import { formatDuration, formatToolTitle } from './message-timeline-tools'

export type ProcessSection = {
  id: string
  kind: 'reasoning' | 'execution' | 'output'
  blocks: ChatBlock[]
}

export function groupProcessSections(blocks: ChatBlock[]): ProcessSection[] {
  const sections: ProcessSection[] = []

  for (const block of blocks) {
    const kind =
      block.kind === 'reasoning'
        ? 'reasoning'
        : block.kind === 'assistant'
          ? 'output'
          : 'execution'
    const last = sections[sections.length - 1]
    if (last && last.kind === kind) {
      last.blocks.push(block)
      continue
    }
    sections.push({
      id: `${kind}-${block.id}`,
      kind,
      blocks: [block]
    })
  }

  return sections
}

function getReasoningSectionText(section: ProcessSection): string {
  if (section.kind !== 'reasoning') return ''
  return section.blocks
    .filter(
      (block): block is Extract<ChatBlock, { kind: 'reasoning' }> => block.kind === 'reasoning'
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function sectionHasDetails(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string
): boolean {
  if (section.kind === 'reasoning') {
    return getReasoningSectionText(section).length > 0
  }
  if (section.kind === 'output') {
    return section.blocks.some(
      (block) => getProcessDetail(block, describeProcessBlock(block, t)).kind === 'assistant'
    )
  }
  if (section.blocks.length > 1) return true
  const [block] = section.blocks
  return block ? getProcessDetail(block, describeProcessBlock(block, t)).kind !== 'none' : false
}

function isProcessSectionActive(section: ProcessSection, processing: boolean): boolean {
  if (!processing) return false
  if (section.kind === 'reasoning') {
    return section.blocks.some((block) => block.id === 'live-reasoning')
  }
  if (section.kind === 'output') {
    return section.blocks.some((block) => block.id === 'live-assistant')
  }
  return section.blocks.some(
    (block) => block.id === 'live-assistant' || blockHasPendingRuntimeWork(block)
  )
}

function isRequestUserInputTool(block: ChatBlock): boolean {
  if (block.kind === 'user_input' && block.status === 'pending') return true
  if (block.kind !== 'tool' || block.status !== 'running') return false
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  if (toolName === 'request_user_input' || toolName === 'user_input') return true
  return /^request_user_input\s*:/i.test(block.summary.trim())
}

function sectionHasRequestUserInput(section: ProcessSection): boolean {
  return section.blocks.some(isRequestUserInputTool)
}

function isPendingApproval(block: ChatBlock): boolean {
  return block.kind === 'approval' && block.status === 'pending'
}

function sectionHasPendingApproval(section: ProcessSection): boolean {
  return section.blocks.some(isPendingApproval)
}

export function ProcessSectionRow({
  section,
  processing,
  reasoningDurationMs,
  singleReasoningSection,
  viewportRef
}: {
  section: ProcessSection
  processing: boolean
  reasoningDurationMs?: number
  singleReasoningSection: boolean
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const assistantBlocks =
    section.kind === 'output'
      ? section.blocks.filter(
          (block): block is Extract<ChatBlock, { kind: 'assistant' }> => block.kind === 'assistant'
        )
      : []
  const hasDetails = sectionHasDetails(section, t)
  const active = isProcessSectionActive(section, processing)
  const hasError = section.blocks.some(
    (block) =>
      (block.kind === 'tool' && block.status === 'error') ||
      (block.kind === 'approval' && block.status === 'error') ||
      (block.kind === 'user_input' && block.status === 'error') ||
      (block.kind === 'system' && block.severity === 'error')
  )
  const defaultExpanded =
    hasError ||
    sectionHasPendingApproval(section) ||
    (active && section.kind === 'reasoning') ||
    (processing && section.kind === 'execution' && sectionHasRequestUserInput(section))
  const forceExpanded = hasError || sectionHasPendingApproval(section)
  const expanded = hasDetails && (forceExpanded || (userExpanded ?? defaultExpanded))
  const title = describeProcessSection(section, t, {
    processing,
    reasoningDurationMs,
    singleReasoningSection
  })
  const reasoningText = section.kind === 'reasoning' ? getReasoningSectionText(section) : ''
  const canToggleSection = hasDetails && !forceExpanded
  const showActiveError = active && hasError
  const { ref: deferredDetailRef, shouldRender: shouldRenderDetail } = useDeferredRender<HTMLDivElement>({
    enabled: expanded,
    immediate: active || section.kind === 'execution',
    root: viewportRef
  })

  if (section.kind === 'execution' && section.blocks.length === 1) {
    const [block] = section.blocks
    if (block) {
      return <ProcessEntryRow block={block} processing={processing} />
    }
  }

  if (section.kind === 'output') {
    return hasDetails ? (
      <div className="min-w-0">
        <div className="flex flex-col gap-2">
          {assistantBlocks.map((block) => (
            <ProcessEntryDetail
              key={block.id}
              block={block}
              detail={getProcessDetail(block)}
              processing={processing}
            />
          ))}
        </div>
      </div>
    ) : (
      <></>
    )
  }

  return (
    <div className="flex flex-col">
      {canToggleSection ? (
        <button
          type="button"
          onClick={() => setUserExpanded(!(userExpanded ?? defaultExpanded))}
          className={`group flex w-fit max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[14px] font-medium transition hover:opacity-85 ${
            hasError ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'
          }`}
        >
          {showActiveError ? (
            <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
              <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-300" />
            </span>
          ) : null}
          <span className={active && !hasError ? 'ds-shiny-text' : ''}>{title}</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-55" strokeWidth={1.8} />
          )}
        </button>
      ) : (
        <div
          className={`flex w-fit max-w-full items-center gap-1.5 py-0.5 text-[14px] font-medium ${
            hasError ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'
          }`}
        >
          {showActiveError ? (
            <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
              <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-300" />
            </span>
          ) : null}
          <span className={active && !hasError ? 'ds-shiny-text' : ''}>{title}</span>
        </div>
      )}

      {expanded ? (
        <div
          ref={deferredDetailRef}
          className="mt-1 border-l-2 border-ds-border-muted/35 pl-3"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
        >
          {shouldRenderDetail ? (
            section.kind === 'reasoning' ? (
            <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
              <AssistantMarkdown text={reasoningText} streaming={active && processing} />
            </div>
          ) : (
            <ProcessStackRows blocks={section.blocks} processing={processing} />
          )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function processBlockIsRunningTool(block: ChatBlock, processing: boolean): boolean {
  return processing && block.kind === 'tool' && block.status === 'running'
}

function processBlockIsAutoOpenPending(block: ChatBlock, processing: boolean): boolean {
  return (
    processing &&
    ((block.kind === 'compaction' && block.status === 'running') ||
      (block.kind === 'approval' && block.status === 'pending') ||
      (block.kind === 'user_input' && block.status === 'pending'))
  )
}

function processBlockIsActive(block: ChatBlock, processing: boolean): boolean {
  return (
    processBlockIsRunningTool(block, processing) ||
    processBlockIsAutoOpenPending(block, processing) ||
    (processing && block.kind === 'assistant' && block.id === 'live-assistant')
  )
}

function processBlockHasError(block: ChatBlock): boolean {
  return (
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error') ||
    (block.kind === 'system' && block.severity === 'error')
  )
}

function ProcessStackRows({
  blocks,
  processing
}: {
  blocks: ChatBlock[]
  processing: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [openBlockId, setOpenBlockId] = useState<string | null>(null)

  return (
    <div className="ds-work-stack">
      {blocks.map((block) => {
        const summary = describeProcessBlock(block, t)
        const detail = getProcessDetail(block, summary)
        const isRunningTool = processBlockIsRunningTool(block, processing)
        const canExpand = detail.kind !== 'none'
        const autoOpenRequestInput = processing && isRequestUserInputTool(block)
        const autoOpenPending = processBlockIsAutoOpenPending(block, processing) || isPendingApproval(block)
        const isError = processBlockHasError(block)
        const forceOpen = isError || autoOpenPending || autoOpenRequestInput
        const open = canExpand && (forceOpen || openBlockId === block.id)
        const rowActive = processBlockIsActive(block, processing)
        const canToggle = canExpand && !forceOpen
        const handleToggle = (): void => {
          if (!canToggle) return
          setOpenBlockId((id) => (id === block.id ? null : block.id))
        }
        const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
          if (!canToggle) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          handleToggle()
        }

        return (
          <div key={block.id} className="min-w-0">
            <div
              role={canToggle ? 'button' : undefined}
              tabIndex={canToggle ? 0 : undefined}
              onClick={handleToggle}
              onKeyDown={handleKeyDown}
              className={`group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13.5px] leading-6 transition ${
                isError
                  ? 'text-red-600 dark:text-red-300'
                  : 'text-ds-faint hover:text-ds-muted'
              } ${canToggle ? 'cursor-pointer hover:bg-ds-hover/45' : 'cursor-default'}`}
            >
              <span className={`min-w-0 flex-1 truncate ${rowActive && !isError ? 'ds-shiny-text' : ''}`}>
                <ProcessSummaryText block={block} summary={summary} />
              </span>
              {canExpand ? (
                open ? (
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-35" strokeWidth={2} />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-35" strokeWidth={2} />
                )
              ) : null}
            </div>
            {open ? (
              detail.kind === 'assistant' ? (
                <div className="ml-1 mt-1">
                  <ProcessEntryDetail block={block} detail={detail} processing={processing} />
                </div>
              ) : (
                <div className="ds-work-timeline-detail ml-1">
                  <ProcessEntryDetail block={block} detail={detail} processing={processing} />
                </div>
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** One line inside an execution section. */
function ProcessEntryRow({
  block,
  processing
}: {
  block: ChatBlock
  processing: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [userOpen, setUserOpen] = useState(false)
  const summary = describeProcessBlock(block, t)
  const detail = getProcessDetail(block, summary)
  const canExpand = detail.kind !== 'none'
  const isAssistantProcessText = block.kind === 'assistant'
  const isRunningTool = processBlockIsRunningTool(block, processing)
  const isAutoOpenPending = processBlockIsAutoOpenPending(block, processing) || isPendingApproval(block)
  const isStreamingAssistant = processing && block.kind === 'assistant' && block.id === 'live-assistant'
  const isError = processBlockHasError(block)
  const open =
    canExpand &&
    (isError || isAssistantProcessText || isAutoOpenPending || isStreamingAssistant || userOpen)

  const { verb, rest } = splitVerb(summary)
  const rowActive = isRunningTool || isAutoOpenPending || isStreamingAssistant
  const wrapSummary = (block.kind === 'system' && !canExpand) || isAssistantProcessText
  const canToggle = canExpand && !isAutoOpenPending && !isAssistantProcessText && !isError
  const handleToggle = (): void => {
    if (!canToggle) return
    setUserOpen((v) => !v)
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!canToggle) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleToggle()
  }

  return (
    <div className="flex flex-col">
      <div
        role={canToggle ? 'button' : undefined}
        tabIndex={canToggle ? 0 : undefined}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[13.5px] leading-[1.55] transition ${
          isError
            ? 'text-red-600 dark:text-red-300'
            : 'text-ds-faint hover:text-ds-ink'
        } ${
          canToggle
            ? 'cursor-pointer hover:bg-ds-hover/70'
            : 'cursor-default'
        }`}
      >
        {!rowActive && block.kind === 'compaction' ? (
          <Minimize2 className="mt-1 h-3 w-3 shrink-0 opacity-70" strokeWidth={2} />
        ) : null}
        <span
          className={`min-w-0 flex-1 ${wrapSummary ? 'whitespace-pre-wrap break-words' : 'truncate'} ${
            rowActive && !isError ? 'ds-shiny-text' : ''
          }`}
        >
          <span
            className={`font-medium ${isError ? '' : rowActive ? '' : 'text-ds-muted'}`}
          >
            {verb}
          </span>
          {rest ? (
            <span className="ml-1.5 font-mono text-[13px]">
              <ProcessSummaryText block={block} summary={rest} />
            </span>
          ) : null}
        </span>
        {canExpand ? (
          open ? (
            <ChevronDown className="mt-1 h-3 w-3 shrink-0 opacity-40" strokeWidth={2} />
          ) : (
            <ChevronRight className="mt-1 h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-45" strokeWidth={2} />
          )
        ) : null}
      </div>
      <RuntimeMetaBadges block={block} t={t} />
      {canExpand && open ? (
        detail.kind === 'assistant' ? (
          <div className="mt-1">
            <ProcessEntryDetail block={block} detail={detail} processing={processing} />
          </div>
        ) : (
          <div className="ds-work-timeline-detail">
            <ProcessEntryDetail block={block} detail={detail} processing={processing} />
          </div>
        )
      ) : null}
    </div>
  )
}

function describeProcessSection(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    processing: boolean
    reasoningDurationMs?: number
    singleReasoningSection: boolean
  }
): string {
  if (section.kind === 'reasoning') {
    if (opts.processing && isProcessSectionActive(section, true)) {
      return t('thinkingNow')
    }
    if (
      opts.singleReasoningSection &&
      typeof opts.reasoningDurationMs === 'number' &&
      opts.reasoningDurationMs >= 1000
    ) {
      return t('thoughtFor', { duration: formatDuration(opts.reasoningDurationMs) })
    }
    return section.blocks.length > 1
      ? t('thoughtSteps', { count: section.blocks.length })
      : t('thinkingLabel')
  }

  if (section.kind === 'output') {
    return t('processTextLabel')
  }

  if (section.blocks.length === 1) {
    return describeProcessBlock(section.blocks[0], t)
  }

  return summarizeExecutionSection(section.blocks, t)
}

function summarizeExecutionSection(
  blocks: ChatBlock[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  let fileCount = 0
  let commandCount = 0
  let toolCount = 0
  let approvalCount = 0

  for (const block of blocks) {
    if (block.kind === 'approval') {
      approvalCount += 1
      continue
    }
    if (block.kind !== 'tool') continue
    if (block.toolKind === 'file_change') {
      fileCount += 1
    } else if (block.toolKind === 'command_execution') {
      commandCount += 1
    } else {
      toolCount += 1
    }
  }

  const parts: string[] = []
  if (fileCount > 0) {
    parts.push(
      fileCount === 1 ? t('groupEditedFile') : t('groupEditedFiles', { count: fileCount })
    )
  }
  if (commandCount > 0) {
    parts.push(
      commandCount === 1
        ? t('groupRanCommand')
        : t('groupRanCommands', { count: commandCount })
    )
  }
  if (toolCount > 0) {
    parts.push(toolCount === 1 ? t('groupUsedTool') : t('groupUsedTools', { count: toolCount }))
  }
  if (approvalCount > 0) {
    parts.push(
      approvalCount === 1 ? t('groupApproval') : t('groupApprovals', { count: approvalCount })
    )
  }

  if (parts.length > 0) return parts.join(' · ')
  return t('processSteps', { count: blocks.length })
}

function splitVerb(summary: string): { verb: string; rest: string } {
  const trimmed = summary.trim()
  if (!trimmed) return { verb: '', rest: '' }
  const space = trimmed.search(/\s/)
  if (space < 0) return { verb: trimmed, rest: '' }
  return { verb: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() }
}

function toolFilePath(block: ToolBlock): string | undefined {
  const sourceText = [block.summary, block.detail ?? ''].filter(Boolean).join('\n')
  return (
    block.filePath ||
    extractQuotedField(sourceText, 'path') ||
    extractQuotedField(sourceText, 'file_path') ||
    extractQuotedField(sourceText, 'file')
  )
}

function ProcessFileReference({
  path,
  children
}: {
  path: string
  children: string
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)

  const stopRowToggle = (event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  const preview = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    previewWorkspaceFile({ path, workspaceRoot })
  }

  const openInEditor = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    void openWorkspacePathInEditor({ path }, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open process file reference', {
          message: result.message,
          target: { path, workspaceRoot }
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <button
      type="button"
      className="ds-process-file-reference"
      title={t('processFileReferenceHint')}
      onClick={preview}
      onDoubleClick={openInEditor}
      onMouseDown={stopRowToggle}
    >
      {children}
    </button>
  )
}

function ProcessSummaryText({
  block,
  summary
}: {
  block: ChatBlock
  summary: string
}): ReactElement {
  if (block.kind !== 'tool') return <>{summary}</>
  const path = toolFilePath(block)
  if (!path) return <>{summary}</>
  const index = summary.indexOf(path)
  if (index < 0) return <>{summary}</>
  const before = summary.slice(0, index)
  const after = summary.slice(index + path.length)
  return (
    <>
      {before}
      <ProcessFileReference path={path}>{path}</ProcessFileReference>
      {after}
    </>
  )
}

type ProcessDetail =
  | { kind: 'none' }
  | { kind: 'reasoning'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; text: string; isPatch: boolean; isError: boolean; filePath?: string }
  | { kind: 'approval' }
  | { kind: 'user_input' }
  | { kind: 'text'; text: string }

function summarizeProcessText(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function humanizeToolName(name: string): string {
  const trimmed = name.trim().replace(/[_-]+/g, ' ')
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function builtInToolLabel(
  toolName: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | undefined {
  switch (toolName) {
    case 'read':
    case 'read_file':
      return t('toolBuiltinRead')
    case 'write':
    case 'write_file':
      return t('toolBuiltinWrite')
    case 'edit':
    case 'edit_file':
      return t('toolBuiltinEdit')
    case 'grep':
    case 'grep_files':
    case 'search_files':
      return t('toolBuiltinGrep')
    case 'find':
      return t('toolBuiltinFind')
    case 'ls':
      return t('toolBuiltinLs')
    case 'bash':
    case 'shell':
      return t('toolBuiltinBash')
    default:
      return undefined
  }
}

function extractToolName(summary: string): string {
  const match = summary.trim().match(/^([a-z0-9_-]+)\s*:/i)
  return match?.[1] ?? ''
}

function extractQuotedField(text: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const attr = new RegExp(`${escaped}="([^"]+)"`, 'i').exec(text)
  if (attr?.[1]) return attr[1]
  const json = new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, 'i').exec(text)
  if (json?.[1]) return json[1]
  return undefined
}

function readMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!meta) return undefined
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readMetaStringArray(meta: Record<string, unknown> | undefined, key: string): string[] {
  const value = meta?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function readMetaSources(meta: Record<string, unknown> | undefined): Array<{ title?: string; url?: string }> {
  const value = meta?.sources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
    })
    .filter((entry): entry is { title?: string; url?: string } => entry !== null)
}

function RuntimeMetaBadges({
  block,
  t
}: {
  block: ChatBlock
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement | null {
  const meta = block.kind === 'tool' || block.kind === 'approval' || block.kind === 'user' ? block.meta : undefined
  if (!meta) return null
  const sources = readMetaSources(meta)
  const attachmentIds = readMetaStringArray(meta, 'attachmentIds')
  const activeSkillIds = readMetaStringArray(meta, 'activeSkillIds')
  const injectedMemoryIds = readMetaStringArray(meta, 'injectedMemoryIds')
  const child = meta.child && typeof meta.child === 'object' ? meta.child as Record<string, unknown> : null
  const childLabel =
    typeof child?.childLabel === 'string' && child.childLabel.trim()
      ? child.childLabel.trim()
      : typeof child?.childId === 'string'
        ? child.childId
        : ''
  if (
    sources.length === 0 &&
    attachmentIds.length === 0 &&
    activeSkillIds.length === 0 &&
    injectedMemoryIds.length === 0 &&
    !childLabel
  ) {
    return null
  }
  const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
  return (
    <div className="ml-7 mt-1 flex min-w-0 flex-wrap gap-1.5">
      {childLabel ? (
        <span className={chipClass} title={childLabel}>
          <span>{t('toolChildAgent')}</span>
          <span className="max-w-28 truncate font-mono text-ds-muted">{childLabel}</span>
        </span>
      ) : null}
      {activeSkillIds.length > 0 ? (
        <span className={chipClass} title={activeSkillIds.join(', ')}>
          {t('toolActiveSkills')} {activeSkillIds.length}
        </span>
      ) : null}
      {injectedMemoryIds.length > 0 ? (
        <span className={chipClass} title={injectedMemoryIds.join(', ')}>
          {t('toolInjectedMemories')} {injectedMemoryIds.length}
        </span>
      ) : null}
      {attachmentIds.length > 0 ? (
        <span className={chipClass} title={attachmentIds.join(', ')}>
          {t('toolAttachments')} {attachmentIds.length}
        </span>
      ) : null}
      {sources.slice(0, 4).map((source, index) =>
        source.url ? (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={chipClass}
            title={source.url}
          >
            {t('toolSources')} {index + 1}
            <span className="max-w-32 truncate text-ds-muted">{source.title || source.url}</span>
          </a>
        ) : (
          <span key={`${source.title}-${index}`} className={chipClass} title={source.title}>
            {t('toolSources')} {index + 1}
          </span>
        )
      )}
    </div>
  )
}

export function summarizeToolBlock(
  block: ToolBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const rawSummary = block.summary?.trim() ?? ''
  const metaToolName = readMetaString(block.meta, 'toolName')
  const toolName = extractToolName(rawSummary) || metaToolName || ''
  const label = builtInToolLabel(toolName, t) || humanizeToolName(toolName) || formatToolTitle(block, t)
  const sourceText = [rawSummary, block.detail ?? ''].filter(Boolean).join('\n')
  const filePath = toolFilePath(block)
  const pattern =
    extractQuotedField(sourceText, 'pattern') ||
    extractQuotedField(sourceText, 'query') ||
    readMetaString(block.meta, 'pattern')
  const command = readMetaString(block.meta, 'command')

  if ((toolName === 'read_file' || toolName === 'read') && filePath) {
    return `${label} ${filePath}`
  }
  if ((toolName === 'write' || toolName === 'edit' || toolName === 'write_file' || toolName === 'edit_file') && filePath) {
    return `${label} ${filePath}`
  }
  if ((toolName === 'grep_files' || toolName === 'search_files' || toolName === 'grep' || toolName === 'find') && pattern) {
    return filePath ? `${label} ${pattern} · ${filePath}` : `${label} ${pattern}`
  }
  if (toolName === 'ls' && filePath) {
    return `${label} ${filePath}`
  }
  if (command && block.toolKind === 'command_execution') {
    return `${formatToolTitle(block, t)} ${summarizeProcessText(command, 72)}`
  }
  if (filePath) {
    return `${label} ${filePath}`
  }
  if (pattern) {
    return `${label} ${pattern}`
  }
  if (rawSummary) {
    const compact = toolName ? rawSummary.replace(/^([a-z0-9_-]+)\s*:\s*/i, '') : rawSummary
    const summary = summarizeProcessText(compact, 72)
    return summary ? `${label} ${summary}` : label
  }
  return label
}

function normalizeProcessText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function getProcessDetail(block: ChatBlock, summaryText?: string): ProcessDetail {
  if (block.kind === 'reasoning') {
    return block.text.trim() ? { kind: 'reasoning', text: block.text } : { kind: 'none' }
  }
  if (block.kind === 'assistant') {
    const split = splitThink(block.text)
    const text = split.content || split.think
    return text.trim() ? { kind: 'assistant', text } : { kind: 'none' }
  }
  if (block.kind === 'tool') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    const isError = block.status === 'error'
    const patchText =
      block.toolKind === 'file_change' && !isError
        ? extractUnifiedDiffText(detailText)
        : undefined
    return {
      kind: 'tool',
      text: patchText ?? block.detail!,
      isPatch: patchText !== undefined,
      isError,
      filePath: block.filePath
    }
  }
  if (block.kind === 'compaction') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    return { kind: 'text', text: detailText }
  }
  if (block.kind === 'approval') return { kind: 'approval' }
  if (block.kind === 'user_input') return { kind: 'user_input' }
  if (block.kind === 'system' && block.text.trim()) {
    if (block.detail?.trim()) return { kind: 'text', text: block.detail }
    // Short system messages already fit in the summary line — skip the
    // expand affordance so we don't duplicate the same string.
    if (block.text.length <= 140) return { kind: 'none' }
    return { kind: 'text', text: block.text }
  }
  return { kind: 'none' }
}

function ProcessEntryDetail({
  block,
  detail,
  processing
}: {
  block: ChatBlock
  detail: ProcessDetail
  processing: boolean
}): ReactElement | null {
  if (detail.kind === 'reasoning') {
    const streamReason = block.id === 'live-reasoning' && processing
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
        <AssistantMarkdown text={detail.text} streaming={streamReason} />
      </div>
    )
  }
  if (detail.kind === 'assistant') {
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-ink">
        <AssistantMarkdown
          text={detail.text}
          streaming={processing && block.kind === 'assistant' && block.id === 'live-assistant'}
        />
      </div>
    )
  }
  if (detail.kind === 'tool') {
    if (detail.isPatch) {
      return <DiffView patch={detail.text} filePath={detail.filePath} />
    }
    if (detail.isError) {
      return (
        <div className="overflow-hidden rounded-[10px] border border-red-200/80 bg-red-50/80 dark:border-red-800/40 dark:bg-red-500/10">
          {detail.filePath ? (
            <div className="border-b border-red-200/70 bg-red-100/50 px-3 py-1.5 font-mono text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/15 dark:text-red-300">
              {detail.filePath}
            </div>
          ) : null}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12px] leading-6 text-red-800 dark:text-red-200">
            {detail.text}
          </pre>
        </div>
      )
    }
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
        {detail.text}
      </pre>
    )
  }
  if (detail.kind === 'text') {
    return <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">{detail.text}</p>
  }
  if (detail.kind === 'approval' && block.kind === 'approval') {
    return <MessageBubble block={block} nested />
  }
  if (detail.kind === 'user_input' && block.kind === 'user_input') {
    return <MessageBubble block={block} nested />
  }
  return null
}

function describeProcessBlock(
  block: ChatBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.kind === 'reasoning') {
    return t('thinkingLabel')
  }
  if (block.kind === 'assistant') {
    return t('processTextLabel')
  }
  if (block.kind === 'tool') {
    return summarizeToolBlock(block, t)
  }
  if (block.kind === 'compaction') {
    if (block.status === 'running') return t('compactionRunning')
    if (block.status === 'error') return block.summary || t('compactionFailed')
    if (typeof block.messagesBefore === 'number' && typeof block.messagesAfter === 'number') {
      return t('compactionCompletedWithCounts', {
        before: block.messagesBefore,
        after: block.messagesAfter
      })
    }
    return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
  }
  if (block.kind === 'approval') {
    return block.summary || t('approvalTitle')
  }
  if (block.kind === 'user_input') {
    return t('userInputTitle')
  }
  if (block.kind === 'system') {
    return block.text
  }
  return 'text' in block ? block.text : t('processed')
}
