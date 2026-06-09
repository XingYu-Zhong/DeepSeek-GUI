import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { EditorSelection, Facet, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath
} from '../components/write/WriteMarkdownPreview'
import {
  CodeBlockToolbarWidget,
  CodeBlockWidget,
  HrWidget,
  ImageWidget,
  ListBulletWidget,
  TableWidget,
  TaskCheckboxWidget,
  closingFencePattern,
  openingFence,
  parseFencedCodeBlock,
  type CodeBlockRange,
  type ParsedTable
} from './markdown-live-widgets'

type DecorationRange = {
  from: number
  to: number
  deco: Decoration
}

type BlockRange = {
  from: number
  to: number
}

type MarkdownImageContext = {
  filePath?: string | null
}

const CONCEAL_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'URL',
  'QuoteMark'
])

const markdownImageContextFacet = Facet.define<MarkdownImageContext, MarkdownImageContext>({
  combine(values) {
    return values[0] ?? {}
  }
})

const hideMark = Decoration.mark({ class: 'cm-write-md-hidden-mark' })
const centerLineDeco = Decoration.line({ class: 'cm-write-md-center-line' })
const blockquoteLineDeco = Decoration.line({ class: 'cm-write-md-blockquote-line' })
const autolinkDeco = Decoration.mark({ class: 'cm-write-md-link-text' })
const markDeco = Decoration.mark({ class: 'cm-write-md-mark' })
const codeBlockLineDeco = Decoration.line({ class: 'cm-write-md-codeblock-line' })

const writeMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.95em', fontWeight: '700', letterSpacing: '-0.035em' },
  { tag: tags.heading2, fontSize: '1.45em', fontWeight: '650', letterSpacing: '-0.025em' },
  { tag: tags.heading3, fontSize: '1.18em', fontWeight: '650' },
  { tag: tags.heading4, fontSize: '1.05em', fontWeight: '650' },
  { tag: tags.heading5, fontSize: '1em', fontWeight: '650' },
  { tag: tags.heading6, fontSize: '0.96em', fontWeight: '650', color: 'var(--ds-text-muted)' },
  { tag: tags.processingInstruction, color: 'var(--ds-text-faint)', opacity: '0.58' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: tags.monospace,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '0.9em',
    backgroundColor: 'color-mix(in srgb, var(--ds-text) 6%, transparent)',
    borderRadius: '5px'
  },
  { tag: tags.link, color: 'var(--ds-accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--ds-text-faint)', fontSize: '0.86em' },
  { tag: tags.quote, color: 'var(--ds-text-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--ds-text-faint)' }
])

const writeMarkdownLiveTheme = EditorView.theme({
  '&.cm-write-live-preview .cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '&.cm-write-live-preview .cm-line': {
    paddingTop: '0.18rem',
    paddingBottom: '0.18rem'
  },
  '&.cm-write-live-preview .cm-write-md-center-line': {
    textAlign: 'center'
  },
  '&.cm-write-live-preview .cm-write-md-blockquote-line': {
    borderLeft: '3px solid color-mix(in srgb, var(--ds-accent) 42%, transparent)',
    color: 'var(--ds-text-muted)',
    paddingLeft: '0.9rem'
  },
  '&.cm-write-live-preview .cm-write-md-link-text': {
    color: 'var(--ds-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px'
  },
  '&.cm-write-live-preview .cm-write-md-mark': {
    borderRadius: '4px',
    backgroundColor: 'color-mix(in srgb, #f7d154 48%, transparent)',
    padding: '0 2px'
  }
})

function collectRevealLines(view: EditorView): Set<number> {
  if (!view.hasFocus || view.state.selection.ranges.some((range) => !range.empty)) return new Set()
  return collectActiveLinesFromState(view.state)
}

function collectRevealLinesFromState(state: EditorState, hasFocus: boolean): Set<number> {
  if (!hasFocus || state.selection.ranges.some((range) => !range.empty)) return new Set()
  return collectActiveLinesFromState(state)
}

function collectActiveLinesFromState(state: EditorState): Set<number> {
  const active = new Set<number>()
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number
    const end = state.doc.lineAt(range.to).number
    for (let line = start; line <= end; line += 1) active.add(line)
  }
  return active
}

