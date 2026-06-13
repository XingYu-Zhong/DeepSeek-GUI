import type {
  WriteEditorSelectionState,
  WriteSelectedImage,
  WriteSelectionAnchorRect,
  WriteSelectionPageRect,
  WriteSelectionRange
} from '../components/write/WriteMarkdownEditor'

function selectedImagesEqual(
  a: WriteSelectedImage | undefined,
  b: WriteSelectedImage | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.src === b.src &&
    a.alt === b.alt &&
    a.line?.from === b.line?.from &&
    a.line?.to === b.line?.to
  )
}

function anchorRectsEqual(
  a: WriteSelectionAnchorRect | undefined,
  b: WriteSelectionAnchorRect | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.top === b.top &&
    a.bottom === b.bottom
  )
}

function rangesEqual(a: WriteSelectionRange, b: WriteSelectionRange): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.startLine === b.startLine &&
    a.startColumn === b.startColumn &&
    a.endLine === b.endLine &&
    a.endColumn === b.endColumn &&
    a.text === b.text &&
    a.charCount === b.charCount &&
    a.page === b.page
  )
}

function pageRectsEqual(
  a: WriteSelectionPageRect[] | undefined,
  b: WriteSelectionPageRect[] | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (
      left.page !== right.page ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.height !== right.height
    ) {
      return false
    }
  }
  return true
}

/**
 * Semantic equality for editor selection snapshots. Typing emits a fresh
 * (usually empty) selection object on every keystroke; comparing before
 * publishing keeps the store reference stable so subscribers do not
 * re-render for no-op selection updates.
 */
export function writeSelectionStatesEqual(
  a: WriteEditorSelectionState,
  b: WriteEditorSelectionState
): boolean {
  if (a === b) return true
  if (a.charCount !== b.charCount || a.text !== b.text) return false
  if (a.blockType !== b.blockType) return false
  if (a.sourceKind !== b.sourceKind || a.pageStart !== b.pageStart || a.pageEnd !== b.pageEnd) return false
  if (!selectedImagesEqual(a.selectedImage, b.selectedImage)) return false
  if (a.ranges.length !== b.ranges.length) return false
  for (let index = 0; index < a.ranges.length; index += 1) {
    if (!rangesEqual(a.ranges[index], b.ranges[index])) return false
  }
  return anchorRectsEqual(a.anchorRect, b.anchorRect) && pageRectsEqual(a.rects, b.rects)
}
