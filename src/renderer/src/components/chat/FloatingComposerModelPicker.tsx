import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  Image as ImageIcon,
  Type as TypeIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  MODEL_REASONING_EFFORTS,
  isComposerChatModelId,
  modelProfileSupportsTextChat,
  modelSupportsImageInput,
  type ModelReasoningEffort,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export type ComposerReasoningEffort = ModelReasoningEffort

type Props = {
  compact: boolean
  mode: 'select' | 'combobox'
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  canChangeModel: boolean
  stretch?: boolean
  composerReasoningEffort?: string
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onConfigureProviders?: () => void
}

const REASONING_OPTIONS: Array<{ id: ComposerReasoningEffort; labelKey: string }> = [
  { id: 'auto', labelKey: 'composerReasoningAuto' },
  { id: 'off', labelKey: 'composerReasoningOff' },
  { id: 'low', labelKey: 'composerReasoningLow' },
  { id: 'medium', labelKey: 'composerReasoningMedium' },
  { id: 'high', labelKey: 'composerReasoningHigh' },
  { id: 'max', labelKey: 'composerReasoningMax' }
]
const LEGACY_REASONING_EFFORTS: ComposerReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']

type FloatingMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingSubmenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingMenuAnchorRect = Pick<DOMRect, 'bottom' | 'right' | 'top'>
type FloatingSubmenuAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

type ComposerModelMenuGroup = {
  providerId: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
}

const FLOATING_MENU_MARGIN = 12
const FLOATING_MENU_GAP = 7
const FLOATING_MENU_WIDTH = 208
const FLOATING_MENU_MIN_WIDTH = 176
const FLOATING_MENU_MIN_HEIGHT = 112
const FLOATING_MENU_MAX_HEIGHT = 336
const FLOATING_SUBMENU_GAP = 6
const FLOATING_SUBMENU_WIDTH = 232
const FLOATING_SUBMENU_MIN_HEIGHT = 80
const FLOATING_SUBMENU_MAX_HEIGHT = 320
const UNGROUPED_MODEL_PROVIDER_ID = '__composer_models__'
const DEFAULT_COMPOSER_MODEL_KEYS = new Set(
  DEFAULT_COMPOSER_MODEL_IDS.map((id) => normalizeModelCapabilityKey(id))
)

