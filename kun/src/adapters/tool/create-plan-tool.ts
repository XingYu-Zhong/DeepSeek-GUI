import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  GUI_PLAN_RELATIVE_DIR,
  buildGuiPlanId,
  guiPlanWorkspaceMatches,
  isGuiPlanCurrentRelativePath,
  isGuiPlanRelativePath,
  nextAvailablePlanRelativePath,
  type CreatePlanToolInput,
  type CreatePlanToolOutput,
  type GuiPlanOperation
} from '../../shared/gui-plan.js'

/**
 * Shared tool name. Kept in sync with the renderer contract so the
 * model, the tool host, and the GUI agree on the public surface.
 */
export const CREATE_PLAN_TOOL_NAME = 'create_plan'

const TOOL_DESCRIPTION = [
  'Create or replace a GUI-owned implementation plan.',
  'Available throughout a Plan-mode conversation: investigate first, then',
  'call this once you understand the task to save the full Markdown plan.',
  'Writes the supplied Markdown to a reserved plan artifact under',
  '.kunsdd/plan and returns structured metadata. Call again to revise.'
].join(' ')

/**
 * Schema describing the tool input. The model sees this verbatim; the
 * tool adapter also validates the values at execution time.
 */
export const CREATE_PLAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    markdown: {
      type: 'string',
      description: 'Complete Markdown plan content to save.'
    },
    source_request: {
      type: 'string',
      description: 'Original user request that this plan answers.'
    },
    title: {
      type: 'string',
      description: 'Short display title for the plan.'
    },
    operation: {
      type: 'string',
      enum: ['draft', 'refine'],
      description: 'Use "draft" for a new plan, "refine" when revising an existing one.'
    },
    plan_id: {
      type: 'string',
      description: 'Optional reserved plan id; when supplied, must match the GUI plan context.'
    },
    plan_relative_path: {
      type: 'string',
      description: 'Optional reserved relative path; must live directly under .kunsdd/plan.'
    }
  },
  required: ['markdown', 'operation'],
  additionalProperties: false
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function pickOperation(value: unknown): GuiPlanOperation | undefined {
  return value === 'draft' || value === 'refine' ? value : undefined
}

function computeContentFingerprint(markdown: string): { hash: string; bytes: number } {
  const bytes = Buffer.byteLength(markdown, 'utf8')
  const hash = createHash('sha256').update(markdown, 'utf8').digest('hex').slice(0, 16)
  return { hash, bytes }
}

function buildTempPath(target: string): string {
  const dot = target.lastIndexOf('.')
  const base = dot > 0 ? target.slice(0, dot) : target
  const ext = dot > 0 ? target.slice(dot) : ''
  return `${base}.tmp-${process.pid}-${Date.now()}${ext}`
}

