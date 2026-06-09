import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from './write-workspace-store'

function installDsGui(overrides: Partial<Window['dsGui']>): void {
  vi.stubGlobal('window', {
    dsGui: overrides
  })
}

function activateTextFile(path = '/tmp/write/draft.md'): void {
  useWriteWorkspaceStore.setState({
    activeFilePath: path,
    activeFileKind: 'text',
    fileContent: 'old content',
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved'
  })
}

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('write workspace store', () => {
  it('reports read errors when syncing the active text file from disk', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        throw new Error('read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileError: 'read failed',
      saveStatus: 'error'
    })
  })

  it('does not apply late read errors after the active text file changes', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async () => {
        useWriteWorkspaceStore.setState({ activeFilePath: '/tmp/write/next.md' })
        throw new Error('late read failed')
      })
    })
    activateTextFile()

    const result = await useWriteWorkspaceStore.getState().syncActiveFileFromDisk('/tmp/write')

    expect(result).toBe(false)
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileError: null,
      saveStatus: 'saved'
    })
  })
})
