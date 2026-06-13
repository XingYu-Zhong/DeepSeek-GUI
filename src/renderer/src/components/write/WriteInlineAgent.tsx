import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import {
  AppWindow,
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  LayoutTemplate,
  Lightbulb,
  List,
  ListOrdered,
  Loader2,
  MessageSquareQuote,
  Pilcrow,
  Quote,
  Replace,
  Sparkles,
  Strikethrough,
  Wand2,
  WandSparkles,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WRITE_BLOCK_TYPES, type WriteBlockType } from '../../write/block-type'
import type { WriteInlineFormatKind } from '../../write/inline-format'
import type { ResolvedWriteQuickAction } from '../../write/quick-actions'
import { clamp, INLINE_AGENT_GAP, type WriteInlineAgentPosition } from './write-workspace-view-utils'

type Props = {
  action: WriteInlineAgentPosition
  value: string
  inFlight: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onValueChange: (value: string) => void
  onSubmitPrompt: (value: string) => void
  onApplyEdit: (value: string) => void
  askOnly?: boolean
  preferAbove?: boolean
  /** Inline markdown formatting + block types; hidden for read-only or non-markdown files. */
  formattingEnabled?: boolean
  onApplyFormat?: (kind: WriteInlineFormatKind) => void
  blockType?: WriteBlockType
  onSetBlockType?: (type: WriteBlockType) => void
  /** Configurable AI quick actions (edit ones rewrite in place, chat ones go to the sidebar). */
  quickActions?: ResolvedWriteQuickAction[]
  onQuickAction?: (action: ResolvedWriteQuickAction) => void
  /** Shown only when the image generation provider is configured. Generation
   * is async: the click inserts an animated placeholder and returns. */
  infographicEnabled?: boolean
  onGenerateInfographic?: () => void
  /** UI design mockup generation; same async placeholder flow as infographics. */
  designDraftEnabled?: boolean
  onGenerateDesignDraft?: () => void
  /** Interactive HTML prototype generation; embeds a runnable page below the selection. */
  prototypeEnabled?: boolean
  onGeneratePrototype?: () => void
  /** A raster image is selected instead of text: only image-aware actions
   * apply, everything text-oriented is hidden. */
  imageMode?: boolean
}

/**
 * Activates without stealing the editor selection: the mouse-down default is
 * prevented so the browser never collapses the selection that anchors this
 * menu.
 */
function ToolbarButton({
  className,
  label,
  disabled = false,
  onActivate,
  children
}: {
  className: string
  label: string
  disabled?: boolean
  onActivate: () => void
  children: ReactNode
}): ReactElement {
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (event.pointerType !== 'mouse') event.preventDefault()
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
    onActivate()
  }
  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onMouseDown={handleMouseDown}
      onClick={onActivate}
    >
      {children}
    </button>
  )
}

const FORMAT_BUTTONS: Array<{ kind: WriteInlineFormatKind; labelKey: string; icon: LucideIcon }> = [
  { kind: 'bold', labelKey: 'writeFormatBold', icon: Bold },
  { kind: 'italic', labelKey: 'writeFormatItalic', icon: Italic },
  { kind: 'strikethrough', labelKey: 'writeFormatStrikethrough', icon: Strikethrough },
  { kind: 'code', labelKey: 'writeFormatCode', icon: Code }
]

const BLOCK_TYPE_META: Record<WriteBlockType, { labelKey: string; icon: LucideIcon }> = {
  paragraph: { labelKey: 'writeBlockTypeParagraph', icon: Pilcrow },
  heading1: { labelKey: 'writeBlockTypeHeading1', icon: Heading1 },
  heading2: { labelKey: 'writeBlockTypeHeading2', icon: Heading2 },
  heading3: { labelKey: 'writeBlockTypeHeading3', icon: Heading3 },
  quote: { labelKey: 'writeBlockTypeQuote', icon: Quote },
  bullet: { labelKey: 'writeBlockTypeBullet', icon: List },
  ordered: { labelKey: 'writeBlockTypeOrdered', icon: ListOrdered },
  code: { labelKey: 'writeBlockTypeCode', icon: Code }
}

