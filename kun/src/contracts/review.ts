import { z } from 'zod'

export const ReviewLineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive()
})
export type ReviewLineRange = z.infer<typeof ReviewLineRangeSchema>

export const ReviewCodeLocationSchema = z.object({
  absoluteFilePath: z.string().min(1),
  lineRange: ReviewLineRangeSchema
})
export type ReviewCodeLocation = z.infer<typeof ReviewCodeLocationSchema>

export const ReviewFindingSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  confidenceScore: z.number().min(0).max(1),
  priority: z.number().int().min(0).max(3),
  codeLocation: ReviewCodeLocationSchema
})
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>

export const ReviewOutputSchema = z.object({
  findings: z.array(ReviewFindingSchema).default([]),
  overallCorrectness: z.enum(['patch is correct', 'patch is incorrect']),
  overallExplanation: z.string(),
  overallConfidenceScore: z.number().min(0).max(1)
})
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>

export const ReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('uncommittedChanges')
  }),
  z.object({
    kind: z.literal('baseBranch'),
    branch: z.string().trim().min(1)
  }),
  z.object({
    kind: z.literal('commit'),
    sha: z.string().trim().min(1)
  }),
  z.object({
    kind: z.literal('custom'),
    instructions: z.string().trim().min(1)
  })
])
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>

export const StartReviewRequest = z.object({
  target: ReviewTargetSchema,
  model: z.string().trim().min(1).optional()
})
export type StartReviewRequest = z.infer<typeof StartReviewRequest>

export const StartReviewResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  userMessageItemId: z.string().min(1),
  reviewItemId: z.string().min(1)
})
export type StartReviewResponse = z.infer<typeof StartReviewResponse>

export function reviewTargetTitle(target: ReviewTarget): string {
  switch (target.kind) {
    case 'uncommittedChanges':
      return 'Review current changes'
    case 'baseBranch':
      return `Review changes against ${target.branch}`
    case 'commit':
      return `Review commit ${target.sha.slice(0, 12)}`
    case 'custom':
      return 'Custom code review'
  }
}

export function reviewTargetPrompt(target: ReviewTarget): string {
  switch (target.kind) {
    case 'uncommittedChanges':
      return '/review'
    case 'baseBranch':
      return `/review base ${target.branch}`
    case 'commit':
      return `/review commit ${target.sha}`
    case 'custom':
      return `/review ${target.instructions}`
  }
}
