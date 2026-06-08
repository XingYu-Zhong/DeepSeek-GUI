import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Resolve the ocrmypdf binary ────────────────────────────────────────

function resolveOcrmypdfBin(): string {
  if (process.env.OCRMYPDF_BIN) return process.env.OCRMYPDF_BIN
  if (process.platform === 'win32') {
    return 'ocrmypdf.exe'
  }
  return 'ocrmypdf'
}

// ── Run ocrmypdf as a child process ────────────────────────────────────

type OcrResult = {
  ok: true
  outputPath: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

type OcrError = {
  ok: false
  error: string
  stdout: string
  stderr: string
}

async function runOcrmypdf(
  args: string[],
  timeoutMs = 300_000
): Promise<OcrResult | OcrError> {
  const bin = resolveOcrmypdfBin()
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          ok: false,
          error: `OCRmyPDF binary not found. Install it with: pip install ocrmypdf (or brew install ocrmypdf)`,
          stdout,
          stderr
        })
      } else {
        resolve({
          ok: false,
          error: `Failed to spawn OCRmyPDF: ${err.message}`,
          stdout,
          stderr
        })
      }
    })

    child.on('close', (code: number | null) => {
      const durationMs = Date.now() - startedAt
      if (code === 0) {
        resolve({
          ok: true,
          outputPath: args[args.length - 1] ?? '',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          durationMs
        })
      } else {
        const errorMessage = stderr.trim() || stdout.trim() || `Exit code ${code}`
        resolve({
          ok: false,
          error: errorMessage,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        })
      }
    })
  })
}

// ── Check installation ──────────────────────────────────────────────────

type OcrmypdfInfo = {
  installed: boolean
  version: string
  binPath: string
  tesseractInstalled: boolean
  tesseractVersion: string
  availableLanguages: string[]
}

async function checkInstallation(): Promise<OcrmypdfInfo> {
  const info: OcrmypdfInfo = {
    installed: false,
    version: '',
    binPath: resolveOcrmypdfBin(),
    tesseractInstalled: false,
    tesseractVersion: '',
    availableLanguages: []
  }

  // Check ocrmypdf binary
  try {
    await access(resolveOcrmypdfBin())
    info.installed = true
  } catch {
    // Try which/where
    const result = await runOcrmypdf(['--version'], 10_000)
    if (result.ok) {
      info.installed = true
      info.version = result.stdout.split('\n')[0]?.trim() || ''
    } else {
      info.installed = !result.error.includes('not found')
    }
  }

  if (info.installed) {
    const versionResult = await runOcrmypdf(['--version'], 10_000)
    if (versionResult.ok) {
      info.version = versionResult.stdout.split('\n')[0]?.trim() || ''
    }
  }

  // Check tesseract
  const tesseractBin = process.platform === 'win32' ? 'tesseract.exe' : 'tesseract'
  try {
    await access(tesseractBin)
    info.tesseractInstalled = true
  } catch {
    // try spawn
    const tesseractResult = await new Promise<{ installed: boolean; version: string }>((resolve) => {
      const child = spawn(tesseractBin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 })
      let out = ''
      child.stdout?.on('data', (c: Buffer) => { out += c.toString() })
      child.on('error', () => resolve({ installed: false, version: '' }))
      child.on('close', (code: number | null) => {
        resolve({
          installed: code === 0,
          version: out.split('\n')[0]?.trim() || ''
        })
      })
    })
    info.tesseractInstalled = tesseractResult.installed
    info.tesseractVersion = tesseractResult.version
  }

  // Get available languages
  if (info.tesseractInstalled) {
    const langResult = await new Promise<string[]>((resolve) => {
      const child = spawn(tesseractBin, ['--list-langs'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 })
      let out = ''
      child.stdout?.on('data', (c: Buffer) => { out += c.toString() })
      child.stderr?.on('data', (c: Buffer) => { out += c.toString() })
      child.on('error', () => resolve([]))
      child.on('close', () => {
        const lines = out.split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('List of'))
        resolve(lines)
      })
    })
    info.availableLanguages = langResult
  }

  return info
}

// ── Helpers ────────────────────────────────────────────────────────────

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}

function resolveOutputPath(inputPath: string, outputPath?: string): string {
  if (outputPath) return outputPath
  const dir = dirname(inputPath)
  const base = basename(inputPath, extname(inputPath))
  return join(dir, `${base}_ocr.pdf`)
}

