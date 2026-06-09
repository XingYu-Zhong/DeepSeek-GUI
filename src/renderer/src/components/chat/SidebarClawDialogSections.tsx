import type { ReactElement } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, Loader2, Trash2 } from 'lucide-react'
import { ClawProviderLogo, clawProviderDisplayLabel } from './SidebarClaw'
import { CLAW_ADD_PROVIDER_OPTIONS, CLAW_DIALOG_STEPS, clawConnectionStatusKey } from './SidebarClawDialogHelpers'

export function ClawManageSelection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { busy, editableChannels, enterManageConfigure, handleDeleteChannel, loadingConfig, mode, onDeleteChannel, providerListTitle, selectedChannelId, t } = ctx

  return (
                  <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {providerListTitle}
                        </div>
                        <div className="mt-2 text-[15px] font-semibold text-ds-ink">
                          {t('clawManageImSelectTitle')}
                        </div>
                        <p className="mt-1 max-w-[560px] text-[12.5px] leading-5 text-ds-faint">
                          {t('clawManageImSelectDesc')}
                        </p>
                      </div>
                      {loadingConfig ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          {t('clawAddImLoading')}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {editableChannels.map((channel: any) => {
                        const active = channel.id === selectedChannelId
                        const option =
                          CLAW_ADD_PROVIDER_OPTIONS.find((item) => item.id === channel.provider)
                          ?? CLAW_ADD_PROVIDER_OPTIONS[0]
                        return (
                          <div
                            key={channel.id}
                            className={`flex min-h-[82px] min-w-0 items-center gap-2 rounded-2xl border px-3 py-3 transition ${
                              active
                                ? 'border-accent/55 bg-accent/10 text-ds-ink shadow-sm ring-2 ring-accent/10'
                                : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => enterManageConfigure(channel.id)}
                              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-0 text-left"
                            >
                              <span
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[12px] font-semibold ${option.toneClass}`}
                              >
                                <ClawProviderLogo provider={channel.provider} className="h-6 w-6" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-semibold">
                                  {channel.label}
                                </span>
                                <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                                  {clawProviderDisplayLabel(channel.provider)} · {channel.model}
                                </span>
                                <span className="mt-1 block truncate text-[11.5px] text-ds-faint">
                                  {channel.enabled ? t('clawImEnabled') : t('clawImDisabled')}
                                </span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                            </button>
                            {typeof onDeleteChannel === 'function' ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteChannel(channel)}
                                disabled={busy}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-red-300"
                                title={t('clawDeleteIm')}
                                aria-label={t('clawDeleteIm')}
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                              </button>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
  )
}

export function ClawConfigureOverview({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { activeStep, activeStepConfig, activeStepIndex, channelModel, credentialStatusText, effectiveProvider, endpoint, error, existingChannel, imEnabled, loadingConfig, mode, providerConfigured, requiresOfficialInstall, resolvedPlatformCredential, returnToManageSelection, selectedOption, setActiveStep, t } = ctx

  return (
    <>
                <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {mode === 'edit' ? (
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          type="button"
                          onClick={returnToManageSelection}
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                          aria-label={t('clawManageImBackToList')}
                          title={t('clawManageImBackToList')}
                        >
                          <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
                        </button>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                            {t('clawManageImEditing')}
                          </div>
                          <div className="mt-1 truncate text-[15px] font-semibold text-ds-ink">
                            {existingChannel?.label ?? selectedOption.label}
                          </div>
                          <div className="mt-1 truncate text-[12.5px] text-ds-faint">
                            {clawProviderDisplayLabel(effectiveProvider)} · {channelModel}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold ${selectedOption.toneClass}`}
                        >
                          <ClawProviderLogo provider={effectiveProvider} className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                            {t('clawAddImSetupFlow')}
                          </div>
                          <div className="mt-1 truncate text-[15px] font-semibold text-ds-ink">
                            {selectedOption.label}
                          </div>
                          <div className="mt-1 truncate text-[12.5px] text-ds-faint">
                            {providerConfigured ? t('clawAddImCanAddAnother') : t(clawConnectionStatusKey(selectedOption.connectionMode))}
                          </div>
                        </div>
                      </div>
                    )}
                    {loadingConfig ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        {t('clawAddImLoading')}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {CLAW_DIALOG_STEPS.map((step, index) => {
                      const Icon = step.icon
                      const active = activeStep === step.id
                      const completed = index < activeStepIndex
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setActiveStep(step.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                            active
                              ? 'border-accent/30 bg-accent/10 text-accent'
                              : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                          }`}
                        >
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                            active
                              ? 'bg-accent/15 text-accent'
                              : completed
                                ? 'bg-emerald-500/12 text-emerald-600'
                                : 'bg-ds-subtle text-ds-faint'
                          }`}>
                            {completed ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} /> : index + 1}
                          </span>
                          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          <span>{t(step.labelKey)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold ${selectedOption.toneClass}`}
                      >
                        <ClawProviderLogo provider={effectiveProvider} className="h-7 w-7" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[17px] font-semibold text-ds-ink">
                          {selectedOption.label}
                        </div>
                        <div className="mt-1 text-[12.5px] text-ds-faint">
                          {mode === 'edit'
                            ? t('clawManageImConfiguredStatus')
                            : providerConfigured
                              ? t('clawAddImCanAddAnother')
                              : t(clawConnectionStatusKey(selectedOption.connectionMode))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-ds-card px-3 py-1 text-[12px] font-medium text-ds-faint">
                        {t('clawAddImStepCounter', {
                          current: activeStepIndex + 1,
                          total: CLAW_DIALOG_STEPS.length
                        })}
                      </span>
                      {loadingConfig ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          {t('clawAddImLoading')}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted">
                    <span className="text-ds-ink">{t(activeStepConfig.labelKey)}</span>
                    <span>·</span>
                    <span>{t(activeStepConfig.descriptionKey)}</span>
                  </div>

                  {mode === 'edit' ? (
                    <div className="mt-5 grid gap-3 xl:grid-cols-3">
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryConnection')}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold text-ds-ink">
                          {t('clawManageImConnected')}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {t('clawAddImConnectionMethod')}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryCredentials')}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold text-ds-ink">
                          {requiresOfficialInstall
                            ? resolvedPlatformCredential
                              ? t('clawAddImOfficialQrSuccess')
                              : t('clawAddImGenerateOfficialQr')
                            : t('clawImWebhook')}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {credentialStatusText}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryEndpoint')}
                        </div>
                        <div className="mt-2 truncate font-mono text-[12.5px] text-ds-ink">
                          {endpoint}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {imEnabled ? t('clawImEnabled') : t('clawImDisabled')}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {error ? (
                  <div className="mt-5 flex items-start gap-2 rounded-[20px] bg-red-500/10 px-4 py-3 text-[12.5px] leading-5 text-red-600 dark:text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <span>{error}</span>
                  </div>
                ) : null}
    </>
  )
}

export function ClawDialogFooter({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { activeStepConfig, activeStepIndex, atLastStep, busy, existingChannel, goToPreviousStep, handleDeleteChannel, handlePrimaryAction, isManageSelection, mode, navigationDisabled, noEditableChannel, onClose, onDeleteChannel, primaryActionLabel, selectedChannelId, submitDisabled, t } = ctx

  return (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted/60 px-5 py-4">
          <div className="text-[12px] leading-5 text-ds-faint">
            {isManageSelection
              ? t('clawManageImFooterHint')
              : `${t('clawAddImStepCounter', {
                current: activeStepIndex + 1,
                total: CLAW_DIALOG_STEPS.length
              })} · ${t(activeStepConfig.descriptionKey)}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isManageSelection && mode === 'edit' && existingChannel && typeof onDeleteChannel === 'function' ? (
              <button
                type="button"
                onClick={() => void handleDeleteChannel(existingChannel)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                {t('clawDeleteIm')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('clawAddImCancel')}
            </button>
            {activeStepIndex > 0 ? (
              <button
                type="button"
                onClick={goToPreviousStep}
                disabled={busy}
                className="rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('clawAddImPrevStep')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isManageSelection ? busy || noEditableChannel || !selectedChannelId : atLastStep ? submitDisabled : navigationDisabled}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex min-w-[126px] items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
              {primaryActionLabel}
            </button>
          </div>
        </div>

  )
}