function quickActionIcon(id: string): LucideIcon {
  if (id === 'polish') return Wand2
  if (id === 'explain') return Lightbulb
  if (id === 'reformat') return WandSparkles
  return Sparkles
}

export function WriteInlineAgent({
  action,
  value,
  inFlight,
  textareaRef,
  onValueChange,
  onSubmitPrompt,
  onApplyEdit,
  askOnly = false,
  preferAbove = false,
  formattingEnabled = false,
  onApplyFormat,
  blockType = 'paragraph',
  onSetBlockType,
  quickActions = [],
  onQuickAction,
  infographicEnabled = false,
  onGenerateInfographic,
  designDraftEnabled = false,
  onGenerateDesignDraft,
  prototypeEnabled = false,
  onGeneratePrototype,
  imageMode = false
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<{ top: number; origin: 'top-center' | 'bottom-center' } | null>(null)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)

  const showBlockSelector = !imageMode && formattingEnabled && Boolean(onSetBlockType)
  const showFormatting = !imageMode && formattingEnabled && Boolean(onApplyFormat)
  const showQuickActions = !imageMode && quickActions.length > 0 && Boolean(onQuickAction)
  const showInfographic = !imageMode && infographicEnabled && Boolean(onGenerateInfographic)
  const showDesignDraft = designDraftEnabled && Boolean(onGenerateDesignDraft)
  const showPrototype = prototypeEnabled && Boolean(onGeneratePrototype)
  const showComposer = !imageMode
  const activeBlock = BLOCK_TYPE_META[blockType] ?? BLOCK_TYPE_META.paragraph
  const ActiveBlockIcon = activeBlock.icon

  // Measure the rendered menu and place it below the selection, flipping above
  // when there isn't enough room. Runs before paint so there is no flash.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const height = el.offsetHeight
    const viewportHeight = window.innerHeight
    const below = action.anchorBottom + INLINE_AGENT_GAP
    const above = action.anchorTop - height - INLINE_AGENT_GAP
    const canPlaceAbove = above >= 16
    const placeAbove = preferAbove
      ? canPlaceAbove
      : below + height > viewportHeight - 16 && canPlaceAbove
    const top = clamp(placeAbove ? above : below, 16, Math.max(16, viewportHeight - height - 16))
    setPlacement({ top, origin: placeAbove ? 'bottom-center' : 'top-center' })
  }, [
    action.anchorTop,
    action.anchorBottom,
    action.left,
    action.width,
    value,
    inFlight,
    showFormatting,
    showBlockSelector,
    showInfographic,
    showDesignDraft,
    showPrototype,
    showComposer,
    blockMenuOpen,
    quickActions.length,
    preferAbove
  ])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (inFlight) return
      onValueChange('')
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    // Enter rewrites editable selections in place; read-only selections such
    // as PDFs send the prompt to the sidebar assistant instead.
    if (askOnly) {
      onSubmitPrompt(value)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      onSubmitPrompt(value)
      return
    }
    onApplyEdit(value)
  }

  return (
    <div
      className="write-inline-agent fixed z-50"
      data-origin={placement?.origin ?? 'top-center'}
      data-selection-ignore="true"
      style={{
        left: action.left,
        top: placement?.top ?? action.anchorBottom + INLINE_AGENT_GAP,
        width: action.width,
        visibility: placement ? 'visible' : 'hidden'
      }}
    >
      <div ref={menuRef} className="write-inline-agent-menu">
        {showBlockSelector ? (
          <div className="write-inline-agent-block">
            <button
              type="button"
              className="write-inline-agent-block-trigger"
              aria-label={t('writeBlockTypeLabel')}
              title={t('writeBlockTypeLabel')}
              aria-expanded={blockMenuOpen}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={() => setBlockMenuOpen((open) => !open)}
            >
              <ActiveBlockIcon className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.85} />
              <span className="min-w-0 flex-1 truncate text-left">{t(activeBlock.labelKey)}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
            </button>
            {blockMenuOpen ? (
              <>
                <div
                  className="write-inline-agent-block-backdrop"
                  onPointerDown={() => setBlockMenuOpen(false)}
                  onMouseDown={(event) => event.preventDefault()}
                />
                <div className="write-inline-agent-block-pop" role="menu">
                  {WRITE_BLOCK_TYPES.map((type) => {
                    const meta = BLOCK_TYPE_META[type]
                    const Icon = meta.icon
                    return (
                      <ToolbarButton
                        key={type}
                        className={`write-inline-agent-block-item${type === blockType ? ' is-active' : ''}`}
                        label={t(meta.labelKey)}
                        onActivate={() => {
                          setBlockMenuOpen(false)
                          onSetBlockType?.(type)
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.85} />
                        <span className="min-w-0 flex-1 truncate text-left">{t(meta.labelKey)}</span>
                      </ToolbarButton>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {showFormatting ? (
          <div className="write-inline-agent-format-row">
            {FORMAT_BUTTONS.map(({ kind, labelKey, icon: Icon }) => (
              <ToolbarButton
                key={kind}
                className="write-inline-agent-format"
                label={t(labelKey)}
                onActivate={() => onApplyFormat?.(kind)}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
              </ToolbarButton>
            ))}
          </div>
        ) : null}

        {showQuickActions || showInfographic || showDesignDraft || showPrototype ? (
          <div className="write-inline-agent-actions">
            <div className="write-inline-agent-section-label">{t('writeSelectionSkills')}</div>
            {showQuickActions
              ? quickActions.map((quickAction) => {
                  const Icon = quickActionIcon(quickAction.id)
                  return (
                    <ToolbarButton
                      key={quickAction.id}
                      className="write-inline-agent-action-row"
                      label={quickAction.label}
                      onActivate={() => onQuickAction?.(quickAction)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                      <span className="min-w-0 flex-1 truncate text-left">{quickAction.label}</span>
                      {quickAction.mode === 'edit' ? (
                        <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
                      ) : (
                        <MessageSquareQuote className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                    </ToolbarButton>
                  )
                })
              : null}
            {showInfographic ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writeInfographicGenerate')}
                onActivate={() => onGenerateInfographic?.()}
              >
                <ImageIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writeInfographicGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
            {showDesignDraft ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writeDesignDraftGenerate')}
                onActivate={() => onGenerateDesignDraft?.()}
              >
                <LayoutTemplate className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writeDesignDraftGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
            {showPrototype ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writePrototypeGenerate')}
                onActivate={() => onGeneratePrototype?.()}
              >
                <AppWindow className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writePrototypeGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
          </div>
        ) : null}

        {showComposer ? (
        <form
          className="write-inline-agent-edit"
          onSubmit={(event) => {
            event.preventDefault()
            if (askOnly) {
              onSubmitPrompt(value)
            } else {
              onApplyEdit(value)
            }
          }}
        >
          {askOnly ? (
            <MessageSquareQuote className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={t(askOnly ? 'writeInlineAgentPlaceholder' : 'writeInlineAgentEditHint')}
            aria-label={t(askOnly ? 'writeInlineAgentPlaceholder' : 'writeInlineAgentEditHint')}
            spellCheck={false}
            className="write-inline-agent-input"
            disabled={inFlight}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {!askOnly ? (
            <button
              type="button"
              className="write-inline-agent-secondary"
              aria-label={t('writeInlineAgentSend')}
              title={t('writeInlineAgentSend')}
              disabled={!value.trim() || inFlight}
              onClick={() => onSubmitPrompt(value)}
            >
              <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="submit"
            className="write-inline-agent-submit"
            aria-label={inFlight ? t('writeInlineEditApplying') : t(askOnly ? 'writeInlineAgentSend' : 'writeInlineEditApply')}
            title={inFlight ? t('writeInlineEditApplying') : t(askOnly ? 'writeInlineAgentSend' : 'writeInlineEditApply')}
            disabled={!value.trim() || inFlight}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : askOnly ? (
              <MessageSquareQuote className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </form>
        ) : null}
      </div>
    </div>
  )
}
