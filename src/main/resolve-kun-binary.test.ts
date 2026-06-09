import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildKunServeArgs,
  resolveKunExecutable,
  type KunBinaryResolution
} from './resolve-kun-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kun-resolver-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveKunExecutable', () => {
  it('resolves the built Kun entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'kun/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveKunExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'kun/src/cli/serve-entry.ts'))

    const resolution = resolveKunExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'kun/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a Kun package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveKunExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveKunExecutable('/app', '/usr/local/bin/kun')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/kun',
      args: [],
      dataDir: ''
    })
  })
})

describe('buildKunServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: KunBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/kun/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildKunServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 8899,
      dataDir: '/tmp/kun',
      baseUrl: 'https://api.deepseek.com/beta',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(args).not.toContain('--api-key')
    expect(args).not.toContain('--runtime-token')
    expect(args).toContain('--token-economy-mode')
    expect(args).toContain('false')
  })
})
