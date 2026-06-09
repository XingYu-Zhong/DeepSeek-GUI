import type { Router } from './router.js'
import type { JsonResponse } from './response.js'
import { jsonResponse } from './response.js'

export type HttpServerOptions = {
  router: Router
}

function toResponse(response: Response | JsonResponse): Response {
  if (response instanceof Response) return response
  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
}

export async function dispatchRequest(router: Router, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const match = router.match(request.method, url.pathname)
  if (!match) {
    return toResponse(jsonResponse(
      { code: 'not_found', message: 'route not found' },
      404
    ))
  }
  return toResponse(await match.handler(request, { params: match.params }))
}
