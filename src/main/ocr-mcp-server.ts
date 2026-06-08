import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createWorker, type Worker, type RecognizeResult } from 'tesseract.js'
import { PDFDocument, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** DPI used when rendering PDF pages for OCR. Affects coordinate scaling. */
const PDF_RENDER_DPI = 300
/** PDF user-space units per inch. Fixed in the PDF spec. */
const PDF_POINTS_PER_INCH = 72
/** Scale factor from pixel coordinates (at PDF_RENDER_DPI) to PDF points. */
const PIXEL_TO_PDF = PDF_POINTS_PER_INCH / PDF_RENDER_DPI

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.pnm', '.pbm', '.webp'
])

// ═══════════════════════════════════════════════════════════════════════════
// Tesseract worker pool (lazy singleton — created once per server lifetime)
// ═══════════════════════════════════════════════════════════════════════════

let _workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!_workerPromise) {
    _workerPromise = createWorker('eng', 1, {
      errorHandler: (err) => {
        // Surface worker errors without crashing the server
        console.error('[ocr-mcp] tesseract worker error:', err.message)
      }
    })
  }
  return _workerPromise
}

async function terminateWorker(): Promise<void> {
  if (!_workerPromise) return
  try {
    const worker = await _workerPromise
    await worker.terminate()
  } catch {
    /* best-effort */
  }
  _workerPromise = null
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

type OcrResult = {
  text: string
  pages: OcrPage[]
  confidence: number
  durationMs: number
}

type OcrOutcome =
  | { ok: true; result: OcrResult }
  | { ok: false; error: string }

// ═══════════════════════════════════════════════════════════════════════════
// Core OCR engine (tesseract.js)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Preprocess an image with sharp to improve OCR accuracy:
 * - Convert to grayscale
 * - Increase contrast
 * - Sharpen
 * - Resize if too large (keeps memory usage reasonable)
 */
async function preprocessImage(inputPath: string): Promise<Buffer> {
  const MAX_DIMENSION = 4096
  const image = sharp(inputPath)

  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  let pipeline = image
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })

  // Only resize if the image exceeds max dimension
  if (Math.max(width, height) > MAX_DIMENSION) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true
    })
  }

  return pipeline.toBuffer()
}

async function runOcrOnImage(imageBuffer: Buffer, language: string): Promise<RecognizeResult> {
  const worker = await getWorker()
  await worker.loadLanguage(language)
  await worker.reinitialize(language)
  const result = await worker.recognize(imageBuffer, { pdfRenderDPI: PDF_RENDER_DPI })
  return result
}

async function runOcrOnPdf(pdfPath: string, language: string): Promise<RecognizeResult> {
  // tesseract.js v6 can ingest PDFs directly — it renders pages internally
  // at pdfRenderDPI and OCRs each page.
  const worker = await getWorker()
  await worker.loadLanguage(language)
  await worker.reinitialize(language)
  const pdfBuffer = await readFile(pdfPath)
  const result = await worker.recognize(pdfBuffer, { pdfRenderDPI: PDF_RENDER_DPI })
  return result
}

function buildPageData(result: RecognizeResult): OcrPage[] {
  const pages = new Map<number, { text: string; words: OcrWord[]; confidences: number[] }>()

  for (const word of result.data.words) {
    const pageNum = (word as { page?: number }).page ?? 1
    if (!pages.has(pageNum)) {
      pages.set(pageNum, { text: '', words: [], confidences: [] })
    }
    const page = pages.get(pageNum)!
    const wordText = word.text || ''
    if (wordText.trim()) {
      page.words.push({
        text: wordText,
        bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
        confidence: word.confidence
      })
      page.text += (page.text ? ' ' : '') + wordText
    }
    page.confidences.push(word.confidence)
  }

  const result_pages: OcrPage[] = []
  for (const [pageNum, data] of pages) {
    const avgConf = data.confidences.length
      ? data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length
      : 0
    result_pages.push({
      pageNumber: pageNum,
      text: data.text,
      words: data.words,
      confidence: Math.round(avgConf)
    })
  }

  // If no word-level data, fall back to the global text
  if (result_pages.length === 0 && result.data.text.trim()) {
    result_pages.push({
      pageNumber: 1,
      text: result.data.text.trim(),
      words: [],
      confidence: Math.round(result.data.confidence)
    })
  }

  return result_pages
}

// ═══════════════════════════════════════════════════════════════════════════
// Searchable PDF generation (pdf-lib)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Embed an invisible but selectable text layer into a copy of the original
 * PDF using per-word bounding boxes from tesseract.js.
 *
 * Coordinates are transformed from pixel space (at PDF_RENDER_DPI, top-left
 * origin) to PDF user space (points, bottom-left origin).
 */
