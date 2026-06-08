import { describe, expect, it } from 'vitest'
import { unified, type Pluggable } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'

import {
  defaultHardenOptions,
  defaultSanitizeSchema,
  safeRehypePluginsForMain,
  safeRehypePluginsForChatBubble,
  safeSanitizeOnlyForRenderer
} from '../markdown-sanitize'
import { isSafeExternalHref } from '../markdown-sanitize-href'

/**
 * Helper: run a markdown source through the given rehype plugins and
 * return the HAST root plus a plain-HTML string for assertion.
 *
 * Implementation note: `unified().process()` runs the chain and then
 * stringifies, so we split the pipeline — run plugins separately to get
 * the HAST tree, then stringify that tree. This lets us assert on the
 * tree structure (e.g. "no <script> elements") instead of grepping the
 * rendered HTML.
 */
async function render(
  markdown: string,
  plugins: Pluggable[] = []
): Promise<{ tree: Root; html: string }> {
  const mdProcessor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
  const mdTree = await mdProcessor.run(mdProcessor.parse(markdown))
  // unified().use() does not accept the [plugin, options] tuple form
  // directly — it has to be .use(plugin, options). Unpack each entry.
  let pluginProcessor = unified()
  for (const entry of plugins) {
    if (Array.isArray(entry)) {
      const [plugin, options] = entry as [Pluggable, unknown]
      pluginProcessor = pluginProcessor.use(plugin as never, options as never)
    } else {
      pluginProcessor = pluginProcessor.use(entry as never)
    }
  }
  const tree = (await pluginProcessor.run(mdTree)) as Root
  const htmlProcessor = unified().use(rehypeStringify)
  const html = String(htmlProcessor.stringify(tree))
  return { tree, html }
}

function findElement(tree: Root, tagName: string): Element | undefined {
  let found: Element | undefined
  visit(tree, 'element', (node) => {
    if (node.tagName === tagName && !found) found = node
  })
  return found
}

function findAllElements(tree: Root, tagName: string): Element[] {
  const found: Element[] = []
  visit(tree, 'element', (node) => {
    if (node.tagName === tagName) found.push(node)
  })
  return found
}

function hasAttribute(tree: Root, tagName: string, attr: string): boolean {
  const el = findElement(tree, tagName)
  if (!el) return false
  return Object.prototype.hasOwnProperty.call(el.properties ?? {}, attr)
}

