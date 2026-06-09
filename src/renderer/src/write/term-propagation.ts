export type WriteTermReplacementSeed = {
  from: number
  to: number
  deletedText: string
  insertedText: string
}

export type WriteTermPropagationChange = {
  from: number
  to: number
  insert: string
}

const MAX_TERM_CHARS = 80
const MAX_PROPAGATION_PARAGRAPH_CHARS = 6_000
const MAX_PROPAGATION_CHANGES = 16
const MAX_CANONICAL_TOKENS = 4

function clampOffset(content: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0
  return Math.max(0, Math.min(content.length, Math.floor(offset)))
}

function normalizeCase(text = ''): string {
  return text.normalize('NFKC').toLocaleLowerCase()
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}_-]/u.test(char)
}

function isParagraphBoundaryLine(text: string): boolean {
  const trimmed = text.trim()
  return !trimmed ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^-{3,}$/.test(trimmed)
}

function lineStart(content: string, offset: number): number {
  const index = content.lastIndexOf('\n', Math.max(0, offset - 1))
  return index >= 0 ? index + 1 : 0
}

function lineEnd(content: string, offset: number): number {
  const index = content.indexOf('\n', offset)
  return index >= 0 ? index : content.length
}

function paragraphRangeAt(content: string, offset: number): { from: number; to: number } {
  const point = clampOffset(content, offset)
  let from = lineStart(content, point)
  let to = lineEnd(content, point)

  if (isParagraphBoundaryLine(content.slice(from, to))) return { from, to }

  while (from > 0) {
    const previousEnd = from - 1
    const previousStart = lineStart(content, previousEnd)
    const previousText = content.slice(previousStart, previousEnd)
    if (isParagraphBoundaryLine(previousText)) break
    from = previousStart
  }

  while (to < content.length) {
    const nextStart = to + 1
    const nextEnd = lineEnd(content, nextStart)
    const nextText = content.slice(nextStart, nextEnd)
    if (isParagraphBoundaryLine(nextText)) break
    to = nextEnd
  }

  return { from, to }
}

function hasSafeTermShape(text: string): boolean {
  const compact = text.trim()
  if (compact.length < 3 || compact.length > MAX_TERM_CHARS) return false
  if (/[\r\n]/.test(compact)) return false
  if (/^\W+$/u.test(compact)) return false
  return (
    compact.length >= 6 ||
    /\s/.test(compact) ||
    /[-_]/.test(compact) ||
    /[A-Z]/.test(compact) ||
    /\d/.test(compact)
  )
}

function hasBoundary(content: string, from: number, to: number): boolean {
  const first = content.slice(from, from + 1)
  const last = content.slice(Math.max(from, to - 1), to)
  const before = from > 0 ? content.slice(from - 1, from) : ''
  const after = to < content.length ? content.slice(to, to + 1) : ''

  if (isWordChar(first) && before && isWordChar(before)) return false
  if (isWordChar(last) && after && isWordChar(after)) return false
  return true
}

type TermToken = {
  from: number
  to: number
  text: string
}

function tokenizeTermWords(text: string, baseOffset: number): TermToken[] {
  const tokens: TermToken[] = []
  const regex = /[\p{L}\p{N}_-]+/gu
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      text: match[0]
    })
  }
  return tokens
}

function candidateHasCanonicalSignal(text: string): boolean {
  return /[A-Z]{2,}/.test(text) ||
    /[a-z][A-Z]/.test(text) ||
    /[A-Z][a-z]/.test(text) ||
    /\d/.test(text)
}

