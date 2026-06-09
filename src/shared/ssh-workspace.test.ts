import { describe, expect, it } from 'vitest'
import {
  appendSshWorkspacePath,
  buildSshWorkspaceUri,
  dirnameSshWorkspaceUri,
  isSshWorkspacePath,
  joinSshRemotePath,
  parseSshWorkspaceUri,
  sshRemoteBasename,
  sshWorkspaceLabel
} from './ssh-workspace'

describe('ssh-workspace', () => {
  it('builds and parses SSH workspace URIs without embedding host details', () => {
    const uri = buildSshWorkspaceUri('ssh-1', '/srv/app/docs')

    expect(uri).toBe('ssh://ssh-1/%2Fsrv%2Fapp%2Fdocs')
    expect(uri).not.toContain('example.com')
    expect(isSshWorkspacePath(uri)).toBe(true)
    expect(parseSshWorkspaceUri(uri)).toEqual({
      connectionId: 'ssh-1',
      remotePath: '/srv/app/docs'
    })
  })

  it('joins, labels, and resolves parent directories for remote paths', () => {
    const root = buildSshWorkspaceUri('ssh-1', '/srv/app')
    const file = appendSshWorkspacePath(root, 'docs/draft.md')

    expect(parseSshWorkspaceUri(file).remotePath).toBe('/srv/app/docs/draft.md')
    expect(dirnameSshWorkspaceUri(file)).toBe(buildSshWorkspaceUri('ssh-1', '/srv/app/docs'))
    expect(sshRemoteBasename('/srv/app/docs/draft.md')).toBe('draft.md')
    expect(sshWorkspaceLabel(file)).toBe('ssh-1:draft.md')
  })

  it('normalizes relative path segments without escaping home or absolute roots', () => {
    expect(joinSshRemotePath('/srv/app/docs', '../img/./cover.png')).toBe('/srv/app/img/cover.png')
    expect(joinSshRemotePath('~/project/docs', '../img/cover.png')).toBe('~/project/img/cover.png')
    expect(joinSshRemotePath('/srv/app', '../../../etc/passwd')).toBe('/etc/passwd')
    expect(parseSshWorkspaceUri(buildSshWorkspaceUri('ssh-1', '/srv/app/../img')).remotePath).toBe('/srv/img')
  })
})
