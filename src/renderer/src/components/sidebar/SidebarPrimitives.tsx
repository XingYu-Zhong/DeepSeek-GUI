import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { ChevronRight, Command, PanelLeft, Search, X } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type SidebarFrameProps = {
  title: string
  children: ReactNode
  footer?: ReactNode
  onCollapse?: () => void
  className?: string
}

type SidebarTitlebarToggleButtonProps = {
  title: string
  ariaLabel?: string
  onClick: () => void
  className?: string
  children?: ReactNode
}

export function SidebarTitlebarToggleButton({
  title,
  ariaLabel,
  onClick,
  className,
  children
}: SidebarTitlebarToggleButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cx('ds-titlebar-sidebar-toggle ds-no-drag', className)}
    >
      {children ?? <PanelLeft className="h-[13px] w-[13px]" strokeWidth={1.55} />}
    </button>
  )
}

export function SidebarFrame({
  title,
  children,
  footer,
  onCollapse,
  className
}: SidebarFrameProps): ReactElement {
  return (
    <aside
      className={cx(
        'ds-drag ds-sidebar-shell relative flex h-full w-full shrink-0 flex-col overflow-hidden px-4 pb-3',
        className
      )}
    >
      <div className="ds-sidebar-titlebar-spacer shrink-0 pb-5 pt-3">
        <div className="ds-sidebar-titlebar-row flex min-h-[34px] items-start justify-between">
          <div aria-hidden className="ds-titlebar-safe-block min-w-[86px]" />
          {onCollapse ? (
            <SidebarTitlebarToggleButton
              onClick={onCollapse}
              title={title}
              ariaLabel={title}
              className="ds-sidebar-titlebar-toggle mt-[5px]"
            />
          ) : null}
        </div>
      </div>

      {children}

      {footer ? (
        <div className="ds-no-drag mt-2 border-t border-[var(--ds-sidebar-divider)] px-1.5 pt-3">
          {footer}
        </div>
      ) : null}
    </aside>
  )
}

type SidebarCommandRowProps = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  shortcut?: string
  variant?: 'flat' | 'accent' | 'footer'
  trailing?: ReactNode
  active?: boolean
  showChevron?: boolean
}

export function SidebarCommandRow({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  shortcut,
  variant = 'flat',
  trailing,
  active = false,
  showChevron = false
}: SidebarCommandRowProps): ReactElement {
  const accent = variant === 'accent'
  const footer = variant === 'footer'
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={cx(
        'flex min-h-[34px] w-full items-center gap-2.5 rounded-[8px] px-3 py-1.5 text-[13px] font-normal transition',
        disabled
          ? 'cursor-not-allowed text-[#a8a8a8] opacity-55'
          : active
            ? 'bg-[var(--ds-sidebar-row-active)] text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white'
            : footer
              ? 'text-[#4f4f4f] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:text-white/70 dark:hover:text-white'
              : accent
                ? 'text-[#1f1f1f] hover:bg-[var(--ds-sidebar-row-hover)] dark:text-white'
                : 'text-[#343434] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:text-white/75 dark:hover:text-white'
      )}
    >
      <span
        className={cx(
          'flex h-5 w-5 shrink-0 items-center justify-center',
          accent ? 'text-[#1f1f1f] dark:text-white' : footer ? 'text-[#888888]' : 'text-[#343434] dark:text-white/75'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <kbd className="ds-kbd hidden items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-ds-faint sm:inline-flex">
          <Command className="h-2.5 w-2.5" strokeWidth={2} />
          {shortcut.replace('⌘', '')}
        </kbd>
      ) : null}
      {trailing ?? null}
      {showChevron ? <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} /> : null}
    </button>
  )
}

type SidebarSectionHeaderProps = {
  label: string
  actions?: ReactNode
}

export function SidebarSectionHeader({
  label,
  actions
}: SidebarSectionHeaderProps): ReactElement {
  return (
    <div className="flex items-center justify-between px-2.5 pb-2 pt-5">
      <span className="min-w-0 truncate text-[12px] font-normal text-[#9aa5b5] dark:text-white/35">
        {label}
      </span>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}

type SidebarIconButtonProps = {
  title: string
  children: ReactNode
  onClick?: () => void
  ariaLabel?: string
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'accent' | 'danger'
  className?: string
  stopPropagation?: boolean
}

export function SidebarIconButton({
  title,
  children,
  onClick,
  ariaLabel,
  disabled,
  active,
  tone = 'default',
  className,
  stopPropagation = false
}: SidebarIconButtonProps): ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300'
      : tone === 'accent'
        ? 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white'
        : 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white'

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        if (stopPropagation) event.stopPropagation()
      }}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation()
        onClick?.()
      }}
      className={cx(
        'ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9a9a9a] transition disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/45',
        active ? 'bg-[var(--ds-sidebar-row-active)] text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white' : toneClass,
        className
      )}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

