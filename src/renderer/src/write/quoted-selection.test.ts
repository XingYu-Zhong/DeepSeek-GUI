import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { harden } from 'rehype-harden'
import { isExplicitWriteResourceUrl } from '@shared/write-markdown-resource'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  writePathToFileUrl,
  WriteMarkdownPreview,
  writeMarkdownHardenOptions
} from '../components/write/WriteMarkdownPreview'
import {
  WRITE_QUOTE_ORIGINAL_END,
  WRITE_QUOTE_ORIGINAL_START,
  WRITE_RETRIEVAL_END,
  composeWritePrompt,
  formatWriteQuotedSelectionForPrompt,
  formatWriteRetrievalContextForPrompt,
  parseWritePromptForDisplay,
  quotedSelectionFromEditor
} from './quoted-selection'

describe('write quoted selections', () => {
  it('formats selected text with file and line context', () => {
    const quote = {
      id: 'quote-1',
      text: 'Selected paragraph',
      sourceTitle: 'notes/draft.md',
      sourceFilePath: '/tmp/workspace/notes/draft.md',
      lineStart: 3,
      lineEnd: 5,
      charCount: 18,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第3-5行')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('formats PDF selections with page context', () => {
    const quote = {
      id: 'quote-pdf-1',
      text: 'The method improves retrieval quality.',
      sourceKind: 'pdf' as const,
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 3,
      pageEnd: 4,
      charCount: 38,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = formatWriteQuotedSelectionForPrompt(quote)

    expect(prompt).toContain('第3-4页')
    expect(prompt).toContain('papers/study.pdf')
    expect(prompt).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(prompt).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('keeps PDF selection rects on quoted selections', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const quote = quotedSelectionFromEditor({
      text: 'Feature driven development',
      ranges: [{
        from: 0,
        to: 26,
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 27,
        text: 'Feature driven development',
        charCount: 26,
        page: 2
      }],
      charCount: 26,
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 2,
      rects: [{ page: 2, x: 12, y: 48, width: 220, height: 18 }]
    }, '/tmp/workspace/paper.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 2,
      rects: [{ page: 2, x: 12, y: 48, width: 220, height: 18 }]
    })
    vi.restoreAllMocks()
  })

  it('does not create a quote for empty selections', () => {
    expect(quotedSelectionFromEditor({
      text: '   ',
      ranges: [],
      charCount: 0
    }, '/tmp/workspace/notes.md', '/tmp/workspace')).toBeNull()
  })

  it('composes prompt with committed quote context first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const quote = quotedSelectionFromEditor({
      text: 'A useful quote',
      ranges: [{
        from: 0,
        to: 14,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 14,
        text: 'A useful quote',
        charCount: 14
      }],
      charCount: 14
    }, '/tmp/workspace/a.md', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).not.toBeNull()
    const prompt = composeWritePrompt('Please revise it.', quote ? [quote] : [])
    expect(prompt.startsWith('[写作上下文]')).toBe(true)
    expect(prompt).toContain('不要调用 request_user_input')
    expect(prompt.indexOf('[引用片段] a.md')).toBeGreaterThan(prompt.indexOf('[写作上下文]'))
    expect(prompt.endsWith('Please revise it.')).toBe(true)
    vi.restoreAllMocks()
  })

  it('parses write prompt metadata for compact timeline display', () => {
    const prompt = composeWritePrompt(
      '帮我改成中文',
      [{
        id: 'quote-1',
        text: "Hi, I'm zxy. Glad to meet you.",
        sourceTitle: 'welcome.md',
        sourceFilePath: '/tmp/workspace/welcome.md',
        lineStart: 10,
        lineEnd: 10,
        charCount: 31,
        createdAt: '2026-05-24T00:00:00.000Z'
      }],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/welcome.md'
      }
    )

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我改成中文')
    expect(parsed?.context?.workspaceRoot).toBe('/tmp/workspace')
    expect(parsed?.context?.activeFile).toBe('welcome.md')
    expect(parsed?.context?.lines.some((line) => line.includes('不要调用 request_user_input'))).toBe(true)
    expect(parsed?.quotes).toHaveLength(1)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceTitle: 'welcome.md',
      sourceFilePath: '/tmp/workspace/welcome.md',
      lineStart: 10,
      lineEnd: 10,
      charCount: 31,
      text: "Hi, I'm zxy. Glad to meet you."
    })
  })

  it('adds retrieval snippets with PDF page locations to assistant prompts', () => {
    const prompt = composeWritePrompt(
      '解释这段论文',
      [],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/papers/study.pdf',
        retrieval: {
          source: 'bm25-keyword',
          query: 'retrieval quality',
          keywords: ['retrieval', 'quality'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [{
            path: 'papers/study.pdf',
            title: 'Page 3',
            text: 'The method improves retrieval quality with focused context.',
            score: 1.25,
            keywords: ['retrieval', 'quality'],
            location: {
              kind: 'pdf',
              pageStart: 3,
              pageEnd: 3
            },
            pageStart: 3,
            pageEnd: 3
          }]
        }
      }
    )

    expect(prompt).toContain('[相关文献上下文]')
    expect(prompt).toContain('papers/study.pdf 第3页')
    expect(prompt).toContain('The method improves retrieval quality')
    expect(prompt).toContain(WRITE_RETRIEVAL_END)
    expect(formatWriteRetrievalContextForPrompt(null)).toBe('')
  })

  it('collapses retrieval context out of the displayed user input', () => {
    const prompt = composeWritePrompt(
      '帮我看看这篇文章讲什么内容\n\n再总结三条要点',
      [],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/papers/study.pdf',
        retrieval: {
          source: 'bm25-keyword',
          query: 'feature development',
          keywords: ['feature', 'development'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [
            {
              path: 'notes/code-graph.md',
              title: '节点内容的处理',
              text: '每个节点都保留了原始的代码内容和行号范围。\n\n<p align="center">\n  <img src="./pic/1.png" alt="代码图构建" width="800">\n</p>',
              score: 2.5,
              keywords: ['内容'],
              location: { kind: 'text', lineStart: 12, lineEnd: 30 }
            },
            {
              path: 'papers/study.pdf',
              title: '',
              text: 'SWE-Dev provides runnable environments with developer-authored tests.',
              score: 1.5,
              keywords: ['feature'],
              location: { kind: 'pdf', pageStart: 1, pageEnd: 2 }
            }
          ]
        }
      }
    )

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我看看这篇文章讲什么内容\n\n再总结三条要点')
    expect(parsed?.retrieval?.source).toBe('bm25-keyword')
    expect(parsed?.retrieval?.keywords).toBe('feature, development')
    expect(parsed?.retrieval?.snippets).toHaveLength(2)
    expect(parsed?.retrieval?.snippets[0]).toMatchObject({
      location: 'notes/code-graph.md:12-30',
      title: '节点内容的处理',
      keywords: '内容'
    })
    expect(parsed?.retrieval?.snippets[0]?.text).toContain('代码图构建')
    expect(parsed?.retrieval?.snippets[1]).toMatchObject({
      location: 'papers/study.pdf 第1-2页',
      text: 'SWE-Dev provides runnable environments with developer-authored tests.'
    })
  })
})

