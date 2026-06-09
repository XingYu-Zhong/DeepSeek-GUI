import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  QrCode,
  RadioTower,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawRunMode
} from '@shared/app-settings'
import type { ClawImInstallQrResult } from '@shared/ds-gui-api'
import {
  ClawProviderLogo,
  clawProviderDisplayLabel
} from './SidebarClaw'
import {
  CLAW_ADD_PROVIDER_OPTIONS,
  CLAW_AGENT_TABS,
  CLAW_DIALOG_STEPS,
  clawConnectionHintKey,
  clawConnectionModeLabelKey,
  clawConnectionStatusKey,
  clawCredentialLabelKey,
  clawDefaultAgentName,
  clawDefaultChannelWorkspacePreview,
  type ClawAddImDialogProps,
  type ClawDialogStep,
  type ClawImDialogMode,
  type ClawInstallQrState,
  type ClawInstallTarget,
  type ClawManageStage,
  copyTextFallback,
  formatClawInstallError,
  isOfficialInstallProvider,
  clawInstallTargetLabel,
  clawPayloadQrTitleKey
} from './SidebarClawDialogHelpers'
import { ClawConfigureOverview, ClawDialogFooter, ClawManageSelection } from './SidebarClawDialogSections'
import { ClawStepContent } from './SidebarClawDialogStepContent'
export function ClawAddImDialog({
  mode,
  initialProvider,
  initialChannelId,
  channels,
  onClose,
  onAddProvider,
  onDeleteChannel,
  t
}: ClawAddImDialogProps): ReactElement {
  const configuredProviders = useMemo(
    () => new Set(channels.map((channel) => channel.provider)),
    [channels]
  )
  const editableChannels = useMemo(
    () => [...channels].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [channels]
  )
  const visibleProviderOptions = mode === 'add'
    ? CLAW_ADD_PROVIDER_OPTIONS.filter((option) => !configuredProviders.has(option.id))
    : CLAW_ADD_PROVIDER_OPTIONS
  const fallbackEditChannelId =
    (initialChannelId && editableChannels.some((channel) => channel.id === initialChannelId)
      ? initialChannelId
      : editableChannels[0]?.id) ?? ''
  const [selectedChannelId, setSelectedChannelId] = useState(fallbackEditChannelId)
  const [manageStage, setManageStage] = useState<ClawManageStage>('select')
  const fallbackProvider =
    (initialProvider && visibleProviderOptions.some((option) => option.id === initialProvider)
      ? initialProvider
      : visibleProviderOptions[0]?.id) ?? CLAW_ADD_PROVIDER_OPTIONS[0].id
  const [provider, setProvider] = useState<ClawImProvider>(fallbackProvider)
  const existingChannel = useMemo(
    () => (mode === 'edit'
      ? editableChannels.find((channel) => channel.id === selectedChannelId) ?? null
      : null),
    [editableChannels, mode, selectedChannelId]
  )
  const effectiveProvider = mode === 'edit'
    ? existingChannel?.provider ?? fallbackProvider
    : provider
  const selectedOption =
    visibleProviderOptions.find((option) => option.id === effectiveProvider)
    ?? CLAW_ADD_PROVIDER_OPTIONS.find((option) => option.id === effectiveProvider)
    ?? CLAW_ADD_PROVIDER_OPTIONS[0]
  const selectedCredentialHints = selectedOption.credentialHints ?? []
  const officialInstallProvider = isOfficialInstallProvider(effectiveProvider) &&
    selectedOption.connectionMode === 'official-install-qr'
    ? effectiveProvider
    : null
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8787/claw/im')
  const [imPort, setImPort] = useState(8787)
  const [imPath, setImPath] = useState('/claw/im')
  const [secret, setSecret] = useState('')
  const [imEnabled, setImEnabled] = useState(true)
  const [responseTimeoutSec, setResponseTimeoutSec] = useState(120)
  const [runMode, setRunMode] = useState<ClawRunMode>('agent')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [installQr, setInstallQr] = useState<ClawInstallQrState>({
    status: 'idle',
    url: '',
    deviceCode: '',
    userCode: '',
    timeLeft: 0,
    error: ''
  })
  const [platformCredential, setPlatformCredential] = useState<ClawImPlatformCredentialV1 | undefined>()
  const installPollTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const installAttemptRef = useRef(0)
  const [activeStep, setActiveStep] = useState<ClawDialogStep>('defaults')
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)
  const [officialInstallTarget, setOfficialInstallTarget] = useState<ClawInstallTarget>('feishu')
  const [channelModel, setChannelModel] = useState<string>('auto')
  const [channelWorkspaceRoot, setChannelWorkspaceRoot] = useState('')
  const [channelEnabled, setChannelEnabled] = useState(true)
  const [showSecret, setShowSecret] = useState(false)
  const [agentProfile, setAgentProfile] = useState<ClawImAgentProfileV1>(() => ({
    name: clawDefaultAgentName(fallbackProvider === 'weixin' ? 'weixin' : 'feishu'),
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }))
  const noVisibleProvider = visibleProviderOptions.length === 0
  const noEditableChannel = mode === 'edit' && editableChannels.length === 0

  useEffect(() => {
    if (mode === 'edit') {
      setSelectedChannelId(fallbackEditChannelId)
      setManageStage('select')
      return
    }
    setManageStage('configure')
    setProvider(fallbackProvider)
  }, [fallbackEditChannelId, fallbackProvider, mode])

  const updateAgentProfile = (
    patch: Partial<ClawImAgentProfileV1>
  ): void => {
    setAgentProfile((profile) => ({ ...profile, ...patch }))
  }

  const clearInstallTimers = (): void => {
    if (installPollTimerRef.current) {
      window.clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      window.clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }

  const cancelInstallAttempt = (): void => {
    installAttemptRef.current += 1
    clearInstallTimers()
  }

  useEffect(() => {
    cancelInstallAttempt()
    setInstallQr({ status: 'idle', url: '', deviceCode: '', userCode: '', timeLeft: 0, error: '' })
    setError(null)
    setActiveStep('defaults')
    setAdvancedSettingsOpen(false)
    if (existingChannel) {
      const target = existingChannel.provider === 'weixin'
        ? 'weixin'
        : existingChannel.platformCredential?.kind === 'feishu' && existingChannel.platformCredential.domain === 'lark'
          ? 'lark'
          : 'feishu'
      setOfficialInstallTarget(target)
      setChannelModel(existingChannel.model)
      setChannelWorkspaceRoot(existingChannel.workspaceRoot || '')
      setChannelEnabled(existingChannel.enabled)
      setAgentProfile({
        name: existingChannel.agentProfile.name || existingChannel.label || clawDefaultAgentName(target),
        description: existingChannel.agentProfile.description || '',
        identity: existingChannel.agentProfile.identity || '',
        personality: existingChannel.agentProfile.personality || '',
        userContext: existingChannel.agentProfile.userContext || '',
        replyRules: existingChannel.agentProfile.replyRules || ''
      })
      setPlatformCredential(existingChannel.platformCredential)
    } else {
      const target = provider === 'weixin' ? 'weixin' : 'feishu'
      setOfficialInstallTarget(target)
      setChannelModel('auto')
      setChannelWorkspaceRoot('')
      setChannelEnabled(true)
      setAgentProfile({
        name: clawDefaultAgentName(target),
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      })
      setPlatformCredential(undefined)
    }
    return cancelInstallAttempt
  }, [existingChannel, provider])

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.getSettings !== 'function') return
    setLoadingConfig(true)
    void window.dsGui
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        const path = settings.claw.im.path.startsWith('/')
          ? settings.claw.im.path
          : `/${settings.claw.im.path}`
        setImEnabled(settings.claw.im.enabled)
        setImPort(settings.claw.im.port)
        setImPath(path)
        setEndpoint(`http://127.0.0.1:${settings.claw.im.port}${path}`)
        setSecret(settings.claw.im.secret.trim())
        setResponseTimeoutSec(Math.round(settings.claw.im.responseTimeoutMs / 1000))
        setRunMode(settings.claw.im.mode)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const providerConfigured = configuredProviders.has(effectiveProvider)
  const resolvedPlatformCredential = platformCredential ?? existingChannel?.platformCredential
  const defaultWorkspacePreview = useMemo(
    () => clawDefaultChannelWorkspacePreview(
      effectiveProvider,
      officialInstallTarget,
      resolvedPlatformCredential,
      existingChannel?.id
    ),
    [effectiveProvider, existingChannel?.id, officialInstallTarget, resolvedPlatformCredential]
  )
  const bindingPayload = useMemo(() => {
    const payload: Record<string, unknown> = {
      kind: 'deepseek-gui.claw-im',
      provider: effectiveProvider,
      endpoint,
      method: 'POST',
      connection: {
        mode: selectedOption.connectionMode,
        domain: officialInstallTarget,
        nativeQr: false,
        officialInstallQr: selectedOption.connectionMode === 'official-install-qr',
        credentialHints: selectedOption.credentialHints ?? []
      },
      agent: {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim()
      },
      body: {
        provider: effectiveProvider,
        text: '<message>',
        sender: '<sender>'
      }
    }
    if (existingChannel?.id) payload.channelId = existingChannel.id
    if (secret) payload.secret = secret
    return JSON.stringify(payload)
  }, [
    agentProfile.description,
    agentProfile.name,
    endpoint,
    existingChannel?.id,
    effectiveProvider,
    officialInstallTarget,
    secret,
    selectedOption.connectionMode,
    selectedOption.credentialHints
  ])
  const qrValue = selectedOption.connectionMode === 'official-install-qr' && installQr.url
    ? installQr.url
    : bindingPayload

  const startOfficialInstallQr = async (): Promise<void> => {
    if (!officialInstallProvider) return
    if (typeof window.dsGui?.startClawImInstallQr !== 'function') {
      setInstallQr({
        status: 'error',
        url: '',
        deviceCode: '',
        userCode: '',
        timeLeft: 0,
        error: t('clawAddImOfficialQrUnavailable')
      })
      return
    }
    clearInstallTimers()
    const installAttempt = installAttemptRef.current + 1
    installAttemptRef.current = installAttempt
    setError(null)
    setPlatformCredential(undefined)
    setInstallQr({ status: 'loading', url: '', deviceCode: '', userCode: '', timeLeft: 0, error: '' })
    let result: ClawImInstallQrResult
    try {
      result = await window.dsGui.startClawImInstallQr(officialInstallProvider, {
        isLark: officialInstallProvider === 'feishu' && officialInstallTarget === 'lark'
      })
    } catch (e) {
      if (installAttempt !== installAttemptRef.current) return
      setInstallQr({
        status: 'error',
        url: '',
        deviceCode: '',
        userCode: '',
        timeLeft: 0,
        error: formatClawInstallError(e instanceof Error ? e.message : String(e), t)
      })
      return
    }
    if (installAttempt !== installAttemptRef.current) return
    if (!result.ok) {
      setInstallQr({
        status: 'error',
        url: '',
        deviceCode: '',
        userCode: '',
        timeLeft: 0,
        error: formatClawInstallError(result.message, t)
      })
      return
    }
    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = window.setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
          installAttemptRef.current += 1
          clearInstallTimers()
          return {
            ...current,
            status: 'error',
            timeLeft: 0,
            error: t('clawAddImOfficialQrExpired')
          }
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
    const waitForInstall = async (): Promise<void> => {
      try {
        const poll = await window.dsGui.pollClawImInstall(officialInstallProvider, result.deviceCode)
        if (installAttempt !== installAttemptRef.current) return
        if (poll.done) {
          clearInstallTimers()
          setPlatformCredential(poll.kind === 'feishu'
            ? {
                kind: poll.kind,
                appId: poll.appId,
                appSecret: poll.appSecret,
                domain: poll.domain,
                createdAt: new Date().toISOString()
              }
            : {
                kind: poll.kind,
                accountId: poll.accountId,
                sessionKey: poll.sessionKey,
                createdAt: new Date().toISOString()
              })
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
        } else if (poll.error) {
          installAttemptRef.current += 1
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: formatClawInstallError(poll.error ?? t('clawAddImOfficialQrFailed'), t)
          }))
        }
      } catch (e) {
        if (installAttempt !== installAttemptRef.current) return
        installAttemptRef.current += 1
        clearInstallTimers()
        setInstallQr((current) => ({
          ...current,
          status: 'error',
          error: formatClawInstallError(e instanceof Error ? e.message : String(e), t)
        }))
      }
    }
    if (officialInstallProvider === 'weixin') {
      void waitForInstall()
    } else {
      installPollTimerRef.current = window.setInterval(() => {
        void waitForInstall()
      }, Math.max(result.interval, 3) * 1000)
    }
  }

  const copyBindingPayload = async (): Promise<void> => {
    try {
      setError(null)
      await navigator.clipboard.writeText(bindingPayload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch (e) {
      try {
        if (copyTextFallback(bindingPayload)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
          return
        }
      } catch {
        // Fall through to the original clipboard error below.
      }
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleAdd = async (): Promise<void> => {
    if (busy) return
    if (noVisibleProvider) return
    if (selectedOption.connectionMode === 'official-install-qr' && !resolvedPlatformCredential) {
      setError(t('clawAddImOfficialCredentialWaiting'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAddProvider(provider, {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim(),
        identity: agentProfile.identity,
        personality: agentProfile.personality,
        userContext: agentProfile.userContext,
        replyRules: agentProfile.replyRules
      }, resolvedPlatformCredential, {
        model: channelModel,
        workspaceRoot: channelWorkspaceRoot.trim(),
        enabled: channelEnabled,
        im: {
          enabled: imEnabled,
          port: imPort,
          path: imPath,
          secret: secret.trim(),
          mode: runMode,
          responseTimeoutMs: responseTimeoutSec * 1000
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (busy || !existingChannel) return
    if (selectedOption.connectionMode === 'official-install-qr' && !resolvedPlatformCredential) {
      setError(t('clawAddImOfficialCredentialWaiting'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAddProvider(existingChannel.provider, {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim(),
        identity: agentProfile.identity,
        personality: agentProfile.personality,
        userContext: agentProfile.userContext,
        replyRules: agentProfile.replyRules
      }, resolvedPlatformCredential, {
        channelId: existingChannel.id,
        model: channelModel,
        workspaceRoot: channelWorkspaceRoot.trim(),
        enabled: channelEnabled,
        im: {
          enabled: imEnabled,
          port: imPort,
          path: imPath,
          secret: secret.trim(),
          mode: runMode,
          responseTimeoutMs: responseTimeoutSec * 1000
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteChannel = async (channel: ClawImChannelV1): Promise<void> => {
    if (busy || typeof onDeleteChannel !== 'function') return
    const confirmMessage = t('clawDeleteImConfirm', { name: channel.label })
    if (!window.confirm(confirmMessage)) return
    setBusy(true)
    setError(null)
    try {
      await onDeleteChannel(channel.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const requiresOfficialInstall = selectedOption.connectionMode === 'official-install-qr'
  const submitDisabled =
    busy || noVisibleProvider || noEditableChannel || (requiresOfficialInstall && !resolvedPlatformCredential)
  const activeStepConfig =
    CLAW_DIALOG_STEPS.find((step) => step.id === activeStep) ?? CLAW_DIALOG_STEPS[0]
  const activeStepIndex = CLAW_DIALOG_STEPS.findIndex((step) => step.id === activeStep)
  const lastStepIndex = CLAW_DIALOG_STEPS.length - 1
  const atLastStep = activeStepIndex >= lastStepIndex
  const navigationDisabled = busy || noVisibleProvider || noEditableChannel
  const credentialStatusText = requiresOfficialInstall
    ? resolvedPlatformCredential
      ? t('clawAddImOfficialCredentialReady')
      : t('clawAddImOfficialCredentialWaiting')
    : secret
      ? t('clawAddImSecretIncluded')
      : t('clawAddImSecretEmpty')

  const dialogTitle = mode === 'edit' ? t('clawManageImTitle') : t('clawAddImTitle')
  const dialogSubtitle = mode === 'edit' ? t('clawManageImSubtitle') : t('clawAddImSubtitle')
  const providerListTitle = mode === 'edit' ? t('clawManageImChooseProvider') : t('clawAddImChooseProvider')
  const showEmptyState = mode === 'edit' ? noEditableChannel : noVisibleProvider
  const isManageSelection = mode === 'edit' && manageStage === 'select'
  const primaryActionLabel = isManageSelection
    ? t('clawManageImEditSelected')
    : atLastStep
    ? mode === 'edit'
      ? busy
        ? t('clawAddImSaving')
        : t('clawAddImSave')
      : busy
        ? t('clawAddImCreating')
        : t('clawAddImCreate')
    : t('clawAddImNextStep')

  const goToPreviousStep = (): void => {
    if (activeStepIndex <= 0) return
    setActiveStep(CLAW_DIALOG_STEPS[activeStepIndex - 1].id)
  }

  const goToNextStep = (): void => {
    if (activeStepIndex >= lastStepIndex) return
    setActiveStep(CLAW_DIALOG_STEPS[activeStepIndex + 1].id)
  }

  const enterManageConfigure = (channelId = selectedChannelId): void => {
    if (!channelId) return
    setSelectedChannelId(channelId)
    setActiveStep('defaults')
    setManageStage('configure')
  }

  const returnToManageSelection = (): void => {
    setManageStage('select')
  }

  const handlePrimaryAction = async (): Promise<void> => {
    if (isManageSelection) {
      enterManageConfigure()
      return
    }
    if (!atLastStep) {
      goToNextStep()
      return
    }
    await (mode === 'edit' ? handleSave() : handleAdd())
  }

  const dialogViewContext = {
    activeStep, activeStepConfig, activeStepIndex, advancedSettingsOpen, agentProfile, atLastStep, bindingPayload, busy, channelEnabled, channelModel, channelWorkspaceRoot, copied, copyBindingPayload, credentialStatusText,
    defaultWorkspacePreview, effectiveProvider, editableChannels, endpoint, enterManageConfigure, error, existingChannel, goToPreviousStep, handleDeleteChannel, handlePrimaryAction,
    imEnabled, imPath, imPort, installQr, isManageSelection, loadingConfig, mode, navigationDisabled, noEditableChannel, officialInstallTarget, onClose, onDeleteChannel,
    primaryActionLabel, providerConfigured, providerListTitle, qrValue, requiresOfficialInstall, resolvedPlatformCredential, responseTimeoutSec, returnToManageSelection, runMode,
    secret, selectedChannelId, selectedCredentialHints, selectedOption, setActiveStep, setAdvancedSettingsOpen, setEndpoint, setChannelEnabled, setChannelModel, setChannelWorkspaceRoot,
    setImEnabled, setImPath, setImPort, setOfficialInstallTarget, setResponseTimeoutSec, setRunMode, setSecret, setShowSecret, showSecret, startOfficialInstallQr,
    submitDisabled, t, updateAgentProfile
  }

  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(860px,calc(100vh-32px))] w-full max-w-[1080px] flex-col overflow-hidden rounded-[28px] border border-ds-border bg-ds-elevated shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ds-border-muted/60 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-accent" strokeWidth={1.9} />
              <h2 className="truncate text-[17px] font-semibold text-ds-ink">
                {dialogTitle}
              </h2>
            </div>
            <p className="mt-1 max-w-[680px] text-[13px] leading-5 text-ds-faint">
              {dialogSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('clawAddImClose')}
            title={t('clawAddImClose')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
          <div className="mx-auto w-full max-w-[900px]">
            {showEmptyState ? (
              <div className="rounded-[24px] border border-dashed border-ds-border-muted bg-ds-main/35 p-8 text-center">
                <div className="text-[15px] font-semibold text-ds-ink">
                  {mode === 'edit' ? t('clawManageImEmptyTitle') : t('clawAddImEmptyTitle')}
                </div>
                <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-6 text-ds-faint">
                  {mode === 'edit' ? t('clawManageImEmptyDesc') : t('clawAddImEmptyDesc')}
                </p>
              </div>
            ) : (
              <>
                {isManageSelection ? <ClawManageSelection ctx={dialogViewContext} /> : null}
                {!isManageSelection ? (
                  <>
                <ClawConfigureOverview ctx={dialogViewContext} />
                <ClawStepContent ctx={dialogViewContext} />
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <ClawDialogFooter ctx={dialogViewContext} />
      </div>
    </div>
  )
}
