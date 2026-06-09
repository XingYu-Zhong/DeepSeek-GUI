export function parseUsageResponse<T>(body: string, label: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`${label} response was not valid JSON`)
  }
}
