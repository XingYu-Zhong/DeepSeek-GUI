import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode
} from 'react'
import { Editor, Extension, type AnyExtension } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  WriteEditorSelectionState,
  WriteSelectionAnchorRect,
  WriteSelectionRange
} from '../../components/write/WriteMarkdownEditor'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { buildInlineCompletionPayload } from '../inline-completion'
import { isSelectableRasterImageSrc } from '../selected-image'
import type { WriteBlockType } from '../block-type'
import type { WriteInlineFormatKind } from '../inline-format'
import { createWriteRecentEdit, type WriteRecentEdit } from '../recent-edits'
import {
  auditWriteMarkdownFidelity,
  getWriteMarkdownManager,
  parseWriteMarkdown,
  type WriteRichFidelity
} from './markdown-manager'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset,
  projectedOffsetForPos
} from './markdown-projection'
import { recentEditsFromRichTransaction } from './recent-edits-pm'
import { replaceRangeWithMarkdown } from './markdown-insert'
import { applyExternalMarkdownToEditor } from './markdown-sync'
import { WriteLocalImage } from './local-image'
import { WritePasteImage } from './paste-image'
import { WriteRichInlineCompletion } from './extensions/inline-completion'
import {
  WriteRichTermPropagation,
  writeRichExternalSyncMeta
} from './extensions/term-propagation'
import { WriteRichTemplateShortcuts } from './extensions/template-shortcuts'
import { SddRequirementBadges } from './extensions/sdd-requirement-badges'

/**
 * Imperative surface for flows that operate on the markdown projection
 * (inline edit, quoted selections). Ranges are projection offsets, the same
 * coordinate space used by the selection state this editor emits.
 */
export type WriteRichEditorHandle = {
  getProjectionText: () => string | null
  applyProjectedReplacement: (
    range: { from: number; to: number },
    original: string,
    replacement: string,
    instruction?: string
  ) => boolean
  /** Replace the image node whose src matches exactly with parsed markdown
   * (an empty string deletes the node). Backs async infographic completion,
   * where the placeholder position can shift under concurrent edits. */
  replaceImageBySrc: (src: string, replacementMarkdown: string) => boolean
  /** Insert parsed markdown right after the image node whose src matches
   * exactly (prototype placeholders go below their source mockup). */
  insertMarkdownAfterImage: (src: string, markdown: string) => boolean
  /** Toggle an inline mark on the current selection (selection toolbar). */
  toggleInlineFormat: (kind: WriteInlineFormatKind) => boolean
  /** Set the block type of the current selection (selection toolbar). */
  setBlockType: (type: WriteBlockType) => boolean
}

/** Block type of the current selection, walking outward from the cursor. */
function richSelectionBlockType(state: EditorState): WriteBlockType {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    const name = node.type.name
    if (name === 'heading') {
      const level = Number(node.attrs.level) || 1
      return level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3'
    }
    if (name === 'codeBlock') return 'code'
    if (name === 'blockquote') return 'quote'
    if (name === 'bulletList') return 'bullet'
    if (name === 'orderedList') return 'ordered'
  }
  return 'paragraph'
}

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  imageDirectory?: string | null
  readOnly?: boolean
  /** Render SDD requirement headings with status pills (SDD draft editor). */
  requirementBadges?: boolean
  completionModel?: string
  completionEnabled?: boolean
  completionDebounceMs?: number
  completionMinAcceptScore?: number
  completionLongEnabled?: boolean
  completionLongDebounceMs?: number
  completionLongMinAcceptScore?: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved?: () => void
  onImagePasteError?: (message: string) => void
  onFidelityChange?: (fidelity: WriteRichFidelity) => void
  handleRef?: MutableRefObject<WriteRichEditorHandle | null>
  /** Rendered instead of the rich editor when the open document fails the
   * round-trip fidelity gate (typically the CodeMirror editor). */
  fallback?: ReactNode
}

type GateState = {
  fileKey: string
  eligible: boolean
}

function fileKeyOf(filePath?: string | null): string {
  return (filePath ?? '').trim()
}