describe('isSafeExternalHref', () => {
  it('accepts https and http URLs', () => {
    expect(isSafeExternalHref('https://example.com')).toBe(true)
    expect(isSafeExternalHref('http://example.com/foo')).toBe(true)
  })

  it('accepts mailto', () => {
    expect(isSafeExternalHref('mailto:foo@bar.com')).toBe(true)
  })

  it('rejects javascript: scheme', () => {
    expect(isSafeExternalHref('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: scheme', () => {
    expect(isSafeExternalHref('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects relative URLs (resolved against the default origin)', () => {
    expect(isSafeExternalHref('/foo')).toBe(false)
    expect(isSafeExternalHref('./bar')).toBe(false)
    expect(isSafeExternalHref('../baz')).toBe(false)
  })

  it('rejects empty / nullish input', () => {
    expect(isSafeExternalHref('')).toBe(false)
    expect(isSafeExternalHref(null)).toBe(false)
    expect(isSafeExternalHref(undefined)).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(isSafeExternalHref('not a url with spaces')).toBe(false)
  })
})

describe('safeRehypePluginsForMain — HTML sanitization', () => {
  it('strips <script> tags', async () => {
    const { tree, html } = await render(
      'Hello <script>alert(1)</script> world',
      safeRehypePluginsForMain
    )
    expect(findElement(tree, 'script')).toBeUndefined()
    expect(html).not.toMatch(/<script/i)
  })

  it('strips onerror from <img> but keeps the src attribute', async () => {
    const { tree, html } = await render(
      '<img src="https://example.com/x.png" onerror="alert(1)">',
      safeRehypePluginsForMain
    )
    const img = findElement(tree, 'img')
    expect(img).toBeDefined()
    expect(img?.properties?.src).toBe('https://example.com/x.png')
    expect(img?.properties?.onerror).toBeUndefined()
    expect(html).not.toMatch(/onerror/i)
  })

  it('strips <svg> with onload handler', async () => {
    const { tree, html } = await render(
      '<svg onload="alert(1)"><circle r="5"/></svg>',
      safeRehypePluginsForMain
    )
    expect(findElement(tree, 'svg')).toBeUndefined()
    expect(html).not.toMatch(/<svg/i)
    expect(html).not.toMatch(/onload/i)
  })

  it('strips <iframe> deeply nested in <div>', async () => {
    const { tree } = await render(
      '<div><div><iframe src="https://evil.example"></iframe></div></div>',
      safeRehypePluginsForMain
    )
    expect(findElement(tree, 'iframe')).toBeUndefined()
  })

  it('rewrites javascript: hrefs to a safe form (or removes the link)', async () => {
    const { html } = await render(
      '[click me](javascript:alert(1))',
      safeRehypePluginsForMain
    )
    expect(html.toLowerCase()).not.toMatch(/href="javascript:/i)
  })

  it('preserves <details> and <summary> (GFM extension)', async () => {
    const { tree } = await render(
      '<details><summary>title</summary>body</details>',
      safeRehypePluginsForMain
    )
    expect(findElement(tree, 'details')).toBeDefined()
    expect(findElement(tree, 'summary')).toBeDefined()
  })

  it('preserves code className for shiki language tags', async () => {
    const { tree, html } = await render(
      '```ts\nlet x: number = 1\n```',
      safeRehypePluginsForMain
    )
    const codes = findAllElements(tree, 'code')
    expect(codes.length).toBeGreaterThan(0)
    const hasLangClass = codes.some(
      (c) =>
        Array.isArray(c.properties?.className) &&
        (c.properties.className as string[]).some((cls) => cls.startsWith('language-'))
    )
    expect(hasLangClass).toBe(true)
  })

  it('safeRehypePluginsForMain does not include rehypeFileReferences', () => {
    // structural assertion — the main-process factory must remain free of
    // renderer-only plugins, even by import side-effect.
    const factory = safeRehypePluginsForMain as unknown[]
    expect(factory.length).toBeGreaterThan(0)
    const names = factory.map((entry) =>
      Array.isArray(entry) ? (entry[0] as { name?: string }).name : (entry as { name?: string }).name
    )
    expect(names.join('|')).not.toMatch(/rehypeFileReferences/i)
  })
})

describe('safeSanitizeOnlyForRenderer (lightest weight)', () => {
  it('strips <script> without needing URL hardening', async () => {
    const { tree, html } = await render(
      'before <script>alert(1)</script> after',
      safeSanitizeOnlyForRenderer
    )
    expect(findElement(tree, 'script')).toBeUndefined()
    expect(html).not.toMatch(/<script/i)
  })

  it('strips onerror attribute from <img>', async () => {
    const { tree } = await render(
      '<img src="x" onerror="alert(1)">',
      safeSanitizeOnlyForRenderer
    )
    expect(hasAttribute(tree, 'img', 'onerror')).toBe(false)
  })
})

describe('safeRehypePluginsForChatBubble parity with main', () => {
  it('produces the same sanitized output for chat-bubble payloads', async () => {
    const payload =
      'Hello <script>alert(1)</script><img src=x onerror=alert(1)> world'
    const a = await render(payload, safeRehypePluginsForMain)
    const b = await render(payload, safeRehypePluginsForChatBubble)
    expect(a.html).toBe(b.html)
  })

  it('uses wildcard to allow any external https link', async () => {
    const { tree, html } = await render(
      '[ok](https://example.com/page)',
      safeRehypePluginsForChatBubble
    )
    const a = findElement(tree, 'a')
    expect(a).toBeDefined()
    expect(a?.properties?.href).toBe('https://example.com/page')
    expect(html).toMatch(/href="https:\/\/example\.com\/page"/)
  })
})

describe('defaultHardenOptions export shape', () => {
  it('uses wildcard for origin allow-listing', () => {
    // rehype-harden interprets 'https:' / 'http:' as origin-less prefixes
    // and rejects every real URL whose origin does not match. Using '*'
    // is the correct way to allow any external http(s) URL while still
    // blocking javascript:/data:/file:/vbscript: at the protocol layer.
    const linkPrefixes = defaultHardenOptions.allowedLinkPrefixes as readonly string[]
    expect(linkPrefixes).toContain('*')
  })
})

describe('defaultSanitizeSchema export shape', () => {
  it('forbids event-handler attributes on *', () => {
    const wildAttrs = defaultSanitizeSchema.attributes?.['*']
    const joined = (wildAttrs ?? []).map(String).join('|')
    expect(joined).not.toMatch(/\bon\w+/i)
  })
})
