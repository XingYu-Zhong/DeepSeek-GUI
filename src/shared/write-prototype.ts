import { isExplicitWriteResourceUrl } from './write-markdown-resource'

export const WRITE_PROTOTYPE_MAX_TEXT_CHARS = 6_000

/**
 * Default requirements for interactive prototype generation. Users can
 * override them via write.selectionAssist.prototypePrompt; the SDD assistant
 * turn prompt (sdd-prototype-prompt.ts) embeds them either way.
 */
export const WRITE_PROTOTYPE_DEFAULT_PROMPT = [
  'Build a single-file interactive HTML prototype for the product requirement.',
  'All CSS and JavaScript must be inline in the document; never reference local files.',
  'Make the prototype clickable and stateful where the requirement implies interaction (tabs, forms, lists, dialogs).',
  'Use a clean modern flat design with a light background, and keep every piece of interface text in the same language as the requirement.',
  'The page must render correctly inside a 480px-tall embedded frame and scale to wider viewports.'
].join(' ')

/** Whether an image src points at a local HTML document to embed inline. */
export function isHtmlEmbedSrc(src: string | undefined): boolean {
  if (!src) return false
  const value = src.trim()
  if (!value || isExplicitWriteResourceUrl(value) || value.startsWith('#')) return false
  if (/[?#]/.test(value)) return false
  return /\.html?$/i.test(value)
}