function unionRects(
  rects: Array<{ left: number; right: number; top: number; bottom: number }>
): WriteSelectionAnchorRect | undefined {
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
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function lineColumnOfText(prefix: string): { line: number; column: number } {
  const breaks = prefix.match(/\n/g)?.length ?? 0
  const lastBreak = prefix.lastIndexOf('\n')
  return { line: breaks + 1, column: prefix.length - lastBreak }
}

/**
 * Build the selection contract from the ProseMirror selection. Offsets,
 * line/column values, and the selected text are all expressed in markdown
 * projection coordinates so inline edit scopes and quoted selections share
 * one coordinate space with the completion contexts.
 */
export function selectionStateFromEditor(editor: Editor): WriteEditorSelectionState {
  const { state, view } = editor
  const doc = state.doc
  const projection = buildWriteRichMarkdownProjection(doc)
  const ranges: WriteSelectionRange[] = []
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []

  // A node-selected raster image surfaces the image-aware toolbar;
  // text ranges below stay empty for node selections (pmFrom === pmTo - size
  // collapses to no projected text).
  const nodeSelection = state.selection instanceof NodeSelection ? state.selection : null
  if (nodeSelection?.node.type.name === 'image') {
    const src = typeof nodeSelection.node.attrs.src === 'string' ? nodeSelection.node.attrs.src : ''
    if (isSelectableRasterImageSrc(src)) {
      const alt = typeof nodeSelection.node.attrs.alt === 'string' ? nodeSelection.node.attrs.alt : ''
      let anchorRect: WriteEditorSelectionState['anchorRect']
      const nodeDom = view.nodeDOM(nodeSelection.from)
      if (nodeDom instanceof HTMLElement) {
        const rect = nodeDom.getBoundingClientRect()
        anchorRect = {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      } else {
        try {
          const coords = view.coordsAtPos(nodeSelection.from)
          anchorRect = { ...coords, width: coords.right - coords.left, height: coords.bottom - coords.top }
        } catch {
          anchorRect = undefined
        }
      }
      return {
        text: '',
        ranges: [],
        charCount: 0,
        selectedImage: { src, alt },
        ...(anchorRect ? { anchorRect } : {})
      }
    }
  }

  for (const range of state.selection.ranges) {
    const pmFrom = range.$from.pos
    const pmTo = range.$to.pos
    if (pmFrom === pmTo) continue
    const from = projectedOffsetForPos(doc, projection, pmFrom)
    const to = projectedOffsetForPos(doc, projection, pmTo)
    try {
      rects.push(view.coordsAtPos(pmFrom), view.coordsAtPos(pmTo))
    } catch {
      // coordsAtPos throws while the view is being torn down; skip the rect.
    }
    if (from === null || to === null || to <= from) continue
    const text = projection.text.slice(from, to)
    const start = lineColumnOfText(projection.text.slice(0, from))
    const end = lineColumnOfText(projection.text.slice(0, Math.max(from, to - 1)))
    ranges.push({
      from,
      to,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      text,
      charCount: to - from
    })
  }

  const text = ranges.map((range) => range.text).join('\n\n')
  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0),
    blockType: richSelectionBlockType(state),
    ...(rects.length > 0 ? { anchorRect: unionRects(rects) } : {})
  }
}

const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180

