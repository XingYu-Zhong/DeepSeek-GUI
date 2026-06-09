import { randomBytes } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type TruncationResult as OutputAccumulatorTruncation,
  truncateTail
} from './truncate.js'

export type OutputAccumulatorSnapshot = {
  content: string
  truncation: OutputAccumulatorTruncation
  fullOutputPath?: string
}

export type OutputAccumulatorOptions = {
  maxLines: number
  maxBytes: number
  tempFilePrefix: string
}

type OutputTextEncoding = 'utf-8' | 'utf-16le'

function defaultTempFilePath(prefix: string): string {
  const id = randomBytes(8).toString('hex')
  return join(tmpdir(), `${prefix}-${id}.log`)
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function startsWithUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
}

function startsWithUtf16LeBom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  let pairs = 0
  let oddNuls = 0
  let evenNuls = 0

  for (let index = 0; index + 1 < sample.length; index += 2) {
    pairs += 1
    if (sample[index] === 0) evenNuls += 1
    if (sample[index + 1] === 0) oddNuls += 1
  }

  if (pairs < 2) return false
  if (oddNuls / pairs >= 0.45 && oddNuls > evenNuls * 2) return true
  return looksLikeHanUtf16LeWithoutNuls(sample)
}

function isHanCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ebef)
  )
}

function isPrivateUseCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd)
  )
}

function textStats(text: string): {
  total: number
  ascii: number
  han: number
  privateUse: number
  replacement: number
  control: number
} {
  const stats = { total: 0, ascii: 0, han: 0, privateUse: 0, replacement: 0, control: 0 }
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    stats.total += 1
    if (codePoint <= 0x7f) stats.ascii += 1
    if (isHanCodePoint(codePoint)) stats.han += 1
    if (isPrivateUseCodePoint(codePoint)) stats.privateUse += 1
    if (codePoint === 0xfffd) stats.replacement += 1
    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
      stats.control += 1
    }
  }
  return stats
}

function looksLikeHanUtf16LeWithoutNuls(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.length % 2 !== 0 || buffer.includes(0)) return false
  const utf16Text = new TextDecoder('utf-16le').decode(buffer)
  const utf8Text = new TextDecoder('utf-8').decode(buffer)
  const utf16 = textStats(utf16Text)
  const utf8 = textStats(utf8Text)
  if (utf16.total === 0 || utf16.han < 2) return false
  if (utf16.replacement > 0 || utf16.control > 0 || utf16.privateUse > 0) return false
  if (utf16.han / utf16.total < 0.6) return false
  if (utf8.replacement > 0) return true
  if (utf8.han > 0) return false
  return utf8.ascii > 0 && utf8.ascii < utf8.total
}

function chooseOutputEncoding(buffer: Buffer, final: boolean): OutputTextEncoding | null {
  if (startsWithUtf16LeBom(buffer) || looksLikeUtf16Le(buffer)) return 'utf-16le'
  if (startsWithUtf8Bom(buffer)) return 'utf-8'
  if (buffer.length >= 32 || final) return 'utf-8'
  return null
}

function stripKnownBom(buffer: Buffer, encoding: OutputTextEncoding): Buffer {
  if (encoding === 'utf-16le' && startsWithUtf16LeBom(buffer)) return buffer.subarray(2)
  if (encoding === 'utf-8' && startsWithUtf8Bom(buffer)) return buffer.subarray(3)
  return buffer
}

export class OutputAccumulator {
  private readonly maxLines: number
  private readonly maxBytes: number
  private readonly maxRollingBytes: number
  private readonly tempFilePrefix: string
  private decoder: TextDecoder | undefined
  private decodeBuffer = Buffer.alloc(0)

  private rawChunks: Buffer[] = []
  private tailText = ''
  private tailBytes = 0
  private tailStartsAtLineBoundary = true
  private totalRawBytes = 0
  private totalDecodedBytes = 0
  private completedLines = 0
  private totalLines = 0
  private currentLineBytes = 0
  private hasOpenLine = false
  private finished = false

  private tempFilePath: string | undefined
  private tempFileStream: WriteStream | undefined

  constructor(options: OutputAccumulatorOptions) {
    this.maxLines = options.maxLines
    this.maxBytes = options.maxBytes
    this.maxRollingBytes = Math.max(this.maxBytes * 2, 1)
    this.tempFilePrefix = options.tempFilePrefix
  }

