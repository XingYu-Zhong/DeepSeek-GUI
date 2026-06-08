/**
 * Shared Markdown sanitization policy for the renderer and the main-process
 * export pipeline.
 *
 * ## Threat model
 *
 * Markdown content fed into React components and into the export pipeline
 * ultimately comes from one of three places:
 *
 *   1. **The user typing in the chat composer.** Treated as trusted; not
 *      itself an injection vector, but the user can paste hostile Markdown.
 *   2. **The LLM streaming assistant / reasoning / tool output.** Treated
 *      as **untrusted**: a prompt-injected or otherwise compromised
 *      runtime can emit `<img onerror=...>` payloads.
 *   3. **Files on the user's local workspace** (Write mode preview, exported
 *      docs). Treated as trusted-by-user, but a hostile file that the user
 *      opens should not be able to escape the file:// boundary.
 *
 * Two layers of protection, applied in this order:
 *
 *  - `rehype-harden` — validates and rewrites `href` / `src` URL schemes
 *    against an origin allow-list, then a protocol allow-list. Blocks
 *    `javascript:`, `data:`, `file:`, `vbscript:` unconditionally
 *    (hard-coded in the library).
 *  - `rehype-sanitize` — drops elements / attributes not in the GitHub
 *    schema, including `<script>`, `<iframe>`, `<object>`, `<embed>`,
 *    `<style>`, `<form>`, `onerror` / `onload` / `onclick` / etc.
 *
 * ## Why three exports, not one
 *
 * `rehype-harden` blocks `file:` URLs unconditionally. Write-mode previews
 * need `file://` URIs in `<img src>` so the renderer can resolve them
 * against the workspace root via the `ResolvedMarkdownImage` IPC path.
 * Adding `rehype-harden` to that pipeline would strip every local image.
 * We therefore expose:
 *
 *   - `safeRehypePluginsForMain` — harden + sanitize. Used by
 *     `write-export-service.ts` for server-side rendering. `file://` is
 *     never needed there (the rendered HTML is for human consumption in
 *     a browser, not for re-loading through the app).
 *   - `safeRehypePluginsForChatBubble` — harden + sanitize. Used by
 *     chat-bubble and reasoning components that render LLM output. No
 *     `file://` URIs are expected.
 *   - `safeSanitizeOnlyForRenderer` — sanitize only. Used by
 *     `WriteMarkdownPreview`, which needs `file://` URIs preserved so the
 *     custom `ResolvedMarkdownImage` resolver can hand them to the
 *     workspace-image IPC. Security at this site is enforced by
 *     (a) the IPC handler validating the path is inside the workspace
 *     root, (b) the `onClick` guard in the `<a>` component
 *     (`isSafeExternalHref`).
 */

import { harden } from 'rehype-harden'
import { defaultSchema } from 'hast-util-sanitize'
import rehypeSanitize from 'rehype-sanitize'
import type { Schema } from 'hast-util-sanitize'
import type { PluggableList, Pluggable } from 'unified'

export { isSafeExternalHref } from './markdown-sanitize-href'

/**
 * Hardening policy for the renderer + main-process export pipelines.
 *
 * `rehype-harden` checks each candidate URL twice:
 *
 *   1. Protocol: only `https:`, `http:`, `irc:`, `ircs:`, `mailto:`,
 *      `xmpp:`, `blob:` are allowed by the library's built-in
 *      `safeProtocols` set; `javascript:`, `data:`, `file:`, `vbscript:`
 *      are blocked unconditionally.
 *   2. Prefix: for `http(s):` URLs, the URL's origin must match one of
 *      `allowedLinkPrefixes` (or the list must contain the wildcard
 *      `'*'`). Relative URLs (resolved against `defaultOrigin`) are
 *      only allowed when they match a prefix on the configured origin.
 *
 * Using `'*'` as the only prefix is the simplest "allow any external
 * HTTPS link" policy. The onClick guard in each custom `<a>` component
 * (see `isSafeExternalHref` in `markdown-sanitize-href.ts`) is the
 * second layer of defence in case the plugin order is ever changed.
 */
export const defaultHardenOptions = {
  defaultOrigin: 'https://deepseek-gui.local',
  allowedLinkPrefixes: ['*'] as const,
  allowedImagePrefixes: ['*'] as const,
  allowDataImages: true
}

/**
 * Sanitize schema extends GitHub's default with `className` allowance on
 * `<code>` and `<span>` for Shiki syntax highlighting language tags.
 * The `attributes` map is deep-merged into the default rather than
 * replacing it, so any new GH-allowed tag retains its baseline.
 */
export const defaultSanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^language-./]]
  }
}

const hardenPlugin: Pluggable = [harden, defaultHardenOptions]
const sanitizePlugin: Pluggable = [rehypeSanitize, defaultSanitizeSchema]

/**
 * Plugin list for **main-process** server-side rendering in
 * `write-export-service.ts`. Contains no renderer-only plugins.
 */
export const safeRehypePluginsForMain: PluggableList = [hardenPlugin, sanitizePlugin]

/**
 * Plugin list for **renderer** chat-bubble components (assistant
 * messages, reasoning blocks, side-conversation messages). Blocks
 * `file://` URIs (intentional — chat content does not have any).
 */
export const safeRehypePluginsForChatBubble: PluggableList = [
  hardenPlugin,
  sanitizePlugin
]

/**
 * Plugin list for **renderer** components that render Markdown where
 * `file://` URIs are valid (Write mode preview). Hardening is omitted
 * because `rehype-harden` unconditionally blocks `file:` URIs, which
 * would break local image previews. Sanitization is sufficient here
 * because the IPC handler (`readWorkspaceImage`) validates that the
 * requested file is inside the workspace root before serving it.
 */
export const safeSanitizeOnlyForRenderer: PluggableList = [sanitizePlugin]
