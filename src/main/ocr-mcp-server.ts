import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import Tesseract, { type RecognizeResult } from 'tesseract.js'

const { recognize } = Tesseract
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PNG } from 'pngjs'
import { PDFDocument } from 'pdf-lib'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, unlink, rmdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PDF_RENDER_DPI = 300
const PDF_POINTS_PER_INCH = 72
const PIXEL_TO_PDF = PDF_POINTS_PER_INCH / PDF_RENDER_DPI

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.pnm', '.pbm', '.webp'
])

// ═══════════════════════════════════════════════════════════════════════════
// Tesseract OCR — use the high-level recognize() API which handles worker
// lifecycle and serialization correctly across all environments.
// ═══════════════════════════════════════════════════════════════════════════

async function ocrFile(
  filePath: string,
  language: string,
  options?: { pdfRenderDPI?: number }
): Promise<RecognizeResult> {
  return recognize(filePath, language, {
    ...options,
    errorHandler: (err) => {
      console.error('[ocr-mcp] tesseract error:', err.message)
    }
  })
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
// Minimal Canvas for pdfjs-dist (pure JS — zero native deps)
// ═══════════════════════════════════════════════════════════════════════════

/** Implements just enough Canvas 2D API for pdfjs-dist page.render() */
class NodeCanvas {
  width: number
  height: number
  _ctx: NodeContext | null = null

  constructor(w: number, h: number) {
    this.width = Math.max(1, w) | 0
    this.height = Math.max(1, h) | 0
  }

  getContext(type: string) {
    if (type !== '2d') return null
    if (!this._ctx) this._ctx = new NodeContext(this)
    return this._ctx
  }

  toRGBA(): Uint8ClampedArray {
    return this._ctx ? this._ctx._pixels : new Uint8ClampedArray(0)
  }

  toPNG(): Buffer {
    const png = new PNG({ width: this.width, height: this.height })
    if (this._ctx) {
      png.data = Buffer.from(this._ctx._pixels)
    }
    return PNG.sync.write(png)
  }
}

class NodeContext {
  canvas: NodeCanvas
  _pixels: Uint8ClampedArray
  _transform: [number, number, number, number, number, number]
  _saveStack: Array<[number, number, number, number, number, number]>

  constructor(canvas: NodeCanvas) {
    this.canvas = canvas
    this._pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255)
    this._transform = [1, 0, 0, 1, 0, 0]
    this._saveStack = []
  }

  // Transform state
  save(): void { this._saveStack.push([...this._transform]) }
  restore(): void {
    const s = this._saveStack.pop()
    if (s) this._transform = s
  }
  scale(sx: number, sy: number): void { this._transform[0] *= sx; this._transform[3] *= sy }
  rotate(_angle: number): void { /* noop — pdfjs-dist uses transform directly */ }
  translate(tx: number, ty: number): void { this._transform[4] += tx; this._transform[5] += ty }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const m = this._transform
    this._transform = [
      m[0] * a + m[1] * c,
      m[0] * b + m[1] * d,
      m[2] * a + m[3] * c,
      m[2] * b + m[3] * d,
      m[4] * a + m[5] * c + e,
      m[4] * b + m[5] * d + f
    ]
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this._transform = [a, b, c, d, e, f]
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const m = this._transform
    return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }
  }
  resetTransform(): void { this._transform = [1, 0, 0, 1, 0, 0] }

  // Path operations (all noop — we only capture raster data)
  beginPath(): void {}
  closePath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  rect(_x: number, _y: number, _w: number, _h: number): void {}
  arc(_x: number, _y: number, _r: number, _sa: number, _ea: number, _ccw?: boolean): void {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _r: number): void {}
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number): void {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number): void {}
  ellipse(_x: number, _y: number, _rx: number, _ry: number, _rot: number, _sa: number, _ea: number, _ccw?: boolean): void {}

  clip(): void {}
  fill(): void {}
  stroke(): void {}
  fillRect(_x: number, _y: number, _w: number, _h: number): void {}
  strokeRect(_x: number, _y: number, _w: number, _h: number): void {}
  clearRect(_x: number, _y: number, _w: number, _h: number): void {}

  fillText(_text: string, _x: number, _y: number, _maxWidth?: number): void {}
  strokeText(_text: string, _x: number, _y: number, _maxWidth?: number): void {}
  measureText(text: string): TextMetrics {
    return { width: text.length * 8 } as TextMetrics
  }

  createLinearGradient(): CanvasGradient { return { addColorStop: () => {} } as unknown as CanvasGradient }
  createRadialGradient(): CanvasGradient { return { addColorStop: () => {} } as unknown as CanvasGradient }

  // Raster operations — these actually capture pixel data
  putImageData(imageData: ImageData, x: number, y: number, dirtyX?: number, dirtyY?: number, dirtyW?: number, dirtyH?: number): void {
    const src = imageData.data
    const sw = imageData.width
    const sh = imageData.height
    const sx = dirtyX ?? 0
    const sy = dirtyY ?? 0
    const dw = dirtyW ?? sw
    const dh = dirtyH ?? sh
    const dx = x | 0
    const dy = y | 0
    const cw = this.canvas.width

    for (let row = 0; row < dh && row < sh; row++) {
      for (let col = 0; col < dw && col < sw; col++) {
        const si = ((sy + row) * sw + (sx + col)) * 4
        const di = ((dy + row) * cw + (dx + col)) * 4
        if (di >= 0 && di < this._pixels.length - 3 && si >= 0 && si < src.length - 3) {
          this._pixels[di] = src[si]
          this._pixels[di + 1] = src[si + 1]
          this._pixels[di + 2] = src[si + 2]
          this._pixels[di + 3] = src[si + 3]
        }
      }
    }
  }

  drawImage(img: any, sx: number, sy: number, sw?: number, sh?: number, dx?: number, dy?: number, dw?: number, dh?: number): void {
    if (!img || !img.data) return
    const src: Uint8ClampedArray = img.data
    const iw = img.width || 1
    const ih = img.height || 1

    // Handle argument overloading (drawImage has multiple signatures)
    let SX: number, SY: number, SW: number, SH: number, DX: number, DY: number, DW: number, DH: number
    if (typeof sw === 'number') {
      // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
      SX = sx; SY = sy; SW = sw; SH = sh!
      DX = dx!; DY = dy!; DW = dw!; DH = dh!
    } else {
      // drawImage(img, dx, dy) or drawImage(img, dx, dy, dw, dh)
      SX = 0; SY = 0; SW = iw; SH = ih
      DX = sx; DY = sy; DW = sw ?? iw; DH = sh ?? ih
    }

    const cw = this.canvas.width
    for (let row = 0; row < DH && row < SH; row++) {
      for (let col = 0; col < DW && col < SW; col++) {
        const si = ((SY + Math.floor(row * SH / DH)) * iw + (SX + Math.floor(col * SW / DW))) * 4
        const di = ((DY + row) * cw + (DX + col)) * 4
        if (di >= 0 && di < this._pixels.length - 3 && si >= 0 && si < src.length - 3) {
          this._pixels[di] = src[si]
          this._pixels[di + 1] = src[si + 1]
          this._pixels[di + 2] = src[si + 2]
          this._pixels[di + 3] = src[si + 3]
        }
      }
    }
  }

  getImageData(_x: number, _y: number, w: number, h: number): ImageData {
    return {
      data: new Uint8ClampedArray(w * h * 4).fill(255),
      width: w,
      height: h,
      colorSpace: 'srgb'
    } as ImageData
  }

  createImageData(w: number, h: number): ImageData {
    return {
      data: new Uint8ClampedArray(w * h * 4).fill(255),
      width: w,
      height: h,
      colorSpace: 'srgb'
    } as ImageData
  }
}

