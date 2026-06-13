export const WRITE_INFOGRAPHIC_MAX_TEXT_CHARS = 6_000

/**
 * Default prompt prefix for infographic generation. Users can override it via
 * write.selectionAssist.infographicPrompt; the selected text is appended after
 * the prefix either way.
 */
export const WRITE_INFOGRAPHIC_DEFAULT_PROMPT = [
  'Create a polished infographic poster from the source content below.',
  'Goal: produce a finished information graphic, not a photo of devices, not an app screenshot.',
  'Composition: portrait canvas, light background, clear headline at the top, 3-5 grouped sections, simple icons, compact charts or cards, generous spacing.',
  'Text: use the source language, keep labels short and readable, summarize instead of copying long paragraphs, avoid tiny unreadable text.',
  'Style: modern editorial vector design, restrained accent colors, crisp lines, high contrast, clean typography.',
  'Source content:'
].join('\n')

/**
 * Default prompt prefix for UI design mockup generation. Users can override
 * it via write.selectionAssist.designDraftPrompt.
 */
export const WRITE_DESIGN_DRAFT_DEFAULT_PROMPT = [
  'Create a high-fidelity UI design mockup from the product requirement below.',
  'Goal: render the actual app screen or webpage, not a lifestyle photo, not a device-on-desk scene.',
  'Canvas: desktop web unless the requirement clearly says mobile; use a flat front-facing screen with no angled phone or tablet mockups.',
  'Layout: realistic navigation, hero or main content, cards, forms, charts, or lists where appropriate, polished spacing, consistent component states.',
  'Text: use the source language, keep UI labels concise and readable, avoid tiny paragraphs and fake unreadable filler.',
  'Style: modern product UI, light theme, restrained palette, crisp typography, high contrast.',
  'Requirement:'
].join('\n')

export type WriteInfographicKind = 'infographic' | 'design'

export type WriteInfographicRequest = {
  /** Selected document text the infographic should summarize. */
  text: string
  /** Absolute path of the markdown document that will embed the image. */
  filePath: string
  /** Active write workspace root; the image is saved to its img/ folder. */
  workspaceRoot: string
  /**
   * Workspace-relative directory the image is written to (default 'img').
   * The SDD draft editor passes the requirement unit's img directory.
   */
  imageDir?: string
  /** Image flavor: summary infographic (default) or UI design mockup. */
  kind?: WriteInfographicKind
  /** Optional local reference image for image-to-image design generation. */
  referenceImagePath?: string
}

export type WriteInfographicResult =
  | {
      ok: true
      /** Path relative to the document directory, ready for a markdown image link. */
      relativePath: string
      absolutePath: string
      fileName: string
    }
  | {
      ok: false
      message: string
    }