function nodeTouchesActiveLine(view: EditorView, from: number, to: number, activeLines: Set<number>): boolean {
  return rangeTouchesActiveLine(view.state, from, to, activeLines)
}

function rangeTouchesActiveLine(state: EditorState, from: number, to: number, activeLines: Set<number>): boolean {
  const start = state.doc.lineAt(from).number
  const end = state.doc.lineAt(Math.max(from, to - 1)).number
  for (let line = start; line <= end; line += 1) {
    if (activeLines.has(line)) return true
  }
  return false
}

function markdownImageFromSource(source: string, filePath?: string | null): {
  src: string
  alt: string
  localPath?: string
} | null {
  const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/.exec(source.trim())
  if (!match) return null
  const resolved = resolveWriteMarkdownResource(match[2], filePath)
  if (!resolved) return null
  const localPath = resolveWriteMarkdownResourcePath(match[2], filePath)
  return { alt: match[1] || '', src: resolved, ...(localPath ? { localPath } : {}) }
}

function splitTableLine(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseMarkdownTable(source: string): ParsedTable | null {
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const headers = splitTableLine(lines[0])
  const delimiter = splitTableLine(lines[1])
  if (headers.length === 0 || delimiter.length !== headers.length) return null
  const validDelimiter = delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
  if (!validDelimiter) return null
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableLine(line)
    while (cells.length < headers.length) cells.push('')
    return cells.slice(0, headers.length)
  })
  return { headers, rows }
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && splitTableLine(trimmed).length >= 2
}

function looksLikeTableDelimiter(line: string, expectedCells: number): boolean {
  const delimiter = splitTableLine(line)
  return delimiter.length === expectedCells && delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function collectMarkdownTableRanges(
  view: EditorView,
  from: number,
  to: number,
  activeLines: Set<number>
): Array<BlockRange & { table: ParsedTable }> {
  return collectMarkdownTableRangesFromState(view.state, from, to, activeLines)
}

function collectMarkdownTableRangesFromState(
  state: EditorState,
  from: number,
  to: number,
  activeLines: Set<number>
): Array<BlockRange & { table: ParsedTable }> {
  const tables: Array<BlockRange & { table: ParsedTable }> = []
  let line = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to).number

  while (line.number < endLine) {
    const headerText = line.text
    if (!looksLikeTableRow(headerText)) {
      if (line.to >= to) break
      line = state.doc.line(line.number + 1)
      continue
    }

    const delimiterLine = state.doc.line(line.number + 1)
    const headers = splitTableLine(headerText)
    if (!looksLikeTableDelimiter(delimiterLine.text, headers.length)) {
      if (line.to >= to) break
      line = state.doc.line(line.number + 1)
      continue
    }

    let lastLine = delimiterLine
    let nextNumber = delimiterLine.number + 1
    while (nextNumber <= state.doc.lines) {
      const nextLine = state.doc.line(nextNumber)
      if (!looksLikeTableRow(nextLine.text)) break
      lastLine = nextLine
      nextNumber += 1
    }

    if (!rangeTouchesActiveLine(state, line.from, lastLine.to, activeLines)) {
      const source = state.doc.sliceString(line.from, lastLine.to)
      const table = parseMarkdownTable(source)
      if (table) tables.push({ from: line.from, to: lastLine.to, table })
    }

    if (lastLine.number >= endLine || lastLine.to >= to) break
    line = state.doc.line(lastLine.number + 1)
  }

  return tables
}

function collectMarkdownCodeBlockRanges(
  view: EditorView,
  from: number,
  to: number,
  activeLines: Set<number>
): CodeBlockRange[] {
  return collectMarkdownCodeBlockRangesFromState(view.state, from, to, activeLines)
}

