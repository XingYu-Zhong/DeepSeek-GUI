import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'ssh2'
import type { ConnectConfig, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import type { SshConnectionV1 } from '../../shared/app-settings'
import type {
  SshConnectionTestPayload,
  SshConnectionTestResult
} from '../../shared/ds-gui-api'

type SshExecStream = {
  stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'close', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

export type SshClientLike = {
  connect(config: ConnectConfig): void
  end(): void
  exec(command: string, callback: (error: Error | undefined, stream: SshExecStream) => void): unknown
  sftp(callback: (error: Error | undefined, value: SFTPWrapper) => void): unknown
  once(event: string, listener: (...args: any[]) => void): unknown
  on(event: string, listener: (...args: any[]) => void): unknown
}
export type SshClientFactory = () => SshClientLike

export type SshFileOperationRequest =
  | { op: 'stat'; root: string; path: string }
  | { op: 'list'; root: string; path: string }
  | { op: 'readText'; root: string; path: string; maxBytes: number }
  | { op: 'readBinary'; root: string; path: string; maxBytes: number }
  | { op: 'writeText'; root: string; path: string; content: string }
  | { op: 'writeBinary'; root: string; path: string; dataBase64: string }
  | { op: 'createFile'; root: string; path: string; content?: string }
  | { op: 'createDirectory'; root: string; path: string }
  | { op: 'rename'; root: string; path: string; newName: string }
  | { op: 'delete'; root: string; path: string }

export type SshFileOperationResult =
  | {
      ok: true
      path: string
      root?: string
      type?: 'file' | 'directory'
      size?: number
      entries?: Array<{ name: string; path: string; type: 'file' | 'directory' }>
      content?: string
      dataBase64?: string
      truncated?: boolean
      previousPath?: string
    }
  | { ok: false; message: string }

const SSH_TIMEOUT_MS = 12_000
const SSH_FILE_TIMEOUT_MS = 20_000

function hasUnsafeTargetPart(value: string): boolean {
  if (value.startsWith('-')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 32 || code === 127) return true
  }
  return false
}

function normalizeHost(value: string): string {
  const host = value.trim()
  if (!host) throw new Error('SSH host is required.')
  if (hasUnsafeTargetPart(host)) throw new Error('SSH host contains unsupported characters.')
  return host
}

function normalizeUser(value: string | undefined): string {
  const user = value?.trim() ?? ''
  if (user && (hasUnsafeTargetPart(user) || user.includes('@'))) {
    throw new Error('SSH user contains unsupported characters.')
  }
  return user
}

function normalizePortValue(value: unknown): number {
  const port = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : 22
  if (port < 1 || port > 65_535) throw new Error('SSH port must be between 1 and 65535.')
  return port
}

export function normalizeSshConnectionTarget(
  payload: SshConnectionTestPayload
): { host: string; username: string; port: number } {
  return {
    host: normalizeHost(payload.host),
    username: normalizeUser(payload.user),
    port: normalizePortValue(payload.port)
  }
}

async function readIdentityFile(payload: SshConnectionTestPayload): Promise<string | undefined> {
  if (payload.authMethod !== 'identityFile') return undefined
  const identityFile = payload.identityFile?.trim()
  if (!identityFile) throw new Error('SSH identity file path is required.')
  return readFile(identityFile, 'utf8')
}

export async function buildSshConnectConfig(
  payload: SshConnectionTestPayload
): Promise<ConnectConfig> {
  const target = normalizeSshConnectionTarget(payload)
  const password = payload.password?.trim() ?? ''
  const privateKey = await readIdentityFile(payload)
  const agent = process.env.SSH_AUTH_SOCK?.trim() || (process.platform === 'win32' ? 'pageant' : '')
  const config: ConnectConfig = {
    host: target.host,
    port: target.port,
    readyTimeout: SSH_TIMEOUT_MS,
    keepaliveInterval: 5_000,
    keepaliveCountMax: 2,
    ...(target.username ? { username: target.username } : {})
  }

  if (payload.authMethod === 'password') {
    if (!password) throw new Error('SSH password is required.')
    return {
      ...config,
      password,
      tryKeyboard: true
    }
  }

  if (payload.authMethod === 'identityFile') {
    return {
      ...config,
      privateKey,
      ...(payload.passphrase?.trim() ? { passphrase: payload.passphrase } : {})
    }
  }

  return agent ? { ...config, agent } : config
}

function formatSshError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/All configured authentication methods failed/i.test(message)) {
    return 'SSH authentication failed.'
  }
  if (/Timed out while waiting for handshake|readyTimeout/i.test(message)) {
    return 'SSH connection timed out.'
  }
  return message
}