// ── Supported languages table ──────────────────────────────────────────

const SUPPORTED_LANGUAGES = [
  'afr', 'amh', 'ara', 'asm', 'aze', 'aze_cyrl', 'bel', 'ben', 'bod', 'bos',
  'bre', 'bul', 'cat', 'ceb', 'ces', 'chi_sim', 'chi_sim_vert', 'chi_tra',
  'chi_tra_vert', 'chr', 'cos', 'cym', 'dan', 'deu', 'div', 'dzo', 'ell',
  'eng', 'enm', 'epo', 'est', 'eus', 'fao', 'fas', 'fil', 'fin', 'fra',
  'frk', 'frm', 'fry', 'gla', 'gle', 'glg', 'grc', 'guj', 'hat', 'heb',
  'hin', 'hrv', 'hun', 'hye', 'iku', 'ind', 'isl', 'ita', 'ita_old', 'jav',
  'jpn', 'jpn_vert', 'kan', 'kat', 'kat_old', 'kaz', 'khm', 'kir', 'kmr',
  'kor', 'kor_vert', 'lao', 'lat', 'lav', 'lit', 'ltz', 'mal', 'mar', 'mkd',
  'mlt', 'mon', 'mri', 'msa', 'mya', 'nep', 'nld', 'nor', 'oci', 'ori',
  'pan', 'pol', 'por', 'pus', 'que', 'ron', 'rus', 'san', 'sin', 'slk',
  'slv', 'snd', 'spa', 'spa_old', 'sqi', 'srp', 'srp_latn', 'sun', 'swa',
  'swe', 'syr', 'tam', 'tat', 'tel', 'tgk', 'tha', 'tir', 'ton', 'tur',
  'uig', 'ukr', 'urd', 'uzb', 'uzb_cyrl', 'vie', 'yid', 'yor'
] as const

// ── MCP server definition ──────────────────────────────────────────────

