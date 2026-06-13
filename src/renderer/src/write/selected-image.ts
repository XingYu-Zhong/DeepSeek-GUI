import { isHtmlEmbedSrc } from '@shared/write-prototype'
import { isExplicitWriteResourceUrl } from '@shared/write-markdown-resource'
import { parsePendingInfographicId } from './infographic-pending'

/**
 * Helpers for the image-selection toolbar: detect when the user has a single
 * plain raster image selected (TipTap node selection / caret on an image
 * markdown line in source mode) so image-aware assists can target it.
 */

/** Parse a line that consists solely of image markdown. */
export function parseImageMarkdownLine(line: string): { alt: string; src: string } | null {
  const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)$/.exec(line.trim())
  if (!match) return null
  return { alt: match[1] || '', src: (match[2] ?? match[3] ?? '').trim() }
}

/** Local raster images only: pending placeholders, HTML embeds and external
 * URLs cannot be turned into prototypes. */
export function isSelectableRasterImageSrc(src: string | undefined): boolean {
  if (!src?.trim()) return false
  const value = src.trim()
  if (parsePendingInfographicId(value) !== null) return false
  if (isHtmlEmbedSrc(value)) return false
  if (isExplicitWriteResourceUrl(value) || value.startsWith('#')) return false
  return true
}
