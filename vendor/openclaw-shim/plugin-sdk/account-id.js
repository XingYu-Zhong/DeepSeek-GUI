const DEFAULT_ACCOUNT_ID = 'default'
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g

function isBlockedObjectKey(value) {
  return value === '__proto__' || value === 'prototype' || value === 'constructor'
}

export function normalizeAccountId(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return DEFAULT_ACCOUNT_ID
  const lowered = trimmed.toLowerCase()
  const normalized = VALID_ID_RE.test(trimmed)
    ? lowered
    : lowered.replace(INVALID_CHARS_RE, '-').replace(/^-+/, '').replace(/-+$/, '').slice(0, 64)
  return normalized && !isBlockedObjectKey(normalized) ? normalized : DEFAULT_ACCOUNT_ID
}

export function normalizeOptionalAccountId(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return undefined
  const normalized = normalizeAccountId(trimmed)
  return normalized === DEFAULT_ACCOUNT_ID && trimmed.toLowerCase() !== DEFAULT_ACCOUNT_ID
    ? undefined
    : normalized
}

export { DEFAULT_ACCOUNT_ID }
