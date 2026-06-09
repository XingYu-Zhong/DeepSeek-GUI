import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  BashLocalToolOperations,
  EditLocalToolOperations,
  FindLocalToolOperations,
  GrepLocalToolOperations,
  LsLocalToolOperations,
  ReadLocalToolOperations,
  ResizedImageResult,
  ResizeImageOptions,
  WriteLocalToolOperations
} from './builtin-tool-types.js'
import {
  DEFAULT_IMAGE_MAX_BASE64_BYTES,
  DEFAULT_IMAGE_MAX_DIMENSION
} from './builtin-tool-types.js'
import {
  detectImageMimeType,
  resolveExecutable,
  shellCommandArgs,
  shellRuntimeInfo,
  spawnCapture,
  terminateSpawnTree,
  waitForSpawnExit
} from './builtin-tool-utils.js'

function imageExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'img'
  }
}

async function resizeImageWithSips(
  buffer: Buffer,
  mimeType: string,
  options: ResizeImageOptions = {}
): Promise<ResizedImageResult | null> {
  const sips = resolveExecutable(['/usr/bin/sips', 'sips'])
  if (!sips) return null
  const maxWidth = options.maxWidth ?? DEFAULT_IMAGE_MAX_DIMENSION
  const maxHeight = options.maxHeight ?? DEFAULT_IMAGE_MAX_DIMENSION
  const maxBytes = options.maxBytes ?? DEFAULT_IMAGE_MAX_BASE64_BYTES
  const tempDir = await mkdtemp(join(tmpdir(), 'kun-read-image-'))
  const inputPath = join(tempDir, `input.${imageExtension(mimeType)}`)
  const outputPath = join(tempDir, `output.${imageExtension(mimeType)}`)
  try {
    await writeFile(inputPath, buffer)
    const info = await spawnCapture(sips, ['-g', 'pixelWidth', '-g', 'pixelHeight', inputPath], {
      cwd: tempDir
    })
    const widthMatch = info.stdout.match(/pixelWidth:\s*(\d+)/)
    const heightMatch = info.stdout.match(/pixelHeight:\s*(\d+)/)
    const originalWidth = Number(widthMatch?.[1] ?? 0)
    const originalHeight = Number(heightMatch?.[1] ?? 0)
    const originalBase64 = buffer.toString('base64')
    const originalSize = Buffer.byteLength(originalBase64, 'utf8')
    if (
      originalWidth > 0 &&
      originalHeight > 0 &&
      originalWidth <= maxWidth &&
      originalHeight <= maxHeight &&
      originalSize < maxBytes
    ) {
      return {
        dataBase64: originalBase64,
        mimeType,
        originalWidth,
        originalHeight,
        width: originalWidth,
        height: originalHeight,
        wasResized: false
      }
    }

    let currentMax = Math.max(maxWidth, maxHeight)
    while (currentMax >= 1) {
      const result = await spawnCapture(
        sips,
        ['--resampleHeightWidthMax', String(currentMax), inputPath, '--out', outputPath],
        { cwd: tempDir }
      )
      if (result.exitCode !== 0) return null
      const resizedBuffer = await readFile(outputPath)
      const resizedBase64 = resizedBuffer.toString('base64')
      const resizedSize = Buffer.byteLength(resizedBase64, 'utf8')
      const detected = detectImageMimeType(resizedBuffer)
      const resizedInfo = await spawnCapture(sips, ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath], {
        cwd: tempDir
      })
      const resizedWidth = Number(resizedInfo.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0)
      const resizedHeight = Number(resizedInfo.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0)
      if (resizedSize < maxBytes && resizedWidth > 0 && resizedHeight > 0) {
        return {
          dataBase64: resizedBase64,
          mimeType: detected?.mimeType ?? mimeType,
          originalWidth,
          originalHeight,
          width: resizedWidth,
          height: resizedHeight,
          wasResized: resizedWidth !== originalWidth || resizedHeight !== originalHeight
        }
      }
      currentMax = Math.floor(currentMax * 0.75)
    }
    return null
  } catch {
    return null
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export const defaultReadLocalToolOperations: ReadLocalToolOperations = {
  stat: (path: string) => stat(path),
  readFile: (path: string) => readFile(path),
  detectImageMimeType,
  resizeImage: resizeImageWithSips
}

export function createLocalBashOperations(): BashLocalToolOperations {
  return {
    exec: async (command, cwd, options) => {
      const { shell, args, name } = shellRuntimeInfo()
      const child = spawn(shell, shellCommandArgs({ shell, args }, command), {
        cwd,
        env: process.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let timedOut = false
      const kill = () => terminateSpawnTree(child)
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, options.timeoutSeconds * 1000)
      const onAbort = () => kill()
      options.signal.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', (chunk: Buffer | string) => {
        options.onData?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        options.onData?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      const exitCode = await waitForSpawnExit(child).finally(() => {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', onAbort)
      })
      if (options.signal.aborted) throw new Error('command aborted')
      if (timedOut) throw new Error(`command timed out after ${options.timeoutSeconds} seconds`)
      return { exitCode, shell: name }
    }
  }
}

export const defaultWriteLocalToolOperations: WriteLocalToolOperations = {
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => {}),
  writeFile: (path: string, content: string) => writeFile(path, content, 'utf8')
}

export const defaultEditLocalToolOperations: EditLocalToolOperations = {
  readFile: (path: string) => readFile(path, 'utf8'),
  writeFile: (path: string, content: string) => writeFile(path, content, 'utf8')
}

export const defaultFindLocalToolOperations: FindLocalToolOperations = {}

export const defaultGrepLocalToolOperations: GrepLocalToolOperations = {}

export const defaultLsLocalToolOperations: LsLocalToolOperations = {
  stat: (path: string) => stat(path),
  readdir: (path: string) => readdir(path, { withFileTypes: true }) as Promise<Array<{ name: string }>>
}
