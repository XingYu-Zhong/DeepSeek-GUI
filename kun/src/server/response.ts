export type JsonResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export function jsonResponse(body: unknown, status = 200): JsonResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  }
}
