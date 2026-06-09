import type { ReactElement } from 'react'
import type { ApprovalPolicy, AppSettingsV1, SandboxMode } from '@shared/app-settings'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_KUN_DATA_DIR,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  isKunRuntimeInsecure
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, Loader2, PencilLine, RefreshCw, Settings } from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  InlineNoticeView,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

export function WriteSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    kun,
    activeApiKey,
    update,
    updateKun,
    updateSharedCredential,
    sharedApiKey,
    sharedBaseUrl,
    showApiKey,
    setShowApiKey,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineApiKeyInherited,
    effectiveWriteInlineApiKey,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx

  return (
            <>
              <SettingsCard title={t('sectionWrite')}>
                <SettingRow
                  title={t('writeWorkspaceRoot')}
                  description={t('writeWorkspaceRootDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={form.write.defaultWorkspaceRoot}
                          onChange={(e) =>
                            update({
                              write: {
                                defaultWorkspaceRoot: e.target.value,
                                activeWorkspaceRoot: e.target.value,
                                workspaces: [e.target.value, ...form.write.workspaces]
                              }
                            })
                          }
                          placeholder={t('writeWorkspaceRootPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={resetWriteWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWriteWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {writeWorkspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {writeWorkspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionApiKey')}
                  description={t('writeInlineCompletionApiKeyDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <SecretInput
                        value={form.write.inlineCompletion.apiKey}
                        onChange={(value) => update({ write: { inlineCompletion: { apiKey: value } } })}
                        visible={showApiKey}
                        onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                        placeholder={t('writeInlineCompletionApiKeyPlaceholder')}
                        autoComplete="off"
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                      />
                      <p className="mt-2 text-[12px] text-ds-muted">
                        {writeInlineApiKeyInherited
                          ? effectiveWriteInlineApiKey
                            ? t('writeInlineCompletionApiKeyInherited')
                            : t('writeInlineCompletionApiKeyMissing')
                          : t('writeInlineCompletionApiKeyOverride')}
                      </p>
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('writeInlineCompletion')} className="mt-5">
                <SettingRow
                  title={t('writeInlineCompletionEnabled')}
                  description={t('writeInlineCompletionEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.enabled}
                      onChange={(enabled) => update({ write: { inlineCompletion: { enabled } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionRetrieval')}
                  description={t('writeInlineCompletionRetrievalDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.retrievalEnabled}
                      onChange={(retrievalEnabled) => update({ write: { inlineCompletion: { retrievalEnabled } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionBaseUrl')}
                  description={t('writeInlineCompletionBaseUrlDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={form.write.inlineCompletion.baseUrl}
                        placeholder={DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL}
                        onChange={(e) => update({ write: { inlineCompletion: { baseUrl: e.target.value } } })}
                      />
                      <p className="mt-2 text-[12px] text-ds-muted">
                        {writeInlineBaseUrlInherited
                          ? t('writeInlineCompletionBaseUrlInherited', { value: effectiveWriteInlineBaseUrl })
                          : t('writeInlineCompletionBaseUrlOverride', { value: effectiveWriteInlineBaseUrl })}
                      </p>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionModel')}
                  description={t('writeInlineCompletionModelDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <input
                        list="write-inline-completion-model-options"
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={writeInlineModelInherited ? '' : form.write.inlineCompletion.model}
                        placeholder={t('writeInlineCompletionModelPlaceholder')}
                        onChange={(e) => {
                          const value = e.target.value.trim()
                          update({
                            write: {
                              inlineCompletion: {
                                inheritModel: !value,
                                model: value || DEFAULT_WRITE_INLINE_COMPLETION_MODEL
                              }
                            }
                          })
                        }}
                      />
                      <datalist id="write-inline-completion-model-options">
                        {WRITE_INLINE_COMPLETION_MODEL_IDS.map((model) => (
                          <option
                            key={model}
                            value={model}
                            label={t(
                              model === DEFAULT_WRITE_INLINE_COMPLETION_MODEL
                                ? 'writeInlineCompletionModelFlash'
                                : 'writeInlineCompletionModelPro'
                            )}
                          />
                        ))}
                      </datalist>
                      <p className="mt-2 text-[12px] text-ds-muted">
                        {writeInlineModelInherited
                          ? t('writeInlineCompletionModelInherited', { value: effectiveWriteInlineModel })
                          : t('writeInlineCompletionModelOverride', { value: effectiveWriteInlineModel })}
                      </p>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionDebounce')}
                  description={t('writeInlineCompletionDebounceDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.debounceMs}
                      onChange={(e) => update({
                        write: { inlineCompletion: { debounceMs: Number(e.target.value) } }
                      })}
                    >
                      <option value={300}>{t('writeInlineCompletionDelayFast')}</option>
                      <option value={650}>{t('writeInlineCompletionDelayBalanced')}</option>
                      <option value={1000}>{t('writeInlineCompletionDelayCalm')}</option>
                      <option value={1500}>{t('writeInlineCompletionDelaySlow')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionThreshold')}
                  description={t('writeInlineCompletionThresholdDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.minAcceptScore}
                      onChange={(e) => update({
                        write: { inlineCompletion: { minAcceptScore: Number(e.target.value) } }
                      })}
                    >
                      <option value={0.38}>{t('writeInlineCompletionThresholdCreative')}</option>
                      <option value={0.52}>{t('writeInlineCompletionThresholdBalanced')}</option>
                      <option value={0.68}>{t('writeInlineCompletionThresholdStrict')}</option>
                      <option value={0.82}>{t('writeInlineCompletionThresholdVeryStrict')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionMaxTokens')}
                  description={t('writeInlineCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={16}
                      max={512}
                      step={8}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.maxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { maxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletion')}
                  description={t('writeInlineLongCompletionDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.longCompletionEnabled}
                      onChange={(longCompletionEnabled) => update({
                        write: { inlineCompletion: { longCompletionEnabled } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletionMaxTokens')}
                  description={t('writeInlineLongCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={64}
                      max={1024}
                      step={16}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.longMaxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { longMaxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                <div className="px-3 py-3 text-[12.5px] leading-5 text-ds-muted">
                  {t('writeInlineCompletionApiNote')}
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeDebugLogTitle')} className="mt-5">
                <SettingRow
                  title={t('writeDebugLogOpen')}
                  description={t('writeDebugLogDesc')}
                  control={
                    <button
                      type="button"
                      onClick={() => {
                        setWriteDebugModalOpen(true)
                        void loadWriteDebugEntries()
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      <PencilLine className="h-4 w-4" strokeWidth={1.75} />
                      {t('writeDebugLogOpenButton')}
                    </button>
                  }
                />
              </SettingsCard>
            </>
  )
}
