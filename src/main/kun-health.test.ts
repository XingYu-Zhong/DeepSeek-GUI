import { describe, expect, it } from 'vitest'
import { isKunHealthResponseBody } from './kun-health'

describe('isKunHealthResponseBody', () => {
  it('accepts Kun serve health responses', () => {
    expect(isKunHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'kun',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isKunHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isKunHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})
