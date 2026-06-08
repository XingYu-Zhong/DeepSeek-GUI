import { describe, expect, it } from 'vitest'

// We can't easily spawn the full MCP server in a unit test without Electron,
// but we can validate the exported symbols and resolution helpers.

describe('ocr-mcp-server (unit)', () => {
  describe('module exports', () => {
    it('exports runOcrMcpServerFromArgv', async () => {
      const mod = await import('./ocr-mcp-server')
      expect(typeof mod.runOcrMcpServerFromArgv).toBe('function')
    })
  })

  describe('runOcrMcpServerFromArgv guard', () => {
    it('returns false when argv does not contain --gui-ocr-mcp-server', async () => {
      const { runOcrMcpServerFromArgv } = await import('./ocr-mcp-server')
      const result = await runOcrMcpServerFromArgv(['node', 'script.js'])
      expect(result).toBe(false)
    })
  })
})