export function WriteRichEditor({
  value,
  workspaceRoot,
  filePath,
  imageDirectory,
  readOnly = false,
  requirementBadges = false,
  completionModel = '',
  completionEnabled = false,
  completionDebounceMs = 0,
  completionMinAcceptScore = 0,
  completionLongEnabled = false,
  completionLongDebounceMs = 0,
  completionLongMinAcceptScore = 0,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError,
  onFidelityChange,
  handleRef,
  fallback
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const readOnlyRef = useRef(readOnly)
  const completionModelRef = useRef(completionModel)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onImagePasteErrorRef = useRef(onImagePasteError)
  const onFidelityChangeRef = useRef(onFidelityChange)
  const lastEmittedValueRef = useRef<string | null>(null)
  const [gate, setGate] = useState<GateState | null>(null)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  imageDirectoryRef.current = imageDirectory ?? ''
  readOnlyRef.current = readOnly
  completionModelRef.current = completionModel
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onImagePasteSavedRef.current = onImagePasteSaved
  onImagePasteErrorRef.current = onImagePasteError
  onFidelityChangeRef.current = onFidelityChange

  const fileKey = fileKeyOf(filePath)
  const eligible = gate?.fileKey === fileKey ? gate.eligible : null

  // Audit every payload that arrives from outside the editor (file open,
  // disk sync). Our own serialized output is round-trip safe by construction
  // and is never re-audited.
  useEffect(() => {
    if (value === lastEmittedValueRef.current && gate?.fileKey === fileKey) return
    const fidelity = auditWriteMarkdownFidelity(value)
    onFidelityChangeRef.current?.(fidelity)
    setGate((current) => {
      if (current?.fileKey === fileKey && current.eligible === fidelity.eligible) return current
      return { fileKey, eligible: fidelity.eligible }
    })
    if (!fidelity.eligible) {
      lastEmittedValueRef.current = null
      return
    }

    const editor = editorRef.current
    if (editor && !editor.isDestroyed) {
      if (applyExternalMarkdownToEditor(editor, value)) {
        lastEmittedValueRef.current = value
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fileKey])

  useEffect(() => {
    if (eligible !== true || !hostRef.current || editorRef.current) return

    const manager = getWriteMarkdownManager()
    const saveShortcut = Extension.create({
      name: 'writeSaveShortcut',
      addKeyboardShortcuts() {
        return {
          'Mod-s': () => {
            onSaveShortcutRef.current()
            return true
          }
        }
      }
    })

    const extensions: AnyExtension[] = [
      StarterKit.configure({
        link: { openOnClick: false },
        undoRedo: { depth: 200 }
      }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      WriteLocalImage.configure({
        getFilePath: () => filePathRef.current,
        getWorkspaceRoot: () => workspaceRootRef.current
      }),
      WritePasteImage.configure({
        getWorkspaceRoot: () => workspaceRootRef.current,
        getFilePath: () => filePathRef.current,
        getImageDirectory: () => imageDirectoryRef.current,
        isReadOnly: () => readOnlyRef.current,
        onSaved: () => onImagePasteSavedRef.current?.(),
        onError: (message) => onImagePasteErrorRef.current?.(message)
      }),
      WriteRichInlineCompletion.configure({
        getDebounceMs: () => completionDebounceMsRef.current,
        getMinAcceptScore: () => completionMinAcceptScoreRef.current,
        getLongDebounceMs: () => completionLongDebounceMsRef.current,
        getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
        isLongEnabled: () => completionLongEnabledRef.current,
        isEnabled: () => completionEnabledRef.current && !readOnlyRef.current,
        getFilePath: () => filePathRef.current,
        requestCompletion: async (context, mode) => {
          if (typeof window.kunGui?.requestWriteInlineCompletion !== 'function') return null
          const result = await window.kunGui.requestWriteInlineCompletion(
            buildInlineCompletionPayload(context, {
              model: completionModelRef.current,
              workspaceRoot: workspaceRootRef.current,
              mode,
              recentEdits: recentEditsRef.current
            })
          )
          if (!result.ok) return null
          if (result.action?.kind === 'edit') {
            return { text: result.action.replacement, action: result.action, mode }
          }
          const completionText = result.action ? result.action.text : result.completion
          if (!completionText) return null
          return { text: completionText, action: result.action, mode }
        }
      }),
      WriteRichTermPropagation,
      WriteRichTemplateShortcuts.configure({
        isReadOnly: () => readOnlyRef.current
      }),
      ...(requirementBadges ? [SddRequirementBadges] : []),
      saveShortcut
    ]

    const editor = new Editor({
      element: hostRef.current,
      extensions,
      content: parseWriteMarkdown(value),
      editable: !readOnlyRef.current,
      editorProps: {
        attributes: {
          class: 'write-rich-editor',
          spellcheck: readOnlyRef.current ? 'false' : 'true',
          'data-write-editor-mode': 'rich'
        }
      },
      onUpdate({ editor: instance, transaction }) {
        // External snapshots are applied through applyExternalMarkdownToEditor;
        // re-emitting them as user changes would mark the file dirty and
        // autosave a normalized rewrite of content the agent just wrote.
        if (transaction.getMeta(writeRichExternalSyncMeta)) {
          onSelectionChangeRef.current(selectionStateFromEditor(instance))
          return
        }
        try {
          const markdown = manager.serialize(instance.state.doc.toJSON())
          lastEmittedValueRef.current = markdown
          onChangeRef.current(markdown)
        } catch (error) {
          onImagePasteErrorRef.current?.(
            error instanceof Error ? error.message : String(error)
          )
        }
        if (onDocumentEditRef.current && transaction.docChanged) {
          const edits = recentEditsFromRichTransaction(transaction, filePathRef.current)
          if (edits.length > 0) onDocumentEditRef.current(edits)
        }
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      },
      onSelectionUpdate({ editor: instance }) {
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      }
    })

    editorRef.current = editor
    lastEmittedValueRef.current = value
    onSelectionChangeRef.current(selectionStateFromEditor(editor))

    if (handleRef) {
      handleRef.current = {
        getProjectionText: () => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return null
          return buildWriteRichMarkdownProjection(instance.state.doc).text
        },
        applyProjectedReplacement: (range, original, replacement, instruction) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const doc = instance.state.doc
          const projection = buildWriteRichMarkdownProjection(doc)
          const from = posForProjectedOffset(doc, projection, range.from)
          const to = posForProjectedOffset(doc, projection, range.to)
          if (from === null || to === null || to < from) return false
          const current = doc.textBetween(from, to, '\n', () => '')
          if (current.replace(/\n+/g, '\n') !== original.replace(/\n+/g, '\n')) return false
          const applied = replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            from,
            to,
            replacement
          )
          if (!applied) return false
          const record = createWriteRecentEdit({
            source: 'inline-edit',
            filePath: filePathRef.current,
            from: range.from,
            to: range.to,
            deletedText: original,
            insertedText: replacement,
            beforeContext: projection.text.slice(
              Math.max(0, range.from - INLINE_EDIT_RECENT_CONTEXT_CHARS),
              range.from
            ),
            afterContext: projection.text.slice(
              range.to,
              Math.min(projection.text.length, range.to + INLINE_EDIT_RECENT_CONTEXT_CHARS)
            ),
            instruction,
            scopeKind: 'selection'
          })
          if (record) onDocumentEditRef.current?.([record])
          return true
        },
        replaceImageBySrc: (src, replacementMarkdown) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return false
          let target: { from: number; to: number } | null = null
          instance.state.doc.descendants((docNode, pos) => {
            if (target) return false
            if (docNode.type.name === 'image' && docNode.attrs.src === src) {
              target = { from: pos, to: pos + docNode.nodeSize }
              return false
            }
            return true
          })
          if (!target) return false
          const { from, to } = target
          return replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            from,
            to,
            replacementMarkdown
          )
        },
        insertMarkdownAfterImage: (src, markdown) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return false
          let insertAt: number | null = null
          instance.state.doc.descendants((docNode, pos) => {
            if (insertAt !== null) return false
            if (docNode.type.name === 'image' && docNode.attrs.src === src) {
              insertAt = pos + docNode.nodeSize
              return false
            }
            return true
          })
          if (insertAt === null) return false
          return replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            insertAt,
            insertAt,
            markdown
          )
        },
        toggleInlineFormat: (kind) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const chain = instance.chain().focus()
          if (kind === 'bold') return chain.toggleBold().run()
          if (kind === 'italic') return chain.toggleItalic().run()
          if (kind === 'strikethrough') return chain.toggleStrike().run()
          return chain.toggleCode().run()
        },
        setBlockType: (type) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const chain = instance.chain().focus()
          switch (type) {
            case 'heading1':
              return chain.toggleHeading({ level: 1 }).run()
            case 'heading2':
              return chain.toggleHeading({ level: 2 }).run()
            case 'heading3':
              return chain.toggleHeading({ level: 3 }).run()
            case 'quote':
              return chain.toggleBlockquote().run()
            case 'bullet':
              return chain.toggleBulletList().run()
            case 'ordered':
              return chain.toggleOrderedList().run()
            case 'code':
              return chain.toggleCodeBlock().run()
            default:
              return chain.setParagraph().run()
          }
        }
      }
    }

    return () => {
      if (handleRef) handleRef.current = null
      editor.destroy()
      editorRef.current = null
    }
    // The editor is created once per eligible file; value/file changes flow
    // through the audit effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, fileKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [readOnly])

  if (eligible === false) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="write-rich-fallback-notice flex shrink-0 items-center gap-2 border-b border-amber-200/80 bg-amber-50/90 px-4 py-2 text-[12.5px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span>{t('writeRichFallbackNotice')}</span>
        </div>
        <div className="min-h-0 min-w-0 flex-1">{fallback}</div>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className="write-rich-host flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto"
    />
  )
}
