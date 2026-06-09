import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import {
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../lib/code-highlighting'

export type BlockRange = {
  from: number
  to: number
}

function clampOffset(state: EditorState, offset: number): number {
  const value = Number(offset)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(state.doc.length, Math.floor(value)))
}

function focusSourceAt(view: EditorView, offset: number): void {
  view.focus()
  view.dispatch({
    selection: EditorSelection.cursor(clampOffset(view.state, offset)),
    scrollIntoView: true
  })
}

function isPrimaryMouseDown(event: MouseEvent): boolean {
  return event.button === 0
}

function preventEditorMouseHandling(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function tableCellContentBounds(lineText: string, cellIndex: number): { from: number; to: number } | null {
  const pipes: number[] = []
  for (let index = 0; index < lineText.length; index += 1) {
    if (lineText[index] === '|') pipes.push(index)
  }
  if (cellIndex < 0 || pipes.length < cellIndex + 2) return null

  let from = pipes[cellIndex] + 1
  let to = pipes[cellIndex + 1]
  while (from < to && /\s/.test(lineText[from] ?? '')) from += 1
  while (to > from && /\s/.test(lineText[to - 1] ?? '')) to -= 1
  return { from, to }
}

function proportionalOffsetFromRect(bounds: { from: number; to: number }, rect: DOMRect, clientX: number): number {
  if (bounds.to <= bounds.from || rect.width <= 0) return bounds.from
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return bounds.from + Math.round((bounds.to - bounds.from) * ratio)
}

export class HrWidget extends WidgetType {
  constructor(private from: number) {
    super()
  }

  eq(other: HrWidget): boolean {
    return other.from === this.from
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('div')
    element.className = 'cm-write-md-hr'
    element.title = 'Click to edit divider'
    element.addEventListener('mousedown', (event) => {
      if (!isPrimaryMouseDown(event)) return
      preventEditorMouseHandling(event)
      focusSourceAt(view, this.from)
    })
    return element
  }
}

export class ListBulletWidget extends WidgetType {
  constructor(
    private from: number,
    private to: number
  ) {
    super()
  }

  eq(other: ListBulletWidget): boolean {
    return other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-write-md-list-bullet'
    element.title = 'Click to edit list marker'
    element.addEventListener('mousedown', (event) => {
      if (!isPrimaryMouseDown(event)) return
      preventEditorMouseHandling(event)
      focusSourceAt(view, this.to)
    })
    return element
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private from: number,
    private to: number
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement('label')
    label.className = 'cm-write-md-task'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = this.checked
    checkbox.tabIndex = -1
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const insert = this.checked ? '[ ]' : '[x]'
      view.focus()
      view.dispatch({
        changes: { from: this.from, to: this.to, insert },
        selection: EditorSelection.cursor(this.from + insert.length)
      })
    })
    label.appendChild(checkbox)
    return label
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    private src: string,
    private alt: string,
    private from: number,
    private localPath?: string
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src &&
      other.alt === this.alt &&
      other.from === this.from &&
      other.localPath === this.localPath
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-write-md-image-wrap'
    wrapper.title = 'Click to edit image markdown'
    wrapper.addEventListener('mousedown', (event) => {
      if (!isPrimaryMouseDown(event)) return
      preventEditorMouseHandling(event)
      focusSourceAt(view, this.from)
    })
    const image = document.createElement('img')
    image.className = 'cm-write-md-image'
    image.src = this.src
    image.alt = this.alt
    image.loading = 'lazy'
    wrapper.appendChild(image)
    if (this.localPath && typeof window.dsGui?.readWorkspaceImage === 'function') {
      void window.dsGui.readWorkspaceImage({ path: this.localPath })
        .then((result) => {
          if (result.ok) image.src = result.dataUrl
        })
        .catch(() => undefined)
    }
    return wrapper
  }
}

export type ParsedTable = {
  headers: string[]
  rows: string[][]
}

export type ParsedCodeBlock = {
  code: string
  language: string
}