export function FloatingComposerModelPicker({
  compact,
  mode,
  composerModel,
  composerProviderId = '',
  composerPickList,
  composerModelGroups = [],
  canChangeModel,
  stretch = false,
  composerReasoningEffort = 'max',
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onConfigureProviders
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const pickerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const providerRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<FloatingMenuPlacement | null>(null)
  const [submenuPlacement, setSubmenuPlacement] = useState<FloatingSubmenuPlacement | null>(null)
  const modelOptions = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    const current = composerModel.trim()
    if (current) ordered.add(current)
    return [...ordered]
  }, [composerModel, composerPickList])
  const providerMenuGroups = useMemo<ComposerModelMenuGroup[]>(() => {
    return buildComposerModelMenuGroups({
      composerModelGroups,
      modelOptions,
      ungroupedLabel: t('composerOtherModels')
    })
  }, [composerModelGroups, modelOptions, t])
  const currentModel = composerModel.trim()
  const selectedProviderGroup = providerMenuGroups.find((group) =>
    group.providerId === composerProviderId.trim() &&
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  ) ?? null
  const selectedProviderId = selectedProviderGroup?.providerId ?? providerMenuGroups.find((group) =>
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? null
  const currentModelProfile = modelProfileForSelection(providerMenuGroups, currentModel, selectedProviderId)
  const needsProviderSetup = shouldShowProviderSetupPrompt(providerMenuGroups)
  const reasoningOptions = reasoningOptionsForModel(currentModelProfile)
  const reasoningEnabled =
    !needsProviderSetup && Boolean(onComposerReasoningEffortChange) && reasoningOptions.length > 0
  const currentReasoning = normalizeComposerReasoningEffort(
    composerReasoningEffort,
    currentModelProfile
  )
  const currentReasoningLabel = t(reasoningLabelKey(currentReasoning))
  const canOpenModelControls = canChangeModel || (needsProviderSetup && Boolean(onConfigureProviders))
  const modelLabel = needsProviderSetup
    ? t('composerNoProvidersShort')
    : fullModelLabel(composerModel, t('autoLabel'))
  const controlsTitle = reasoningEnabled
    ? `${modelLabel} / ${currentReasoningLabel}`
    : modelLabel
  const activeProviderGroup =
    providerMenuGroups.find((group) => group.providerId === activeProviderId) ?? null
  const comboboxWidthClass = stretch
    ? 'min-w-0 flex-1 max-w-[284px]'
    : compact
      ? 'w-[184px] max-w-[184px] shrink-0'
      : 'w-[248px] max-w-[260px] shrink-0'

  useEffect(() => {
    if (!reasoningEnabled) return
    const rawReasoning = normalizeComposerReasoningEffortValue(composerReasoningEffort)
    if (rawReasoning !== currentReasoning) {
      onComposerReasoningEffortChange?.(currentReasoning)
    }
  }, [composerReasoningEffort, currentReasoning, onComposerReasoningEffortChange, reasoningEnabled])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (pickerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      if (submenuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null)
      setSubmenuPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const picker = pickerRef.current
      if (!picker) return

      setMenuPlacement(
        calculateFloatingMenuPlacement({
          anchorRect: picker.getBoundingClientRect(),
          menuHeight: menuRef.current?.offsetHeight ?? 0,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      setActiveProviderId(null)
      return
    }
    if (providerMenuGroups.length === 0) {
      setActiveProviderId(null)
      return
    }
    setActiveProviderId((current) => {
      if (current && providerMenuGroups.some((group) => group.providerId === current)) return current
      return null
    })
  }, [menuOpen, providerMenuGroups])

  useEffect(() => {
    if (!menuOpen || !activeProviderGroup) {
      setSubmenuPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const row = providerRowRefs.current.get(activeProviderGroup.providerId)
      if (!row) return

      setSubmenuPlacement(
        calculateFloatingSubmenuPlacement({
          anchorRect: row.getBoundingClientRect(),
          submenuHeight:
            submenuRef.current?.offsetHeight
            || estimatedModelSubmenuHeight(activeProviderGroup.modelIds.length),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    const menu = menuRef.current
    menu?.addEventListener('scroll', updatePlacement, true)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      menu?.removeEventListener('scroll', updatePlacement, true)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [activeProviderGroup, menuOpen])

  const menuStyle: CSSProperties = menuPlacement
    ? {
        left: `${menuPlacement.left}px`,
        top: `${menuPlacement.top}px`,
        width: `${menuPlacement.width}px`,
        maxHeight: `${menuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_MENU_WIDTH}px`,
        maxHeight: `${FLOATING_MENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const submenuStyle: CSSProperties = submenuPlacement
    ? {
        left: `${submenuPlacement.left}px`,
        top: `${submenuPlacement.top}px`,
        width: `${submenuPlacement.width}px`,
        maxHeight: `${submenuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_SUBMENU_WIDTH}px`,
        maxHeight: `${FLOATING_SUBMENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const renderMenu = (className: string): ReactElement | null => {
    if (!menuOpen || !canOpenModelControls) return null
    const menu = (
      <>
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle}
          className={className}
        >
          {reasoningEnabled && !needsProviderSetup ? (
            <>
              <MenuSectionTitle icon={<Brain className="h-3.5 w-3.5" strokeWidth={1.9} />}>
                {t('composerReasoning')}
              </MenuSectionTitle>
              <div className="flex flex-col gap-1">
                {reasoningOptions.map((option) => (
                  <PickerRow
                    key={option.id}
                    selected={currentReasoning === option.id}
                    title={t(option.labelKey)}
                    onClick={() => {
                      onComposerReasoningEffortChange?.(option.id)
                      setMenuOpen(false)
                    }}
                  />
                ))}
              </div>
              <MenuSeparator />
            </>
          ) : null}

          <MenuSectionTitle icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.9} />}>
            {t('composerModel')}
          </MenuSectionTitle>
          <div className="pr-0.5">
            {needsProviderSetup ? (
              <div className="px-2.5 py-2">
                <p className="text-[12.5px] leading-5 text-ds-muted">
                  {t('composerNoProviders')}
                </p>
                {onConfigureProviders ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onConfigureProviders()
                    }}
                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                  >
                    {t('composerConfigureProviders')}
                  </button>
                ) : null}
              </div>
            ) : (
              providerMenuGroups.map((group) => {
                const selectedModel = group.modelIds.some((id) => modelIdsMatch(id, currentModel))
                  ? currentModel
                  : ''
                return (
                  <ProviderRow
                    key={group.providerId}
                    refNode={(node) => {
                      if (node) providerRowRefs.current.set(group.providerId, node)
                      else providerRowRefs.current.delete(group.providerId)
                    }}
                    active={activeProviderId === group.providerId}
                    selected={selectedProviderId === group.providerId}
                    title={group.label}
                    subtitle={selectedModel}
                    onClick={() => setActiveProviderId(group.providerId)}
                    onMouseEnter={() => setActiveProviderId(group.providerId)}
                  />
                )
              })
            )}
          </div>
        </div>
        {activeProviderGroup ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={activeProviderGroup.label}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerModel')}
            </div>
            {activeProviderGroup.modelIds.map((id) => (
              <PickerRow
                key={`${activeProviderGroup.providerId}:${id}`}
                selected={modelIdsMatch(currentModel, id)}
                title={id}
                rightSlot={
                  modelSupportsImageInput(modelProfileForModel(activeProviderGroup, id))
                    ? <ModelCapabilityBadge kind="vision" label={t('composerModelVision')} />
                    : <ModelCapabilityBadge kind="text" label={t('composerModelTextOnly')} />
                }
                onClick={() => {
                  const nextReasoning = normalizeComposerReasoningEffort(
                    composerReasoningEffort,
                    modelProfileForModel(activeProviderGroup, id)
                  )
                  onComposerModelChange(
                    id,
                    activeProviderGroup.providerId === UNGROUPED_MODEL_PROVIDER_ID
                      ? undefined
                      : activeProviderGroup.providerId
                  )
                  if (nextReasoning !== currentReasoning) {
                    onComposerReasoningEffortChange?.(nextReasoning)
                  }
                  setMenuOpen(false)
                }}
              />
            ))}
          </div>
        ) : null}
      </>
    )

    if (typeof document === 'undefined') return menu
    return createPortal(menu, document.body)
  }

  if (mode === 'combobox') {
    return (
      <div
        ref={(node) => {
          pickerRef.current = node
        }}
        className={`ds-composer-model-picker ds-no-drag relative flex h-9 items-center rounded-full transition ${comboboxWidthClass} ${
          canOpenModelControls ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
        }`}
        title={controlsTitle}
      >
        <span className="sr-only">{t('composerModel')}</span>
        <button
          type="button"
          disabled={!canOpenModelControls}
          onClick={() => setMenuOpen((open) => !open)}
          title={controlsTitle}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t('composerModelControls')}
          className={`flex h-9 min-w-0 flex-1 items-center justify-end gap-1 rounded-full py-2 pl-3 pr-1 text-[13px] font-medium outline-none transition ${
            canOpenModelControls
              ? 'text-current focus-visible:ring-2 focus-visible:ring-accent/25'
              : 'cursor-not-allowed text-ds-faint'
          }`}
        >
          <span className="min-w-0 truncate text-right">
            {modelLabel}
          </span>
          {reasoningEnabled ? (
            <span className="shrink-0 text-[12px] font-semibold text-ds-faint">
              {currentReasoningLabel}
            </span>
          ) : null}
          <span className="mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint">
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        </button>
        {renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[12.5px] shadow-[0_18px_50px_rgba(20,47,95,0.16)] dark:bg-ds-card')}
      </div>
    )
  }

  return (
    <div
      className={`ds-composer-model-picker ds-no-drag relative h-9 shrink-0 items-center rounded-full transition ${
        canOpenModelControls ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
      } ${
        compact ? 'max-w-[220px]' : 'max-w-[260px]'
      }`}
      ref={(node) => {
        pickerRef.current = node
      }}
    >
      <button
        type="button"
        disabled={!canOpenModelControls}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex h-9 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed ${
          canOpenModelControls ? 'hover:bg-ds-hover' : ''
        }`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t('composerModelControls')}
        title={t('composerModelControls')}
      >
        <span className="min-w-0 whitespace-nowrap">{modelLabel}</span>
        {reasoningEnabled ? (
          <span className="shrink-0 text-ds-faint">
            {t(reasoningLabelKey(currentReasoning))}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
      </button>

      {menuOpen && canOpenModelControls ? (
        renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_22px_64px_rgba(20,47,95,0.18)] dark:bg-ds-card')
      ) : null}
    </div>
  )
}

export function buildComposerModelMenuGroups({
  composerModelGroups,
  modelOptions,
  ungroupedLabel
}: {
  composerModelGroups: readonly ModelProviderModelGroup[]
  modelOptions: readonly string[]
  ungroupedLabel: string
}): ComposerModelMenuGroup[] {
  const seen = new Set<string>()
  const groups = composerModelGroups
    .map((group) => {
      const ids = group.modelIds
        .map((id) => id.trim())
        .filter((id) => {
          const key = normalizeModelCapabilityKey(id)
          if (!key || seen.has(key)) return false
          if (!composerMenuSupportsModel(group, id)) return false
          markModelSeen(seen, group, id)
          return true
        })
      return {
        ...group,
        label: group.label.trim() || group.providerId,
        modelIds: ids,
        modelProfiles: group.modelProfiles
      }
    })
    .filter((group) => group.modelIds.length > 0)

  const ungrouped: string[] = []
  for (const rawId of modelOptions) {
    const id = rawId.trim()
    const key = normalizeModelCapabilityKey(id)
    if (!key || seen.has(key) || !isComposerChatModelId(id)) continue
    seen.add(key)
    ungrouped.push(id)
  }

  if (ungrouped.length > 0) {
    groups.push({
      providerId: UNGROUPED_MODEL_PROVIDER_ID,
      label: ungroupedLabel,
      modelIds: ungrouped,
      modelProfiles: {}
    })
  }
  return groups
}

function shouldShowProviderSetupPrompt(groups: readonly ComposerModelMenuGroup[]): boolean {
  const hasConfiguredProviderModels = groups.some((group) =>
    group.providerId !== UNGROUPED_MODEL_PROVIDER_ID
  )
  if (hasConfiguredProviderModels) return false
  const ungroupedModels = groups.flatMap((group) =>
    group.providerId === UNGROUPED_MODEL_PROVIDER_ID ? group.modelIds : []
  )
  return ungroupedModels.every((id) =>
    DEFAULT_COMPOSER_MODEL_KEYS.has(normalizeModelCapabilityKey(id))
  )
}

export function normalizeComposerReasoningEffort(
  value: string | undefined,
  profile?: Pick<ModelProviderModelProfileV1, 'reasoning'>
): ComposerReasoningEffort {
  const normalized = normalizeComposerReasoningEffortValue(value)
  if (!profile?.reasoning) return normalized ?? 'max'
  const supported = profile.reasoning.supportedEfforts
  if (normalized && supported.includes(normalized)) return normalized
  if (normalized === 'low' && supported.includes('off') && !supported.includes('low')) {
    return 'off'
  }
  return profile.reasoning.defaultEffort
}

function normalizeComposerReasoningEffortValue(
  value: string | undefined
): ComposerReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ComposerReasoningEffort)
    ? normalized as ComposerReasoningEffort
    : undefined
}

export function composerReasoningEffortRequestValue(
  value: ComposerReasoningEffort
): string | undefined {
  return value
}

export function calculateFloatingMenuPlacement({
  anchorRect,
  menuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingMenuAnchorRect
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(FLOATING_MENU_WIDTH, viewportMaxWidth)
  const left = clamp(
    normalizedAnchorRect.right - width,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(menuHeight, FLOATING_MENU_MIN_HEIGHT)
  const spaceAbove = Math.max(0, normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP)
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP
  )
  const targetHeight = Math.min(contentHeight, FLOATING_MENU_MAX_HEIGHT)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = Math.max(openAbove ? spaceAbove : spaceBelow, FLOATING_MENU_MIN_HEIGHT)
  const maxHeight = Math.min(FLOATING_MENU_MAX_HEIGHT, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_MENU_GAP - visibleHeight
    : normalizedAnchorRect.bottom + FLOATING_MENU_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function calculateFloatingSubmenuPlacement({
  anchorRect,
  submenuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingSubmenuAnchorRect
  submenuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingSubmenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(FLOATING_SUBMENU_WIDTH, viewportMaxWidth)
  const spaceRight = normalizedViewportWidth - normalizedAnchorRect.right - FLOATING_MENU_MARGIN
  const spaceLeft = normalizedAnchorRect.left - FLOATING_MENU_MARGIN
  const openRight = spaceRight >= width + FLOATING_SUBMENU_GAP || spaceRight >= spaceLeft
  const preferredLeft = openRight
    ? normalizedAnchorRect.right + FLOATING_SUBMENU_GAP
    : normalizedAnchorRect.left - width - FLOATING_SUBMENU_GAP
  const left = clamp(
    preferredLeft,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(submenuHeight, FLOATING_SUBMENU_MIN_HEIGHT)
  const maxHeight = Math.min(
    FLOATING_SUBMENU_MAX_HEIGHT,
    Math.max(FLOATING_SUBMENU_MIN_HEIGHT, normalizedViewportHeight - FLOATING_MENU_MARGIN * 2)
  )
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = normalizedAnchorRect.top - 8
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function reasoningLabelKey(value: ComposerReasoningEffort): string {
  return REASONING_OPTIONS.find((option) => option.id === value)?.labelKey ?? 'composerReasoningMax'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function fullModelLabel(model: string, autoLabel: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'auto') return autoLabel
  return trimmed
}

function estimatedModelSubmenuHeight(modelCount: number): number {
  return 34 + Math.max(1, modelCount) * 36 + 12
}

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function modelIdsMatch(a: string, b: string): boolean {
  const left = normalizeModelCapabilityKey(a)
  return Boolean(left) && left === normalizeModelCapabilityKey(b)
}

function markModelSeen(
  seen: Set<string>,
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): void {
  for (const id of [modelId, ...(modelProfileForModel(group, modelId)?.aliases ?? [])]) {
    const key = normalizeModelCapabilityKey(id)
    if (key) seen.add(key)
  }
}

function modelProfileForModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'> | null | undefined,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  if (!group) return undefined
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

function modelProfileForSelection(
  groups: readonly ComposerModelMenuGroup[],
  modelId: string,
  providerId?: string | null
): ModelProviderModelProfileV1 | undefined {
  const selectedGroup = providerId
    ? groups.find((group) => group.providerId === providerId)
    : null
  if (selectedGroup && selectedGroup.modelIds.some((id) => modelIdsMatch(id, modelId))) {
    const profile = modelProfileForModel(selectedGroup, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    if (!group.modelIds.some((id) => modelIdsMatch(id, modelId))) continue
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  return undefined
}

function reasoningOptionsForModel(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): Array<{ id: ComposerReasoningEffort; labelKey: string }> {
  const supported = profile?.reasoning?.supportedEfforts ?? LEGACY_REASONING_EFFORTS
  return supported
    .map((effort) => REASONING_OPTIONS.find((option) => option.id === effort))
    .filter((option): option is { id: ComposerReasoningEffort; labelKey: string } => Boolean(option))
}

export function composerMenuSupportsModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): boolean {
  if (!isComposerChatModelId(modelId)) return false
  return modelProfileSupportsTextChat(modelProfileForModel(group, modelId))
}

function MenuSectionTitle({
  children,
  icon
}: {
  children: string
  icon: ReactElement
}): ReactElement {
  return (
    <div className="flex h-8 items-center gap-2 px-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ds-faint">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function MenuSeparator(): ReactElement {
  return <div className="my-2 h-px bg-ds-border-muted" />
}

function PickerRow({
  selected,
  title,
  rightSlot,
  onClick
}: {
  selected: boolean
  title: string
  rightSlot?: ReactElement | null
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        selected
          ? 'bg-ds-hover text-ds-ink'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
      </span>
      {rightSlot}
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
    </button>
  )
}

function ModelCapabilityBadge({
  kind,
  label
}: {
  kind: 'vision' | 'text'
  label: string
}): ReactElement {
  const tone = kind === 'vision'
    ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-ds-border bg-ds-hover text-ds-muted'
  const Icon = kind === 'vision' ? ImageIcon : TypeIcon
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${tone}`}
      title={label}
    >
      <Icon className="h-3 w-3" strokeWidth={1.9} />
      <span>{label}</span>
    </span>
  )
}

function ProviderRow({
  active,
  selected,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <button
      ref={refNode}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onFocus={onMouseEnter}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        active
          ? 'bg-ds-hover text-ds-ink'
          : selected
            ? 'text-ds-ink hover:bg-ds-hover'
            : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11.5px] font-medium text-ds-faint">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
    </button>
  )
}
