export type FileReferenceTarget = {
  path: string
  line?: number
  column?: number
}

export type FileReferenceMatch = {
  start: number
  end: number
  text: string
  target: FileReferenceTarget
}

type HastNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const FILE_REFERENCE_SCHEME = 'deepseek-file:'
const PATH_PREFIX_BOUNDARY = String.raw`(?<![\w@.~\/\\-])`

const EXTENSIONS = [
  'astro',
  'bash',
  'c',
  'cc',
  'cjs',
  'cpp',
  'cs',
  'css',
  'dart',
  'env',
  'fish',
  'go',
  'h',
  'hpp',
  'html?',
  'ini',
  'java',
  'jsx?',
  'json',
  'kt',
  'less',
  'lock',
  'mdx?',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'tsx?',
  'txt',
  'vue',
  'ya?ml',
  'xml',
  'zsh'
].join('|')

const PATH_CHARS = String.raw`[\w@.()+=[\]{} $,;!%#~\/\\-]`
const PATH_END = String.raw`(?=$|[\s(),.;:!?\]\u3001\u3002\uff0c\uff1b\uff08\uff09]|#L)`
const PATH_WITH_SEPARATOR = new RegExp(
  String.raw`${PATH_PREFIX_BOUNDARY}(?:~|\/|\.{1,2}\/|[A-Za-z]:[\\/]|[\w@.-]+[\\/])${PATH_CHARS}*?\.(?:${EXTENSIONS})${PATH_END}`,
  'giu'
)
const LINE_SUFFIX = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L\d+)?|\s*[（(](?:line|lines)\s+(\d+)[）)]|\s*[（(]第\s*(\d+)\s*行[）)]|\s+line\s+(\d+)|\s+第\s*(\d+)\s*行)/iy
const TRAILING_PUNCTUATION = /[.,;!?]+$/
const BLOCKED_PARENTS = new Set(['a', 'code', 'pre', 'script', 'style', 'textarea'])

function lineFromSuffix(match: RegExpExecArray): { line?: number; column?: number } {
  const lineText = match[1] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7]
  const columnText = match[2]
  const line = lineText ? Number.parseInt(lineText, 10) : undefined
  const column = columnText ? Number.parseInt(columnText, 10) : undefined
  return {
    ...(line && Number.isFinite(line) && line > 0 ? { line } : {}),
    ...(column && Number.isFinite(column) && column > 0 ? { column } : {})
  }
}

function tokenBefore(text: string, index: number): string {
  const prefix = text.slice(0, index)
  const tokenStart = Math.max(
    prefix.lastIndexOf(' '),
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('\t'),
    prefix.lastIndexOf('('),
    prefix.lastIndexOf('['),
    prefix.lastIndexOf('{')
  )
  return prefix.slice(tokenStart + 1)
}

function isProbablyUrl(text: string, index: number): boolean {
  return tokenBefore(text, index).includes('://')
}

function trimPathMatch(raw: string): string {
  return raw.replace(TRAILING_PUNCTUATION, '')
}

function collectMatches(text: string, regex: RegExp, requireLineSuffix: boolean): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = []
  regex.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const matched = match[0]
    if (!matched || isProbablyUrl(text, match.index)) continue

    const path = trimPathMatch(matched)
    const pathEnd = match.index + path.length
    LINE_SUFFIX.lastIndex = pathEnd
    const suffix = LINE_SUFFIX.exec(text)
    const lineInfo = suffix ? lineFromSuffix(suffix) : {}
    if (requireLineSuffix && !lineInfo.line) continue

    const end = suffix ? suffix.index + suffix[0].length : pathEnd
    matches.push({
      start: match.index,
      end,
      text: text.slice(match.index, end),
      target: {
        path,
        ...lineInfo
      }
    })
  }

  return matches
}

function mergeMatches(matches: FileReferenceMatch[]): FileReferenceMatch[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: FileReferenceMatch[] = []
  let lastEnd = -1
  for (const match of sorted) {
    if (match.start < lastEnd) continue
    merged.push(match)
    lastEnd = match.end
  }
  return merged
}

export function findFileReferences(text: string): FileReferenceMatch[] {
  if (!text.trim()) return []
  return mergeMatches(collectMatches(text, PATH_WITH_SEPARATOR, false))
}

export function createFileReferenceHref(target: FileReferenceTarget): string {
  const params = new URLSearchParams({ path: target.path })
  if (target.line) params.set('line', String(target.line))
  if (target.column) params.set('column', String(target.column))
  return `${FILE_REFERENCE_SCHEME}//open?${params.toString()}`
}

export function parseFileReferenceHref(href: string | undefined): FileReferenceTarget | null {
  if (!href?.startsWith(FILE_REFERENCE_SCHEME)) return null
  try {
    const url = new URL(href)
    const path = url.searchParams.get('path')?.trim()
    if (!path) return null
    const line = Number.parseInt(url.searchParams.get('line') ?? '', 10)
    const column = Number.parseInt(url.searchParams.get('column') ?? '', 10)
    return {
      path,
      ...(Number.isFinite(line) && line > 0 ? { line } : {}),
      ...(Number.isFinite(column) && column > 0 ? { column } : {})
    }
  } catch {
    return null
  }
}

function linkifyTextNode(node: HastNode): HastNode[] {
  const text = node.value ?? ''
  const matches = findFileReferences(text)
  if (matches.length === 0) return [node]

  const next: HastNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      next.push({ type: 'text', value: text.slice(cursor, match.start) })
    }
    next.push({
      type: 'element',
      tagName: 'a',
      properties: {
        href: createFileReferenceHref(match.target),
        className: ['ds-file-reference-link'],
        title: match.target.line
          ? `${match.target.path}:${match.target.line}`
          : match.target.path
      },
      children: [{ type: 'text', value: match.text }]
    })
    cursor = match.end
  }
  if (cursor < text.length) {
    next.push({ type: 'text', value: text.slice(cursor) })
  }
  return next
}

function visit(node: HastNode, blocked: boolean): void {
  const children = node.children
  if (!children?.length) return

  const nextBlocked = blocked || (node.tagName ? BLOCKED_PARENTS.has(node.tagName) : false)
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!nextBlocked && child.type === 'text') {
      const replacement = linkifyTextNode(child)
      if (replacement.length !== 1 || replacement[0] !== child) {
        children.splice(index, 1, ...replacement)
        index += replacement.length - 1
      }
      continue
    }
    visit(child, nextBlocked)
  }
}

export function rehypeFileReferences() {
  return (tree: HastNode): void => visit(tree, false)
}
