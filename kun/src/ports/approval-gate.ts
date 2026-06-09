import type { ApprovalRequest } from '../domain/approval.js'

/**
 * Port for the approval flow used by tool execution. The local gate
 * is the in-process registry; a remote gate could integrate with an
 * external service. The loop awaits a `decide` resolution before
 * proceeding with a tool call.
 */
export interface ApprovalGate {
  request(approval: ApprovalRequest): Promise<'allow' | 'deny'>
  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean
  pending(threadId?: string): ApprovalRequest[]
  get(approvalId: string): ApprovalRequest | undefined
}