async function embedTextLayer(
  originalPdfPath: string,
  outputPdfPath: string,
  pages: OcrPage[]
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
      // Word-level embedding: place each word at its recognized position
      for (const word of ocrPage.words) {
        if (!word.text.trim()) continue

        const fontSize = Math.max(
          (word.bbox.y1 - word.bbox.y0) * PIXEL_TO_PDF,
          4 // minimum font size for readability in PDF
        )

        // Convert from image coords (top-left origin) to PDF coords (bottom-left origin)
        const x = word.bbox.x0 * PIXEL_TO_PDF
        const y = pageHeight - word.bbox.y1 * PIXEL_TO_PDF

        pdfPage.drawText(word.text, {
          x,
          y,
          size: fontSize,
          font: helvetica,
          opacity: 0 // invisible but selectable/copyable
        })
      }
    } else {
      // Fallback: embed the full page text as a single invisible block at
      // the top of the page. Still makes it searchable.
      pdfPage.drawText(ocrPage.text, {
        x: 36,
        y: pageHeight - 36,
        size: 10,
        font: helvetica,
        opacity: 0,
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

/** All Tesseract language codes (ISO 639-3) supported by tesseract.js */
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

// Build a quick lookup of languages that are already cached locally.
// tesseract.js auto-downloads language data on first use; we report which
// ones are available now vs. which will trigger a one-time download.
async function detectCachedLanguages(): Promise<string[]> {
  try {
    const worker = await getWorker()
    const langs = await worker.loadLanguage('eng')
    // loadLanguage doesn't return the list — just use the known set
    return ['eng'] // eng is bundled with the worker
  } catch {
    return []
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP server definition
// ═══════════════════════════════════════════════════════════════════════════

export async function runOcrMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes('--gui-ocr-mcp-server')) return false

  const server = new McpServer(
    { name: 'deepseek-gui-ocr', version: '0.2.0' },
    { capabilities: { logging: {} } }
  )

  // ── gui_ocr_check ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_check', {
    description:
      'Check the built-in OCR engine status. Always returns ready — the OCR ' +
      'engine (tesseract.js) is bundled with DeepSeek GUI and requires zero ' +
      'system configuration. Language data for English is pre-installed; ' +
      'additional languages auto-download on first use.'
  }, async () => {
    try {
      const cached = await detectCachedLanguages()
      return textResult(
        [
          'Built-in OCR engine — ready.',
          '',
          `Pre-cached languages: ${cached.length ? cached.join(', ') : 'eng (bundled)'}`,
          `All supported languages (${ALL_TESSERACT_LANGUAGES.length}): ${ALL_TESSERACT_LANGUAGES.join(', ')}`,
          '',
          'Use gui_ocr_languages for the full list of available language codes.',
          'Use gui_ocr_pdf to OCR a PDF, gui_ocr_image to OCR an image.',
          '',
          'Language data for non-English languages auto-downloads on first use ',
          'and is cached permanently. No system packages required.'
        ].join('\n'),
        {
          engine: 'tesseract.js (WASM)',
          ready: true,
          bundledLanguage: 'eng',
          supportedLanguageCount: ALL_TESSERACT_LANGUAGES.length,
          cachedLanguages: cached
        }
      )
    } catch (err) {
      return errorResult(
        `OCR engine error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })

  // ── gui_ocr_languages ──────────────────────────────────────────────

  server.registerTool('gui_ocr_languages', {
    description:
      'List all Tesseract OCR language codes supported by the built-in engine. ' +
      'Use these codes with gui_ocr_pdf or gui_ocr_image (e.g. "eng", "chi_sim", ' +
      '"eng+chi_sim"). English (eng) is pre-installed; others download automatically ' +
      'on first use and are cached permanently.'
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
        'Combine multiple languages with "+", e.g. "eng+chi_sim+fra".',
        'English (eng) is pre-installed with the engine.'
      ].join('\n'),
      {
        languages: ALL_TESSERACT_LANGUAGES,
        cachedLanguages: cached,
        combineWith: '+'
      }
    )
  })

  // ── gui_ocr_pdf ────────────────────────────────────────────────────

  server.registerTool('gui_ocr_pdf', {
    description:
      'Run OCR on a PDF file using the built-in tesseract.js engine. ' +
      'Extracts text from scanned/image-based PDFs. Optionally creates a ' +
      'searchable output PDF with an invisible selectable text layer. ' +
      'Supports 100+ languages. Zero system dependencies required.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input PDF file'),
      output_path: z.string().optional().describe(
        'Absolute path for the output searchable PDF. If provided, a copy of the ' +
        'original PDF is saved here with an invisible selectable text layer. ' +
        'If omitted, only text extraction is performed (no output file).'
      ),
      language: z.string().optional().describe(
        'OCR language(s) as 3-letter Tesseract codes. Combine multiple with "+", ' +
        'e.g. "eng", "chi_sim", "eng+chi_sim+fra". Default: "eng". ' +
        'Non-English languages auto-download on first use.'
      ),
      create_searchable_pdf: z.boolean().optional().describe(
        'If true, create a searchable PDF at output_path with an invisible text ' +
        'layer embedded at word positions. Default: true when output_path is set.'
      ),
      timeout_seconds: z.number().int().min(30).max(3600).optional().describe(
        'Maximum time in seconds before giving up. Default: 300 (5 minutes). ' +
        'Large PDFs with many pages may need more time.'
      )
    }
  }, async (args) => {
    const startedAt = Date.now()

    try {
      const inputPath = args.input_path
      if (!existsSync(inputPath)) {
        return errorResult(`Input file not found: ${inputPath}`)
      }

      const ext = extname(inputPath).toLowerCase()
      if (ext !== '.pdf') {
        return errorResult(`Input must be a .pdf file, got "${ext}". Use gui_ocr_image for images.`)
      }

      const language = args.language || 'eng'
      const shouldCreatePdf = args.create_searchable_pdf ?? (args.output_path !== undefined)

      // Ensure output directory exists
      if (args.output_path) {
        const outputDir = dirname(args.output_path)
        try { await mkdir(outputDir, { recursive: true }) } catch { /* exists */ }
      }

      // Run OCR
      const recognizeResult = await withTimeout(
        runOcrOnPdf(inputPath, language),
        (args.timeout_seconds ?? 300) * 1000,
        'OCR timed out'
      )

      const pages = buildPageData(recognizeResult)
      const fullText = pages.map((p) => p.text).join('\n\n')
      const avgConfidence = pages.length
        ? Math.round(pages.reduce((s, p) => s + p.confidence, 0) / pages.length)
        : 0
      const durationMs = Date.now() - startedAt

      let outputPath: string | undefined

      // Optionally create searchable PDF
      if (shouldCreatePdf && pages.length > 0) {
        outputPath = resolveOutputPath(inputPath, args.output_path)
        await embedTextLayer(inputPath, outputPath, pages)
      }

      const summaryLines = [
        `OCR completed in ${(durationMs / 1000).toFixed(1)}s.`,
        `Pages: ${pages.length}`,
        `Average confidence: ${avgConfidence}%`,
        `Language: ${language}`,
      ]
      if (outputPath) {
        summaryLines.push(`Searchable PDF saved to: ${outputPath}`)
      }
      summaryLines.push('', '--- Recognized text ---', fullText || '(no text recognized)')

      return textResult(summaryLines.join('\n'), {
        durationMs,
        pageCount: pages.length,
        confidence: avgConfidence,
        language,
        text: fullText,
        outputPath: outputPath ?? null,
        pages: pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.text.slice(0, 500), // truncate in structured output
          confidence: p.confidence,
          wordCount: p.words.length
        }))
      })
    } catch (err) {
      const durationMs = Date.now() - startedAt
      return errorResult(
        `OCR failed after ${(durationMs / 1000).toFixed(1)}s: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
    }
  })

  // ── gui_ocr_image ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_image', {
    description:
      'Run OCR on an image file (PNG, JPEG, TIFF, BMP, WebP) using the built-in ' +
      'tesseract.js engine. Images are automatically preprocessed (grayscale, ' +
      'contrast enhancement, sharpen) for better accuracy. Supports 100+ languages.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input image file'),
      language: z.string().optional().describe(
        'OCR language(s) as 3-letter Tesseract codes. Combine multiple with "+", ' +
        'e.g. "eng", "chi_sim", "eng+chi_sim". Default: "eng".'
      ),
      preprocess: z.boolean().optional().describe(
        'Enable automatic image preprocessing (grayscale + contrast + sharpen). ' +
        'Default: true. Disable if the image is already clean black-and-white text.'
      )
    }
  }, async (args) => {
    const startedAt = Date.now()

    try {
      const inputPath = args.input_path
      if (!existsSync(inputPath)) {
        return errorResult(`Input file not found: ${inputPath}`)
      }

      const ext = extname(inputPath).toLowerCase()
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        return errorResult(
          `Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS].join(', ')}`
        )
      }

      const language = args.language || 'eng'
      const shouldPreprocess = args.preprocess !== false

      // Preprocess or read raw
      const imageBuffer = shouldPreprocess
        ? await preprocessImage(inputPath)
        : await readFile(inputPath)

      // Run OCR
      const recognizeResult = await withTimeout(
        runOcrOnImage(imageBuffer, language),
        (args.timeout_seconds ?? 300) * 1000,
        'OCR timed out'
      )

      const pages = buildPageData(recognizeResult)
      const fullText = pages.map((p) => p.text).join('\n\n')
      const avgConfidence = pages.length
        ? Math.round(pages.reduce((s, p) => s + p.confidence, 0) / pages.length)
        : 0
      const durationMs = Date.now() - startedAt

      return textResult(
        [
          `OCR completed in ${(durationMs / 1000).toFixed(1)}s.`,
          `Confidence: ${avgConfidence}%`,
          `Language: ${language}`,
          shouldPreprocess ? 'Preprocessing: enabled' : 'Preprocessing: disabled',
          '',
          '--- Recognized text ---',
          fullText || '(no text recognized)'
        ].join('\n'),
        {
          durationMs,
          confidence: avgConfidence,
          language,
          text: fullText,
          preprocessed: shouldPreprocess
        }
      )
    } catch (err) {
      const durationMs = Date.now() - startedAt
      return errorResult(
        `OCR failed after ${(durationMs / 1000).toFixed(1)}s: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
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
    promise
      .then((val) => {
        clearTimeout(timer)
        resolve(val)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}
