export const DEFAULT_DEV_PREVIEW_URL = 'http://127.0.0.1:5173/'

function stripIpv6Brackets(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    return Number(part)
  })
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null
  }
  return octets
}

export function isAllowedDevPreviewHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname)
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'host.docker.internal' ||
    host.endsWith('.local') ||
    host === '::1'
  ) {
    return true
  }

  const octets = parseIpv4(host)
  if (!octets) return false

  const [a, b] = octets
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

export function normalizeDevPreviewUrlInput(input: string): string | null {
  let value = input.trim()
  if (!value) return null

  if (/^\d{2,5}$/.test(value)) {
    value = `http://127.0.0.1:${value}`
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = stripIpv6Brackets(url.hostname)
  if (host === '0.0.0.0' || host === '::') {
    url.hostname = '127.0.0.1'
  }

  if (!isAllowedDevPreviewHostname(url.hostname)) return null
  if (!url.pathname) url.pathname = '/'
  return url.toString()
}

export function isAllowedDevPreviewUrl(value: string): boolean {
  return normalizeDevPreviewUrlInput(value) !== null
}
