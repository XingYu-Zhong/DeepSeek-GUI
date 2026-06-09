import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn()
  },
  clipboard: {
    readImage: vi.fn()
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import { clipboard } from 'electron'

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  saveWorkspaceClipboardImage,
  writeWorkspaceFile
} from './workspace-service'

describe('workspace-service boundary checks', () => {
  let rootDir = ''
  let workspaceRoot = ''
  let outsideFile = ''

  beforeEach(async () => {
    vi.mocked(clipboard.readImage).mockReset()
    rootDir = await mkdtemp(join(tmpdir(), 'ds-gui-workspace-'))
    workspaceRoot = join(rootDir, 'workspace')
    outsideFile = join(rootDir, 'outside.txt')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'inside.txt'), 'inside', 'utf8')
    await writeFile(outsideFile, 'outside', 'utf8')
  })

  it('allows files inside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(await realpath(join(workspaceRoot, 'inside.txt')))
    }
  })

  it('rejects relative paths that escape the selected workspace', async () => {
    const result = await readWorkspaceFile({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('rejects absolute paths outside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: outsideFile,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('lists directories and files inside the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'draft.md'), '# draft', 'utf8')
    const result = await listWorkspaceDirectory({ workspaceRoot, path: workspaceRoot })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries.map((entry) => entry.name)).toEqual(['notes', 'inside.txt'])
      expect(result.entries[0].type).toBe('directory')
    }
  })

  it('creates and saves files within the selected workspace', async () => {
    const createResult = await createWorkspaceFile({
      path: 'notes/new.md',
      workspaceRoot,
      content: '# first draft'
    })

    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const saveResult = await writeWorkspaceFile({
      path: createResult.path,
      workspaceRoot,
      content: '# revised draft'
    })
    expect(saveResult.ok).toBe(true)

    const readResult = await readWorkspaceFile({
      path: createResult.path,
      workspaceRoot
    })
    expect(readResult.ok).toBe(true)
    if (readResult.ok) {
      expect(readResult.content).toBe('# revised draft')
    }
  })

  it('marks oversized files as truncated when loading preview content', async () => {
    const largePath = join(workspaceRoot, 'large.md')
    await writeFile(largePath, 'a'.repeat(1_500_001), 'utf8')

    const result = await readWorkspaceFile({
      path: largePath,
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.truncated).toBe(true)
    expect(result.size).toBe(1_500_001)
    expect(result.content.length).toBeLessThan(result.size)
  })

  it('creates directories inside the selected workspace', async () => {
    const result = await createWorkspaceDirectory({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const listResult = await listWorkspaceDirectory({ workspaceRoot })
    expect(listResult.ok).toBe(true)
    if (listResult.ok) {
      expect(listResult.entries.some((entry) => entry.name === 'notes' && entry.type === 'directory')).toBe(true)
    }
  })

  it('saves pasted clipboard images into the workspace img directory and returns a markdown path', async () => {
    const currentFilePath = join(workspaceRoot, 'notes', 'draft.md')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(currentFilePath, '# draft', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('fake-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, 'img')))
    expect(result.markdownPath.startsWith('../img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('fake-png-bytes'))
  })

  it('reads clipboard images as PNG base64 without writing workspace files', async () => {
    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('clipboard-png-bytes'),
      getSize: () => ({ width: 12, height: 8 })
    } as Electron.NativeImage)

    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toMatch(/^pasted-image-.+\.png$/)
    expect(result.mimeType).toBe('image/png')
    expect(result.dataBase64).toBe(Buffer.from('clipboard-png-bytes').toString('base64'))
    expect(result.byteSize).toBe(Buffer.byteLength('clipboard-png-bytes'))
    expect(result.width).toBe(12)
    expect(result.height).toBe(8)
  })

  it('saves SDD pasted clipboard images into .kunsdd/img with draft-relative markdown', async () => {
    const currentFilePath = join(workspaceRoot, '.kunsdd', 'draft', 'draft-1', 'requirement.md')
    await mkdir(join(workspaceRoot, '.kunsdd', 'draft', 'draft-1'), { recursive: true })
    await writeFile(currentFilePath, '# requirement', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('sdd-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath,
      imageDirectory: '.kunsdd/img'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, '.kunsdd', 'img')))
    expect(result.markdownPath.startsWith('../../img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('sdd-png-bytes'))
  })

  it('reads supported workspace images as data URLs', async () => {
    const imagePath = join(workspaceRoot, 'img', 'sample.png')
    await mkdir(join(workspaceRoot, 'img'), { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await readWorkspaceImage({
      path: 'img/sample.png',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.path).toBe(await realpath(imagePath))
    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toBe('data:image/png;base64,iVBORw==')
  })

  it('renames files within the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'renamed.txt'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await readFile(join(workspaceRoot, 'renamed.txt'), 'utf8')).toBe('inside')
  })

  it('rejects rename names that escape the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: '../outside.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('path separators')
    }
  })

  it('rejects rename conflicts', async () => {
    await writeFile(join(workspaceRoot, 'existing.txt'), 'existing', 'utf8')
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'existing.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('already exists')
    }
  })

  it('deletes files within the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    const readResult = await readWorkspaceFile({ path: 'inside.txt', workspaceRoot })
    expect(readResult.ok).toBe(false)
  })

  it('deletes directories within the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes', 'nested'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'nested', 'draft.md'), '# draft', 'utf8')

    const result = await deleteWorkspaceEntry({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    await expect(readdir(join(workspaceRoot, 'notes'))).rejects.toThrow()
  })

  it('rejects deleting the workspace root', async () => {
    const result = await deleteWorkspaceEntry({
      path: workspaceRoot,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('workspace root')
    }
  })

  it('rejects delete paths that escape the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })
})
