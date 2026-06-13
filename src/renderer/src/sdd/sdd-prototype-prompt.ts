import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'

export type SddPrototypeTurnOptions = {
  mode: 'text' | 'image'
  /** Selected requirement text (text mode). */
  text?: string
  /** Workspace-relative path the agent must write the prototype to. */
  prototypeRelativePath: string
  workspaceRoot: string
  /** write.selectionAssist.prototypePrompt; empty = built-in default. */
  customPrompt?: string
}

/**
 * Turn prompt for the SDD assistant agent: produce a single-file interactive
 * HTML prototype and save it to the exact reserved path with the file tools.
 * Mirrors the "Save exactly to the reserved plan file" contract the plan
 * flow uses — the editor pre-inserts a placeholder and polls that path.
 */
export function buildSddPrototypeTurnPrompt(options: SddPrototypeTurnOptions): string {
  const requirements = options.customPrompt?.trim() || WRITE_PROTOTYPE_DEFAULT_PROMPT
  const lines = [
    'Kun is asking you to build an interactive HTML prototype for an SDD requirement.',
    `Workspace: ${options.workspaceRoot}`,
    `Reserved prototype file: ${options.prototypeRelativePath}`,
    '',
    `Prototype requirements: ${requirements}`,
    '',
    'Hard rules:',
    `- Produce ONE complete standalone HTML document at \`${options.prototypeRelativePath}\`; create parent directories as needed.`,
    '- Build it INCREMENTALLY to stay inside your output limit: first `write` a small valid skeleton (doctype, head, empty body), then extend it with several `edit` calls. Keep every tool call payload under ~4000 characters — oversized tool arguments get truncated and fail.',
    '- Do not create or modify any other file during this turn.',
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of the interactions you implemented.'
  ]
  if (options.mode === 'image') {
    lines.push(
      '',
      'The attached image is the visual specification (a design mockup).',
      'Reproduce its layout, colors and typography as faithfully as possible, and make the implied interactions work.'
    )
  }
  const text = options.text?.trim()
  if (text) {
    lines.push('', 'Requirement:', text.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  }
  return lines.join('\n')
}