export type CodeBlockRange = BlockRange & {
  block: ParsedCodeBlock
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseFencedCodeBlock(source: string): ParsedCodeBlock {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const opener = lines[0] ?? ''
  const match = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(opener)
  if (!match) return { code: normalized, language: '' }

  const fence = match[2]
  const language = match[3].trim().split(/\s+/)[0] ?? ''
  const body = lines.slice(1)
  const closingPattern = new RegExp(`^\\s*${escapeRegExp(fence[0])}{${fence.length},}\\s*$`)
  if (body.length > 0 && closingPattern.test(body[body.length - 1] ?? '')) {
    body.pop()
  }
  return { code: body.join('\n'), language }
}

export function openingFence(line: string): { marker: string; language: string } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  return {
    marker: match[1],
    language: match[2].trim().split(/\s+/)[0] ?? ''
  }
}

export function closingFencePattern(marker: string): RegExp {
  return new RegExp(`^(?: {0,3})${escapeRegExp(marker[0])}{${marker.length},}\\s*$`)
}

export class TableWidget extends WidgetType {
  constructor(
    private table: ParsedTable,
    private from: number,
    private to: number
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.from === this.from &&
      other.to === this.to &&
      JSON.stringify(other.table) === JSON.stringify(this.table)
  }

  private sourceOffsetFromClick(view: EditorView, event: MouseEvent, table: HTMLTableElement): number {
    const startLine = view.state.doc.lineAt(this.from)
    const endLine = view.state.doc.lineAt(Math.max(this.from, this.to - 1))
    const target = event.target instanceof Element ? event.target : null
    const row = target?.closest('tr') ?? null
    const rows = Array.from(table.querySelectorAll('tr'))
    const rowIndex = row ? rows.indexOf(row) : -1
    const sourceLineNumber = rowIndex <= 0
      ? startLine.number
      : Math.min(endLine.number, startLine.number + rowIndex + 1)
    const sourceLine = view.state.doc.line(sourceLineNumber)

    const cell = target?.closest('th,td') ?? null
    if (!(cell instanceof HTMLElement)) return sourceLine.from
    const cells = row ? Array.from(row.querySelectorAll('th,td')) : []
    const cellIndex = cells.indexOf(cell)
    const bounds = tableCellContentBounds(sourceLine.text, cellIndex)
    if (!bounds) return sourceLine.from
    const column = proportionalOffsetFromRect(bounds, cell.getBoundingClientRect(), event.clientX)
    return sourceLine.from + column
  }

  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('table')
    table.className = 'cm-write-md-table'
    table.title = 'Click to edit table markdown'
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    for (const header of this.table.headers) {
      const cell = document.createElement('th')
      cell.textContent = header
      headerRow.appendChild(cell)
    }
    thead.appendChild(headerRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const row of this.table.rows) {
      const tr = document.createElement('tr')
      for (const cellText of row) {
        const cell = document.createElement('td')
        cell.textContent = cellText
        tr.appendChild(cell)
      }
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    table.addEventListener('mousedown', (event) => {
      if (!isPrimaryMouseDown(event)) return
      preventEditorMouseHandling(event)
      focusSourceAt(view, this.sourceOffsetFromClick(view, event, table))
    })
    return table
  }
}

export class CodeBlockWidget extends WidgetType {
  constructor(
    private block: ParsedCodeBlock,
    private from: number,
    private to: number
  ) {
    super()
  }

  eq(other: CodeBlockWidget): boolean {
    return other.block.code === this.block.code &&
      other.block.language === this.block.language &&
      other.from === this.from &&
      other.to === this.to
  }

  private lineIndexFromClick(event: MouseEvent, html: HTMLElement): number {
    const lines = Array.from(html.querySelectorAll<HTMLElement>('.line'))
    if (lines.length === 0) return 0

    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.line') : null
    const targetIndex = target ? lines.indexOf(target) : -1
    if (targetIndex >= 0) return targetIndex

    const firstRect = lines[0].getBoundingClientRect()
    const lastRect = lines[lines.length - 1].getBoundingClientRect()
    if (event.clientY <= firstRect.top) return 0
    if (event.clientY >= lastRect.bottom) return lines.length - 1

    const index = lines.findIndex((line) => {
      const rect = line.getBoundingClientRect()
      return event.clientY >= rect.top && event.clientY <= rect.bottom
    })
    return index >= 0 ? index : 0
  }