function collectMarkdownCodeBlockRangesFromState(
  state: EditorState,
  from: number,
  to: number,
  _activeLines: Set<number>
): CodeBlockRange[] {
  const blocks: CodeBlockRange[] = []
  let line = state.doc.line(1)
  const rangeFrom = Math.max(0, from)
  const rangeTo = Math.max(rangeFrom, to)

  while (line.number <= state.doc.lines) {
    const fence = openingFence(line.text)
    if (!fence) {
      if (line.number >= state.doc.lines) break
      line = state.doc.line(line.number + 1)
      continue
    }

    const closePattern = closingFencePattern(fence.marker)
    let lastLine = line
    let nextNumber = line.number + 1
    while (nextNumber <= state.doc.lines) {
      const nextLine = state.doc.line(nextNumber)
      lastLine = nextLine
      if (closePattern.test(nextLine.text)) break
      nextNumber += 1
    }

    if (lastLine.to >= rangeFrom && line.from <= rangeTo) {
      const source = state.doc.sliceString(line.from, lastLine.to)
      blocks.push({ from: line.from, to: lastLine.to, block: parseFencedCodeBlock(source) })
    }

    if (lastLine.number >= state.doc.lines) break
    line = state.doc.line(lastLine.number + 1)
  }

  return blocks
}

export const markdownLivePreviewTestInternals = {
  collectMarkdownCodeBlockRangesFromState,
  collectRevealLinesFromState
}

function addFencedCodeLineDecorations(
  view: EditorView,
  block: CodeBlockRange,
  activeLines: Set<number>,
  ranges: DecorationRange[]
): void {
  const startLine = view.state.doc.lineAt(block.from)
  const endLine = view.state.doc.lineAt(Math.max(block.from, block.to - 1))
  let blockActive = false
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    if (activeLines.has(lineNumber)) {
      blockActive = true
      break
    }
  }

  if (!blockActive) return

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    ranges.push({ from: line.from, to: line.from, deco: codeBlockLineDeco })
  }

  if (startLine.from < startLine.to) {
    ranges.push({
      from: startLine.from,
      to: startLine.to,
      deco: Decoration.replace({ widget: new CodeBlockToolbarWidget(block.block) })
    })
  }

  if (endLine.number !== startLine.number && endLine.from < endLine.to) {
    ranges.push({
      from: endLine.from,
      to: endLine.to,
      deco: Decoration.replace({})
    })
  }
}

function isInsideBlockRanges(from: number, to: number, blocks: BlockRange[]): boolean {
  return blocks.some((block) => from >= block.from && to <= block.to)
}

function addConcealRange(view: EditorView, nodeName: string, from: number, to: number, ranges: DecorationRange[]): void {
  let hideTo = to
  if (nodeName === 'HeaderMark' && view.state.doc.sliceString(hideTo, hideTo + 1) === ' ') {
    hideTo += 1
  }
  ranges.push({ from, to: hideTo, deco: hideMark })
}

function addTaskMarker(view: EditorView, from: number, to: number, ranges: DecorationRange[]): void {
  const marker = view.state.doc.sliceString(from, to)
  const checked = /\[[xX]\]/.test(marker)
  ranges.push({
    from,
    to,
    deco: Decoration.replace({
      widget: new TaskCheckboxWidget(checked, from, to)
    })
  })
}

function buildDecorationSet(ranges: DecorationRange[]): DecorationSet {
  return Decoration.set(
    ranges
      .filter((range) => range.to >= range.from)
      .map((range) => range.deco.range(range.from, range.to)),
    true
  )
}

function buildMarkdownBlockDecorations(state: EditorState): DecorationSet {
  const activeLines = collectActiveLinesFromState(state)
  const ranges: DecorationRange[] = []
  const renderedBlocks: BlockRange[] = []

  for (const codeRange of collectMarkdownCodeBlockRangesFromState(state, 0, state.doc.length, activeLines)) {
    if (rangeTouchesActiveLine(state, codeRange.from, codeRange.to, activeLines)) continue
    renderedBlocks.push({ from: codeRange.from, to: codeRange.to })
    ranges.push({
      from: codeRange.from,
      to: codeRange.to,
      deco: Decoration.replace({
        widget: new CodeBlockWidget(codeRange.block, codeRange.from, codeRange.to),
        block: true
      })
    })
  }

  for (const tableRange of collectMarkdownTableRangesFromState(state, 0, state.doc.length, activeLines)) {
    if (isInsideBlockRanges(tableRange.from, tableRange.to, renderedBlocks)) continue
    ranges.push({
      from: tableRange.from,
      to: tableRange.to,
      deco: Decoration.replace({ widget: new TableWidget(tableRange.table, tableRange.from, tableRange.to), block: true })
    })
  }

  return buildDecorationSet(ranges)
}

const markdownBlockPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildMarkdownBlockDecorations(state)
  },
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildMarkdownBlockDecorations(transaction.state)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field)
})

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const activeLines = collectRevealLines(view)
  const imageContext = view.state.facet(markdownImageContextFacet)
  const ranges: DecorationRange[] = []
  const renderedBlocks: BlockRange[] = []

  for (const { from, to } of view.visibleRanges) {
    for (const codeRange of collectMarkdownCodeBlockRanges(view, from, to, activeLines)) {
      renderedBlocks.push({ from: codeRange.from, to: codeRange.to })
      addFencedCodeLineDecorations(view, codeRange, activeLines, ranges)
    }
  }

  for (const { from, to } of view.visibleRanges) {
    for (const tableRange of collectMarkdownTableRanges(view, from, to, activeLines)) {
      renderedBlocks.push({ from: tableRange.from, to: tableRange.to })
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'Document' && isInsideBlockRanges(node.from, node.to, renderedBlocks)) {
          return false
        }
        const line = view.state.doc.lineAt(node.from)
        const isActive = activeLines.has(line.number)

        switch (node.name) {
          case 'FencedCode':
          case 'CodeBlock':
            return false
          case 'ATXHeading1':
            ranges.push({ from: line.from, to: line.from, deco: centerLineDeco })
            break
          case 'Blockquote':
            ranges.push({ from: line.from, to: line.from, deco: blockquoteLineDeco })
            break
          case 'HorizontalRule':
            if (!isActive) {
              ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new HrWidget(node.from) }) })
              ranges.push({ from: line.from, to: line.from, deco: centerLineDeco })
            }
            return false
          default:
            break
        }

        if (node.name === 'TaskMarker') {
          if (!isActive) addTaskMarker(view, node.from, node.to, ranges)
          return false
        }

        if (isActive) return

        switch (node.name) {
          case 'Image': {
            const parsed = markdownImageFromSource(
              view.state.doc.sliceString(node.from, node.to),
              imageContext.filePath
            )
            if (parsed) {
              ranges.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new ImageWidget(parsed.src, parsed.alt, node.from, parsed.localPath) })
              })
              return false
            }
            break
          }
          case 'Table': {
            if (nodeTouchesActiveLine(view, node.from, node.to, activeLines)) return false
            const parsed = parseMarkdownTable(view.state.doc.sliceString(node.from, node.to))
            if (parsed) return false
            break
          }
          case 'Autolink': {
            const source = view.state.doc.sliceString(node.from, node.to)
            if (source.startsWith('<') && source.endsWith('>')) {
              ranges.push({ from: node.from, to: node.from + 1, deco: hideMark })
              ranges.push({ from: node.from + 1, to: node.to - 1, deco: autolinkDeco })
              ranges.push({ from: node.to - 1, to: node.to, deco: hideMark })
              return false
            }
            break
          }
          case 'ListMark': {
            const markText = view.state.doc.sliceString(node.from, node.to)
            if (markText !== '-' && markText !== '*' && markText !== '+') break
            let hideTo = node.to
            if (view.state.doc.sliceString(hideTo, hideTo + 1) === ' ') hideTo += 1
            const rest = view.state.doc.sliceString(node.to, Math.min(node.to + 5, line.to))
            if (/^ ?\[[ xX]\]/.test(rest)) {
              ranges.push({ from: node.from, to: hideTo, deco: hideMark })
            } else {
              ranges.push({
                from: node.from,
                to: hideTo,
                deco: Decoration.replace({ widget: new ListBulletWidget(node.from, hideTo) })
              })
            }
            break
          }
          case 'Mark': {
            ranges.push({ from: node.from, to: node.to, deco: markDeco })
            break
          }
          default:
            if (CONCEAL_MARKS.has(node.name)) addConcealRange(view, node.name, node.from, node.to, ranges)
            break
        }
      }
    })
  }

  return buildDecorationSet(ranges)
}

const markdownLivePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMarkdownDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
)

export function writeMarkdownLivePreviewExtensions(filePath?: string | null): Extension[] {
  return [
    EditorView.editorAttributes.of({ class: 'cm-write-live-preview' }),
    markdownImageContextFacet.of({ filePath }),
    syntaxHighlighting(writeMarkdownHighlight),
    writeMarkdownLiveTheme,
    markdownBlockPreviewField,
    markdownLivePreviewPlugin
  ]
}