async function connectSshClient(
  payload: SshConnectionTestPayload,
  createClient: SshClientFactory = () => new Client()
): Promise<SshClientLike> {
  const config = await buildSshConnectConfig(payload)
  const password = payload.password ?? ''
  const client = createClient()
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        client.end()
      } catch {
        /* noop */
      }
      reject(new Error('SSH connection timed out.'))
    }, SSH_TIMEOUT_MS)

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    client.once('ready', () => finish(() => resolve(client)))
    client.once('error', (error) => finish(() => reject(error)))
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, done) => {
      done(prompts.map(() => password))
    })
    try {
      client.connect(config)
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

function execSsh(client: SshClientLike, command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let exitCode: number | null = null
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('SSH command timed out.'))
    }, timeoutMs)

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      if (exitCode !== null && exitCode !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `SSH command exited with code ${exitCode}.`))
        return
      }
      resolve(stdout.trim())
    }

    client.exec(command, (error, stream) => {
      if (error) {
        finish(error)
        return
      }
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      stream.once('exit', (code) => {
        exitCode = code
      })
      stream.once('close', () => finish())
      stream.once('error', finish)
    })
  })
}

export async function testSshConnection(
  payload: SshConnectionTestPayload,
  createClient: SshClientFactory = () => new Client()
): Promise<SshConnectionTestResult> {
  let client: SshClientLike | null = null
  try {
    client = await connectSshClient(payload, createClient)
    const remotePath = payload.remotePath?.trim() ?? ''
    const pwd = await execSsh(
      client,
      remotePath ? `cd ${quoteRemoteShellPath(remotePath)} && pwd` : 'pwd',
      SSH_TIMEOUT_MS
    )
    return {
      ok: true,
      message: pwd ? `SSH connection succeeded: ${pwd}` : 'SSH connection succeeded.'
    }
  } catch (error) {
    return { ok: false, message: formatSshError(error) }
  } finally {
    client?.end()
  }
}

