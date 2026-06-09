import { z } from 'zod'

export const ApprovalDecisionRequest = z.object({
  decision: z.enum(['allow', 'deny']),
  /** Optional human-readable reason stored alongside the resolution. */
  reason: z.string().optional()
})
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>

export const ApprovalDecisionResponse = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  status: z.enum(['allowed', 'denied', 'expired'])
})
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponse>
