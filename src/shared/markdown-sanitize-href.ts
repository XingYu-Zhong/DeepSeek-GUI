/**
 * URL allow-list helpers shared between Markdown rendering components (renderer)
 * and the main-process export service. Centralised here so that the renderer
 * `<a>` onClick guards, the `StreamdownLink` click handler, and the post-sanitize
 * hardening for exported HTML all use the same definition of "safe".
 *
 * Background: `rehype-harden` rewrites `href` / `src` values to a safe origin,
 * but we still want a second-layer guard at the React `onClick` boundary in case
 * a custom component receives a raw `href` that was not processed by harden
 * (e.g. when a future refactor changes the plugin order).
 */

/**
 * Detects whether a value looks like an absolute URL with a scheme we trust.
 * Relative URLs (`/foo`, `./bar`, `../baz`, bare strings) are explicitly
 * rejected — they should be handled by the application router, not passed
 * to `window.open` / `openExternal`.
 */
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function isSafeExternalHref(href: string | undefined | null): href is string {
  if (!href) return false
  // Reject relative paths explicitly: '/foo', './bar', '../baz', 'foo/bar'
  if (
    href.startsWith('/') ||
    href.startsWith('./') ||
    href.startsWith('../') ||
    href.startsWith('#') ||
    !ABSOLUTE_URL_PATTERN.test(href)
  ) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return false
  }
  return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)
}