  private editSourceAtClick(view: EditorView, event: MouseEvent, html: HTMLElement): void {
    const startLine = view.state.doc.lineAt(this.from)
    const endLine = view.state.doc.lineAt(Math.max(this.from, this.to - 1))
    const codeLineIndex = this.lineIndexFromClick(event, html)
    const sourceLineNumber = Math.min(
      endLine.number,
      startLine.number + 1 + codeLineIndex
    )
    const sourceLine = view.state.doc.line(sourceLineNumber)
    const lineElement = Array.from(html.querySelectorAll<HTMLElement>('.line'))[codeLineIndex]
    const lineRect = lineElement?.getBoundingClientRect()
    const columnOffset = lineRect
      ? Math.min(sourceLine.length, Math.max(0, Math.round((event.clientX - lineRect.left) / 8)))
      : 0

    view.focus()
    view.dispatch({
      selection: EditorSelection.cursor(sourceLine.from + columnOffset),
      scrollIntoView: true
    })
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-write-md-code-block'
    wrapper.tabIndex = -1
    wrapper.title = 'Click to edit code'

    if (this.block.language) {
      const label = document.createElement('div')
      label.className = 'cm-write-md-code-lang'
      label.textContent = this.block.language
      wrapper.appendChild(label)
    }

    const body = document.createElement('div')
    body.className = 'cm-write-md-code-block-body'
    const html = document.createElement('div')
    html.className = 'cm-write-md-code-block-html'
    html.innerHTML = renderFallbackCodeHtml(this.block.code)
    body.appendChild(html)
    wrapper.appendChild(body)

    wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      preventEditorMouseHandling(event)
      this.editSourceAtClick(view, event, html)
    })

    void highlightCodeHtml(this.block.code, this.block.language).then((nextHtml) => {
      if (!wrapper.isConnected) return
      html.innerHTML = nextHtml
    })

    return wrapper
  }
}

export class CodeBlockToolbarWidget extends WidgetType {
  constructor(private block: ParsedCodeBlock) {
    super()
  }

  eq(other: CodeBlockToolbarWidget): boolean {
    return other.block.code === this.block.code && other.block.language === this.block.language
  }

  toDOM(): HTMLElement {
    const toolbar = document.createElement('span')
    toolbar.className = 'cm-write-md-codeblock-toolbar'

    if (this.block.language) {
      const language = document.createElement('span')
      language.className = 'cm-write-md-codeblock-lang'
      language.textContent = this.block.language
      toolbar.appendChild(language)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-write-md-codeblock-copy'
    button.title = 'Copy code'
    button.setAttribute('aria-label', 'Copy code')
    button.textContent = 'copy'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const reset = (): void => {
        button.dataset.copied = 'false'
        button.dataset.copyFailed = 'false'
        button.textContent = 'copy'
        button.title = 'Copy code'
        button.setAttribute('aria-label', 'Copy code')
      }
      const fallbackCopy = (): boolean => {
        const textarea = document.createElement('textarea')
        textarea.value = this.block.code
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.top = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        return ok
      }
      const markCopied = (): void => {
        button.dataset.copied = 'true'
        button.dataset.copyFailed = 'false'
        button.textContent = 'copied'
        button.title = 'Copied'
        button.setAttribute('aria-label', 'Copied')
        window.setTimeout(reset, 1400)
      }
      const markFailed = (): void => {
        button.dataset.copied = 'false'
        button.dataset.copyFailed = 'true'
        button.textContent = 'failed'
        button.title = 'Copy failed'
        button.setAttribute('aria-label', 'Copy failed')
        window.setTimeout(reset, 1400)
      }

      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(this.block.code).then(markCopied).catch(() => {
          if (fallbackCopy()) markCopied()
          else markFailed()
        })
        return
      }

      if (fallbackCopy()) markCopied()
      else markFailed()
    })

    toolbar.appendChild(button)
    return toolbar
  }
}
