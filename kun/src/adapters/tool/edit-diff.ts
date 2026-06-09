import * as Diff from 'diff'

export interface Edit {
  oldText: string
  newText: string
}

export interface FuzzyMatchResult {
  found: boolean
  index: number
  matchLength: number
  usedFuzzyMatch: boolean
  contentForReplacement: string
}

interface MatchedEdit {
  editIndex: number
  matchIndex: number
  matchLength: number
  newText: string
}

export interface AppliedEditsResult {
  baseContent: string
  newContent: string
}

export interface EditDiffResult {
  diff: string
  firstChangedLine: number | undefined
}

export interface EditDiffError {
  error: string
}

function splitLines(value: string): string[] {
  return value.split('\n')
}

export function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIndex = content.indexOf('\r\n')
  const lfIndex = content.indexOf('\n')
  if (lfIndex === -1) return '\n'
  if (crlfIndex === -1) return '\n'
  return crlfIndex < lfIndex ? '\r\n' : '\n'
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith('\uFEFF') ? { bom: '\uFEFF', text: content.slice(1) } : { bom: '', text: content }
}

export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize('NFKC')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText)
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content
    }
  }

  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)
  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content
    }
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent
  }
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  return fuzzyContent.split(fuzzyOldText).length - 1
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
    )
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`
  )
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`
    )
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`
  )
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) return new Error(`oldText must not be empty in ${path}.`)
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`)
}

function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`
    )
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`)
}

export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string
): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText)
  }))

  for (let index = 0; index < normalizedEdits.length; index += 1) {
    if (normalizedEdits[index]!.oldText.length === 0) {
      throw getEmptyOldTextError(path, index, normalizedEdits.length)
    }
  }

  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText))
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent

  const matchedEdits: MatchedEdit[] = []
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    const edit = normalizedEdits[index]!
    const matchResult = fuzzyFindText(baseContent, edit.oldText)
    if (!matchResult.found) {
      throw getNotFoundError(path, index, normalizedEdits.length)
    }
    const occurrences = countOccurrences(baseContent, edit.oldText)
    if (occurrences > 1) {
      throw getDuplicateError(path, index, normalizedEdits.length, occurrences)
    }
    matchedEdits.push({
      editIndex: index,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText
    })
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let index = 1; index < matchedEdits.length; index += 1) {
    const previous = matchedEdits[index - 1]!
    const current = matchedEdits[index]!
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`
      )
    }
  }

  let newContent = baseContent
  for (let index = matchedEdits.length - 1; index >= 0; index -= 1) {
    const edit = matchedEdits[index]!
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength)
  }

  if (baseContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length)
  }

  return { baseContent, newContent }
}

export function firstChangedLine(oldContent: string, newContent: string): number | undefined {
  const oldLines = splitLines(oldContent)
  const newLines = splitLines(newContent)
  const count = Math.max(oldLines.length, newLines.length)
  for (let index = 0; index < count; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) return index + 1
  }
  return undefined
}

export function generateDisplayDiff(
  oldContent: string,
  newContent: string,
  contextLines = 4
): string {
  const parts = Diff.diffLines(oldContent, newContent)
  const output: string[] = []
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const maxLineNum = Math.max(oldLines.length, newLines.length)
  const lineNumWidth = String(maxLineNum).length

  let oldLineNum = 1
  let newLineNum = 1
  let lastWasChange = false

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!
    const raw = part.value.split('\n')
    if (raw[raw.length - 1] === '') raw.pop()
    const nextPartIsChange = index < parts.length - 1 && (parts[index + 1]!.added || parts[index + 1]!.removed)

    if (part.added || part.removed) {
      for (const line of raw) {
        if (part.added) {
          output.push(`+${String(newLineNum).padStart(lineNumWidth, ' ')} ${line}`)
          newLineNum += 1
        } else {
          output.push(`-${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
          oldLineNum += 1
        }
      }
      lastWasChange = true
      continue
    }

    const hasLeadingChange = lastWasChange
    const hasTrailingChange = nextPartIsChange
    if (hasLeadingChange && hasTrailingChange) {
      if (raw.length <= contextLines * 2) {
        for (const line of raw) {
          output.push(` ${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
          oldLineNum += 1
          newLineNum += 1
        }
      } else {
        const leading = raw.slice(0, contextLines)
        const trailing = raw.slice(raw.length - contextLines)
        const skipped = raw.length - leading.length - trailing.length
        for (const line of leading) {
          output.push(` ${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
          oldLineNum += 1
          newLineNum += 1
        }
        output.push(` ${''.padStart(lineNumWidth, ' ')} ...`)
        oldLineNum += skipped
        newLineNum += skipped
        for (const line of trailing) {
          output.push(` ${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
          oldLineNum += 1
          newLineNum += 1
        }
      }
    } else if (hasLeadingChange) {
      const shown = raw.slice(0, contextLines)
      const skipped = raw.length - shown.length
      for (const line of shown) {
        output.push(` ${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
        oldLineNum += 1
        newLineNum += 1
      }
      if (skipped > 0) {
        output.push(` ${''.padStart(lineNumWidth, ' ')} ...`)
        oldLineNum += skipped
        newLineNum += skipped
      }
    } else if (hasTrailingChange) {
      const skipped = Math.max(0, raw.length - contextLines)
      if (skipped > 0) {
        output.push(` ${''.padStart(lineNumWidth, ' ')} ...`)
        oldLineNum += skipped
        newLineNum += skipped
      }
      for (const line of raw.slice(skipped)) {
        output.push(` ${String(oldLineNum).padStart(lineNumWidth, ' ')} ${line}`)
        oldLineNum += 1
        newLineNum += 1
      }
    } else {
      oldLineNum += raw.length
      newLineNum += raw.length
    }

    lastWasChange = false
  }

  return output.join('\n')
}

export function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 4
): EditDiffResult {
  return {
    diff: generateDisplayDiff(oldContent, newContent, contextLines),
    firstChangedLine: firstChangedLine(oldContent, newContent)
  }
}

export function generateUnifiedPatch(
  path: string,
  oldContent: string,
  newContent: string,
  contextLines = 4
): string {
  return Diff.createTwoFilesPatch(`a/${path}`, `b/${path}`, oldContent, newContent, undefined, undefined, {
    context: contextLines,
    headerOptions: Diff.FILE_HEADERS_ONLY
  })
}

export async function computeEditsDiff(
  path: string,
  edits: Edit[],
  cwd: string
): Promise<EditDiffResult | EditDiffError> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const absolutePath = resolve(cwd, path)
    const rawContent = await readFile(absolutePath, 'utf8')
    const { text: content } = stripBom(rawContent)
    const normalizedContent = normalizeToLF(content)
    const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path)
    return generateDiffString(baseContent, newContent)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function computeEditDiff(
  path: string,
  oldText: string,
  newText: string,
  cwd: string
): Promise<EditDiffResult | EditDiffError> {
  return computeEditsDiff(path, [{ oldText, newText }], cwd)
}
