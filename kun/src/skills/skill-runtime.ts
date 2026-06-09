import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { SkillsCapabilityConfig } from '../contracts/capabilities.js'

const DEFAULT_ACTIVE_LIMIT = 3
const DEFAULT_INSTRUCTION_BUDGET_BYTES = 24_000

const SkillTriggerManifest = z.object({
  commands: z.array(z.string().min(1)).default([]),
  promptPatterns: z.array(z.string().min(1)).default([]),
  fileTypes: z.array(z.string().min(1)).default([])
}).default({ commands: [], promptPatterns: [], fileTypes: [] })

export const SkillManifest = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.0.0'),
  entry: z.string().min(1).default('SKILL.md'),
  triggers: SkillTriggerManifest,
  allowedTools: z.array(z.string().min(1)).default([]),
  assets: z.array(z.string().min(1)).default([]),
  priority: z.number().int().default(0)
}).strict()
export type SkillManifest = z.infer<typeof SkillManifest>

export type LoadedSkill = {
  id: string
  name: string
  description?: string
  version: string
  root: string
  entryPath: string
  entry: string
  triggers: z.infer<typeof SkillTriggerManifest>
  allowedTools: string[]
  assets: string[]
  priority: number
  legacy: boolean
}

export type SkillActivation = {
  skillId: string
  reason: string
  score: number
}

export type SkillTurnResolution = {
  activeSkillIds: string[]
  activations: SkillActivation[]
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
}

export type SkillRuntimeDiagnostics = {
  enabled: boolean
  roots: string[]
  skills: Array<{
    id: string
    name: string
    description?: string
    version: string
    root: string
    legacy: boolean
    triggers: LoadedSkill['triggers']
    allowedTools: string[]
  }>
  validationErrors: Array<{ root: string; message: string }>
  lastActivations: SkillActivation[]
  lastInjection?: {
    activeSkillIds: string[]
    injectedBytes: number
    budgetBytes: number
    blockedToolNames: string[]
  }
}

export type SkillRuntimeOptions = {
  activeLimit?: number
  instructionBudgetBytes?: number
}

export class SkillRuntime {
  private skills: LoadedSkill[]
  private validationErrors: Array<{ root: string; message: string }>
  private lastActivations: SkillActivation[] = []
  private lastInjection: SkillRuntimeDiagnostics['lastInjection']

  private constructor(
    private readonly config: SkillsCapabilityConfig,
    private readonly options: Required<SkillRuntimeOptions>,
    loaded: { skills: LoadedSkill[]; validationErrors: Array<{ root: string; message: string }> }
  ) {
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
  }

  static async create(
    config: SkillsCapabilityConfig | undefined,
    options: SkillRuntimeOptions = {}
  ): Promise<SkillRuntime> {
    const normalized = config ?? { enabled: false, roots: [], legacySkillMd: true }
    const resolvedOptions = {
      activeLimit: options.activeLimit ?? DEFAULT_ACTIVE_LIMIT,
      instructionBudgetBytes: options.instructionBudgetBytes ?? DEFAULT_INSTRUCTION_BUDGET_BYTES
    }
    const loaded = normalized.enabled
      ? await discoverSkills(normalized)
      : { skills: [], validationErrors: [] }
    return new SkillRuntime(normalized, resolvedOptions, loaded)
  }

  async refresh(): Promise<void> {
    const loaded = this.config.enabled
      ? await discoverSkills(this.config)
      : { skills: [], validationErrors: [] }
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
  }

