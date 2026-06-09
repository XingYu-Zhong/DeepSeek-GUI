import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspacePathInEditor } from './open-workspace-path'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openWorkspacePathInEditor', () => {
  it('returns a failed result when the editor bridge is unavailable', async () => {
    vi.stubGlobal('window', {})

    await expect(openWorkspacePathInEditor({ path: '/tmp/demo.ts' })).resolves.toEqual({
      ok: false,
      message: 'Editor bridge is unavailable.'
    })
  })

  it('converts editor bridge rejections into failed results', async () => {
    const openEditorPath = vi.fn(async () => {
      throw new Error('editor launch failed')
    })
    vi.stubGlobal('window', { dsGui: { openEditorPath } })

    await expect(openWorkspacePathInEditor({ path: '/tmp/demo.ts' })).resolves.toEqual({
      ok: false,
      message: 'editor launch failed'
    })
  })
})
