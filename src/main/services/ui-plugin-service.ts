import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  UI_PLUGIN_LIMITS,
  UI_PLUGIN_MANIFEST_FILENAME,
  isSafeUiPluginFigurePath,
  normalizeUiPluginManifest,
  type UiPluginFigureSlot,
  type UiPluginListItem,
  type UiPluginManifestV1,
  type UiPluginRuntimeFigures
} from '../../shared/ui-plugin'

/**
 * UI 插件落盘服务。插件目录:~/.kun/ui-plugins/<id>/
 * 安装走"白名单复制":只复制 manifest.json 与被 figures 引用到的图片,
 * 源目录里的其它任何文件(脚本、可执行文件等)一概不进入 Kun 数据目录。
 */

export type UiPluginInstallResult =
  | { ok: true; plugin: UiPluginListItem }
  | { ok: false; errors: string[] }

export type UiPluginLoadResult =
  | { ok: true; manifest: UiPluginManifestV1; figures: UiPluginRuntimeFigures }
  | { ok: false; error: string }

const FIGURE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif'
}

export function uiPluginsRootDir(kunHomeDir: string): string {
  return join(kunHomeDir, 'ui-plugins')
}

function confinedPluginPath(rootDir: string, pluginId: string, relativePath?: string): string {
  const base = resolve(rootDir)
  const target = resolve(base, pluginId, ...(relativePath ? relativePath.split('/') : []))
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`UI plugin path escapes plugins root: ${pluginId}/${relativePath ?? ''}`)
  }
  return target
}

function figureDataUrl(filePath: string, bytes: Buffer): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  const mime = FIGURE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function readFigureWithCaps(
  filePath: string,
  budget: { remaining: number }
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  let size: number
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { ok: false, error: '不是文件' }
    size = info.size
  } catch {
    return { ok: false, error: '文件不存在' }
  }
  if (size > UI_PLUGIN_LIMITS.figureBytes) {
    return { ok: false, error: `图片超过 ${Math.round(UI_PLUGIN_LIMITS.figureBytes / 1024 / 1024)}MB 上限` }
  }
  if (size > budget.remaining) {
    return { ok: false, error: '插件图片总体积超过上限' }
  }
  budget.remaining -= size
  const bytes = await readFile(filePath)
  return { ok: true, dataUrl: figureDataUrl(filePath, bytes) }
}

async function readManifestAt(dir: string): Promise<
  | { ok: true; manifest: UiPluginManifestV1 }
  | { ok: false; errors: string[] }
> {
  const manifestPath = join(dir, UI_PLUGIN_MANIFEST_FILENAME)
  let text: string
  try {
    const info = await stat(manifestPath)
    if (info.size > UI_PLUGIN_LIMITS.manifestBytes) {
      return { ok: false, errors: ['manifest.json 超过 64KB 上限'] }
    }
    text = await readFile(manifestPath, 'utf8')
  } catch {
    return { ok: false, errors: ['目录里找不到 manifest.json'] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      errors: [`manifest.json 不是合法 JSON:${error instanceof Error ? error.message : String(error)}`]
    }
  }
  return normalizeUiPluginManifest(raw)
}

async function readPluginPreview(
  pluginDir: string,
  manifest: UiPluginManifestV1
): Promise<string | null> {
  const previewSlots: UiPluginFigureSlot[] = ['toggleIcon', 'swim', 'greet', 'sit', 'sleep', 'run', 'surf']
  for (const slot of previewSlots) {
    const relativePath = manifest.figures[slot]
    if (!relativePath) continue
    const budget = { remaining: UI_PLUGIN_LIMITS.figureBytes }
    const result = await readFigureWithCaps(join(pluginDir, ...relativePath.split('/')), budget)
    if (result.ok) return result.dataUrl
  }
  return null
}

