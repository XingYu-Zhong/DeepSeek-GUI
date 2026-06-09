export type DiffStats = {
  added: number
  removed: number
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

function textHasUnifiedDiffMarkers(text: string): boolean {
  return text
    .split('\n')
    .some((line) => /^(@@|diff --git |--- |\+\+\+ |index )/.test(line))
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function extractUnifiedDiffText(text: string | undefined): string | undefined {
  const raw = text?.trim()
  if (!raw) return undefined
  if (textHasUnifiedDiffMarkers(raw)) return raw

  const record = parseJsonRecord(raw)
  if (!record) return undefined

  for (const key of ['diff', 'patch', 'unified_diff', 'unifiedDiff']) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const patch = value.trim()
    if (patch && textHasUnifiedDiffMarkers(patch)) return patch
  }

  return undefined
}

export function looksLikeUnifiedDiff(text: string | undefined): boolean {
  return extractUnifiedDiffText(text) !== undefined
}

export function extractDiffFilePath(
  patch: string | undefined,
  override?: string
): string | undefined {
  const preset = override?.trim()
  if (preset) return preset
  if (!patch) return undefined

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const raw = line.slice(4).trim()
      const cleaned = raw.replace(/^[ab]\//, '')
      if (cleaned && cleaned !== '/dev/null') return cleaned
      continue
    }
    if (line.startsWith('diff --git ')) {
      const match = line.match(/ b\/(\S+)/)
      if (match?.[1]) return match[1]
    }
  }

  return undefined
}

export function formatFilePathForDisplay(
  filePath: string | undefined,
  workspaceRoot?: string
): string | undefined {
  const raw = filePath?.trim()
  if (!raw) return undefined

  const normalizedFilePath = normalizePath(raw)
  const normalizedWorkspaceRoot = trimTrailingSlash(normalizePath(workspaceRoot?.trim() ?? ''))
  if (!normalizedWorkspaceRoot) return normalizedFilePath

  const fileLower = normalizedFilePath.toLowerCase()
  const rootLower = normalizedWorkspaceRoot.toLowerCase()
  if (fileLower === rootLower) return normalizedFilePath
  if (!fileLower.startsWith(`${rootLower}/`)) return normalizedFilePath

  return normalizedFilePath.slice(normalizedWorkspaceRoot.length + 1)
}

export function countDiffStats(patch: string | undefined): DiffStats | null {
  if (!patch) return null

  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }

  if (added === 0 && removed === 0) return null
  return { added, removed }
}

export function sumDiffStats(patches: Array<string | undefined>): DiffStats | null {
  let added = 0
  let removed = 0
  let hasStats = false

  for (const patch of patches) {
    const stats = countDiffStats(patch)
    if (!stats) continue
    added += stats.added
    removed += stats.removed
    hasStats = true
  }

  return hasStats ? { added, removed } : null
}