  resolveTurn(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
  }): SkillTurnResolution {
    if (!this.config.enabled) return emptyResolution()
    const matches = this.matchSkills(input)
    const active = matches.slice(0, this.options.activeLimit)
    const injection = buildInjection(active, this.options.instructionBudgetBytes)
    const blockedToolNames = blockedToolsFor(this.skills, injection.allowedToolNames)
    this.lastActivations = active.map(({ skill, reason, score }) => ({
      skillId: skill.id,
      reason,
      score
    }))
    this.lastInjection = {
      activeSkillIds: injection.activeSkillIds,
      injectedBytes: injection.injectedBytes,
      budgetBytes: this.options.instructionBudgetBytes,
      blockedToolNames
    }
    return {
      activeSkillIds: injection.activeSkillIds,
      activations: this.lastActivations,
      instructions: injection.instructions,
      ...(injection.allowedToolNames ? { allowedToolNames: injection.allowedToolNames } : {}),
      injectedBytes: injection.injectedBytes
    }
  }

  diagnostics(): SkillRuntimeDiagnostics {
    return {
      enabled: this.config.enabled,
      roots: [...this.config.roots],
      skills: this.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        version: skill.version,
        root: skill.root,
        legacy: skill.legacy,
        triggers: skill.triggers,
        allowedTools: skill.allowedTools
      })),
      validationErrors: [...this.validationErrors],
      lastActivations: [...this.lastActivations],
      ...(this.lastInjection ? { lastInjection: this.lastInjection } : {})
    }
  }

  count(): number {
    return this.skills.length
  }

  private matchSkills(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
  }): Array<SkillActivation & { skill: LoadedSkill }> {
    const prompt = input.prompt
    const lowerPrompt = prompt.toLowerCase()
    const fileTypes = fileTypesFrom(input.filePaths ?? [], prompt)
    const matches: Array<SkillActivation & { skill: LoadedSkill }> = []
    for (const skill of this.skills) {
      const explicit = explicitSkillMention(skill, prompt)
      if (explicit) {
        matches.push({ skill, skillId: skill.id, reason: explicit, score: 1_000 + skill.priority })
        continue
      }
      const command = skill.triggers.commands.find((candidate) => lowerPrompt.startsWith(candidate.toLowerCase()))
      if (command) {
        matches.push({ skill, skillId: skill.id, reason: `command:${command}`, score: 900 + skill.priority })
        continue
      }
      const pattern = skill.triggers.promptPatterns.find((candidate) => safePatternMatches(candidate, prompt))
      if (pattern) {
        matches.push({ skill, skillId: skill.id, reason: `pattern:${pattern}`, score: 500 + skill.priority })
        continue
      }
      const fileType = skill.triggers.fileTypes.find((candidate) => fileTypes.has(normalizeFileType(candidate)))
      if (fileType) {
        matches.push({ skill, skillId: skill.id, reason: `fileType:${fileType}`, score: 300 + skill.priority })
      }
    }
    return matches.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
  }
}

async function discoverSkills(config: SkillsCapabilityConfig): Promise<{
  skills: LoadedSkill[]
  validationErrors: Array<{ root: string; message: string }>
}> {
  const skills: LoadedSkill[] = []
  const validationErrors: Array<{ root: string; message: string }> = []
  for (const rawRoot of config.roots) {
    const root = resolve(rawRoot)
    const candidates = await packageCandidates(root).catch((error) => {
      validationErrors.push({ root, message: errorMessage(error) })
      return []
    })
    for (const candidate of candidates) {
      const loaded = await loadSkillPackage(candidate, config.legacySkillMd).catch((error) => {
        validationErrors.push({ root: candidate, message: errorMessage(error) })
        return null
      })
      if (loaded) skills.push(loaded)
    }
  }
  const unique = new Map<string, LoadedSkill>()
  for (const skill of skills) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
    else validationErrors.push({ root: skill.root, message: `duplicate Skill id: ${skill.id}` })
  }
  return { skills: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), validationErrors }
}

async function packageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (await exists(join(root, 'skill.json')) || await exists(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = join(root, entry.name)
      if (await exists(join(dir, 'skill.json')) || await exists(join(dir, 'SKILL.md'))) {
        candidates.add(dir)
      }
    }
  }
  return [...candidates]
}

