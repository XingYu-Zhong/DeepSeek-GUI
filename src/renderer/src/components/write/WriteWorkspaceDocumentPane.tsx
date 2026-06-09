import { type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { WriteInlineCompletionSettingsV1 } from '@shared/app-settings'
import type { WriteRenderSafety } from '../../write/write-render-safety'
import type { WriteRecentEdit } from '../../write/recent-edits'
import type { WriteEditorSelectionState } from './WriteMarkdownEditor'
import { WriteMarkdownEditor } from './WriteMarkdownEditor'
import { WriteMarkdownPreview } from './WriteMarkdownPreview'
import { WriteWorkspaceStart } from './WriteWorkspaceStart'
import { WriteImagePreview } from './WriteImagePreview'

type Props = {
  activeFilePath: string | null
  activeFileIsImage: boolean
  activeFileIsText: boolean
  fileLoading: boolean
  fileContent: string
  imageDataUrl: string
  imageMimeType: string
  fileSize: number
  workspaceRoot: string
  workspaceName: string
  workspacePathLabel: string
  renderSafety: WriteRenderSafety
  fileGuardMessage: string
  fileGuardDetail: string
  editorVisible: boolean
  previewVisible: boolean
  editorWidth: string
  previewWidth: string
  editorAppearance: 'source' | 'live'
  debouncedPreviewContent: string
  isMarkdown: boolean
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
  recentEdits: WriteRecentEdit[]
  editorPaneRef: RefObject<HTMLDivElement | null>
  previewPaneRef: RefObject<HTMLDivElement | null>
  onAskAssistant: () => void
  onCreateDraft: () => void
  onPickWorkspace: () => void
  onRefreshWorkspace: () => void
  onContentChange: (content: string) => void
  onDocumentEdit: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved: () => void
  onImagePasteError: (message: string) => void
}

export function WriteWorkspaceDocumentPane({
  activeFilePath,
  activeFileIsImage,
  activeFileIsText,
  fileLoading,
  fileContent,
  imageDataUrl,
  imageMimeType,
  fileSize,
  workspaceRoot,
  workspaceName,
  workspacePathLabel,
  renderSafety,
  fileGuardMessage,
  fileGuardDetail,
  editorVisible,
  previewVisible,
  editorWidth,
  previewWidth,
  editorAppearance,
  debouncedPreviewContent,
  isMarkdown,
  inlineCompletion,
  inlineCompletionApiReady,
  recentEdits,
  editorPaneRef,
  previewPaneRef,
  onAskAssistant,
  onCreateDraft,
  onPickWorkspace,
  onRefreshWorkspace,
  onContentChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError
}: Props): ReactElement {
  const { t } = useTranslation('common')

  if (!activeFilePath) {
    return (
      <WriteWorkspaceStart
        workspaceName={workspaceName}
        workspacePathLabel={workspacePathLabel}
        onAskAssistant={onAskAssistant}
        onCreateDraft={onCreateDraft}
        onPickWorkspace={onPickWorkspace}
        onRefreshWorkspace={onRefreshWorkspace}
      />
    )
  }

  if (fileLoading) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-[14px] text-ds-muted">
        {t('filePreviewLoading')}
      </div>
    )
  }

  if (activeFileIsImage) {
    return (
      <WriteImagePreview
        src={imageDataUrl}
        filePath={activeFilePath}
        mimeType={imageMimeType}
        size={fileSize}
        workspaceRoot={workspaceRoot}
      />
    )
  }

  if (!activeFileIsText) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-[14px] text-ds-muted">
        {t('writeUnsupportedFileType')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {renderSafety.notice !== 'none' ? (
        <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/90 px-5 py-3 text-[12.5px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100 sm:px-6">
          <div className="font-semibold">{fileGuardMessage}</div>
          {fileGuardDetail ? (
            <div className="mt-1 text-amber-800/90 dark:text-amber-100/90">{fileGuardDetail}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        {editorVisible ? (
          <div ref={editorPaneRef} className={`${editorWidth} min-h-0 overflow-hidden`}>
            <WriteMarkdownEditor
              value={fileContent}
              workspaceRoot={workspaceRoot}
              filePath={activeFilePath}
              appearance={editorAppearance}
              livePreviewEnabled={renderSafety.livePreviewEnabled}
              readOnly={renderSafety.readOnly}
              completionModel={inlineCompletion.model}
              completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
              completionDebounceMs={inlineCompletion.debounceMs}
              completionMinAcceptScore={inlineCompletion.minAcceptScore}
              completionLongEnabled={inlineCompletion.longCompletionEnabled}
              completionLongDebounceMs={inlineCompletion.longDebounceMs}
              completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
              recentEdits={recentEdits}
              onChange={onContentChange}
              onDocumentEdit={onDocumentEdit}
              onSelectionChange={onSelectionChange}
              onSaveShortcut={onSaveShortcut}
              onImagePasteSaved={onImagePasteSaved}
              onImagePasteError={onImagePasteError}
            />
          </div>
        ) : null}

        {previewVisible ? (
          <div ref={previewPaneRef} className={`${previewWidth} min-h-0 overflow-y-auto overflow-x-hidden`}>
            <WriteMarkdownPreview
              content={debouncedPreviewContent}
              isMarkdown={isMarkdown && renderSafety.markdownPreviewEnabled}
              filePath={activeFilePath}
              previewErrorMessage={t('writePreviewErrorFallback')}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
