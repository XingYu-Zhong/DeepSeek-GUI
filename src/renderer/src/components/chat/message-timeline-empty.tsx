import { Fragment, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, RefreshCw, Settings } from 'lucide-react'
import type { ClawImChannelV1 } from '@shared/app-settings'
import { KunStateFigure } from './AnimatedWorkLogo'
import { InitialSessionUsageHeatmap } from './InitialSessionUsageHeatmap'
import { KunHeroStage } from './KunHeroStage'

/**
 * Empty / hero states rendered by `MessageTimeline` when there is no
 * turn content yet. Lifted out of the timeline component so the main
 * file can focus on rendering turns and scroll behaviour.
 */

function clawChannelDisplayName(
  channel: ClawImChannelV1 | null,
  fallback: string
): string {
  if (!channel) return fallback
  return (
    channel.agentProfile.name.trim()
    || channel.label.trim()
    || channel.agentProfile.description.trim()
    || fallback
  )
}

function ClawEmptyHero({
  channel,
  onSelectSuggestion
}: {
  channel: ClawImChannelV1 | null
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentName = clawChannelDisplayName(channel, t('clawEmptyHeroFallbackName'))
  void onSelectSuggestion
  const hasInboundConversation = Boolean(
    channel?.threadId.trim() ||
    channel?.conversations.some((conversation) => conversation.localThreadId.trim()) ||
    channel?.conversations.length ||
    channel?.remoteSession?.chatId?.trim()
  )

  return (
    <div className="ds-no-drag flex justify-center px-4 pb-6 pt-12 md:px-8 md:pt-16">
      <div className="w-full max-w-[980px] rounded-[32px] border border-ds-border-muted bg-ds-card/78 px-8 py-10 text-center shadow-[0_16px_40px_rgba(20,47,95,0.06)] backdrop-blur md:px-12 md:py-14">
        <div className="mx-auto max-w-[720px]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-ds-border-muted bg-ds-main/55 text-accent">
            <KunStateFigure kind="greet" className="h-14 w-14" />
          </div>

          <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.055em] text-ds-ink md:text-[48px]">
            {t('clawEmptyHeroTitle', { name: agentName })}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ds-muted md:text-[16px]">
            {hasInboundConversation ? t('clawEmptyHeroSub') : t('clawEmptyHeroNeedsInbound')}
          </p>
        </div>
      </div>
    </div>
  )
}

function RuntimeWakeHero({
  runtimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeError?: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  // When the runtime probe has surfaced a specific error (e.g. port conflict,
  // missing API key, or unhealthy runtime), prefer a clear "cannot connect"
  // title and show the localized error message as the body. Otherwise fall
  // back to the generic "waking" hero. This addresses issue #78, where users
  // saw the "正在唤醒" title and assumed the app was still loading, never
  // noticing the port-conflict detail text below it.
  const trimmedError = runtimeError?.trim() ?? ''
  const hasError = trimmedError.length > 0
  const title = hasError ? t('runtimeErrorHeroTitle') : t('runtimeOfflineHeroTitle')
  const detail = hasError ? trimmedError : t('runtimeOfflineHeroSub')

  return (
    <div className="ds-runtime-wake-hero ds-no-drag px-6 pb-8 pt-12 text-center md:pt-16">
      {/* 报错时关掉「唤醒中」动效,沿用 #78 的原则:错误不该看起来像还在加载 */}
      <KunHeroStage waking={!hasError} />

      <p className="text-[12px] font-semibold uppercase tracking-[0] text-accent">
        {t('runtimeOfflineHeroKicker')}
      </p>
      <h1 className="mt-2 max-w-[620px] text-[26px] font-semibold leading-tight tracking-[0] text-ds-ink md:text-[32px]">
        {title}
      </h1>
      <p className="mt-3 max-w-[620px] text-[15px] leading-7 text-ds-muted">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="ds-chip inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('retryConnection')}
        </button>
        <button
          type="button"
          className="ds-chip-muted inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('openSettings')}
        </button>
      </div>
    </div>
  )
}

export function MessageTimelineEmptyHero({
  route,
  ready,
  hasWorkspace,
  runtimeError,
  activeClawChannel,
  onPickWorkspace,
  onRetry,
  onOpenSettings,
  onSelectSuggestion,
  focusModeEnabled = false
}: {
  route: 'chat' | 'claw'
  ready: boolean
  hasWorkspace: boolean
  runtimeError?: string | null
  activeClawChannel: ClawImChannelV1 | null
  onPickWorkspace: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')

  if (!ready) {
    return <RuntimeWakeHero runtimeError={runtimeError} onRetry={onRetry} onOpenSettings={onOpenSettings} />
  }

  if (!hasWorkspace) {
    return (
      <div className="ds-no-drag flex flex-col items-center justify-center px-6 py-24 text-center">
        <KunStateFigure kind="sit" className="mb-4 h-16 w-16" />
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ds-ink">
          {t('selectWorkspace')}
        </h1>
        <p className="mt-2 max-w-sm text-[14.5px] leading-6 text-ds-muted">
          {t('emptyHeroSubNoWorkspace')}
        </p>
        <button
          type="button"
          className="ds-chip mt-5 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onPickWorkspace}
        >
          {t('selectWorkspace')}
        </button>
      </div>
    )
  }

  if (route === 'claw') {
    return (
      <ClawEmptyHero
        channel={activeClawChannel}
        onSelectSuggestion={onSelectSuggestion}
      />
    )
  }

  return <InitialSessionUsageHeatmap hideHero={focusModeEnabled} />
}

export function ThreadForkBanner({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-[18px] border border-accent/16 bg-accent/7 px-4 py-3 text-ds-muted shadow-[0_14px_36px_rgba(59,130,216,0.05)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
          <GitFork className="h-4 w-4" strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-ds-ink">
            {t('threadForkBannerTitle')}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-ds-muted">
            {parentTitle
              ? t('threadForkBannerSub', { title: parentTitle })
              : t('threadForkBannerSubUnknown')}
          </span>
        </span>
      </div>
    </div>
  )
}

export function ThreadForkPoint({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3 py-1 text-[12px] font-medium text-ds-faint">
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
      <span
        className="inline-flex max-w-[min(100%,420px)] items-center gap-1.5 rounded-full border border-accent/16 bg-ds-card/78 px-3 py-1.5 text-accent shadow-sm"
        title={parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
      >
        <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">
          {parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
        </span>
      </span>
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
    </div>
  )
}
