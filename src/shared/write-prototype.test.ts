import { describe, expect, it } from 'vitest'
import { isHtmlEmbedSrc } from './write-prototype'

describe('isHtmlEmbedSrc', () => {
  it('matches local html paths only', () => {
    expect(isHtmlEmbedSrc('../../proto/page.html')).toBe(true)
    expect(isHtmlEmbedSrc('proto/page.htm')).toBe(true)
    expect(isHtmlEmbedSrc('img/photo.png')).toBe(false)
    expect(isHtmlEmbedSrc('https://example.com/page.html')).toBe(false)
    expect(isHtmlEmbedSrc('kun-pending-infographic://abc')).toBe(false)
    expect(isHtmlEmbedSrc('proto/page.html?x=1')).toBe(false)
    expect(isHtmlEmbedSrc('#anchor.html')).toBe(false)
    expect(isHtmlEmbedSrc(undefined)).toBe(false)
  })
})