type SidebarSearchFieldProps = {
  value: string
  placeholder: string
  clearLabel: string
  onChange: (value: string) => void
}

export function SidebarSearchField({
  value,
  placeholder,
  clearLabel,
  onChange
}: SidebarSearchFieldProps): ReactElement {
  return (
    <label className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
        strokeWidth={1.8}
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-[8px] border border-transparent bg-[var(--ds-sidebar-field-bg)] pl-7 pr-7 text-[13px] text-[#1f1f1f] outline-none transition placeholder:text-[#9aa5b5] focus:bg-[var(--ds-sidebar-field-focus)] dark:text-white"
      />
      {value.trim() ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#9a9a9a] transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white"
          title={clearLabel}
          aria-label={clearLabel}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      ) : null}
    </label>
  )
}

type SidebarTreeRowProps = {
  children: ReactNode
  onClick?: () => void
  title?: string
  ariaLabel?: string
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
  disabled?: boolean
  active?: boolean
  activeVariant?: 'rail' | 'outline'
  trailing?: ReactNode
  actions?: ReactNode
  actionsVisibility?: 'hidden' | 'subtle' | 'visible'
  actionsLayout?: 'inline' | 'overlay'
  className?: string
  buttonClassName?: string
  buttonStyle?: CSSProperties
}

export function SidebarTreeRow({
  children,
  onClick,
  title,
  ariaLabel,
  onContextMenu,
  disabled,
  active = false,
  activeVariant = 'rail',
  trailing,
  actions,
  actionsVisibility = 'subtle',
  actionsLayout = 'inline',
  className,
  buttonClassName,
  buttonStyle
}: SidebarTreeRowProps): ReactElement {
  const outlined = active && activeVariant === 'outline'
  const rail = activeVariant === 'rail'
  const actionsClass =
    actionsVisibility === 'hidden'
      ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
      : actionsVisibility === 'visible'
        ? 'opacity-100'
        : 'opacity-55 group-hover:opacity-100 focus-within:opacity-100'
  const actionsWrapClass =
    actionsLayout === 'overlay'
      ? 'absolute inset-y-0 right-1.5 flex items-center gap-0.5'
      : 'mr-1.5 flex shrink-0 items-center gap-0.5'
  const trailingWrapClass =
    actionsLayout === 'overlay'
      ? 'mr-1.5 flex shrink-0 items-center gap-0.5 transition group-hover:opacity-0 group-focus-within:opacity-0'
      : 'flex shrink-0 items-center gap-0.5'

  return (
    <div
      className={cx(
        'group relative flex w-full items-center overflow-hidden rounded-[8px] text-[13px] font-normal transition',
        outlined
          ? 'bg-[var(--ds-sidebar-row-active)] text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white'
          : active
            ? 'bg-[var(--ds-sidebar-row-active)] text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white'
            : 'text-[#343434] hover:bg-[var(--ds-sidebar-row-hover)] dark:text-white/75',
        className
      )}
      title={title}
      onContextMenu={onContextMenu}
    >
      {rail ? (
        <span
          aria-hidden
          className={cx(
            'absolute bottom-1 left-0 top-1 w-[2px] rounded-full transition',
            active ? 'bg-transparent opacity-0' : 'bg-transparent opacity-0'
          )}
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cx(
          'flex min-w-0 flex-1 text-left disabled:cursor-not-allowed',
          buttonClassName ?? 'items-center gap-2 px-2.5 py-2'
        )}
        style={buttonStyle}
      >
        {children}
      </button>
      {trailing ? <div className={trailingWrapClass}>{trailing}</div> : null}
      {actions ? (
        <div className={actionsWrapClass}>
          <div className={cx('flex shrink-0 items-center gap-0.5 transition', actionsClass)}>
            {actions}
          </div>
        </div>
      ) : null}
    </div>
  )
}
