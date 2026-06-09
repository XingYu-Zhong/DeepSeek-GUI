import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Brain, Check, ChevronDown, ChevronRight, Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/ds-gui-api'

export type ComposerReasoningEffort = 'low' | 'medium' | 'high' | 'max'

type Props = {
  compact: boolean
  mode: 'select' | 'combobox'
  composerModel: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  canChangeModel: boolean
  stretch?: boolean
  composerReasoningEffort?: string
  onComposerModelChange: (modelId: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
}

const REASONING_OPTIONS: Array<{ id: ComposerReasoningEffort; labelKey: string }> = [
  { id: 'low', labelKey: 'composerReasoningLow' },
  { id: 'medium', labelKey: 'composerReasoningMedium' },
  { id: 'high', labelKey: 'composerReasoningHigh' },
  { id: 'max', labelKey: 'composerReasoningMax' }
]

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

export function FloatingComposerModelPicker({
  compact,
  mode,
  composerModel,
  composerPickList,
  composerModelGroups = [],
  canChangeModel,
  stretch = false,
  composerReasoningEffort = 'max',
  onComposerModelChange,
  onComposerReasoningEffortChange
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
    const seen = new Set<string>()
    const groups = composerModelGroups
      .map((group) => {
        const ids = group.modelIds
          .map((id) => id.trim())
          .filter((id) => {
            if (!id || seen.has(id)) return false
            seen.add(id)
            return true
          })
        return {
          ...group,
          label: group.label.trim() || group.providerId,
          modelIds: ids
        }
      })
      .filter((group) => group.modelIds.length > 0)
    const ungrouped = modelOptions.filter((id) => id !== 'auto' && !seen.has(id))
    if (ungrouped.length > 0) {
      groups.push({
        providerId: UNGROUPED_MODEL_PROVIDER_ID,
        label: t('composerModel'),
        modelIds: ungrouped
      })
    }
    return groups
  }, [composerModelGroups, modelOptions, t])
  const reasoningEnabled = Boolean(onComposerReasoningEffortChange)
  const currentReasoning = normalizeComposerReasoningEffort(composerReasoningEffort)
  const currentReasoningLabel = t(reasoningLabelKey(currentReasoning))
  const modelLabel = fullModelLabel(composerModel, t('autoLabel'))
  const controlsTitle = reasoningEnabled
    ? `${modelLabel} / ${currentReasoningLabel}`
    : modelLabel
  const currentModel = composerModel.trim()
  const selectedProviderId = providerMenuGroups.find((group) =>
    group.modelIds.includes(currentModel)
  )?.providerId ?? null
  const activeProviderGroup =
    providerMenuGroups.find((group) => group.providerId === activeProviderId) ?? null
  const comboboxWidthClass = stretch
    ? 'min-w-0 flex-1 max-w-[284px]'
    : compact
      ? 'w-[184px] max-w-[184px] shrink-0'
      : 'w-[248px] max-w-[260px] shrink-0'

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
    if (!menuOpen || !canChangeModel) return null
    const menu = (
      <>
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle}
          className={className}
        >
        {reasoningEnabled ? (
          <>
            <MenuSectionTitle icon={<Brain className="h-3.5 w-3.5" strokeWidth={1.9} />}>
              {t('composerReasoning')}
            </MenuSectionTitle>
            <div className="flex flex-col gap-1">
              {REASONING_OPTIONS.map((option) => (
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
          <PickerRow
            selected={!composerModel.trim() || composerModel.trim() === 'auto'}
            title={t('autoLabel')}
            onClick={() => {
              onComposerModelChange('auto')
              setMenuOpen(false)
            }}
          />
          {providerMenuGroups.map((group) => {
            const selectedModel = group.modelIds.includes(currentModel) ? currentModel : ''
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
          })}
        </div>
        </div>
        {activeProviderGroup ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={activeProviderGroup.label}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerModel')}
            </div>
            {activeProviderGroup.modelIds.map((id) => (
              <PickerRow
                key={`${activeProviderGroup.providerId}:${id}`}
                selected={currentModel === id}
                title={id}
                onClick={() => {
                  onComposerModelChange(id)
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
          canChangeModel ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
        }`}
        title={controlsTitle}
      >
        <span className="sr-only">{t('composerModel')}</span>
        <button
          type="button"
          disabled={!canChangeModel}
          onClick={() => setMenuOpen((open) => !open)}
          title={controlsTitle}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t('composerModelControls')}
          className={`flex h-9 min-w-0 flex-1 items-center justify-end gap-1 rounded-full py-2 pl-3 pr-1 text-[13px] font-medium outline-none transition ${
            canChangeModel
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
        {renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[12.5px] shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:bg-ds-card')}
      </div>
    )
  }

  return (
    <div
      className={`ds-composer-model-picker ds-no-drag relative h-9 shrink-0 items-center rounded-full transition ${
        canChangeModel ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
      } ${
        compact ? 'max-w-[220px]' : 'max-w-[260px]'
      }`}
      ref={(node) => {
        pickerRef.current = node
      }}
    >
      <button
        type="button"
        disabled={!canChangeModel}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex h-9 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed ${
          canChangeModel ? 'hover:bg-ds-hover' : ''
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

      {menuOpen && canChangeModel ? (
        renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_22px_64px_rgba(15,23,42,0.18)] dark:bg-ds-card')
      ) : null}
    </div>
  )
}

export function normalizeComposerReasoningEffort(value: string | undefined): ComposerReasoningEffort {
  switch (value?.trim().toLowerCase()) {
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      return value.trim().toLowerCase() as ComposerReasoningEffort
    default:
      return 'max'
  }
}

export function composerReasoningEffortRequestValue(
  value: ComposerReasoningEffort
): string | undefined {
  if (value === 'low') return 'off'
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
  onClick
}: {
  selected: boolean
  title: string
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
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
    </button>
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
