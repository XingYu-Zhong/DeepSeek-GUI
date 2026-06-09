import { AttachmentUploadRequest } from '../../contracts/attachments.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

export async function uploadAttachment(
  store: AttachmentStore | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('attachment store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = AttachmentUploadRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.attachmentValidation('invalid attachment upload body', parsed.error.issues)
  try {
    const attachment = await store.create({
      name: parsed.data.name,
      mimeType: parsed.data.mimeType,
      data: Buffer.from(parsed.data.dataBase64, 'base64'),
      textFallback: parsed.data.textFallback,
      threadId: parsed.data.threadId,
      workspace: parsed.data.workspace
    })
    return jsonResponse({ attachment }, 201)
  } catch (error) {
    return ERRORS.attachmentValidation(errorMessage(error))
  }
}

export async function getAttachmentMetadata(
  store: AttachmentStore | undefined,
  id: string
): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('attachment store is unavailable')
  const attachment = await store.get(id)
  if (!attachment) return ERRORS.notFound(`attachment not found: ${id}`)
  return jsonResponse({ attachment })
}

export async function getAttachmentContent(
  store: AttachmentStore | undefined,
  id: string,
  request: Request
): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('attachment store is unavailable')
  const url = new URL(request.url)
  try {
    const attachment = await store.resolveContent(id, {
      threadId: url.searchParams.get('thread_id') ?? undefined,
      workspace: url.searchParams.get('workspace') ?? undefined
    })
    return jsonResponse({
      attachment: {
        ...attachment,
        data: undefined
      },
      dataBase64: attachment.data.toString('base64')
    })
  } catch (error) {
    const message = errorMessage(error)
    return /not authorized/i.test(message) ? ERRORS.forbidden(message) : ERRORS.notFound(message)
  }
}

export async function attachmentDiagnostics(
  store: AttachmentStore | undefined
): Promise<JsonResponse> {
  if (!store) {
    return jsonResponse({ enabled: false, rootDir: '', count: 0, totalBytes: 0 })
  }
  return jsonResponse(await store.diagnostics())
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
