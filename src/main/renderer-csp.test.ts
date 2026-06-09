import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows blob image URLs for local attachment previews', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('blob:')
  })
})