function toRelativePath(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function planDirectory(workspaceRoot: string): string {
  return isAbsolute(workspaceRoot)
    ? join(workspaceRoot, GUI_PLAN_RELATIVE_DIR)
    : join(process.cwd(), workspaceRoot, GUI_PLAN_RELATIVE_DIR)
}

function assertWithinWorkspace(absolutePath: string, workspaceRoot: string): void {
  const rel = relative(workspaceRoot, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('plan write escaped the configured workspace root')
  }
}

/**
 * Derive a filesystem-safe plan feature name from free-form text. Mirrors
 * the renderer's `planFeatureNameFromRequest` so self-allocated plan files
 * stay consistent with GUI-reserved ones. Non-ASCII (e.g. CJK) text is
 * preserved; only illegal filename characters are stripped.
 */
function deriveFeatureName(seed: string | undefined): string {
  const raw = (seed ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .replace(/[<>:"|?*\\/]+/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '')
  const safe = raw.slice(0, 96).replace(/[.\-\s]+$/, '')
  return safe || 'plan'
}

export type CreatePlanAdapterOptions = {
  /** Default workspace root to resolve relative paths against. */
  defaultWorkspaceRoot?: string
  /**
   * Path resolver used when the plan context does not include an
   * absolute path. Returns the workspace root directory.
   */
  resolveWorkspaceRoot?: (workspace: string) => Promise<string> | string
  /**
   * Lists existing plan relative paths (e.g. `.kunsdd/plan/foo.md`)
   * so a free-form plan-mode call can allocate a non-colliding filename.
   * Defaults to reading the workspace plan directory. Tests can override
   * this to allocate deterministically without touching the filesystem.
   */
  listPlanFiles?: (workspaceRoot: string) => Promise<string[]> | string[]
  /**
   * Atomic writer. Defaults to a temp file + rename implementation.
   * Tests can override this to inspect plan writes without touching
   * the real filesystem.
   */
  writePlan?: (
    target: { workspaceRoot: string; relativePath: string; absolutePath: string; markdown: string },
    signal: AbortSignal
  ) => Promise<{ path: string; savedAt: string }>
}

/**
 * Default atomic write. Writes to a sibling temp file, then renames
 * over the target so a mid-write crash leaves the previous plan
 * intact. Honours the abort signal before the rename.
 */
async function defaultWritePlan(
  target: { workspaceRoot: string; relativePath: string; absolutePath: string; markdown: string },
  signal: AbortSignal
): Promise<{ path: string; savedAt: string }> {
  return withFileMutationQueue(target.absolutePath, async () => {
    if (signal.aborted) {
      throw new Error('plan write aborted before start')
    }
    await mkdir(dirname(target.absolutePath), { recursive: true })
    const tempPath = buildTempPath(target.absolutePath)
    await writeFile(tempPath, target.markdown, 'utf8')
    if (signal.aborted) {
      throw new Error('plan write aborted before atomic rename')
    }
    await rename(tempPath, target.absolutePath)
    return { path: target.absolutePath, savedAt: new Date().toISOString() }
  })
}

/**
 * List existing plan relative paths under the workspace plan directory.
 * Returns an empty list when the directory does not exist yet.
 */
async function listExistingPlanRelativePaths(
  workspaceRoot: string,
  options: CreatePlanAdapterOptions
): Promise<string[]> {
  if (options.listPlanFiles) {
    return options.listPlanFiles(workspaceRoot)
  }
  try {
    const entries = await readdir(planDirectory(workspaceRoot))
    return entries
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .map((name) => `${GUI_PLAN_RELATIVE_DIR}/${name}`)
  } catch {
    return []
  }
}

/**
 * Build the `create_plan` tool with mode-aware advertisement and
 * execution-time enforcement of the active GUI plan context. The
 * tool:
 *
 * 1. Advertises during any Plan-mode turn, or when an explicit GUI
 *    plan context is present.
 * 2. With a GUI plan context, writes only to the reserved path and
 *    enforces operation/workspace/id parity (refine-in-place).
 * 3. Without one (free-form plan mode), allocates a fresh
 *    `.kunsdd/plan/<feature>.md` under the active workspace.
 * 4. Writes atomically, observes the abort signal, and returns a
 *    structured output with content hash and byte count.
 */
export function createCreatePlanTool(options: CreatePlanAdapterOptions = {}): LocalTool {
  return LocalToolHost.defineTool({
    name: CREATE_PLAN_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    toolKind: 'file_change',
    inputSchema: CREATE_PLAN_INPUT_SCHEMA,
    policy: 'auto',
    shouldAdvertise: (context) => isPlanToolContextActive(context),
    execute: async (args, context) =>
      executeCreatePlanTool(args, context, options)
  })
}

/**
 * Predicate exposed for tests and runtime composition. Returns true
 * when the active turn context should advertise `create_plan`: either
 * the thread/turn is in Plan mode, or an explicit GUI plan context was
 * advertised by the renderer.
 */
export function isPlanToolContextActive(context: ToolHostContext | undefined): boolean {
  if (!context) return false
  return Boolean(context.guiPlan) || context.threadMode === 'plan'
}

type ResolvedPlanTarget = {
  workspaceRoot: string
  relativePath: string
  planId: string
  operation: GuiPlanOperation
  sourceRequest?: string
  title?: string
}

/**
 * Execution-time validation. Split out so it can be unit-tested without
 * going through the full tool host. Returns either an error tool
 * result or the resolved write output.
 */
export async function executeCreatePlanTool(
  args: Record<string, unknown>,
  context: ToolHostContext,
  options: CreatePlanAdapterOptions = {}
): Promise<{ output: unknown; isError?: boolean }> {
  if (!isPlanToolContextActive(context)) {
    return {
      output: { error: 'create_plan requires Plan mode or an active GUI plan context' },
      isError: true
    }
  }
  const input: Partial<CreatePlanToolInput> = {
    markdown: pickString(args.markdown),
    source_request: pickString(args.source_request),
    title: pickString(args.title),
    operation: pickOperation(args.operation),
    plan_id: pickString(args.plan_id),
    plan_relative_path: pickString(args.plan_relative_path)
  }
  if (input.operation !== 'draft' && input.operation !== 'refine') {
    return { output: { error: 'operation must be "draft" or "refine"' }, isError: true }
  }
  if (typeof input.markdown !== 'string' || !input.markdown.trim()) {
    return { output: { error: 'markdown is required and must be non-empty' }, isError: true }
  }

  const resolved = context.guiPlan
    ? resolveReservedTarget(input, context)
    : await resolveFreeFormTarget(input, context, options)
  if ('error' in resolved) {
    return { output: { error: resolved.error }, isError: true }
  }

  const resolvedWorkspace = options.resolveWorkspaceRoot
    ? await options.resolveWorkspaceRoot(resolved.workspaceRoot)
    : resolved.workspaceRoot
  const absolutePath = isAbsolute(resolvedWorkspace)
    ? normalize(join(resolvedWorkspace, resolved.relativePath))
    : normalize(join(planDirectory(resolvedWorkspace), basename(resolved.relativePath)))
  assertWithinWorkspace(absolutePath, resolvedWorkspace)
  if (context.abortSignal.aborted) {
    return { output: { error: 'plan write aborted' }, isError: true }
  }
  const writer = options.writePlan ?? defaultWritePlan
  const fingerprint = computeContentFingerprint(input.markdown)
  const written = await writer(
    {
      workspaceRoot: resolvedWorkspace,
      relativePath: resolved.relativePath,
      absolutePath,
      markdown: input.markdown
    },
    context.abortSignal
  )
  if (context.abortSignal.aborted) {
    return { output: { error: 'plan write aborted' }, isError: true }
  }
  const output: CreatePlanToolOutput = {
    summary: `${resolved.operation === 'refine' ? 'Refined' : 'Created'} GUI plan at ${resolved.relativePath}.`,
    plan_id: resolved.planId,
    workspace_root: resolvedWorkspace,
    relative_path: resolved.relativePath,
    absolute_path: written.path,
    source_request: input.source_request ?? resolved.sourceRequest,
    title: input.title ?? resolved.title,
    operation: resolved.operation,
    saved_at: written.savedAt,
    content_hash: fingerprint.hash,
    byte_size: fingerprint.bytes
  }
  return { output }
}

/**
 * Strict resolution for turns that carry a renderer-advertised GUI plan
 * context: the tool may only write to the reserved path, with parity
 * checks on operation, workspace, id, and explicit path overrides.
 */
function resolveReservedTarget(
  input: Partial<CreatePlanToolInput>,
  context: ToolHostContext
): ResolvedPlanTarget | { error: string } {
  const contextPlan = context.guiPlan
  if (!contextPlan) {
    return { error: 'create_plan requires an active GUI plan context' }
  }
  if (input.operation !== contextPlan.operation) {
    return { error: 'operation does not match the active GUI plan operation' }
  }
  if (!guiPlanWorkspaceMatches(context.workspace, contextPlan.workspaceRoot)) {
    return { error: 'tool workspace does not match the active GUI plan workspace' }
  }
  const relativePath = toRelativePath(contextPlan.relativePath)
  if (!relativePath || !isGuiPlanRelativePath(relativePath)) {
    return { error: 'plan_relative_path must be a direct Markdown file under .kunsdd/plan' }
  }
  if (input.operation === 'draft' && !isGuiPlanCurrentRelativePath(relativePath)) {
    return { error: 'legacy .deepseekgui/plan paths can only be refined' }
  }
  if (input.plan_relative_path && toRelativePath(input.plan_relative_path) !== contextPlan.relativePath) {
    return { error: 'plan_relative_path does not match the reserved GUI plan path' }
  }
  if (input.plan_id && input.plan_id !== contextPlan.planId) {
    return { error: 'plan_id does not match the reserved GUI plan id' }
  }
  const workspaceRoot = contextPlan.workspaceRoot ?? context.workspace
  if (!workspaceRoot) {
    return { error: 'workspace root is required' }
  }
  return {
    workspaceRoot,
    relativePath,
    planId: contextPlan.planId ?? input.plan_id ?? buildGuiPlanId(workspaceRoot, relativePath),
    operation: input.operation as GuiPlanOperation,
    sourceRequest: contextPlan.sourceRequest,
    title: contextPlan.title
  }
}

/**
 * Free-form resolution for Plan-mode turns without a reserved context.
 * Honours an explicit `plan_relative_path` when valid; otherwise
 * allocates a fresh, non-colliding `.kunsdd/plan/<feature>.md`.
 */
async function resolveFreeFormTarget(
  input: Partial<CreatePlanToolInput>,
  context: ToolHostContext,
  options: CreatePlanAdapterOptions
): Promise<ResolvedPlanTarget | { error: string }> {
  const workspaceRoot = context.workspace?.trim() || options.defaultWorkspaceRoot?.trim() || ''
  if (!workspaceRoot) {
    return { error: 'workspace root is required' }
  }
  let relativePath: string
  if (input.plan_relative_path) {
    const candidate = toRelativePath(input.plan_relative_path)
    if (!candidate || !isGuiPlanCurrentRelativePath(candidate)) {
      return { error: 'plan_relative_path must be a direct Markdown file under .kunsdd/plan' }
    }
    relativePath = candidate
  } else {
    const featureName = deriveFeatureName(input.title ?? input.source_request)
    const existing = await listExistingPlanRelativePaths(workspaceRoot, options)
    relativePath = nextAvailablePlanRelativePath(featureName, existing)
  }
  return {
    workspaceRoot,
    relativePath,
    planId: buildGuiPlanId(workspaceRoot, relativePath),
    operation: input.operation as GuiPlanOperation,
    sourceRequest: input.source_request,
    title: input.title
  }
}
