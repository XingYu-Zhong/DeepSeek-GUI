import { z } from 'zod'

export const AttachmentTextFallback = z.object({
  dataBase64: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  wasCompressed: z.boolean().optional()
}).strict()
export type AttachmentTextFallback = z.infer<typeof AttachmentTextFallback>

export const AttachmentMetadata = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  hash: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  textFallback: AttachmentTextFallback.optional(),
  threadIds: z.array(z.string().min(1)).default([]),
  workspaces: z.array(z.string().min(1)).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type AttachmentMetadata = z.infer<typeof AttachmentMetadata>

export const AttachmentUploadRequest = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  dataBase64: z.string().min(1),
  textFallback: AttachmentTextFallback.optional(),
  threadId: z.string().min(1).optional(),
  workspace: z.string().min(1).optional()
}).strict()
export type AttachmentUploadRequest = z.infer<typeof AttachmentUploadRequest>

export const AttachmentUploadResponse = z.object({
  attachment: AttachmentMetadata
}).strict()
export type AttachmentUploadResponse = z.infer<typeof AttachmentUploadResponse>

export const AttachmentDiagnostics = z.object({
  enabled: z.boolean(),
  rootDir: z.string(),
  count: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative()
}).strict()
export type AttachmentDiagnostics = z.infer<typeof AttachmentDiagnostics>
