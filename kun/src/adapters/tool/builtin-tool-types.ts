import { stat } from 'node:fs/promises'
import type { LocalTool } from './local-tool-host.js'

export type FsStats = NonNullable<Awaited<ReturnType<typeof stat>>>

export const DEFAULT_BASH_TIMEOUT_SECONDS = 120
export const DEFAULT_SEARCH_LIMIT = 100
export const DEFAULT_LIST_LIMIT = 500
export const DEFAULT_FIND_LIMIT = 1000
export const DEFAULT_IMAGE_MAX_DIMENSION = 2000
export const DEFAULT_IMAGE_MAX_BASE64_BYTES = 4.5 * 1024 * 1024
export const FD_EXECUTABLE_CANDIDATES = [
  '/Applications/Codex.app/Contents/Resources/fd',
  'fd'
]
export const RG_EXECUTABLE_CANDIDATES = [
  '/Applications/Codex.app/Contents/Resources/rg',
  'rg'
]

export type TruncateMode = 'head' | 'tail'

export type TextSlice = {
  text: string
  truncated: boolean
  totalLines: number
  shownLines: number
  totalBytes: number
  shownBytes: number
  firstLineExceedsLimit?: boolean
  truncatedBy?: 'lines' | 'bytes'
  lastLinePartial?: boolean
}

export type ShellConfig = {
  shell: string
  args: string[]
}

export type ListEntry = {
  path: string
  relative_path: string
  name: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
}

export type GrepMatch = {
  path: string
  relative_path: string
  line: number
  column: number
  text: string
  context_before?: string[]
  context_after?: string[]
}

export type EditInstruction = {
  oldText: string
  newText: string
}

export type ImageDetection = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  width?: number
  height?: number
}

export interface ResizedImageResult {
  dataBase64: string
  mimeType: string
  width: number
  height: number
  originalWidth?: number
  originalHeight?: number
  wasResized?: boolean
}

export interface ResizeImageOptions {
  maxWidth?: number
  maxHeight?: number
  maxBytes?: number
}

export type ReadClassification = {
  kind: 'docs' | 'resource' | 'skill'
  label: string
}

export const COMPACT_RESOURCE_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'])

export type BuiltinToolName = 'read' | 'bash' | 'edit' | 'write' | 'grep' | 'find' | 'ls'
export const allBuiltinToolNames: Set<BuiltinToolName> = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls'
])
export type ToolName = BuiltinToolName
export const allToolNames: Set<ToolName> = allBuiltinToolNames

export type ReadLocalToolOptions = {
  maxLines?: number
  maxBytes?: number
  autoResizeImages?: boolean
  operations?: ReadLocalToolOperations
}

export type BashLocalToolOptions = {
  defaultTimeoutSeconds?: number
  operations?: BashLocalToolOperations
}

export type WriteLocalToolOptions = {
  operations?: WriteLocalToolOperations
}
export type EditLocalToolOptions = {
  operations?: EditLocalToolOperations
}

export type GrepLocalToolOptions = {
  defaultLimit?: number
  rgExecutableCandidates?: string[]
  operations?: GrepLocalToolOperations
}

export type FindLocalToolOptions = {
  defaultLimit?: number
  fdExecutableCandidates?: string[]
  rgExecutableCandidates?: string[]
  operations?: FindLocalToolOperations
}

export type LsLocalToolOptions = {
  defaultLimit?: number
  operations?: LsLocalToolOperations
}

export type BuiltinLocalToolsOptions = {
  read?: ReadLocalToolOptions
  bash?: BashLocalToolOptions
  write?: WriteLocalToolOptions
  edit?: EditLocalToolOptions
  grep?: GrepLocalToolOptions
  find?: FindLocalToolOptions
  ls?: LsLocalToolOptions
}
export type ToolsOptions = BuiltinLocalToolsOptions

export interface ReadLocalToolOperations {
  stat?: (path: string) => Promise<FsStats>
  readFile?: (path: string) => Promise<Buffer>
  detectImageMimeType?: (buffer: Buffer) => ImageDetection | null
  resizeImage?: (
    buffer: Buffer,
    mimeType: string,
    options?: ResizeImageOptions
  ) => Promise<ResizedImageResult | null>
}

export interface BashLocalToolOperations {
  exec?: (
    command: string,
    cwd: string,
    options: { signal: AbortSignal; timeoutSeconds: number; onData?: (data: Buffer) => void }
  ) => Promise<{ exitCode: number | null; shell?: string }>
}

export interface WriteLocalToolOperations {
  mkdir?: (path: string) => Promise<void>
  writeFile?: (path: string, content: string) => Promise<void>
}

export interface EditLocalToolOperations {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, content: string) => Promise<void>
}

export interface GrepLocalToolOperations {
  search?: (
    input: {
      pattern: string
      path: string
      glob: string | null
      ignoreCase: boolean
      literal: boolean
      context: number
      limit: number
    }
  ) => Promise<GrepMatch[]>
}

export interface FindLocalToolOperations {
  glob?: (
    input: { pattern: string; path: string; limit: number }
  ) => Promise<Array<{ path: string; relative_path: string }>>
}

export interface LsLocalToolOperations {
  stat?: (path: string) => Promise<FsStats>
  readdir?: (path: string) => Promise<Array<{ name: string }>>
}

export type Tool = LocalTool
export type ToolDef = LocalTool
