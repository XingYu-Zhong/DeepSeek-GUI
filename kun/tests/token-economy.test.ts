import { describe, expect, it } from 'vitest'
import {
  TOKEN_ECONOMY_INSTRUCTION,
  applyTokenEconomyToRequest,
  compressProse,
  normalizeTokenEconomyConfig
} from '../src/loop/token-economy.js'
import { makeToolCallItem, makeToolResultItem } from '../src/domain/item.js'
import type { ModelRequest } from '../src/ports/model-client.js'

function request(): ModelRequest {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    model: 'fake',
    systemPrompt: 'system',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

describe('token economy', () => {
  it('compresses prose while preserving protected technical segments', () => {
    const input = 'Sure, I can really explain `useMemo` for https://example.com/docs and ./src/App.tsx.'
    const output = compressProse(input)

    expect(output).not.toContain('Sure')
    expect(output).not.toContain('really')
    expect(output).toContain('`useMemo`')
    expect(output).toContain('https://example.com/docs')
    expect(output).toContain('./src/App.tsx')
  })

  it('compresses tool descriptions and long tool results only in the model request', () => {
    const longOutput = Array.from({ length: 500 }, (_, index) =>
      index === 240 ? 'ERROR failed to compile auth middleware' : `noise line ${index}`
    ).join('\n')
    const originalToolResult = makeToolResultItem({
      id: 'item_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_bash',
      toolName: 'bash',
      output: {
        command: 'npm test',
        output: longOutput,
        full_output_path: '/tmp/full.log'
      }
    })
    const original = request()
    original.tools = [
      {
        name: 'read',
        description: 'Please read a file from the workspace and return the complete content.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to the file that should be read.'
            }
          }
        }
      }
    ]
    original.history = [
      makeToolCallItem({
        id: 'item_call',
        threadId: 'thr_1',
        turnId: 'turn_1',
        callId: 'call_bash',
        toolName: 'bash',
        arguments: { command: 'npm test' }
      }),
      originalToolResult
    ]

    const compacted = applyTokenEconomyToRequest(original, { enabled: true })
    const result = compacted.history.find((item) => item.kind === 'tool_result')
    const originalOutput = originalToolResult.kind === 'tool_result'
      ? originalToolResult.output
      : {}

    expect(compacted.contextInstructions).toContain(TOKEN_ECONOMY_INSTRUCTION)
    expect(compacted.tools[0]?.description).not.toContain('Please')
    expect(JSON.stringify(compacted.tools[0]?.inputSchema)).not.toContain('The path')
    expect(result?.kind === 'tool_result' ? JSON.stringify(result.output).length : 0)
      .toBeLessThan(JSON.stringify(originalOutput).length)
    expect(JSON.stringify(originalOutput)).toContain('noise line 499')
  })

  it('returns the original request when disabled', () => {
    const original = request()
    expect(applyTokenEconomyToRequest(original, { enabled: false })).toBe(original)
  })

  it('keeps request history hygiene limits with the token economy config', () => {
    const normalized = normalizeTokenEconomyConfig({
      historyHygiene: {
        maxToolResultLines: 120,
        maxArrayItems: 20
      }
    })

    expect(normalized.historyHygiene.maxToolResultLines).toBe(120)
    expect(normalized.historyHygiene.maxArrayItems).toBe(20)
  })
})
