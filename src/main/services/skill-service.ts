import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { expandHomePath } from './workspace-service'

export type GuiSkillScope = 'project' | 'global'

export type GuiSkillSummary = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: GuiSkillScope
  legacy: boolean
}

export type GuiSkillListResult =
  | { ok: true; skills: GuiSkillSummary[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }

export type GuiSkillRoot = {
  path: string
  scope: GuiSkillScope
}

export async function guiSkillRootsForRuntime(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<GuiSkillRoot[]> {
  if (!settings && !workspaceRootOverride) return []
  const workspaceRoots = uniqueStrings([
    workspaceRootOverride,
    settings?.workspaceRoot,
    settings?.claw.im.workspaceRoot,
    settings?.schedule.defaultWorkspaceRoot,
    ...(settings?.claw.channels.map((channel) => channel.workspaceRoot) ?? []),
    ...(settings?.claw.tasks.map((task) => task.workspaceRoot) ?? []),
    ...(settings?.schedule.tasks.map((task) => task.workspaceRoot) ?? [])
  ].map(normalizeSkillRootPath).filter(Boolean))
  const projectRoots = workspaceRoots.flatMap((workspaceRoot) => [
    join(workspaceRoot, '.codex', 'skills'),
    join(workspaceRoot, '.agents', 'skills'),
    join(workspaceRoot, 'skills')
  ])
  const globalRoots = [
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.kun', 'skills'),
    ...await discoverCodexPluginSkillRoots()
  ]
  const configuredExtraRoots = [
    ...(settings?.claw.skills.extraDirs ?? []),
    ...(settings?.schedule.skills.extraDirs ?? [])
  ].map(normalizeSkillRootPath)

  return uniqueSkillRoots([
    ...projectRoots
      .filter((root) => existsSync(root))
      .map((path) => ({ path, scope: 'project' as const })),
    ...globalRoots
      .filter((root) => existsSync(root))
      .map((path) => ({ path, scope: 'global' as const })),
    ...configuredExtraRoots
      .filter(Boolean)
      .map((path) => ({ path, scope: scopeForConfiguredRoot(path, workspaceRoots) }))
  ])
}

export async function listGuiSkills(
  settings: AppSettingsV1,
  workspaceRootOverride?: string
): Promise<GuiSkillListResult> {
  try {
    const roots = await guiSkillRootsForRuntime(settings, workspaceRootOverride)
    const skills: GuiSkillSummary[] = []
    const validationErrors: Array<{ root: string; message: string }> = []
    for (const root of roots) {
      const candidates = await packageCandidates(root.path).catch((error) => {
        validationErrors.push({ root: root.path, message: errorMessage(error) })
        return []
      })
      for (const candidate of candidates) {
        const loaded = await loadSkillSummary(candidate, root.scope).catch((error) => {
          validationErrors.push({ root: candidate, message: errorMessage(error) })
          return null
        })
        if (loaded) skills.push(loaded)
      }
    }
    return {
      ok: true,
      skills: dedupeSkills(skills),
      validationErrors
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export function normalizeSkillRootPath(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  return resolve(expandHomePath(trimmed))
}

async function discoverCodexPluginSkillRoots(): Promise<string[]> {
  const roots: string[] = []
  await collectSkillRoots(join(homedir(), '.codex', 'plugins', 'cache'), roots, 0, 5)
  return roots
}

async function collectSkillRoots(root: string, roots: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth || !existsSync(root)) return
  if (basename(root) === 'skills' && skillRootHasPackages(root)) {
    roots.push(root)
    return
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => collectSkillRoots(join(root, entry.name), roots, depth + 1, maxDepth)))
}

function skillRootHasPackages(root: string): boolean {
  if (existsSync(join(root, 'SKILL.md')) || existsSync(join(root, 'skill.json'))) return true
  try {
    return readdirSync(root, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() &&
      (existsSync(join(root, entry.name, 'SKILL.md')) || existsSync(join(root, entry.name, 'skill.json')))
    )
  } catch {
    return false
  }
}

async function packageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (existsSync(join(root, 'skill.json')) || existsSync(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    if (existsSync(join(dir, 'skill.json')) || existsSync(join(dir, 'SKILL.md'))) {
      candidates.add(dir)
    }
  }
  return [...candidates]
}

async function loadSkillSummary(root: string, scope: GuiSkillScope): Promise<GuiSkillSummary | null> {
  const manifestPath = join(root, 'skill.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const name = stringValue(manifest.name) || titleFromSlug(basename(root))
    const entry = stringValue(manifest.entry) || 'SKILL.md'
    return {
      id: slug(stringValue(manifest.id) || name || basename(root)),
      name,
      ...(stringValue(manifest.description) ? { description: stringValue(manifest.description) } : {}),
      root,
      entryPath: join(root, entry),
      scope,
      legacy: false
    }
  }
  const entryPath = join(root, 'SKILL.md')
  if (!existsSync(entryPath)) return null
  const content = await readFile(entryPath, 'utf8')
  const frontmatter = readFrontmatter(content)
  const name = displaySkillName(frontmatter.name, basename(root))
  return {
    id: slug(frontmatter.id || basename(root)),
    name,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    root,
    entryPath,
    scope,
    legacy: true
  }
}

function readFrontmatter(content: string): { id?: string; name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { description: firstMarkdownParagraph(content) }
  const yaml = match[1] ?? ''
  return {
    id: frontmatterString(yaml, 'id'),
    name: frontmatterString(yaml, 'name'),
    description: frontmatterString(yaml, 'description') || firstMarkdownParagraph(content.slice(match[0].length))
  }
}

function frontmatterString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? stripQuotes(match[1] ?? '').trim() || undefined : undefined
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function titleFromSlug(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function displaySkillName(frontmatterName: string | undefined, folderName: string): string {
  const value = frontmatterName?.trim() ?? ''
  if (!value) return titleFromSlug(folderName)
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value) ? titleFromSlug(value) : value
}

function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

function dedupeSkills(skills: GuiSkillSummary[]): GuiSkillSummary[] {
  const unique = new Map<string, GuiSkillSummary>()
  for (const skill of skills.sort(compareSkillSummary)) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
  }
  return [...unique.values()]
}

function compareSkillSummary(a: GuiSkillSummary, b: GuiSkillSummary): number {
  if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1
  return a.name.localeCompare(b.name)
}

function scopeForConfiguredRoot(path: string, workspaceRoots: string[]): GuiSkillScope {
  const comparable = comparablePath(path)
  return workspaceRoots.some((workspaceRoot) => {
    const workspace = comparablePath(workspaceRoot)
    return comparable === workspace || comparable.startsWith(`${workspace}/`)
  }) ? 'project' : 'global'
}

function uniqueSkillRoots(roots: GuiSkillRoot[]): GuiSkillRoot[] {
  const seen = new Set<string>()
  const out: GuiSkillRoot[] = []
  for (const root of roots) {
    const key = comparablePath(root.path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