export async function runOcrMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes('--gui-ocr-mcp-server')) return false

  const server = new McpServer(
    { name: 'deepseek-gui-ocr', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  // ── gui_ocr_check ────────────────────────────────────────────────

  server.registerTool('gui_ocr_check', {
    description:
      'Check if OCRmyPDF is installed and ready. Returns version, available Tesseract languages, and installation status.'
  }, async () => {
    try {
      const info = await checkInstallation()
      if (!info.installed) {
        return errorResult(
          'OCRmyPDF is not installed. Install it with:\n' +
          '  macOS:  brew install ocrmypdf\n' +
          '  Linux:  apt install ocrmypdf   or   pip install ocrmypdf\n' +
          '  Windows: pip install ocrmypdf\n' +
          'Tesseract is also required for OCR.'
        )
      }
      return textResult(
        [
          `OCRmyPDF ${info.version} — installed and ready.`,
          `Tesseract: ${info.tesseractInstalled ? info.tesseractVersion || 'installed' : 'NOT INSTALLED'}`,
          info.availableLanguages.length
            ? `Available languages (${info.availableLanguages.length}): ${info.availableLanguages.join(', ')}`
            : 'No Tesseract language data found. Install with: apt install tesseract-ocr-<lang>'
        ].join('\n'),
        {
          installed: info.installed,
          version: info.version,
          tesseractInstalled: info.tesseractInstalled,
          tesseractVersion: info.tesseractVersion,
          availableLanguages: info.availableLanguages
        }
      )
    } catch (err) {
      return errorResult(`Failed to check OCRmyPDF: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // ── gui_ocr_pdf ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_pdf', {
    description:
      'Run OCR (Optical Character Recognition) on a PDF file using OCRmyPDF. ' +
      'Adds a searchable text layer to scanned PDFs. Supports 100+ languages, ' +
      'deskew, cleaning, and PDF/A output.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input PDF file'),
      output_path: z.string().optional().describe(
        'Absolute path for the output PDF. If omitted, saves next to the input with "_ocr" suffix.'
      ),
      language: z.string().optional().describe(
        'OCR language(s). Use 3-letter Tesseract codes. Combine with "+" for multiple, e.g. "eng", "chi_sim", "eng+chi_sim". Default: "eng"'
      ),
      output_type: z.enum(['pdf', 'pdfa', 'pdfa-1', 'pdfa-2', 'pdfa-3']).optional().describe(
        'Output PDF type. "pdf" = normal PDF with text layer (default). "pdfa" = PDF/A-2. "pdfa-1"/"pdfa-2"/"pdfa-3" = specific PDF/A levels.'
      ),
      deskew: z.boolean().optional().describe('Auto-deskew crooked pages. Default: false'),
      clean: z.boolean().optional().describe('Clean up pages (remove speckles, smooth). Default: false'),
      skip_text: z.boolean().optional().describe('Skip OCR on pages that already have selectable text. Default: false'),
      force_ocr: z.boolean().optional().describe('Force OCR on every page, ignoring existing text. Default: false'),
      optimize: z.number().int().min(0).max(3).optional().describe(
        'Optimization level: 0=fastest, 1=balanced (default), 2=higher quality, 3=maximum quality (slowest)'
      ),
      rotate_pages: z.boolean().optional().describe('Auto-detect and correct page orientation. Default: true'),
      remove_background: z.boolean().optional().describe('Remove background to improve OCR accuracy. Default: false'),
      timeout_seconds: z.number().int().min(10).max(3600).optional().describe(
        'Maximum time in seconds before giving up. Default: 300 (5 minutes)'
      )
    }
  }, async (args) => {
    try {
      const inputPath = args.input_path
      if (!existsSync(inputPath)) {
        return errorResult(`Input file not found: ${inputPath}`)
      }

      const ext = extname(inputPath).toLowerCase()
      if (ext !== '.pdf') {
        return errorResult(`Input must be a .pdf file, got "${ext}"`)
      }

      const outputPath = resolveOutputPath(inputPath, args.output_path)
      const outputDir = dirname(outputPath)
      try {
        await mkdir(outputDir, { recursive: true })
      } catch {
        // directory likely exists
      }

      // Build OCRmyPDF arguments
      const ocrArgs: string[] = []

      if (args.language) {
        ocrArgs.push('-l', args.language)
      }

      if (args.output_type) {
        ocrArgs.push('--output-type', args.output_type)
      }

      if (args.deskew) ocrArgs.push('--deskew')
      if (args.clean) ocrArgs.push('--clean')
      if (args.skip_text) ocrArgs.push('--skip-text')
      if (args.force_ocr) ocrArgs.push('--force-ocr')
      if (args.remove_background) ocrArgs.push('--remove-background')

      if (args.rotate_pages !== undefined && !args.rotate_pages) {
        ocrArgs.push('--no-rotate-pages')
      }

      if (args.optimize !== undefined) {
        ocrArgs.push('--optimize', String(args.optimize))
      }

      ocrArgs.push(inputPath, outputPath)

      const timeoutMs = (args.timeout_seconds ?? 300) * 1000
      const result = await runOcrmypdf(ocrArgs, timeoutMs)

      if (!result.ok) {
        return errorResult(
          `OCRmyPDF failed:\n${result.error}\n\nCommand: ocrmypdf ${ocrArgs.join(' ')}`
        )
      }

      return textResult(
        [
          `OCR completed successfully in ${(result.durationMs / 1000).toFixed(1)}s.`,
          `Output: ${result.outputPath}`,
          result.stdout ? `\nDetails:\n${result.stdout}` : ''
        ].filter(Boolean).join('\n'),
        {
          outputPath: result.outputPath,
          inputPath,
          durationMs: result.durationMs,
          language: args.language ?? 'eng',
          outputType: args.output_type ?? 'pdf'
        }
      )
    } catch (err) {
      return errorResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // ── gui_ocr_languages ────────────────────────────────────────────

  server.registerTool('gui_ocr_languages', {
    description:
      'List Tesseract OCR languages installed on this system. ' +
      'Use the returned language codes with gui_ocr_pdf\'s `language` parameter.'
  }, async () => {
    try {
      const info = await checkInstallation()
      if (!info.tesseractInstalled) {
        return errorResult(
          'Tesseract is not installed. Install it with:\n' +
          '  macOS:  brew install tesseract tesseract-lang\n' +
          '  Linux:  apt install tesseract-ocr tesseract-ocr-all'
        )
      }
      return textResult(
        info.availableLanguages.length
          ? `${info.availableLanguages.length} language(s) available:\n${info.availableLanguages.join('\n')}`
          : 'No language packs installed. Install with: apt install tesseract-ocr-eng tesseract-ocr-chi-sim ...',
        { languages: info.availableLanguages }
      )
    } catch (err) {
      return errorResult(`Failed to list languages: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}