function quoteRemoteShellPath(value: string): string {
  const escaped = value.replace(/'/g, "'\\''")
  return `'${escaped}'`
}

function sftpAsync<T>(
  call: (callback: (error: Error | undefined, value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    call((error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
}

function sftpVoid(
  call: (callback: (error?: Error | null) => void) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    call((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function pathParts(value: string): string[] {
  return value.split('/').filter(Boolean)
}

function normalizeRemotePath(value: string): string {
  const raw = value.trim().replace(/\0/g, '').replaceAll('\\', '/')
  if (!raw) return ''
  const absolute = raw.startsWith('/')
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) {
        parts.pop()
        continue
      }
      if (!absolute) parts.push(part)
      continue
    }
    parts.push(part)
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || (absolute ? '/' : '')
}

function dirnameRemote(path: string): string {
  const normalized = normalizeRemotePath(path)
  if (!normalized || normalized === '/') return '/'
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return '.'
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

function joinRemotePath(base: string, next: string): string {
  const normalizedNext = normalizeRemotePath(next)
  if (!normalizedNext) return normalizeRemotePath(base)
  if (normalizedNext.startsWith('/') || normalizedNext.startsWith('~')) return normalizedNext
  const normalizedBase = normalizeRemotePath(base)
  if (!normalizedBase || normalizedBase === '/') return `/${normalizedNext}`
  return `${normalizedBase.replace(/\/+$/, '')}/${normalizedNext}`
}

function isWithinRemoteRoot(root: string, target: string): boolean {
  const rootParts = pathParts(root)
  const targetParts = pathParts(target)
  if (rootParts.length > targetParts.length) return false
  return rootParts.every((part, index) => part === targetParts[index])
}

function entryType(stats: Stats): 'file' | 'directory' {
  return stats.isDirectory() ? 'directory' : 'file'
}

async function realpathOrNormalized(sftp: SFTPWrapper, path: string): Promise<string> {
  try {
    return await sftpAsync<string>((callback) => sftp.realpath(path, callback))
  } catch {
    return normalizeRemotePath(path)
  }
}

async function expandRemotePath(sftp: SFTPWrapper, path: string): Promise<string> {
  if (path.trim().startsWith('~')) {
    try {
      return await sftpAsync<string>((callback) => sftp.ext_openssh_expandPath(path, callback))
    } catch {
      /* fall through to realpath */
    }
  }
  return realpathOrNormalized(sftp, path)
}

async function resolveRemoteRoot(sftp: SFTPWrapper, root: string): Promise<string> {
  const expanded = await expandRemotePath(sftp, root.trim() || '.')
  const stats = await sftpAsync<Stats>((callback) => sftp.stat(expanded, callback))
  if (!stats.isDirectory()) throw new Error('Remote workspace root is not a directory.')
  return expanded
}

async function resolveRemoteTarget(sftp: SFTPWrapper, root: string, rawPath: string): Promise<string> {
  const requested = rawPath.trim()
  const candidate = requested
    ? requested.startsWith('~')
      ? await expandRemotePath(sftp, requested)
      : joinRemotePath(root, requested)
    : root
  try {
    const real = await realpathOrNormalized(sftp, candidate)
    if (!isWithinRemoteRoot(root, real)) {
      throw new Error('Path must stay within the selected SSH workspace.')
    }
    return real
  } catch (error) {
    if (error instanceof Error && error.message.includes('within the selected SSH workspace')) throw error
    const parent = await realpathOrNormalized(sftp, dirnameRemote(candidate))
    const target = normalizeRemotePath(joinRemotePath(parent, basename(candidate)))
    if (!isWithinRemoteRoot(root, target)) {
      throw new Error('Path must stay within the selected SSH workspace.')
    }
    return target
  }
}

async function readRemoteBytes(sftp: SFTPWrapper, path: string, maxBytes: number): Promise<Buffer> {
  const tmpDir = join(tmpdir(), `deepseek-gui-ssh-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
  const localPath = join(tmpDir, 'file')
  try {
    await sftpVoid((callback) => sftp.fastGet(path, localPath, callback))
    const bytes = await readFile(localPath)
    return bytes.subarray(0, Math.min(bytes.length, maxBytes))
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function writeRemoteBytes(sftp: SFTPWrapper, path: string, bytes: Buffer, mode: 'w' | 'wx'): Promise<void> {
  const tmpDir = join(tmpdir(), `deepseek-gui-ssh-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
  const localPath = join(tmpDir, 'file')
  try {
    await writeFile(localPath, bytes)
    if (mode === 'wx') {
      await sftpVoid((callback) => sftp.open(path, 'wx', (error, handle) => {
        if (error) {
          callback(error)
          return
        }
        sftp.close(handle, (closeError) => {
          if (closeError) callback(closeError)
          else callback()
        })
      }))
    }
    await sftpVoid((callback) => sftp.fastPut(localPath, path, callback))
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function ensureRemoteParent(sftp: SFTPWrapper, root: string, path: string): Promise<void> {
  const parent = dirnameRemote(path)
  if (!isWithinRemoteRoot(root, parent)) {
    throw new Error('Path must stay within the selected SSH workspace.')
  }
  const parts = pathParts(parent)
  let current = parent.startsWith('/') ? '/' : ''
  for (const part of parts) {
    current = current === '/' ? `/${part}` : current ? `${current}/${part}` : part
    try {
      const stats = await sftpAsync<Stats>((callback) => sftp.stat(current, callback))
      if (!stats.isDirectory()) throw new Error(`${current} is not a directory.`)
    } catch (error) {
      if (error instanceof Error && error.message.includes('is not a directory')) throw error
      await sftpVoid((callback) => sftp.mkdir(current, callback))
    }
  }
}

async function rmRemoteRecursive(sftp: SFTPWrapper, path: string): Promise<void> {
  const stats = await sftpAsync<Stats>((callback) => sftp.stat(path, callback))
  if (!stats.isDirectory()) {
    await sftpVoid((callback) => sftp.unlink(path, callback))
    return
  }

  const entries = await sftpAsync<FileEntryWithStats[]>((callback) => {
    sftp.readdir(path, callback)
  })
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    await rmRemoteRecursive(sftp, joinRemotePath(path, entry.filename))
  }
  await sftpVoid((callback) => sftp.rmdir(path, callback))
}

async function withSftp<T>(
  connection: SshConnectionV1,
  action: (sftp: SFTPWrapper) => Promise<T>,
  createClient: SshClientFactory
): Promise<T> {
  const client = await connectSshClient(connection, createClient)
  try {
    const sftp = await sftpAsync<SFTPWrapper>((callback) => client.sftp(callback))
    return await action(sftp)
  } finally {
    client.end()
  }
}

async function executeSshFileOperation(
  sftp: SFTPWrapper,
  request: SshFileOperationRequest
): Promise<SshFileOperationResult> {
  const root = await resolveRemoteRoot(sftp, request.root)
  const path = await resolveRemoteTarget(sftp, root, request.path)

  if (request.op === 'stat') {
    const stats = await sftpAsync<Stats>((callback) => sftp.stat(path, callback))
    return { ok: true, path, root, type: entryType(stats), size: stats.size }
  }

  if (request.op === 'list') {
    const stats = await sftpAsync<Stats>((callback) => sftp.stat(path, callback))
    if (!stats.isDirectory()) return { ok: false, message: 'Remote path is not a directory.' }
    const entries = await sftpAsync<FileEntryWithStats[]>((callback) => {
      sftp.readdir(path, callback)
    })
    return {
      ok: true,
      path,
      root: path,
      entries: entries
        .filter((entry) => entry.filename !== '.DS_Store')
        .map((entry) => ({
          name: entry.filename,
          path: joinRemotePath(path, entry.filename),
          type: entryType(entry.attrs)
        }))
    }
  }

  if (request.op === 'readText') {
    const stats = await sftpAsync<Stats>((callback) => sftp.stat(path, callback))
    if (stats.isDirectory()) return { ok: false, message: 'Cannot preview a directory.' }
    const bytes = await readRemoteBytes(sftp, path, request.maxBytes)
    if (bytes.includes(0)) {
      return { ok: false, message: 'This file appears to be binary and cannot be previewed.' }
    }
    return {
      ok: true,
      path,
      size: stats.size,
      truncated: stats.size > request.maxBytes,
      content: bytes.toString('utf8')
    }
  }

  if (request.op === 'readBinary') {
    const stats = await sftpAsync<Stats>((callback) => sftp.stat(path, callback))
    if (stats.isDirectory()) return { ok: false, message: 'Cannot preview a directory.' }
    if (stats.size > request.maxBytes) {
      return { ok: false, message: 'This image is too large to preview.' }
    }
    const bytes = await readRemoteBytes(sftp, path, request.maxBytes)
    return { ok: true, path, size: stats.size, dataBase64: bytes.toString('base64') }
  }

  if (request.op === 'writeText') {
    const bytes = Buffer.from(request.content, 'utf8')
    await ensureRemoteParent(sftp, root, path)
    await writeRemoteBytes(sftp, path, bytes, 'w')
    return { ok: true, path, size: bytes.length }
  }

  if (request.op === 'writeBinary') {
    const bytes = Buffer.from(request.dataBase64, 'base64')
    await ensureRemoteParent(sftp, root, path)
    await writeRemoteBytes(sftp, path, bytes, 'w')
    return { ok: true, path, size: bytes.length }
  }

  if (request.op === 'createFile') {
    const bytes = Buffer.from(request.content ?? '', 'utf8')
    await ensureRemoteParent(sftp, root, path)
    await writeRemoteBytes(sftp, path, bytes, 'wx')
    return { ok: true, path, size: bytes.length }
  }

  if (request.op === 'createDirectory') {
    await sftpVoid((callback) => sftp.mkdir(path, callback))
    return { ok: true, path, type: 'directory' }
  }

  if (request.op === 'rename') {
    const nextName = request.newName.trim()
    if (!nextName || nextName === '.' || nextName === '..' || /[\\/]/.test(nextName)) {
      return { ok: false, message: 'Name must not contain path separators.' }
    }
    const target = normalizeRemotePath(joinRemotePath(dirnameRemote(path), nextName))
    if (!isWithinRemoteRoot(root, target)) {
      return { ok: false, message: 'Path must stay within the selected SSH workspace.' }
    }
    await sftpVoid((callback) => sftp.rename(path, target, callback))
    return { ok: true, path: target, previousPath: path }
  }

  if (request.op === 'delete') {
    if (path === root) return { ok: false, message: 'Deleting the SSH workspace root is not supported.' }
    await rmRemoteRecursive(sftp, path)
    return { ok: true, path }
  }

  return { ok: false, message: 'Unsupported SSH file operation.' }
}

export async function runSshFileOperation(
  connection: SshConnectionV1,
  request: SshFileOperationRequest,
  createClient: SshClientFactory = () => new Client()
): Promise<SshFileOperationResult> {
  try {
    return await withSftp(connection, (sftp) => executeSshFileOperation(sftp, request), createClient)
  } catch (error) {
    return { ok: false, message: formatSshError(error) }
  }
}
