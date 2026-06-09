import { describe, expect, it } from 'vitest'
import { shouldAnimateStreamingText } from './StreamdownAssistant'

describe('shouldAnimateStreamingText', () => {
  it('keeps the lightweight reveal for short single-line text', () => {
    expect(shouldAnimateStreamingText('正在检查配置。')).toBe(true)
    expect(shouldAnimateStreamingText('Checking the CSS variables.')).toBe(true)
  })

  it('lets multiline streaming render from the actual SSE sequence', () => {
    expect(shouldAnimateStreamingText('First line\nSecond line')).toBe(false)
    expect(shouldAnimateStreamingText('First paragraph\n\nSecond paragraph')).toBe(false)
  })

  it('does not animate structured markdown while it is still streaming', () => {
    expect(shouldAnimateStreamingText('- one\n- two')).toBe(false)
    expect(shouldAnimateStreamingText('Use `npm test` next.')).toBe(false)
  })
})
