import { useEffect, useRef, type ReactElement } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { drawSelection, EditorView, highlightActiveLine, keymap, type ViewUpdate } from '@codemirror/view'
import { buildInlineCompletionExtension, buildInlineCompletionPayload } from '../../write/inline-completion'
import { writeMarkdownLivePreviewExtensions } from '../../write/markdown-live-preview'
import { createWriteRecentEdit, type WriteRecentEdit } from '../../write/recent-edits'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../write/term-propagation'

export type WriteSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WriteSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
}

export type WriteEditorSelectionState = {
  text: string
  ranges: WriteSelectionRange[]
  charCount: number
  anchorRect?: WriteSelectionAnchorRect
}

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  imageDirectory?: string | null
  appearance?: 'source' | 'live'
  livePreviewEnabled?: boolean
  readOnly?: boolean
  completionModel: string
  completionEnabled: boolean
  completionDebounceMs: number
  completionMinAcceptScore: number
  completionLongEnabled: boolean
  completionLongDebounceMs: number
  completionLongMinAcceptScore: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved?: () => void
  onImagePasteError?: (message: string) => void
}

const externalValueSyncAnnotation = Annotation.define<boolean>()
const termPropagationAnnotation = Annotation.define<boolean>()
const RECENT_EDIT_CONTEXT_CHARS = 160

function clampOffset(state: EditorState, offset = 0): number {
  const size = state.doc.length
  const value = Number(offset)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(size, Math.floor(value)))
}

function positionForOffset(state: EditorState, offset: number): { line: number; column: number } {
  const point = clampOffset(state, offset)
  const line = state.doc.lineAt(point)
  return {
    line: line.number,
    column: point - line.from + 1
  }
}

function unionRects(rects: Array<{ left: number; right: number; top: number; bottom: number }>): WriteSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function selectionAnchorRect(view: EditorView, ranges: WriteSelectionRange[]): WriteSelectionAnchorRect | undefined {
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
  for (const range of ranges) {
    const start = view.coordsAtPos(range.from, 1)
    const end = view.coordsAtPos(range.to, -1) ?? view.coordsAtPos(Math.max(range.from, range.to - 1), 1)
    if (start) rects.push(start)
    if (end) rects.push(end)
  }
  return unionRects(rects)
}

function selectionState(view: EditorView): WriteEditorSelectionState {
  const ranges = view.state.selection.ranges
    .map((range): WriteSelectionRange | null => {
      if (range.empty) return null
      const from = clampOffset(view.state, range.from)
      const to = clampOffset(view.state, range.to)
      const start = positionForOffset(view.state, from)
      const end = positionForOffset(view.state, Math.max(from, to - 1))
      const text = view.state.sliceDoc(from, to)
      return {
        from,
        to,
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
        text,
        charCount: Math.max(0, to - from)
      }
    })
    .filter((value): value is WriteSelectionRange => value !== null)

  const text = ranges.map((range) => range.text).join('\n\n')
  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0),
    anchorRect: selectionAnchorRect(view, ranges)
  }
}

function recentEditsFromUpdate(update: ViewUpdate, filePath: string): WriteRecentEdit[] {
  const path = filePath.trim()
  if (!path || !update.docChanged) return []
  const edits: WriteRecentEdit[] = []
  const timestamp = Date.now()

  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const edit = createWriteRecentEdit({
      source: 'user',
      timestamp,
      filePath: path,
      from: fromA,
      to: toA,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString(),
      beforeContext: update.startState.sliceDoc(Math.max(0, fromA - RECENT_EDIT_CONTEXT_CHARS), fromA),
      afterContext: update.state.sliceDoc(toB, Math.min(update.state.doc.length, toB + RECENT_EDIT_CONTEXT_CHARS))
    })
    if (edit) edits.push(edit)
  })

  return edits
}

function termReplacementSeedFromUpdate(update: ViewUpdate): WriteTermReplacementSeed | null {
  const changes: WriteTermReplacementSeed[] = []
  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    changes.push({
      from: fromB,
      to: toB,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString()
    })
  })
  if (changes.length !== 1) return null
  const [change] = changes
  if (!change.deletedText || !change.insertedText) return null
  return change
}

