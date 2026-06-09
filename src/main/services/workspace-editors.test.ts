import { describe, expect, it, vi } from 'vitest'
import { buildSshWorkspaceUri } from '../../shared/ssh-workspace'

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn()
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import { shell } from 'electron'
import { openEditorPath } from './workspace-editors'

describe('workspace-editors', () => {
  it('does not pass SSH workspace files to local external editors', async () => {
    const result = await openEditorPath({
      path: buildSshWorkspaceUri('ssh-1', '/srv/app/README.md'),
      workspaceRoot: buildSshWorkspaceUri('ssh-1', '/srv/app'),
      editorId: 'system'
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected SSH workspace external editor open to fail.')
    expect(result.message).toContain('SSH workspace files can be edited in the built-in Write view')
    expect(shell.openPath).not.toHaveBeenCalled()
  })
})