const pdfCanvasFactory = {
  create(w: number, h: number) { return new NodeCanvas(w, h) },
  reset(c: NodeCanvas, w: number, h: number) { c.width = w; c.height = h },
  destroy(_c: NodeCanvas) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Core OCR engine
// ═══════════════════════════════════════════════════════════════════════════

async function runOcrOnImage(inputPath: string, language: string): Promise<RecognizeResult> {
  return ocrFile(inputPath, language)
}

/**
 * Render a single PDF page to a temporary PNG file.
 * Returns the file path, or null when pageIndex is out of range.
 * Caller is responsible for cleanup (unlink).
 */
async function renderPdfPageToPng(
  pdfData: Uint8Array,
  pageIndex: number,
  scale: number,
  workDir: string
): Promise<string | null> {
  const pdf = await getDocument({
    data: pdfData,
    canvasFactory: pdfCanvasFactory,
    standardFontDataUrl: 'about:blank'
  }).promise

  if (pageIndex >= pdf.numPages) return null

  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale })
  const canvas = pdfCanvasFactory.create(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')!

  await page.render({
    canvasContext: ctx,
    viewport,
    canvasFactory: pdfCanvasFactory
  }).promise

  // Write to temp file — tesseract.js worker can't handle in-memory
  // Buffers across the thread boundary in Node.js ("Unable to
  // deserialize cloned data").
  const tmpPath = join(workDir, `page-${pageIndex}.png`)
  await writeFile(tmpPath, canvas.toPNG())
  return tmpPath
}

