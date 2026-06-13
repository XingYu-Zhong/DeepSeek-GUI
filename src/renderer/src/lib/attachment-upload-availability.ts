export type AttachmentUploadAvailabilityInput = {
  runtimeConnection: string
  route: string
  mode: 'plan' | 'agent'
  attachmentStoreAvailable?: boolean
  modelSupportsImageInput?: boolean
  imageRecognitionAvailable?: boolean
  imageRecognitionEnabledAt?: string
  threadCreatedAt?: string
  firstUserMessageCreatedAt?: string
  now?: () => Date
}

export function isChatAttachmentUploadEnabled(input: AttachmentUploadAvailabilityInput): boolean {
  const baseAvailable =
    input.runtimeConnection === 'ready' &&
    (input.route === 'chat' || input.route === 'write') &&
    (input.mode === 'agent' || input.mode === 'plan') &&
    input.attachmentStoreAvailable === true
  if (!baseAvailable) return false
  if (input.modelSupportsImageInput === true) return true
  return (
    input.imageRecognitionAvailable === true &&
    isAfterImageRecognitionEnabled({
      enabledAt: input.imageRecognitionEnabledAt,
      threadCreatedAt: input.threadCreatedAt,
      firstUserMessageCreatedAt: input.firstUserMessageCreatedAt,
      now: input.now
    })
  )
}

function isAfterImageRecognitionEnabled(input: {
  enabledAt?: string
  threadCreatedAt?: string
  firstUserMessageCreatedAt?: string
  now?: () => Date
}): boolean {
  const enabledAt = parseTime(input.enabledAt)
  if (enabledAt === null) return false
  const candidate =
    parseTime(input.firstUserMessageCreatedAt) ??
    (input.now?.() ?? new Date()).getTime()
  return candidate >= enabledAt
}

function parseTime(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}
