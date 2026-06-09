export function formatRelativeTime(input: string, locale: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return input
  }

  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const absSeconds = Math.abs(diffMs) / 1000
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (absSeconds < 60) {
    return formatter.format(Math.round(diffMs / 1000), 'second')
  }

  const absMinutes = absSeconds / 60
  if (absMinutes < 60) {
    return formatter.format(Math.round(diffMs / (60 * 1000)), 'minute')
  }

  const absHours = absMinutes / 60
  if (absHours < 24) {
    return formatter.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')
  }

  const absDays = absHours / 24
  if (absDays < 7) {
    return formatter.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), 'day')
  }

  if (absDays < 30) {
    return formatter.format(Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)), 'week')
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(date)
}