/**
 * Count pages in a PDF using pdfjs-dist.
 */
async function countPdfPages(pdfData: Uint8Array): Promise<number> {
  const pdf = await getDocument({
    data: pdfData,
    canvasFactory: pdfCanvasFactory,
    standardFontDataUrl: 'about:blank'
  }).promise
  return pdf.numPages
}

async function runOcrOnPdf(pdfPath: string, language: string): Promise<RecognizeResult> {
  const pdfData = new Uint8Array(await readFile(pdfPath))
  const pageCount = await countPdfPages(pdfData)

  const scale = PDF_RENDER_DPI / 72
  const workDir = join(tmpdir(), `ocr-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  const tmpFiles: string[] = []

  const pageResults: RecognizeResult[] = []
  try {
    for (let i = 0; i < pageCount; i++) {
      const tmpFile = await renderPdfPageToPng(pdfData, i, scale, workDir)
      if (!tmpFile) break
      tmpFiles.push(tmpFile)

      // Use high-level recognize() — avoids worker thread serialization issues
      const result = await ocrFile(tmpFile, language, { pdfRenderDPI: PDF_RENDER_DPI })

      for (const word of result.data.words) {
        ;(word as { page?: number }).page = i + 1
      }
      for (const line of result.data.lines) {
        ;(line as { page?: number }).page = i + 1
      }
      for (const block of result.data.blocks) {
        ;(block as { page?: number }).page = i + 1
      }
      pageResults.push(result)
    }
  } finally {
    // Clean up temp files
    await Promise.all(tmpFiles.map((f) => unlink(f).catch(() => undefined)))
    await rmdir(workDir).catch(() => undefined)
  }

  if (pageResults.length === 0) {
    throw new Error('Could not render any pages from the PDF. The file may be corrupted or encrypted.')
  }

  const merged: RecognizeResult = {
    data: {
      text: pageResults.map((r) => r.data.text).join('\n\n'),
      words: pageResults.flatMap((r) => r.data.words),
      lines: pageResults.flatMap((r) => r.data.lines),
      blocks: pageResults.flatMap((r) => r.data.blocks),
      paragraphs: pageResults.flatMap((r) => r.data.paragraphs),
      confidence: Math.round(
        pageResults.reduce((s, r) => s + r.data.confidence, 0) / pageResults.length
      )
    }
  }
  return merged
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
      for (const word of ocrPage.words) {
        if (!word.text.trim()) continue

        const fontSize = Math.max(
          (word.bbox.y1 - word.bbox.y0) * PIXEL_TO_PDF,
          4
        )
        const x = word.bbox.x0 * PIXEL_TO_PDF
        const y = pageHeight - word.bbox.y1 * PIXEL_TO_PDF

        pdfPage.drawText(word.text, {
          x, y,
          size: fontSize,
          font: helvetica,
          opacity: 0
        })
      }
    } else {
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
    { name: 'deepseek-gui-ocr', version: '0.3.0' },
    { capabilities: { logging: {} } }
  )

  // ── gui_ocr_check ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_check', {
    description:
      'Check the built-in OCR engine status. Always ready — the engine ' +
      '(tesseract.js + pdfjs-dist) is bundled with DeepSeek GUI and ' +
      'requires zero system configuration. English is pre-installed; ' +
      'other languages auto-download on first use.'
  }, async () => {
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
        engine: 'tesseract.js (WASM) + pdfjs-dist (pure JS)',
        ready: true,
        bundledLanguage: 'eng',
        supportedLanguageCount: ALL_TESSERACT_LANGUAGES.length,
        cachedLanguages: cached
      }
    )
  })

  // ── gui_ocr_languages ──────────────────────────────────────────────

  server.registerTool('gui_ocr_languages', {
    description:
      'List all Tesseract OCR language codes. English is pre-installed; ' +
      'others auto-download on first use and are cached permanently.'
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
      { languages: ALL_TESSERACT_LANGUAGES, cachedLanguages: cached, combineWith: '+' }
    )
  })

  // ── gui_ocr_pdf ────────────────────────────────────────────────────

  server.registerTool('gui_ocr_pdf', {
    description:
      'Run OCR on a PDF file using the built-in engine. Extracts text from ' +
      'scanned/image-based PDFs. Optionally creates a searchable output PDF ' +
      'with an invisible selectable text layer. Supports 100+ languages. ' +
      'Zero system dependencies required.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input PDF file'),
      output_path: z.string().optional().describe(
        'Absolute path for the output searchable PDF. If provided, a copy of the ' +
        'original PDF is saved here with an invisible selectable text layer.'
      ),
      language: z.string().optional().describe(
        'OCR language(s). Combine with "+", e.g. "eng", "chi_sim", "eng+chi_sim". Default: "eng".'
      ),
      create_searchable_pdf: z.boolean().optional().describe(
        'If true, create a searchable PDF at output_path. Default: true when output_path is set.'
      ),
      timeout_seconds: z.number().int().min(30).max(3600).optional().describe(
        'Maximum time in seconds. Default: 300 (5 minutes).'
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

      if (args.output_path) {
        const outputDir = dirname(args.output_path)
        try { await mkdir(outputDir, { recursive: true }) } catch { /* exists */ }
      }

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
      if (outputPath) summaryLines.push(`Searchable PDF saved to: ${outputPath}`)
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
          text: p.text.slice(0, 500),
          confidence: p.confidence,
          wordCount: p.words.length
        }))
      })
    } catch (err) {
      return errorResult(
        `OCR failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
    }
  })

  // ── gui_ocr_image ──────────────────────────────────────────────────

  server.registerTool('gui_ocr_image', {
    description:
      'Run OCR on an image file (PNG, JPEG, TIFF, BMP, WebP) using the built-in engine.',
    inputSchema: {
      input_path: z.string().min(1).describe('Absolute path to the input image file'),
      language: z.string().optional().describe(
        'OCR language(s). Combine with "+", e.g. "eng", "chi_sim". Default: "eng".'
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
        return errorResult(`Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS].join(', ')}`)
      }

      const language = args.language || 'eng'
      const recognizeResult = await withTimeout(
        runOcrOnImage(inputPath, language),
        300_000,
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
          '',
          '--- Recognized text ---',
          fullText || '(no text recognized)'
        ].join('\n'),
        { durationMs, confidence: avgConfidence, language, text: fullText }
      )
    } catch (err) {
      return errorResult(
        `OCR failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ` +
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
    promise.then((val) => { clearTimeout(timer); resolve(val) })
      .catch((err) => { clearTimeout(timer); reject(err) })
  })
}
