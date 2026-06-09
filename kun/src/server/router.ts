import type { JsonResponse } from './response.js'

export type RouteContext = { params: Record<string, string> }
export type RouteHandler = (
  request: Request,
  context: RouteContext
) => Promise<Response | JsonResponse> | Response | JsonResponse

/**
 * Minimal router that supports `:param` placeholders. Routes are
 * registered with `(method, path, handler)` tuples and resolved in
 * registration order. The first matching route wins; this keeps
 * extension paths (`/v1/threads/:id/turns/:turnId`) explicit.
 */
export class Router {
  private readonly routes: Array<{
    method: string
    pattern: string
    segments: string[]
    handler: RouteHandler
  }> = []

  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      pattern: path,
      segments: path.split('/').filter(Boolean),
      handler
    })
  }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | undefined {
    const upperMethod = method.toUpperCase()
    const segments = path.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== upperMethod) continue
      if (route.segments.length !== segments.length) continue
      const params: Record<string, string> = {}
      let matches = true
      for (let i = 0; i < route.segments.length; i += 1) {
        const want = route.segments[i]
        const got = segments[i]
        if (want.startsWith(':')) {
          params[want.slice(1)] = decodeURIComponent(got)
        } else if (want !== got) {
          matches = false
          break
        }
      }
      if (matches) return { handler: route.handler, params }
    }
    return undefined
  }
}