async function loadSkillPackage(root: string, allowLegacy: boolean): Promise<LoadedSkill | null> {
  const manifestPath = join(root, 'skill.json')
  if (await exists(manifestPath)) {
    const manifest = SkillManifest.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    const entryPath = resolve(root, manifest.entry)
    const entry = await readFile(entryPath, 'utf8')
    return {
      id: slug(manifest.id ?? manifest.name),
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      root,
      entryPath,
      entry,
      triggers: manifest.triggers,
      allowedTools: manifest.allowedTools,
      assets: manifest.assets.map((asset) => resolve(root, asset)),
      priority: manifest.priority,
      legacy: false
    }
  }
  if (!allowLegacy) return null
  const legacyPath = join(root, 'SKILL.md')
  if (!await exists(legacyPath)) return null
  const entry = await readFile(legacyPath, 'utf8')
  const frontmatter = readFrontmatter(entry)
  const folderName = basename(root)
  const name = frontmatter.name || folderName
  return {
    id: slug(frontmatter.id || folderName),
    name,
    description: frontmatter.description,
    version: 'legacy',
    root,
    entryPath: legacyPath,
    entry,
    triggers: { commands: [], promptPatterns: [], fileTypes: [] },
    allowedTools: [],
    assets: [],
    priority: 0,
    legacy: true
  }
}

function buildInjection(
  active: Array<SkillActivation & { skill: LoadedSkill }>,
  budgetBytes: number
): {
  activeSkillIds: string[]
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
} {
  const instructions: string[] = []
  const activeSkillIds: string[] = []
  const allowed = new Set<string>()
  let injectedBytes = 0
  for (const match of active) {
    const skill = match.skill
    const text = [
      `Active Skill: ${skill.name} (${skill.id})`,
      `Activation: ${match.reason}`,
      skill.description ? `Description: ${skill.description}` : '',
      skill.allowedTools.length ? `Allowed tools: ${skill.allowedTools.join(', ')}` : '',
      skill.assets.length ? `Assets:\n${skill.assets.map((asset) => `- ${asset}`).join('\n')}` : '',
      skill.entry
    ].filter(Boolean).join('\n\n')
    const bytes = Buffer.byteLength(text, 'utf8')
    if (injectedBytes + bytes > budgetBytes) continue
    activeSkillIds.push(skill.id)
    instructions.push(text)
    injectedBytes += bytes
    for (const tool of skill.allowedTools) allowed.add(tool)
  }
  return {
    activeSkillIds,
    instructions,
    ...(allowed.size > 0 ? { allowedToolNames: [...allowed].sort() } : {}),
    injectedBytes
  }
}

function blockedToolsFor(skills: LoadedSkill[], allowedToolNames: string[] | undefined): string[] {
  if (!allowedToolNames) return []
  const allowed = new Set(allowedToolNames)
  return [...new Set(skills.flatMap((skill) => skill.allowedTools))]
    .filter((tool) => !allowed.has(tool))
    .sort()
}

function emptyResolution(): SkillTurnResolution {
  return {
    activeSkillIds: [],
    activations: [],
    instructions: [],
    injectedBytes: 0
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function explicitSkillMention(skill: LoadedSkill, prompt: string): string | undefined {
  const lower = prompt.toLowerCase()
  const id = skill.id.toLowerCase()
  const name = skill.name.toLowerCase()
  if (lower.includes(`$${id}`) || lower.includes(`@${id}`) || lower.includes(`/skill:${id}`)) return 'explicit:id'
  if (name && (lower.includes(`$${name}`) || lower.includes(`@${name}`))) return 'explicit:name'
  return undefined
}

function safePatternMatches(pattern: string, prompt: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(prompt)
  } catch {
    return false
  }
}

function fileTypesFrom(paths: readonly string[], prompt: string): Set<string> {
  const out = new Set<string>()
  for (const filePath of paths) {
    const ext = extname(filePath)
    if (ext) out.add(normalizeFileType(ext))
  }
  for (const match of prompt.matchAll(/\.[a-z0-9]+/gi)) {
    out.add(normalizeFileType(match[0] ?? ''))
  }
  return out
}

function normalizeFileType(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
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

function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('; ')
  return error instanceof Error ? error.message : String(error)
}