  append(data: Buffer): void {
    if (this.finished) throw new Error('Cannot append to a finished output accumulator')
    this.totalRawBytes += data.length
    this.appendDecodedBytes(data, false)
    if (this.tempFileStream || this.shouldUseTempFile()) {
      this.ensureTempFile()
      this.tempFileStream?.write(data)
    } else if (data.length > 0) {
      this.rawChunks.push(data)
    }
  }

  finish(): void {
    if (this.finished) return
    this.finished = true
    this.appendDecodedBytes(Buffer.alloc(0), true)
    if (this.decoder) {
      this.appendDecodedText(this.decoder.decode())
    }
    if (this.shouldUseTempFile()) this.ensureTempFile()
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): OutputAccumulatorSnapshot {
    const tailTruncation = truncateTail(this.getSnapshotText(), {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes
    })
    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes
    const truncation: OutputAccumulatorTruncation = {
      ...tailTruncation,
      truncated,
      truncatedBy: truncated
        ? (tailTruncation.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? 'bytes' : 'lines'))
        : null,
      totalLines: this.totalLines,
      totalBytes: this.totalDecodedBytes,
      maxLines: this.maxLines,
      maxBytes: this.maxBytes
    }
    if (options.persistIfTruncated && truncation.truncated) this.ensureTempFile()
    return {
      content: truncation.content,
      truncation,
      fullOutputPath: this.tempFilePath
    }
  }

  async closeTempFile(): Promise<void> {
    if (!this.tempFileStream) return
    const stream = this.tempFileStream
    this.tempFileStream = undefined
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stream.off('finish', onFinish)
        reject(error)
      }
      const onFinish = () => {
        stream.off('error', onError)
        resolve()
      }
      stream.once('error', onError)
      stream.once('finish', onFinish)
      stream.end()
    })
  }

  getLastLineBytes(): number {
    return this.currentLineBytes
  }

  private appendDecodedText(text: string): void {
    if (text.length === 0) return
    const bytes = byteLength(text)
    this.totalDecodedBytes += bytes
    this.tailText += text
    this.tailBytes += bytes
    if (this.tailBytes > this.maxRollingBytes * 2) this.trimTail()

    let newlines = 0
    let lastNewline = -1
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
      newlines += 1
      lastNewline = index
    }
    if (newlines === 0) {
      this.currentLineBytes += bytes
      this.hasOpenLine = true
    } else {
      this.completedLines += newlines
      const tail = text.slice(lastNewline + 1)
      this.currentLineBytes = byteLength(tail)
      this.hasOpenLine = tail.length > 0
    }
    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0)
  }

  private appendDecodedBytes(data: Buffer, final: boolean): void {
    if (!this.decoder) {
      if (data.length > 0) this.decodeBuffer = Buffer.concat([this.decodeBuffer, data])
      const encoding = chooseOutputEncoding(this.decodeBuffer, final)
      if (!encoding) return
      this.decoder = new TextDecoder(encoding)
      const buffered = stripKnownBom(this.decodeBuffer, encoding)
      this.decodeBuffer = Buffer.alloc(0)
      this.appendDecodedText(this.decoder.decode(buffered, { stream: !final }))
      return
    }

    if (data.length > 0) {
      this.appendDecodedText(this.decoder.decode(data, { stream: true }))
    }
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, 'utf8')
    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length
      return
    }
    let start = buffer.length - this.maxRollingBytes
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
      start += 1
    }
    this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a
    this.tailText = buffer.subarray(start).toString('utf8')
    this.tailBytes = byteLength(this.tailText)
  }

  private getSnapshotText(): string {
    if (this.tailStartsAtLineBoundary) return this.tailText
    const firstNewline = this.tailText.indexOf('\n')
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1)
  }

  private shouldUseTempFile(): boolean {
    return (
      this.totalRawBytes > this.maxBytes ||
      this.totalDecodedBytes > this.maxBytes ||
      this.totalLines > this.maxLines
    )
  }

  private ensureTempFile(): void {
    if (this.tempFilePath) return
    this.tempFilePath = defaultTempFilePath(this.tempFilePrefix)
    this.tempFileStream = createWriteStream(this.tempFilePath)
    for (const chunk of this.rawChunks) {
      this.tempFileStream.write(chunk)
    }
    this.rawChunks = []
  }
}