function buildEditorTheme(appearance: 'source' | 'live'): Extension {
  const sourceMode = appearance === 'source'
  return EditorView.theme({
    '&': {
      height: '100%',
      minWidth: '0',
      minHeight: '0',
      color: 'var(--ds-text)',
      backgroundColor: 'transparent',
      fontFamily: sourceMode
        ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
        : 'Georgia, Charter, "Iowan Old Style", "Noto Serif SC", serif',
      fontSize: sourceMode ? '14px' : '15px'
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: sourceMode ? '1.75' : '1.85',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '26px 24px 56px',
      caretColor: 'var(--ds-text)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--ds-text)'
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))'
    },
    '.cm-content::selection, .cm-content *::selection': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))',
      color: 'var(--write-selection-text, inherit)'
    },
    '.cm-gutters': {
      display: 'none'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(0, 0, 0, 0.025)'
    },
    '[data-theme="dark"] & .cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)'
    }
  })
}

function buildInteractionExtensions(readOnly: boolean, appearance: 'source' | 'live'): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      spellcheck: readOnly ? 'false' : 'true',
      autocorrect: readOnly ? 'off' : 'on',
      autocapitalize: readOnly ? 'off' : 'sentences',
      'data-write-editor-mode': appearance
    })
  ]
}

function hasClipboardImage(event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

function buildPastedImageMarkdown(
  state: EditorState,
  from: number,
  to: number,
  markdownPath: string
): { text: string; cursor: number } {
  const before = from > 0 ? state.sliceDoc(from - 1, from) : ''
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : ''
  const leadingBreak = from > 0 && before !== '\n' ? '\n' : ''
  const trailingBreak = after && after !== '\n' ? '\n' : ''
  const text = `${leadingBreak}![Pasted image](${markdownPath})${trailingBreak}\n`
  return {
    text,
    cursor: from + text.length
  }
}

export function WriteMarkdownEditor({
  value,
  workspaceRoot,
  filePath,
  imageDirectory,
  appearance = 'live',
  livePreviewEnabled = appearance === 'live',
  readOnly = false,
  completionModel,
  completionEnabled,
  completionDebounceMs,
  completionMinAcceptScore,
  completionLongEnabled,
  completionLongDebounceMs,
  completionLongMinAcceptScore,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError
}: Props): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const livePreviewCompartmentRef = useRef<Compartment | null>(null)
  const editableCompartmentRef = useRef<Compartment | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const livePreviewEnabledRef = useRef(livePreviewEnabled)
  const readOnlyRef = useRef(readOnly)
  const completionModelRef = useRef(completionModel)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const appearanceRef = useRef(appearance)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onImagePasteErrorRef = useRef(onImagePasteError)
  const valueRef = useRef(value)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  imageDirectoryRef.current = imageDirectory ?? ''
  livePreviewEnabledRef.current = livePreviewEnabled
  readOnlyRef.current = readOnly
  completionModelRef.current = completionModel
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  appearanceRef.current = appearance
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onImagePasteSavedRef.current = onImagePasteSaved
  onImagePasteErrorRef.current = onImagePasteError
  valueRef.current = value

  useEffect(() => {
    if (!hostRef.current) return

    const inlineCompletionCompartment = new Compartment()
    const themeCompartment = new Compartment()
    const livePreviewCompartment = new Compartment()
    const editableCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    livePreviewCompartmentRef.current = livePreviewCompartment
    editableCompartmentRef.current = editableCompartment
    const inlineCompletionExtension = buildInlineCompletionExtension({
      getDebounceMs: () => completionDebounceMsRef.current,
      getMinAcceptScore: () => completionMinAcceptScoreRef.current,
      getLongDebounceMs: () => completionLongDebounceMsRef.current,
      getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
      isLongEnabled: () => completionLongEnabledRef.current,
      isEnabled: () => completionEnabledRef.current && !readOnlyRef.current,
      getFilePath: () => filePathRef.current,
      language: 'markdown',
      getModel: () => completionModelRef.current,
      requestCompletion: async (context, mode) => {
        if (typeof window.dsGui?.requestWriteInlineCompletion !== 'function') return null
        const result = await window.dsGui.requestWriteInlineCompletion(
          buildInlineCompletionPayload(context, {
            model: completionModelRef.current,
            workspaceRoot: workspaceRootRef.current,
            mode,
            recentEdits: recentEditsRef.current
          })
        )
        if (!result.ok) return null
        if (result.action?.kind === 'edit') {
          return {
            text: result.action.replacement,
            action: result.action,
            mode
          }
        }
        const completionText = result.action ? result.action.text : result.completion
        if (!completionText) return null
        return {
          text: completionText,
          action: result.action,
          mode
        }
      }
    })

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        themeCompartment.of(buildEditorTheme(appearanceRef.current)),
        livePreviewCompartment.of(
          appearanceRef.current === 'live' && livePreviewEnabledRef.current
            ? writeMarkdownLivePreviewExtensions(filePathRef.current)
            : []
        ),
        editableCompartment.of(buildInteractionExtensions(readOnlyRef.current, appearanceRef.current)),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              onSaveShortcutRef.current()
              return true
            }
          }
        ]),
        EditorView.domEventHandlers({
          paste(event, view) {
            if (readOnlyRef.current) return false
            if (!hasClipboardImage(event)) return false
            const nextWorkspaceRoot = workspaceRootRef.current.trim()
            const nextFilePath = filePathRef.current.trim()
            if (!nextWorkspaceRoot || !nextFilePath) {
              onImagePasteErrorRef.current?.('Open a workspace file before pasting an image.')
              event.preventDefault()
              return true
            }
            if (typeof window.dsGui?.saveWorkspaceClipboardImage !== 'function') return false

            event.preventDefault()
            void window.dsGui
              .saveWorkspaceClipboardImage({
                workspaceRoot: nextWorkspaceRoot,
                currentFilePath: nextFilePath,
                ...(imageDirectoryRef.current.trim()
                  ? { imageDirectory: imageDirectoryRef.current.trim() }
                  : {})
              })
              .then((result) => {
                if (!result.ok) {
                  onImagePasteErrorRef.current?.(result.message)
                  return
                }
                const selection = view.state.selection.main
                const insertion = buildPastedImageMarkdown(
                  view.state,
                  selection.from,
                  selection.to,
                  result.markdownPath
                )
                view.focus()
                view.dispatch({
                  changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: insertion.text
                  },
                  selection: EditorSelection.cursor(insertion.cursor),
                  scrollIntoView: true
                })
                onImagePasteSavedRef.current?.()
              })
              .catch((error) => {
                onImagePasteErrorRef.current?.(
                  error instanceof Error ? error.message : String(error)
                )
              })
            return true
          }
        }),
        inlineCompletionCompartment.of(inlineCompletionExtension),
        EditorView.updateListener.of((update) => {
          const externalValueSync = update.transactions.some((transaction) =>
            transaction.annotation(externalValueSyncAnnotation)
          )
          const termPropagationSync = update.transactions.some((transaction) =>
            transaction.annotation(termPropagationAnnotation)
          )
          if (update.docChanged && !externalValueSync) {
            const recentEdits = recentEditsFromUpdate(update, filePathRef.current)
            if (recentEdits.length > 0) onDocumentEditRef.current?.(recentEdits)
            onChangeRef.current(update.state.doc.toString())
          }
          if (update.docChanged || update.selectionSet) {
            onSelectionChangeRef.current(selectionState(update.view))
          }
          if (update.docChanged && !externalValueSync && !termPropagationSync) {
            const seed = termReplacementSeedFromUpdate(update)
            if (seed) {
              const content = update.state.doc.toString()
              const rawPropagationChanges = [
                ...buildWriteTermPropagationChanges(content, seed),
                ...buildWriteCanonicalTermPropagationChanges(content, seed)
              ]
              const seenPropagationChanges = new Set<string>()
              const propagationChanges = rawPropagationChanges.filter((change) => {
                const key = `${change.from}:${change.to}`
                if (seenPropagationChanges.has(key)) return false
                seenPropagationChanges.add(key)
                return true
              })
              if (propagationChanges.length > 0) {
                update.view.dispatch({
                  changes: propagationChanges,
                  annotations: termPropagationAnnotation.of(true)
                })
              }
            }
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: hostRef.current
    })
    viewRef.current = view
    onSelectionChangeRef.current(selectionState(view))

    return () => {
      view.destroy()
      viewRef.current = null
      themeCompartmentRef.current = null
      livePreviewCompartmentRef.current = null
      editableCompartmentRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const themeCompartment = themeCompartmentRef.current
    const livePreviewCompartment = livePreviewCompartmentRef.current
    const editableCompartment = editableCompartmentRef.current
    if (!view || !themeCompartment || !livePreviewCompartment || !editableCompartment) return
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(buildEditorTheme(appearance)),
        livePreviewCompartment.reconfigure(
          appearance === 'live' && livePreviewEnabled ? writeMarkdownLivePreviewExtensions(filePath) : []
        ),
        editableCompartment.reconfigure(buildInteractionExtensions(readOnly, appearance))
      ]
    })
  }, [appearance, filePath, livePreviewEnabled, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const nextLength = value.length
    const { anchor, head } = view.state.selection.main
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalValueSyncAnnotation.of(true),
      selection: EditorSelection.single(
        Math.min(anchor, nextLength),
        Math.min(head, nextLength)
      )
    })
  }, [value])

  return <div ref={hostRef} className="write-codemirror-host flex h-full min-h-0 w-full min-w-0" />
}
