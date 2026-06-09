import { describe, expect, it } from 'vitest'
import {
  collectSddDraftImages,
  parseSddMarkdownImages,
  resolveSddMarkdownImagePath
} from './sdd-draft-images'

const DRAFT_PATH = '.kunsdd/draft/draft-1/requirement.md'

describe('sdd draft image parsing', () => {
  it('parses local Markdown image references with alt text', () => {
    expect(
      parseSddMarkdownImages([
        '![Login state](../../img/login.png)',
        '![With title](<../../img/wireframe.png> "wireframe")',
        '![remote](https://example.com/a.png)'
      ].join('\n'))
    ).toEqual([
      { alt: 'Login state', markdownPath: '../../img/login.png' },
      { alt: 'With title', markdownPath: '../../img/wireframe.png' }
    ])
  })

  it('resolves draft-relative image paths into workspace-relative SDD paths', () => {
    expect(resolveSddMarkdownImagePath(DRAFT_PATH, '../../img/login.png')).toBe('.kunsdd/img/login.png')
    expect(resolveSddMarkdownImagePath(DRAFT_PATH, '.kunsdd/img/direct.png')).toBe('.kunsdd/img/direct.png')
    expect(resolveSddMarkdownImagePath(DRAFT_PATH, '../../../../outside.png')).toBeNull()
    expect(resolveSddMarkdownImagePath(DRAFT_PATH, '/tmp/outside.png')).toBeNull()
  })
})

describe('collectSddDraftImages', () => {
  it('collects referenced SDD images once in first appearance order', async () => {
    const readOrder: string[] = []
    const result = await collectSddDraftImages({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: DRAFT_PATH,
      markdown: [
        '![First](../../img/a.png)',
        '![Duplicate](../../img/a.png)',
        '![Second](../../img/b.png)'
      ].join('\n'),
      readImage: async ({ path }) => {
        readOrder.push(path)
        return {
          ok: true,
          path: `/tmp/ws/${path}`,
          dataUrl: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
          mimeType: 'image/png',
          size: 12
        }
      },
      measureImage: async () => ({ width: 640, height: 480 })
    })

    expect(result.errors).toEqual([])
    expect(readOrder).toEqual(['.kunsdd/img/a.png', '.kunsdd/img/b.png'])
    expect(result.images).toMatchObject([
      {
        index: 1,
        alt: 'First',
        markdownPath: '../../img/a.png',
        relativePath: '.kunsdd/img/a.png',
        mimeType: 'image/png',
        width: 640,
        height: 480
      },
      {
        index: 2,
        alt: 'Second',
        markdownPath: '../../img/b.png',
        relativePath: '.kunsdd/img/b.png'
      }
    ])
  })

  it('reports missing, escaped, and non-SDD image references', async () => {
    const result = await collectSddDraftImages({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: DRAFT_PATH,
      markdown: [
        '![missing](../../img/missing.png)',
        '![outside](../../../../outside.png)',
        '![write](../../../img/write.png)'
      ].join('\n'),
      readImage: async () => ({ ok: false, message: 'not found' }),
      measureImage: async () => ({})
    })

    expect(result.images).toEqual([])
    expect(result.errors).toEqual([
      'Failed to read ../../img/missing.png: not found',
      'Image path is outside the workspace: ../../../../outside.png',
      'SDD images must live under .kunsdd/img: ../../../img/write.png'
    ])
  })

  it('rejects workspace images outside .kunsdd/img', async () => {
    const result = await collectSddDraftImages({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: DRAFT_PATH,
      markdown: '![wrong](../not-img/wrong.png)',
      readImage: async () => {
        throw new Error('should not read rejected paths')
      },
      measureImage: async () => ({})
    })

    expect(result.images).toEqual([])
    expect(result.errors).toEqual(['SDD images must live under .kunsdd/img: ../not-img/wrong.png'])
  })
})
