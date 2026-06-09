import { z } from 'zod'

export const APPROVAL_POLICIES = [
  'on-request',
  'untrusted',
  'never',
  'auto',
  'suggest'
] as const
export const DEFAULT_APPROVAL_POLICY = 'auto'

export const ApprovalPolicySchema = z.enum(APPROVAL_POLICIES)
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export const SANDBOX_MODES = [
  'read-only',
  'workspace-write',
  'danger-full-access',
  'external-sandbox'
 ] as const
export const DEFAULT_SANDBOX_MODE = 'workspace-write'

export const SandboxModeSchema = z.enum(SANDBOX_MODES)
export type SandboxMode = z.infer<typeof SandboxModeSchema>
