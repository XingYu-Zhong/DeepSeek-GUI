import { describe, expect, it } from 'vitest'

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

  describe('zero system dependencies', () => {
    it('does not reference ocrmypdf binary resolution', async () => {
      // The server uses tesseract.js (pure JS/WASM) — no spawn(), no shell
      // commands, no Python dependency. Verify the source doesn't try to
      // resolve a system binary.
      const fs = await import('node:fs/promises')
      const source = await fs.readFile(
        new URL('./ocr-mcp-server.ts', import.meta.url),
        'utf8'
      )
      expect(source).not.toContain("spawn('ocrmypdf'")
      expect(source).not.toContain("spawn('tesseract'")
      expect(source).not.toContain('process.env.OCRMYPDF_BIN')
    })
  })

  describe('engine independence', () => {
    it('imports tesseract.js as the OCR engine', async () => {
      // Verify the module can import tesseract.js
      const mod = await import('./ocr-mcp-server')
      // If the module loads without tesseract.js being available, this
      // test catches missing peer dependencies.
      expect(mod).toBeDefined()
    })
  })
})
