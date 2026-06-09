export type SshAuthMethodV1 = 'agent' | 'password' | 'identityFile'

export type SshConnectionV1 = {
  id: string
  name: string
  host: string
  user: string
  port: number
  authMethod: SshAuthMethodV1
  password: string
  identityFile: string
  passphrase: string
  remotePath: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ConnectionsSettingsV1 = {
  ssh: SshConnectionV1[]
}

export type ConnectionsSettingsPatchV1 = {
  ssh?: Array<Partial<SshConnectionV1>>
}

const DEFAULT_SSH_PORT = 22
const MAX_SSH_CONNECTIONS = 64

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizePort(value: unknown): number {
  const port = Number(value)
  if (!Number.isFinite(port)) return DEFAULT_SSH_PORT
  return Math.max(1, Math.min(65_535, Math.round(port)))
}

function normalizeAuthMethod(value: unknown): SshAuthMethodV1 {
  return value === 'password' || value === 'identityFile' ? value : 'agent'
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback
}

export function defaultConnectionsSettings(): ConnectionsSettingsV1 {
  return { ssh: [] }
}

export function normalizeSshConnection(
  input: Partial<SshConnectionV1> | undefined,
  index: number,
  now = new Date().toISOString()
): SshConnectionV1 {
  const id = cleanString(input?.id, 128) || `ssh-${index + 1}`
  const host = cleanString(input?.host, 512)
  const name = cleanString(input?.name, 120) || host || `SSH ${index + 1}`
  return {
    id,
    name,
    host,
    user: cleanString(input?.user, 512),
    port: normalizePort(input?.port),
    authMethod: normalizeAuthMethod(input?.authMethod),
    password: cleanString(input?.password, 8_192),
    identityFile: cleanString(input?.identityFile, 4_096),
    passphrase: cleanString(input?.passphrase, 8_192),
    remotePath: cleanString(input?.remotePath, 4_096),
    enabled: input?.enabled !== false,
    createdAt: normalizeTimestamp(input?.createdAt, now),
    updatedAt: normalizeTimestamp(input?.updatedAt, now)
  }
}

export function normalizeConnectionsSettings(
  input: ConnectionsSettingsPatchV1 | undefined
): ConnectionsSettingsV1 {
  const source = Array.isArray(input?.ssh) ? input.ssh : []
  const now = new Date().toISOString()
  return {
    ssh: source
      .slice(0, MAX_SSH_CONNECTIONS)
      .map((connection, index) => normalizeSshConnection(connection, index, now))
  }
}

export function mergeConnectionsSettings(
  current: ConnectionsSettingsV1,
  patch: ConnectionsSettingsPatchV1 | undefined
): ConnectionsSettingsV1 {
  if (!patch) return normalizeConnectionsSettings(current)
  return normalizeConnectionsSettings({
    ...current,
    ...patch,
    ssh: patch.ssh ?? current.ssh
  })
}