describe('write markdown preview resources', () => {
  it('uses a rehype-harden config that can initialize without crashing preview', () => {
    expect(() => harden(writeMarkdownHardenOptions)).not.toThrow()
  })

  it('resolves relative image paths from the current markdown file', () => {
    const resolved = resolveWriteMarkdownResource('../assets/hero image.png', '/tmp/workspace/docs/draft.md')
    expect(resolved).toBe('file:///tmp/workspace/assets/hero%20image.png')
    expect(resolveWriteMarkdownResourcePath('../assets/hero image.png', '/tmp/workspace/docs/draft.md')).toBe(
      '/tmp/workspace/assets/hero image.png'
    )
  })

  it('resolves Windows local image paths without treating drive letters as URL protocols', () => {
    expect(isExplicitWriteResourceUrl('C:\\Users\\me\\assets\\hero image.png')).toBe(false)
    expect(resolveWriteMarkdownResource('..\\assets\\hero image.png', 'C:\\Users\\me\\docs\\draft.md')).toBe(
      'file:///C:/Users/me/assets/hero%20image.png'
    )
    expect(resolveWriteMarkdownResourcePath('C:\\Users\\me\\assets\\hero image.png', 'C:\\Users\\me\\docs\\draft.md')).toBe(
      'C:/Users/me/assets/hero image.png'
    )
    expect(writePathToFileUrl('\\\\server\\share\\hero image.png')).toBe(
      'file://server/share/hero%20image.png'
    )
  })

  it('renders bare relative markdown images from the current markdown file', () => {
    const html = renderToStaticMarkup(createElement(WriteMarkdownPreview, {
      content: '![信息图](img/infographic.png)',
      isMarkdown: true,
      filePath: '/tmp/write_workspace/doc.md'
    }))

    expect(html).toContain('src="file:///tmp/write_workspace/img/infographic.png"')
    expect(html).not.toContain('https://kun.local/img/infographic.png')
  })

  it('keeps explicit external URLs unchanged', () => {
    expect(resolveWriteMarkdownResource('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBe('https://example.com/a.png')
    expect(resolveWriteMarkdownResourcePath('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
  })

  it('does not pass through explicit file URLs from markdown content', () => {
    expect(resolveWriteMarkdownResource('file:///tmp/secret.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(writePathToFileUrl('/tmp/workspace/assets/hero image.png')).toBe('file:///tmp/workspace/assets/hero%20image.png')
  })
})
