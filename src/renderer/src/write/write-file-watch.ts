import type {
  WorkspaceFileChangePayload,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult
} from '@shared/workspace-file'

type WriteFileWatchApi = {
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
}

type TextSnapshot = {
  path: string
  content?: string
  size?: number
  truncated?: boolean
  message?: string
  animate: boolean
}

type StartWriteFileWatchOptions = {
  api: WriteFileWatchApi
  workspaceRoot: string
  path: string
  kind: 'text' | 'image'
  onTextSnapshot: (snapshot: TextSnapshot) => void
  onImageChanged: (path: string) => void
  onError: (message: string) => void
}

export function startWriteWorkspaceFileWatch(options: StartWriteFileWatchOptions): () => void {
  let cancelled = false
  let watchId = ''

  const unwatch = (id: string): void => {
    void options.api.unwatchWorkspaceFile(id).catch(() => undefined)
  }

  const handleTextSnapshot = (snapshot: Omit<TextSnapshot, 'animate'> & { animate?: boolean }): void => {
    options.onTextSnapshot({
      ...snapshot,
      animate: snapshot.animate ?? true
    })
  }

  const offChanged = options.api.onWorkspaceFileChanged((payload) => {
    if (!watchId || payload.watchId !== watchId) return
    if (options.kind === 'image') {
      options.onImageChanged(payload.path)
      return
    }
    if (payload.ok) {
      handleTextSnapshot({
        path: payload.path,
        content: payload.content,
        size: payload.size,
        truncated: payload.truncated,
        animate: true
      })
      return
    }
    handleTextSnapshot({
      path: payload.path,
      message: payload.message,
      animate: false
    })
  })

  void options.api.watchWorkspaceFile({
    path: options.path,
    workspaceRoot: options.workspaceRoot
  }).then((result) => {
    if (cancelled) {
      if (result.ok) unwatch(result.watchId)
      return
    }
    if (!result.ok) {
      options.onError(result.message)
      return
    }
    watchId = result.watchId
    if (options.kind === 'image') {
      options.onImageChanged(result.path)
      return
    }
    handleTextSnapshot({
      path: result.path,
      content: result.content,
      size: result.size,
      truncated: result.truncated,
      animate: false
    })
  }).catch((error) => {
    if (!cancelled) {
      options.onError(error instanceof Error ? error.message : String(error))
    }
  })

  return () => {
    cancelled = true
    offChanged()
    if (watchId) unwatch(watchId)
  }
}
