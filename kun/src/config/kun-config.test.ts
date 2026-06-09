import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandHomePath } from './kun-config.js'

describe('expandHomePath', () => {
  it('expands Windows-style home-relative paths', () => {
    expect(expandHomePath('~\\kun\\config.json')).toBe(join(homedir(), 'kun', 'config.json'))
  })

  it('leaves non-home tilde prefixes untouched', () => {
    expect(expandHomePath('~other/config.json')).toBe('~other/config.json')
  })
})
