import { z } from 'zod'
import { ApprovalPolicySchema, SandboxModeSchema } from './policy.js'
import { RuntimeCapabilityManifest } from './capabilities.js'

export const RuntimeInfoResponse = z
  .object({
    host: z.string(),
    port: z.number().int().min(0).max(65_535),
    dataDir: z.string().min(1),
    configPath: z.string().optional(),
    model: z.string().optional(),
    approvalPolicy: ApprovalPolicySchema.optional(),
    sandboxMode: SandboxModeSchema.optional(),
    tokenEconomyMode: z.boolean().optional(),
    insecure: z.boolean().optional(),
    startedAt: z.string(),
    pid: z.number().int().positive().optional(),
    capabilities: RuntimeCapabilityManifest
  })
  .strict()
export type RuntimeInfoResponse = z.infer<typeof RuntimeInfoResponse>
