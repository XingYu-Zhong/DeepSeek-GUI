import { describe, expect, it } from 'vitest'
import {
  isWriteImageFileExtension,
  isWriteImageFilePath,
  isWriteTextFileExtension,
  isWriteTextFilePath,
  isWriteWorkspaceFilePath,
  isWriteWorkspaceEntry
} from './write-text-file'

describe('write text file helpers', () => {
  it('accepts markdown and txt-like extensions', () => {
    expect(isWriteTextFileExtension('.md')).toBe(true)
    expect(isWriteTextFileExtension('.MDX')).toBe(true)
    expect(isWriteTextFileExtension('.txt')).toBe(true)
    expect(isWriteTextFileExtension('.text')).toBe(true)
  })

  it('rejects non-write file extensions', () => {
    expect(isWriteTextFileExtension('.json')).toBe(false)
    expect(isWriteTextFileExtension('.png')).toBe(false)
  })

  it('accepts common image extensions for preview', () => {
    expect(isWriteImageFileExtension('.png')).toBe(true)
    expect(isWriteImageFileExtension('.JPG')).toBe(true)
    expect(isWriteImageFileExtension('.webp')).toBe(true)
    expect(isWriteImageFileExtension('.svg')).toBe(false)
  })

  it('checks file paths with extension matching', () => {
    expect(isWriteTextFilePath('/tmp/draft.md')).toBe(true)
    expect(isWriteTextFilePath('/tmp/notes.TXT')).toBe(true)
    expect(isWriteTextFilePath('/tmp/output.jsonl')).toBe(false)
    expect(isWriteTextFilePath('/tmp/folder/no-ext')).toBe(false)

    expect(isWriteImageFilePath('/tmp/img/hero.PNG')).toBe(true)
    expect(isWriteWorkspaceFilePath('/tmp/img/hero.PNG')).toBe(true)
    expect(isWriteWorkspaceFilePath('/tmp/folder/no-ext')).toBe(false)
  })

  it('allows directories but filters unsupported files from the write tree', () => {
    expect(isWriteWorkspaceEntry({
      name: 'docs',
      path: '/tmp/docs',
      type: 'directory',
      ext: ''
    })).toBe(true)
    expect(isWriteWorkspaceEntry({
      name: 'draft.md',
      path: '/tmp/draft.md',
      type: 'file',
      ext: '.md'
    })).toBe(true)
    expect(isWriteWorkspaceEntry({
      name: 'hero.png',
      path: '/tmp/hero.png',
      type: 'file',
      ext: '.png'
    })).toBe(true)
    expect(isWriteWorkspaceEntry({
      name: 'data.json',
      path: '/tmp/data.json',
      type: 'file',
      ext: '.json'
    })).toBe(false)
  })
})
