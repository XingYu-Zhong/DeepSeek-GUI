import { describe, expect, it } from 'vitest'
import { ToolStormBreaker } from '../src/loop/tool-storm-breaker.js'
import type { ToolCallLike } from '../src/ports/tool-host.js'

function call(argumentsValue: Record<string, unknown>): ToolCallLike {
  return {
    callId: Math.random().toString(36),
    toolName: 'read',
    arguments: argumentsValue
  }
}

describe('ToolStormBreaker', () => {
  it('suppresses the third identical tool call in a turn', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
    const third = breaker.inspect(call({ path: 'src/a.ts' }))

    expect(third.suppress).toBe(true)
    expect(third.reason).toContain('identical arguments 3 times')
  })

  it('canonicalizes argument key order', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(call({ path: 'src/a.ts', offset: 10 })).suppress).toBe(false)
    expect(breaker.inspect(call({ offset: 10, path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts', offset: 10 })).suppress).toBe(true)
  })

  it('allows a read after a file-changing call resets read-only history', () => {
    const breaker = new ToolStormBreaker()

    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
    expect(
      breaker.inspect({
        callId: 'mutate',
        toolName: 'write',
        toolKind: 'file_change',
        arguments: { path: 'src/a.ts', content: 'new' }
      }).suppress
    ).toBe(false)
    expect(breaker.inspect(call({ path: 'src/a.ts' })).suppress).toBe(false)
  })
})
