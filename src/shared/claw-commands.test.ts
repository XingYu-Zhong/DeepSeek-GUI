import { describe, expect, it } from 'vitest'
import { parseClawCommand } from './claw-commands'

describe('parseClawCommand', () => {
  it('rejects auto as a Claw model command', () => {
    expect(parseClawCommand('/model auto')).toEqual({ kind: 'invalidModel' })
    expect(parseClawCommand('/model 自动')).toEqual({ kind: 'invalidModel' })
  })

  it('accepts concrete Claw model commands', () => {
    expect(parseClawCommand('/model pro')).toEqual({ kind: 'model', model: 'deepseek-v4-pro' })
    expect(parseClawCommand('/model flash')).toEqual({ kind: 'model', model: 'deepseek-v4-flash' })
  })
})
