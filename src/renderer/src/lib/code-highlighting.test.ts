import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHighlightCodeCache,
  hasCachedHighlightCode,
  highlightCodeCacheSize,
  highlightCodeHtml,
  MAX_HIGHLIGHT_CACHE_ENTRIES
} from './code-highlighting'

describe('code highlighting cache', () => {
  afterEach(() => {
    clearHighlightCodeCache()
  })

  it('caps cached highlighted blocks', async () => {
    for (let index = 0; index < MAX_HIGHLIGHT_CACHE_ENTRIES + 5; index += 1) {
      await highlightCodeHtml(`line-${index}`, 'text')
    }

    expect(highlightCodeCacheSize()).toBe(MAX_HIGHLIGHT_CACHE_ENTRIES)
    expect(hasCachedHighlightCode('line-0', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-4', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-5', 'text')).toBe(true)
  })

  it('refreshes cache entries when they are reused', async () => {
    await highlightCodeHtml('line-0', 'text')
    for (let index = 1; index < MAX_HIGHLIGHT_CACHE_ENTRIES; index += 1) {
      await highlightCodeHtml(`line-${index}`, 'text')
    }

    await highlightCodeHtml('line-0', 'text')
    await highlightCodeHtml(`line-${MAX_HIGHLIGHT_CACHE_ENTRIES}`, 'text')

    expect(highlightCodeCacheSize()).toBe(MAX_HIGHLIGHT_CACHE_ENTRIES)
    expect(hasCachedHighlightCode('line-1', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-0', 'text')).toBe(true)
  })
})
