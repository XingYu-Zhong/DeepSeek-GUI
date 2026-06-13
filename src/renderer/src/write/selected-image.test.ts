import { describe, expect, it } from 'vitest'
import { isSelectableRasterImageSrc, parseImageMarkdownLine } from './selected-image'

describe('parseImageMarkdownLine', () => {
  it('parses lines that consist solely of image markdown', () => {
    expect(parseImageMarkdownLine('![设计稿](../../img/mock.png)')).toEqual({
      alt: '设计稿',
      src: '../../img/mock.png'
    })
    expect(parseImageMarkdownLine('  ![a](<img/with space.png>)  ')).toEqual({
      alt: 'a',
      src: 'img/with space.png'
    })
    expect(parseImageMarkdownLine('![t](img/a.png "标题")')).toEqual({ alt: 't', src: 'img/a.png' })
  })

  it('rejects lines with surrounding prose or non-image content', () => {
    expect(parseImageMarkdownLine('前缀 ![a](img/a.png)')).toBeNull()
    expect(parseImageMarkdownLine('[link](img/a.png)')).toBeNull()
    expect(parseImageMarkdownLine('普通文字')).toBeNull()
    expect(parseImageMarkdownLine('')).toBeNull()
  })
})

describe('isSelectableRasterImageSrc', () => {
  it('accepts local raster images only', () => {
    expect(isSelectableRasterImageSrc('../../img/mock.png')).toBe(true)
    expect(isSelectableRasterImageSrc('img/a.jpg')).toBe(true)
    expect(isSelectableRasterImageSrc('kun-pending-infographic://abc-123')).toBe(false)
    expect(isSelectableRasterImageSrc('../../proto/p.html')).toBe(false)
    expect(isSelectableRasterImageSrc('https://example.com/a.png')).toBe(false)
    expect(isSelectableRasterImageSrc('')).toBe(false)
    expect(isSelectableRasterImageSrc(undefined)).toBe(false)
  })
})
