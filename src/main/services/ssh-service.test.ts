import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import {
  buildSshConnectConfig,
  normalizeSshConnectionTarget,
  testSshConnection,
  type SshClientFactory
} from './ssh-service'

class MockSshStream extends EventEmitter {
  stderr = new EventEmitter()
}

class MockSshClient extends EventEmitter {
  config: unknown
  ended = false

  connect(config: unknown): void {
    this.config = config
    queueMicrotask(() => this.emit('ready'))
  }

  end(): void {
    this.ended = true
  }

  exec(command: string, callback: (error: Error | undefined, stream: MockSshStream) => void): void {
    const stream = new MockSshStream()
    callback(undefined, stream)
    queueMicrotask(() => {
      stream.emit('data', Buffer.from(command.includes('cd ') ? '/srv/app\n' : '/home/deploy\n'))
      stream.emit('exit', 0)
      stream.emit('close')
    })
  }

  sftp(callback: (error: Error | undefined, value: SFTPWrapper) => void): void {
    callback(new Error('SFTP is not used by these tests.'), undefined as unknown as SFTPWrapper)
  }
}

describe('ssh-service', () => {
  it('normalizes host, user, and port values', () => {
    expect(normalizeSshConnectionTarget({
      host: ' vps.example.com ',
      user: ' deploy ',
      port: 2222
    })).toEqual({
      host: 'vps.example.com',
      username: 'deploy',
      port: 2222
    })
  })

  it('rejects empty or unsafe ssh targets', () => {
    expect(() => normalizeSshConnectionTarget({ host: '', port: 22 })).toThrow(/host is required/i)
    expect(() => normalizeSshConnectionTarget({ host: '-bad', port: 22 })).toThrow(/unsupported/i)
    expect(() =>
      normalizeSshConnectionTarget({ host: 'vps.example.com', user: 'bad@user', port: 22 })
    ).toThrow(/unsupported/i)
  })

  it('builds password auth config for ssh2', async () => {
    await expect(buildSshConnectConfig({
      host: 'vps.example.com',
      user: 'deploy',
      port: 2222,
      authMethod: 'password',
      password: 'secret'
    })).resolves.toMatchObject({
      host: 'vps.example.com',
      username: 'deploy',
      port: 2222,
      password: 'secret',
      tryKeyboard: true
    })
  })

  it('builds identity-file auth config for ssh2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deepseek-gui-ssh-test-'))
    const identityFile = join(dir, 'id_ed25519')
    await writeFile(identityFile, 'PRIVATE KEY')
    try {
      await expect(buildSshConnectConfig({
        host: 'vps.example.com',
        user: 'deploy',
        authMethod: 'identityFile',
        identityFile,
        passphrase: 'phrase'
      })).resolves.toMatchObject({
        host: 'vps.example.com',
        username: 'deploy',
        privateKey: 'PRIVATE KEY',
        passphrase: 'phrase'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns a success message from ssh2 exec output', async () => {
    const client = new MockSshClient()
    const createClient = vi.fn(() => client) satisfies SshClientFactory

    const result = await testSshConnection({
      host: 'vps.example.com',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/app'
    }, createClient)

    expect(createClient).toHaveBeenCalledOnce()
    expect(client.config).toMatchObject({
      host: 'vps.example.com',
      username: 'deploy',
      port: 22
    })
    expect(client.ended).toBe(true)
    expect(result).toEqual({ ok: true, message: 'SSH connection succeeded: /srv/app' })
  })

  it('returns a compact authentication failure message', async () => {
    class FailingClient extends MockSshClient {
      override connect(config: unknown): void {
        this.config = config
        queueMicrotask(() => this.emit('error', new Error('All configured authentication methods failed')))
      }
    }
    const result = await testSshConnection(
      { host: 'vps.example.com', port: 22 },
      () => new FailingClient()
    )

    expect(result).toEqual({
      ok: false,
      message: 'SSH authentication failed.'
    })
  })
})