function canonicalTermCandidates(content: string, paragraph: { from: number; to: number }, from: number, to: number): string[] {
  const paragraphText = content.slice(paragraph.from, paragraph.to)
  const tokens = tokenizeTermWords(paragraphText, paragraph.from)
  const touched = tokens.findIndex((token) => token.to >= from && token.from <= to)
  if (touched < 0) return []

  const candidates: string[] = []
  for (let start = Math.max(0, touched - MAX_CANONICAL_TOKENS + 1); start <= touched; start += 1) {
    for (
      let end = touched;
      end < Math.min(tokens.length, start + MAX_CANONICAL_TOKENS);
      end += 1
    ) {
      const candidateFrom = tokens[start].from
      const candidateTo = tokens[end].to
      const candidate = content.slice(candidateFrom, candidateTo).trim()
      if (!hasSafeTermShape(candidate)) continue
      if (!candidateHasCanonicalSignal(candidate)) continue
      const normalized = normalizeCase(candidate)
      const paragraphLower = normalizeCase(paragraphText)
      const first = paragraphLower.indexOf(normalized)
      const second = first >= 0 ? paragraphLower.indexOf(normalized, first + normalized.length) : -1
      if (second < 0) continue
      candidates.push(candidate)
    }
  }

  return [...new Set(candidates)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 1)
}

function changesForTerm(
  content: string,
  paragraph: { from: number; to: number },
  searchText: string,
  replacement: string,
  skip?: { from: number; to: number }
): WriteTermPropagationChange[] {
  const changes: WriteTermPropagationChange[] = []
  const paragraphText = content.slice(paragraph.from, paragraph.to)
  const paragraphLower = normalizeCase(paragraphText)
  const normalizedSearch = normalizeCase(searchText)
  let searchFrom = 0

  while (changes.length < MAX_PROPAGATION_CHANGES) {
    const index = paragraphLower.indexOf(normalizedSearch, searchFrom)
    if (index < 0) break

    const from = paragraph.from + index
    const to = from + searchText.length
    const existing = content.slice(from, to)
    searchFrom = index + Math.max(1, searchText.length)

    if (skip && from < skip.to && to > skip.from) continue
    if (existing === replacement) continue
    if (!hasBoundary(content, from, to)) continue

    changes.push({ from, to, insert: replacement })
  }

  return changes
}

export function buildWriteTermPropagationChanges(
  content: string,
  seed: WriteTermReplacementSeed
): WriteTermPropagationChange[] {
  const deletedText = seed.deletedText.trim()
  const insertedText = seed.insertedText.trim()
  if (!deletedText || !insertedText || deletedText === insertedText) return []
  if (!hasSafeTermShape(deletedText) || !hasSafeTermShape(insertedText)) return []

  const seedFrom = clampOffset(content, seed.from)
  const seedTo = clampOffset(content, Math.max(seed.from, seed.to))
  const paragraph = paragraphRangeAt(content, seedFrom)
  if (paragraph.to - paragraph.from > MAX_PROPAGATION_PARAGRAPH_CHARS) return []

  const changes = changesForTerm(content, paragraph, deletedText, insertedText, {
    from: seedFrom,
    to: seedTo
  })

  if (changes.length === 0) return []
  return changes
}

export function buildWriteCanonicalTermPropagationChanges(
  content: string,
  seed: WriteTermReplacementSeed
): WriteTermPropagationChange[] {
  const seedFrom = clampOffset(content, seed.from)
  const seedTo = clampOffset(content, Math.max(seed.from, seed.to))
  const paragraph = paragraphRangeAt(content, seedFrom)
  if (paragraph.to - paragraph.from > MAX_PROPAGATION_PARAGRAPH_CHARS) return []

  const changes: WriteTermPropagationChange[] = []
  for (const candidate of canonicalTermCandidates(content, paragraph, seedFrom, seedTo)) {
    const nextChanges = changesForTerm(content, paragraph, candidate, candidate, {
      from: seedFrom,
      to: seedTo
    })
    for (const change of nextChanges) {
      if (changes.some((existing) => existing.from === change.from && existing.to === change.to)) continue
      changes.push(change)
      if (changes.length >= MAX_PROPAGATION_CHANGES) return changes
    }
  }

  return changes
}