export async function listUiPlugins(userDataDir: string): Promise<UiPluginListItem[]> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let entries: string[]
  try {
    entries = (await readdir(rootDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const plugins: UiPluginListItem[] = []
  for (const entry of entries.sort()) {
    let pluginDir: string
    try {
      pluginDir = confinedPluginPath(rootDir, entry)
    } catch {
      continue
    }
    const manifestResult = await readManifestAt(pluginDir)
    if (!manifestResult.ok) continue
    // 目录名必须与 manifest id 一致,避免同一插件多份伪装
    if (manifestResult.manifest.id !== entry) continue
    plugins.push({
      manifest: manifestResult.manifest,
      previewDataUrl: await readPluginPreview(pluginDir, manifestResult.manifest)
    })
  }
  return plugins
}

export async function loadUiPluginFigures(
  userDataDir: string,
  pluginId: string
): Promise<UiPluginLoadResult> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let pluginDir: string
  try {
    pluginDir = confinedPluginPath(rootDir, pluginId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const manifestResult = await readManifestAt(pluginDir)
  if (!manifestResult.ok) {
    return { ok: false, error: manifestResult.errors.join('; ') }
  }
  const manifest = manifestResult.manifest
  if (manifest.id !== pluginId) {
    return { ok: false, error: '插件目录与 manifest id 不一致' }
  }

  const figures: UiPluginRuntimeFigures = {}
  const budget = { remaining: UI_PLUGIN_LIMITS.totalFigureBytes }
  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath || !isSafeUiPluginFigurePath(relativePath)) continue
    let figurePath: string
    try {
      figurePath = confinedPluginPath(rootDir, pluginId, relativePath)
    } catch {
      continue
    }
    const result = await readFigureWithCaps(figurePath, budget)
    if (!result.ok) {
      return { ok: false, error: `槽位 ${slot} 加载失败:${result.error}` }
    }
    figures[slot as UiPluginFigureSlot] = result.dataUrl
  }
  return { ok: true, manifest, figures }
}

export async function installUiPluginFromDirectory(
  userDataDir: string,
  sourceDir: string
): Promise<UiPluginInstallResult> {
  const manifestResult = await readManifestAt(sourceDir)
  if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors }
  const manifest = manifestResult.manifest

  // 先在源目录核验每张被引用的图片(存在 + 体积)
  const errors: string[] = []
  const budget = { remaining: UI_PLUGIN_LIMITS.totalFigureBytes }
  const figureFiles: Array<{ relativePath: string; bytes: Buffer }> = []
  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath) continue
    const sourcePath = resolve(sourceDir, ...relativePath.split('/'))
    if (sourcePath !== resolve(sourceDir) && !sourcePath.startsWith(resolve(sourceDir) + sep)) {
      errors.push(`槽位 ${slot} 的路径越界`)
      continue
    }
    const check = await readFigureWithCaps(sourcePath, budget)
    if (!check.ok) {
      errors.push(`槽位 ${slot}(${relativePath}):${check.error}`)
      continue
    }
    figureFiles.push({ relativePath, bytes: await readFile(sourcePath) })
  }
  if (errors.length > 0) return { ok: false, errors }

  const rootDir = uiPluginsRootDir(userDataDir)
  const targetDir = confinedPluginPath(rootDir, manifest.id)
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  await writeFile(
    join(targetDir, UI_PLUGIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  for (const file of figureFiles) {
    const targetPath = confinedPluginPath(rootDir, manifest.id, file.relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.bytes)
  }

  return {
    ok: true,
    plugin: {
      manifest,
      previewDataUrl: await readPluginPreview(targetDir, manifest)
    }
  }
}

/**
 * 用内存字节落盘一个插件(预装插件用)。figureBytes 的键是槽位名,
 * 落盘路径取 manifest.figures 声明的相对路径。
 */
export async function seedUiPlugin(
  userDataDir: string,
  manifestRaw: unknown,
  figureBytes: Record<string, Buffer>
): Promise<UiPluginInstallResult> {
  const manifestResult = normalizeUiPluginManifest(manifestRaw)
  if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors }
  const manifest = manifestResult.manifest

  const errors: string[] = []
  let totalBytes = 0
  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath) continue
    const bytes = figureBytes[slot]
    if (!bytes) {
      errors.push(`槽位 ${slot} 缺少预装图片数据`)
      continue
    }
    if (bytes.byteLength > UI_PLUGIN_LIMITS.figureBytes) {
      errors.push(`槽位 ${slot} 图片超过单张上限`)
    }
    totalBytes += bytes.byteLength
  }
  if (totalBytes > UI_PLUGIN_LIMITS.totalFigureBytes) {
    errors.push('预装插件图片总体积超过上限')
  }
  if (errors.length > 0) return { ok: false, errors }

  const rootDir = uiPluginsRootDir(userDataDir)
  const targetDir = confinedPluginPath(rootDir, manifest.id)
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  await writeFile(
    join(targetDir, UI_PLUGIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  for (const [slot, relativePath] of Object.entries(manifest.figures)) {
    if (!relativePath) continue
    const bytes = figureBytes[slot]
    if (!bytes) continue
    const targetPath = confinedPluginPath(rootDir, manifest.id, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, bytes)
  }

  return {
    ok: true,
    plugin: {
      manifest,
      previewDataUrl: await readPluginPreview(targetDir, manifest)
    }
  }
}

export async function removeUiPlugin(userDataDir: string, pluginId: string): Promise<boolean> {
  const rootDir = uiPluginsRootDir(userDataDir)
  let pluginDir: string
  try {
    pluginDir = confinedPluginPath(rootDir, pluginId)
  } catch {
    return false
  }
  if (pluginDir === resolve(rootDir)) return false
  try {
    await rm(pluginDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
