export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
}

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  ext: string
}

export type WorkspaceDirectoryTarget = {
  path?: string
  workspaceRoot: string
}

export type WorkspaceFileWritePayload = {
  path: string
  workspaceRoot?: string
  content: string
}

export type WorkspaceFileCreatePayload = {
  path: string
  workspaceRoot: string
  content?: string
}

export type WorkspaceDirectoryCreatePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceEntryRenamePayload = {
  path: string
  workspaceRoot: string
  newName: string
}

export type WorkspaceEntryDeletePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceFileWatchPayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceClipboardImageSavePayload = {
  workspaceRoot: string
  currentFilePath: string
  imageDirectory?: string
}

export type ClipboardImageReadResult =
  | {
      ok: true
      name: string
      mimeType: string
      dataBase64: string
      byteSize: number
      width?: number
      height?: number
    }
  | { ok: false; message: string }

export type WorkspaceFileReadResult =
  | {
      ok: true
      path: string
      content: string
      size: number
      truncated: boolean
      line?: number
      column?: number
    }
  | { ok: false; message: string }

export type WorkspaceImageReadResult =
  | {
      ok: true
      path: string
      dataUrl: string
      mimeType: string
      size: number
    }
  | { ok: false; message: string }

export type WorkspaceFileResolveResult =
  | {
      ok: true
      path: string
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryListResult =
  | {
      ok: true
      root: string
      entries: WorkspaceEntry[]
    }
  | { ok: false; message: string }

export type WorkspaceFileWriteResult =
  | {
      ok: true
      path: string
      savedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryRenameResult =
  | {
      ok: true
      path: string
      previousPath: string
      renamedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryDeleteResult =
  | {
      ok: true
      path: string
      deletedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileWatchResult =
  | {
      ok: true
      watchId: string
      path: string
      content: string
      size: number
      truncated: boolean
      startedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceClipboardImageSaveResult =
  | {
      ok: true
      path: string
      markdownPath: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileChangePayload =
  | {
      ok: true
      watchId: string
      workspaceRoot: string
      path: string
      content: string
      size: number
      truncated: boolean
      changedAt: string
    }
  | {
      ok: false
      watchId: string
      workspaceRoot: string
      path: string
      message: string
      changedAt: string
    }
