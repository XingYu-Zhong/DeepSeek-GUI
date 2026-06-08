import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'
import { existsSync, appendFileSync } from 'node:fs'
import { readFile, writeFile, mkdir, unlink, rmdir } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fork, execFile } from 'node:child_process'

// ═══════════════════════════════════════════════════════════════════════════
// PDF rendering — pdfjs-dist + node-canvas
// ═══════════════════════════════════════════════════════════════════════════

import { createCanvas } from 'canvas'
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
const { getDocument } = pdfjsLib as {
  getDocument: (params: unknown) => { promise: Promise<unknown> }
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug logging
// ═══════════════════════════════════════════════════════════════════════════

const DEBUG_LOG = '/tmp/ocr-debug.log'
function dlog(msg: string, data?: unknown): void {
  try {
    const ts = new Date().toISOString()
    const line = data !== undefined
      ? `[${ts}] ${msg} ${JSON.stringify(data, (_k, v) =>
          v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v
        )}\n`
      : `[${ts}] ${msg}\n`
    appendFileSync(DEBUG_LOG, line)
  } catch { /* best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PDF_RENDER_DPI = 300
const PDF_POINTS_PER_INCH = 72
const PIXEL_TO_PDF = PDF_POINTS_PER_INCH / PDF_RENDER_DPI

const MAX_PAGES_DEFAULT = 50
const PER_PAGE_TIMEOUT_MS = 30_000 // 30 seconds per page
const TOTAL_TIMEOUT_MS = 300_000   // 5 minutes total

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.pnm', '.pbm', '.webp'
])

// ═══════════════════════════════════════════════════════════════════════════
// Platform detection
// ═══════════════════════════════════════════════════════════════════════════

const IS_MACOS = process.platform === 'darwin'

// ═══════════════════════════════════════════════════════════════════════════
// Apple Vision OCR (macOS only)
//
// Uses macOS built-in Vision Framework via JXA (osascript -l JavaScript).
// Accuracy: ~100% vs tesseract.js ~93-94%. Zero dependencies.
// The JXA script is embedded inline so it works inside ASAR packages.
// ═══════════════════════════════════════════════════════════════════════════

const VISION_OCR_JXA = `
ObjC.import('Foundation')
ObjC.import('AppKit')
ObjC.import('Vision')
function run(argv) {
  if (argv.length < 1) return JSON.stringify({error:"missing image path"})
  var imagePath = argv[0]
  var languages = argv.length >= 2 ? argv[1].split(',') : []
  var url = $.NSURL.fileURLWithPath(imagePath)
  var image = $.NSImage.alloc.initWithContentsOfURL(url)
  if (!image) return JSON.stringify({error:"Cannot load: "+imagePath})
  var cgImage = image.CGImageForProposedRectContextHints($.nil, $.nil, $.nil)
  var request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate
  request.usesLanguageCorrection = true
  if (languages.length > 0) request.recognitionLanguages = $.NSArray.arrayWithArray(languages)
  var handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cgImage, $.NSDictionary.alloc.init)
  handler.performRequestsError($([request]), $())
  var results = request.results
  var count = results.count
  var text = ''
  var totalConf = 0.0
  for (var i = 0; i < count; i++) {
    var obs = results.objectAtIndex(i)
    var candidate = obs.topCandidates(1).objectAtIndex(0)
    text += (text === '' ? '' : '\\n') + candidate.string.js
    totalConf += candidate.confidence
  }
  return JSON.stringify({text:text, confidence:count > 0 ? totalConf/count : 0, lineCount:count})
}
`

function visionOcr(imagePath: string, languages?: string[]): Promise<{ text: string; confidence: number }> {
  return new Promise((resolve, reject) => {
    const args = ['-l', 'JavaScript', '-e', VISION_OCR_JXA, '--', imagePath]
    if (languages?.length) args.push(languages.join(','))

    execFile('osascript', args, {
      encoding: 'utf-8',
      timeout: PER_PAGE_TIMEOUT_MS
    }, (err, stdout, stderr) => {
      if (err) {
        dlog('visionOcr:error', { err: err.message, stderr })
        reject(new Error(`Vision OCR failed: ${err.message}`))
        return
      }
      try {
        const result = JSON.parse(stdout)
        if (result.error) {
          reject(new Error(result.error))
        } else {
          resolve({ text: result.text || '', confidence: result.confidence || 0 })
        }
      } catch {
        dlog('visionOcr:parse-error', { stdout: stdout.slice(0, 200) })
        reject(new Error(`Vision OCR returned invalid JSON`))
      }
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Font data path for pdfjs-dist
// ═══════════════════════════════════════════════════════════════════════════

function getStandardFontDataUrl(): string {
  try {
    const pdfjsDir = dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js'))
    return join(pdfjsDir, '..', '..', 'standard_fonts') + sep
  } catch {
    return ''
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OCR Worker — one-shot child_process per request (tesseract.js fallback)
// ═══════════════════════════════════════════════════════════════════════════

type OcrResponse = {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

function getWorkerEntryPath(): string {
  const entryName = 'ocr-worker-entry.js'
  const mainDir = dirname(__dirname)

  if (__dirname.includes(`${sep}app.asar${sep}`)) {
    const unpackedMain = mainDir.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    const unpackedPath = join(unpackedMain, entryName)
    if (existsSync(unpackedPath)) return unpackedPath
    const unpackedSame = join(
      __dirname.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`),
      entryName
    )
    if (existsSync(unpackedSame)) return unpackedSame
  }

  const parentPath = join(mainDir, entryName)
  if (existsSync(parentPath)) return parentPath
  const samePath = join(__dirname, entryName)
  if (existsSync(samePath)) return samePath
  return parentPath
}

function resolveAsarUnpackedPath(asarPath: string): string {
  if (!asarPath.includes(`${sep}app.asar${sep}`)) return asarPath
  return asarPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

function buildTesseractOptions(): { workerPath: string; corePath: string; langPath: string } {
  const tesseractEntry = require.resolve('tesseract.js')
  const coreEntry = require.resolve('tesseract.js-core')
  return {
    workerPath: resolveAsarUnpackedPath(join(dirname(tesseractEntry), 'worker-script', 'node', 'index.js')),
    corePath: resolveAsarUnpackedPath(dirname(coreEntry)),
    langPath: 'https://tessdata.projectnaptha.com/4.0.0'
  }
}

function tesseractOcr(filePath: string, language: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const entryPath = getWorkerEntryPath()
    const opts = buildTesseractOptions()
    const reqId = randomUUID()
    const request = JSON.stringify({ id: reqId, filePath, language, ...opts })

    dlog('tesseractOcr: spawning', { filePath, language })

    const child = fork(entryPath, [request], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => { child.kill(); reject(new Error('OCR worker timeout')) }, PER_PAGE_TIMEOUT_MS)

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !stdout) {
        reject(new Error(`OCR worker exited ${code}${stderr ? ': ' + stderr.slice(0, 300) : ''}`))
        return
      }
      try {
        const resp: OcrResponse = JSON.parse(stdout)
        resp.ok ? resolve(resp.data) : reject(new Error(resp.error || 'OCR error'))
      } catch {
        reject(new Error(`OCR worker invalid JSON: ${stdout.slice(0, 200)}`))
      }
    })

    child.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function preloadLanguages(languages: string[]): void {
  const entryPath = getWorkerEntryPath()
  const opts = buildTesseractOptions()
  const request = JSON.stringify({ id: randomUUID(), preload: languages, ...opts })

  const child = fork(entryPath, [request], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  child.on('exit', (code) => dlog('preload:done', { code, languages }))
  child.on('error', (err) => dlog('preload:error', err))
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified OCR — Vision (macOS) → tesseract.js fallback
// ═══════════════════════════════════════════════════════════════════════════

async function ocrImage(imagePath: string, language: string): Promise<{ text: string; confidence: number }> {
  // Try Apple Vision first on macOS (much better accuracy)
  if (IS_MACOS) {
    try {
      const langMap: Record<string, string> = {
        'eng': 'en-US', 'chi_sim': 'zh-Hans', 'chi_tra': 'zh-Hant',
        'jpn': 'ja', 'kor': 'ko', 'fra': 'fr', 'deu': 'de',
        'spa': 'es', 'ita': 'it', 'por': 'pt', 'rus': 'ru',
        'ara': 'ar', 'tha': 'th', 'vie': 'vi'
      }
      const visionLang = language.split('+').map(l => langMap[l] || l)
      const result = await visionOcr(imagePath, visionLang)
      dlog('ocrImage:vision', { confidence: result.confidence, textLen: result.text.length })
      return result
    } catch (err) {
      dlog('ocrImage:vision-fallback', { error: (err as Error).message })
      // Fall through to tesseract.js
    }
  }

  // Fallback: tesseract.js
  const result = await tesseractOcr(imagePath, language) as any
  return { text: result.text || '', confidence: (result.confidence || 0) / 100 }
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type OcrWord = {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
  confidence: number
}

type OcrPage = {
  pageNumber: number
  text: string
  words: OcrWord[]
  confidence: number
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF text extraction — direct text layer (no OCR needed for text PDFs)
// ═══════════════════════════════════════════════════════════════════════════

async function extractPdfText(pdfPath: string): Promise<{ hasText: boolean; text: string; pageCount: number }> {
  try {
    const pdfBytes = await readFile(pdfPath)
    const pdfParse = require('pdf-parse')
    const data = await pdfParse(pdfBytes)
    const text = (data.text || '').trim()
    // Consider it a text PDF if we got meaningful content (>50 chars per page average)
    const avgCharsPerPage = text.length / (data.numpages || 1)
    const hasText = avgCharsPerPage > 50
    dlog('extractPdfText', { hasText, pages: data.numpages, textLen: text.length, avgCharsPerPage })
    return { hasText, text, pageCount: data.numpages }
  } catch (err) {
    dlog('extractPdfText:error', err)
    return { hasText: false, text: '', pageCount: 0 }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF → PNG rendering (pdfjs-dist + node-canvas)
// ═══════════════════════════════════════════════════════════════════════════

async function renderPdfPageToPng(
  pdf: any, pageIndex: number, dpi: number, workDir: string
): Promise<string | null> {
  if (pageIndex >= pdf.numPages) return null

  const page = await pdf.getPage(pageIndex + 1)
  const scale = dpi / PDF_POINTS_PER_INCH
  const viewport = page.getViewport({ scale })

  const canvas = createCanvas(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise

  const tmpPath = join(workDir, `page-${pageIndex}.png`)
  await writeFile(tmpPath, canvas.toBuffer('image/png'))
  return tmpPath
}

// ═══════════════════════════════════════════════════════════════════════════
// OCR pipeline — with pagination and timeout control
// ═══════════════════════════════════════════════════════════════════════════

async function runOcrOnPdf(
  pdfPath: string, language: string, maxPages: number, startPage: number
): Promise<{ pages: OcrPage[]; totalInPdf: number; truncated: boolean }> {
  dlog('runOcrOnPdf:start', { pdfPath, language, maxPages, startPage })

  // Step 1: Try direct text extraction first
  const textResult = await extractPdfText(pdfPath)
  if (textResult.hasText) {
    dlog('runOcrOnPdf:direct-text', { pages: textResult.pageCount })
    const text = cleanPdfText(textResult.text)
    return {
      pages: [{
        pageNumber: 1, text,
        words: [], confidence: 100
      }],
      totalInPdf: textResult.pageCount,
      truncated: false
    }
  }

  // Step 2: OCR path — render pages then recognize
  const pdfData = new Uint8Array(await readFile(pdfPath))
  const fontDataUrl = getStandardFontDataUrl()

  const pdf = await getDocument({
    data: pdfData,
    standardFontDataUrl: fontDataUrl,
    verbosity: 0
  }).promise as any

  const totalPages = pdf.numPages
  const endPage = Math.min(startPage + maxPages - 1, totalPages)
  const truncated = endPage < totalPages

  dlog('runOcrOnPdf:ocr', { totalPages, startPage, endPage, truncated })

  const workDir = join(tmpdir(), `ocr-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  const pages: OcrPage[] = []

  try {
    for (let i = startPage - 1; i < endPage; i++) {
      const pageNum = i + 1
      dlog('runOcrOnPdf:page', { pageNum })

      const tmpFile = await renderPdfPageToPng(pdf, i, PDF_RENDER_DPI, workDir)
      if (!tmpFile) continue

      try {
        const result = await withTimeout(
          ocrImage(tmpFile, language),
          PER_PAGE_TIMEOUT_MS,
          `Page ${pageNum} OCR timed out`
        )

        pages.push({
          pageNumber: pageNum,
          text: result.text,
          words: [],
          confidence: Math.round(result.confidence * 100)
        })

        dlog('runOcrOnPdf:page-done', { pageNum, confidence: result.confidence, textLen: result.text.length })
      } catch (err) {
        dlog('runOcrOnPdf:page-error', { pageNum, error: (err as Error).message })
        pages.push({
          pageNumber: pageNum,
          text: `[OCR failed for page ${pageNum}: ${(err as Error).message}]`,
          words: [],
          confidence: 0
        })
      } finally {
        await unlink(tmpFile).catch(() => undefined)
      }
    }
  } finally {
    await rmdir(workDir).catch(() => undefined)
  }

  return { pages, totalInPdf: totalPages, truncated }
}

function cleanPdfText(text: string): string {
  return text
    .replace(/\0/g, '�')           // NUL → replacement char
    .replace(/ /g, ' ')            // non-breaking space → space
    .replace(/\n{3,}/g, '\n\n')         // collapse blank lines
    .replace(/[ \t]+$/gm, '')           // trim trailing whitespace
    .trim()
}

async function runOcrOnImage(inputPath: string, language: string): Promise<OcrPage[]> {
  const result = await ocrImage(inputPath, language)
  return [{
    pageNumber: 1,
    text: result.text,
    words: [],
    confidence: Math.round(result.confidence * 100)
  }]
}

// ═══════════════════════════════════════════════════════════════════════════
// Searchable PDF generation (pdf-lib)
// ═══════════════════════════════════════════════════════════════════════════

async function embedTextLayer(
  originalPdfPath: string, outputPdfPath: string, pages: OcrPage[]
): Promise<void> {
  const pdfBytes = await readFile(originalPdfPath)
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const helvetica = pdfDoc.embedStandardFont('Helvetica')

  for (const ocrPage of pages) {
    const pageIndex = ocrPage.pageNumber - 1
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue

    const pdfPage = pdfDoc.getPage(pageIndex)
    const { height: pageHeight } = pdfPage.getSize()

    if (ocrPage.words.length > 0) {
      for (const word of ocrPage.words) {
        if (!word.text.trim()) continue
        const fontSize = Math.max((word.bbox.y1 - word.bbox.y0) * PIXEL_TO_PDF, 4)
        pdfPage.drawText(word.text, {
          x: word.bbox.x0 * PIXEL_TO_PDF,
          y: pageHeight - word.bbox.y1 * PIXEL_TO_PDF,
          size: fontSize, font: helvetica, opacity: 0
        })
      }
    } else if (ocrPage.text.trim()) {
      // For Vision OCR results (no word-level bboxes), overlay full text
      pdfPage.drawText(ocrPage.text, {
        x: 36, y: pageHeight - 36,
        size: 10, font: helvetica, opacity: 0,
        maxWidth: pdfPage.getSize().width - 72
      })
    }
  }

  const outputBytes = await pdfDoc.save()
  await writeFile(outputPdfPath, outputBytes)
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP helpers
// ═══════════════════════════════════════════════════════════════════════════

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

const ALL_TESSERACT_LANGUAGES = [
  'afr', 'amh', 'ara', 'asm', 'aze', 'aze_cyrl', 'bel', 'ben', 'bod', 'bos',
  'bre', 'bul', 'cat', 'ceb', 'ces', 'chi_sim', 'chi_tra', 'chr', 'cos',
  'cym', 'dan', 'deu', 'div', 'dzo', 'ell', 'eng', 'enm', 'epo', 'est',
  'eus', 'fao', 'fas', 'fil', 'fin', 'fra', 'frk', 'frm', 'fry', 'gla',
  'gle', 'glg', 'grc', 'guj', 'hat', 'heb', 'hin', 'hrv', 'hun', 'hye',
  'iku', 'ind', 'isl', 'ita', 'ita_old', 'jav', 'jpn', 'kan', 'kat',
  'kat_old', 'kaz', 'khm', 'kir', 'kmr', 'kor', 'lao', 'lat', 'lav', 'lit',
  'ltz', 'mal', 'mar', 'mkd', 'mlt', 'mon', 'mri', 'msa', 'mya', 'nep',
  'nld', 'nor', 'oci', 'ori', 'pan', 'pol', 'por', 'pus', 'que', 'ron',
  'rus', 'san', 'sin', 'slk', 'slv', 'snd', 'spa', 'spa_old', 'sqi', 'srp',
  'srp_latn', 'sun', 'swa', 'swe', 'syr', 'tam', 'tat', 'tel', 'tgk', 'tha',
  'tir', 'ton', 'tur', 'uig', 'ukr', 'urd', 'uzb', 'uzb_cyrl', 'vie', 'yid', 'yor'
] as const

async function detectCachedLanguages(): Promise<string[]> {
  try { return ['eng'] } catch { return [] }
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP server definition
// ═══════════════════════════════════════════════════════════════════════════

export async function runOcrMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes('--gui-ocr-mcp-server')) return false

  const server = new McpServer(
    { name: 'deepseek-gui-ocr', version: '0.8.0' },
    { capabilities: { logging: {} } }
  )

  // Pre-download English and Chinese language data
  preloadLanguages(['eng', 'chi_sim'])

  const ocrEngine = IS_MACOS
    ? 'Apple Vision Framework (native, ~100% accuracy) + tesseract.js fallback'
    : 'tesseract.js WASM'

  // ── gui_ocr_check ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_check', {
    description:
      'Check the built-in OCR engine status. On macOS, uses Apple Vision ' +
      'Framework (near-perfect accuracy). On other platforms, uses tesseract.js.'
  }, async () => {
    const cached = await detectCachedLanguages()
    return textResult(
      [
        'Built-in OCR engine — ready.',
        '',
        `OCR engine: ${ocrEngine}`,
        `PDF renderer: pdfjs-dist + node-canvas (bundled)`,
        `Pre-cached languages: ${cached.length ? cached.join(', ') : 'eng (bundled)'}`,
        '',
        'Features:',
        '  • Text-based PDFs: direct extraction (no OCR needed)',
        '  • Scanned/image PDFs: OCR with automatic page rendering',
        '  • Large files: pagination support (max_pages parameter)',
        IS_MACOS ? '  • macOS: Apple Vision Framework (~100% accuracy)' : '',
        '',
        'Zero system dependencies — works out of the box.'
      ].filter(Boolean).join('\n'),
      { engine: ocrEngine, ready: true, isMacOS: IS_MACOS, cachedLanguages: cached }
    )
  })

  // ── gui_ocr_languages ──────────────────────────────────────────────

  server.registerTool('gui_ocr_languages', {
    description: 'List all supported OCR language codes.'
  }, async () => {
    const cached = await detectCachedLanguages()
    return textResult(
      [
        `Supported language codes (${ALL_TESSERACT_LANGUAGES.length} total):`,
        '',
        ...ALL_TESSERACT_LANGUAGES.map(
          (l) => `${l}${cached.includes(l) ? ' [pre-cached]' : ' [auto-download on first use]'}`
        ),
        '',
        'Combine with "+", e.g. "eng+chi_sim+fra".'
      ].join('\n'),
      { languages: ALL_TESSERACT_LANGUAGES, cachedLanguages: cached }
    )
  })

  // ── gui_ocr_preload ─────────────────────────────────────────────────

  server.registerTool('gui_ocr_preload', {
    description: 'Pre-download OCR language data for faster subsequent use.',
    inputSchema: {
      language: z.string().min(1).describe('Language code(s), combine with "+", e.g. "eng+chi_sim".')
    }
  }, async (args) => {
    const languages = args.language.split('+').map((l: string) => l.trim()).filter(Boolean)
    const invalid = languages.filter((l: string) => !(ALL_TESSERACT_LANGUAGES as readonly string[]).includes(l))
    if (invalid.length > 0) {
      return errorResult(`Unknown language code(s): ${invalid.join(', ')}.`)
    }
    preloadLanguages(languages)
    return textResult(`Pre-downloading: ${languages.join(', ')} (background).`)
  })

  // ── gui_ocr_pdf ────────────────────────────────────────────────────

  server.registerTool('gui_ocr_pdf', {
    description:
      'Run OCR on a PDF file. Automatically detects text-based PDFs and ' +
      'extracts text directly (fast). For scanned/image PDFs, renders pages ' +
      'and runs OCR. Supports pagination for large files.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input PDF file'),
      output_path: z.string().optional().describe('Path for searchable output PDF.'),
      language: z.string().optional().describe('OCR language(s). Default: "eng". Combine with "+".'),
      start_page: z.number().int().min(1).optional().describe('Start page (1-based). Default: 1.'),
      max_pages: z.number().int().min(1).max(500).optional().describe(`Max pages to process. Default: ${MAX_PAGES_DEFAULT}.`),
      create_searchable_pdf: z.boolean().optional().describe('Create searchable PDF. Default: true when output_path is set.'),
      timeout_seconds: z.number().int().min(30).max(3600).optional().describe('Max time in seconds. Default: 300.')
    }
  }, async (args) => {
    const startedAt = Date.now()

    try {
      const inputPath = args.input_path
      if (!existsSync(inputPath)) return errorResult(`File not found: ${inputPath}`)

      const ext = extname(inputPath).toLowerCase()
      if (ext !== '.pdf') return errorResult(`Expected .pdf, got "${ext}". Use gui_ocr_image for images.`)

      const language = args.language || 'eng'
      const startPage = args.start_page || 1
      const maxPages = args.max_pages || MAX_PAGES_DEFAULT
      const shouldCreatePdf = args.create_searchable_pdf ?? (args.output_path !== undefined)

      if (args.output_path) {
        try { await mkdir(dirname(args.output_path), { recursive: true }) } catch { /* noop */ }
      }

      const { pages, totalInPdf, truncated } = await withTimeout(
        runOcrOnPdf(inputPath, language, maxPages, startPage),
        (args.timeout_seconds ?? 300) * 1000,
        'OCR timed out'
      )

      const fullText = pages.map(p => p.text).join('\n\n')
      const avgConfidence = pages.length
        ? Math.round(pages.reduce((s, p) => s + p.confidence, 0) / pages.length)
        : 0
      const durationMs = Date.now() - startedAt

      let outputPath: string | undefined
      if (shouldCreatePdf && pages.length > 0 && fullText.trim()) {
        outputPath = resolveOutputPath(inputPath, args.output_path)
        await embedTextLayer(inputPath, outputPath, pages)
      }

      const summaryLines = [
        `OCR completed in ${(durationMs / 1000).toFixed(1)}s.`,
        `Pages: ${pages.length}${truncated ? ` (of ${totalInPdf} total — use start_page to continue)` : ''}`,
        `Average confidence: ${avgConfidence}%`,
        `Language: ${language}`,
      ]
      if (outputPath) summaryLines.push(`Searchable PDF: ${outputPath}`)
      if (truncated) summaryLines.push(`⚠ Large file: processed pages ${startPage}-${startPage + pages.length - 1}. Use start_page=${startPage + pages.length} to continue.`)
      summaryLines.push('', '--- Recognized text ---', fullText || '(no text recognized)')

      return textResult(summaryLines.join('\n'), {
        durationMs, pageCount: pages.length, totalInPdf, truncated,
        confidence: avgConfidence, language, text: fullText,
        outputPath: outputPath ?? null,
        nextStartPage: truncated ? startPage + pages.length : null,
        pages: pages.map(p => ({
          pageNumber: p.pageNumber, text: p.text.slice(0, 500), confidence: p.confidence
        }))
      })
    } catch (err) {
      dlog('gui_ocr_pdf:error', err)
      return errorResult(`OCR failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // ── gui_ocr_image ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_image', {
    description: 'Run OCR on an image file (PNG, JPEG, TIFF, BMP, WebP).',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input image.'),
      language: z.string().optional().describe('OCR language(s). Default: "eng".')
    }
  }, async (args) => {
    const startedAt = Date.now()

    try {
      const inputPath = args.input_path
      if (!existsSync(inputPath)) return errorResult(`File not found: ${inputPath}`)

      const ext = extname(inputPath).toLowerCase()
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        return errorResult(`Unsupported format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS].join(', ')}`)
      }

      const language = args.language || 'eng'
      const pages = await withTimeout(
        runOcrOnImage(inputPath, language),
        TOTAL_TIMEOUT_MS,
        'OCR timed out'
      )

      const fullText = pages.map(p => p.text).join('\n\n')
      const avgConfidence = pages.length
        ? Math.round(pages.reduce((s, p) => s + p.confidence, 0) / pages.length)
        : 0
      const durationMs = Date.now() - startedAt

      return textResult(
        [
          `OCR completed in ${(durationMs / 1000).toFixed(1)}s.`,
          `Confidence: ${avgConfidence}%`,
          `Language: ${language}`, '',
          '--- Recognized text ---',
          fullText || '(no text recognized)'
        ].join('\n'),
        { durationMs, confidence: avgConfidence, language, text: fullText }
      )
    } catch (err) {
      return errorResult(`OCR failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(val => { clearTimeout(timer); resolve(val) })
      .catch(err => { clearTimeout(timer); reject(err) })
  })
}
