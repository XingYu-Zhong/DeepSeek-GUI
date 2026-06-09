export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired'

/**
 * A pending approval request surfaced by the loop. The runtime stores
 * approval records so that an SSE subscriber can replay the request to
 * late joiners and so the HTTP approval endpoint can look the record
 * up by id.
 */
export type ApprovalRequest = {
  id: string
  threadId: string
  turnId: string
  toolName: string
  summary: string
  status: ApprovalStatus
  createdAt: string
  decidedAt?: string
  reason?: string
}

export function createApprovalRequest(input: {
  id: string
  threadId: string
  turnId: string
  toolName: string
  summary: string
  createdAt?: string
}): ApprovalRequest {
  return {
    id: input.id,
    threadId: input.threadId,
    turnId: input.turnId,
    toolName: input.toolName,
    summary: input.summary,
    status: 'pending',
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

export function resolveApprovalRequest(
  request: ApprovalRequest,
  decision: 'allow' | 'deny',
  reason?: string,
  decidedAt?: string
): ApprovalRequest {
  return {
    ...request,
    status: decision === 'allow' ? 'allowed' : 'denied',
    reason,
    decidedAt: decidedAt ?? new Date().toISOString()
  }
}

export function expireApprovalRequest(
  request: ApprovalRequest,
  decidedAt?: string
): ApprovalRequest {
  return {
    ...request,
    status: 'expired',
    decidedAt: decidedAt ?? new Date().toISOString()
  }
}
