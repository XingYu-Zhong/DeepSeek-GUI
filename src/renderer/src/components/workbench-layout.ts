import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { AppRoute } from '../store/chat-store-types'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import { WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from '../lib/workspace-file-preview'
import type { RightPanelMode } from './chat/WorkbenchTopBar'

const LEFT_PANEL_WIDTH_KEY = 'deepseekgui.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'deepseekgui.layout.leftSidebarCollapsed'
const RIGHT_PANEL_WIDTH_KEY = 'deepseekgui.layout.rightInspectorWidth'
const RIGHT_PANEL_MODE_KEY = 'deepseekgui.layout.rightPanelMode'
const LEFT_PANEL_DEFAULT = 304
const RIGHT_PANEL_DEFAULT = 360
export const CODE_PANEL_PREFERRED = 560
const LEFT_PANEL_MIN = 280
const LEFT_PANEL_MAX = 480
const RIGHT_PANEL_MIN = 280
const RIGHT_PANEL_MAX = 760
const SIDEBAR_HARD_MIN = 180
const MAIN_MIN_WIDTH = 560
const PANEL_RESIZE_HANDLE_WIDTH = 5

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readStoredWidth(key: string, fallback: number): number {
  const raw = readBrowserStorageItem(key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

function persistWidth(key: string, width: number): void {
  writeBrowserStorageItem(key, String(Math.round(width)))
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = readBrowserStorageItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

function persistBoolean(key: string, value: boolean): void {
  writeBrowserStorageItem(key, value ? '1' : '0')
}

function readStoredRightPanelMode(): RightPanelMode {
  const raw = readBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  return raw === 'todo' || raw === 'changes' || raw === 'browser' ? raw : null
}

function persistRightPanelMode(mode: RightPanelMode): void {
  if (mode === 'todo' || mode === 'changes' || mode === 'browser') {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, mode)
  } else {
    removeBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  }
}

function fitWorkbenchWidths(
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  panels: { leftPanelVisible: boolean; rightPanelVisible: boolean }
): { left: number; right: number } {
  const handleWidth =
    (panels.leftPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
    (panels.rightPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0)
  const usableWidth = Math.max(0, containerWidth - handleWidth)

  if (!panels.leftPanelVisible) {
    if (!panels.rightPanelVisible) {
      return {
        left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
        right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
      }
    }
    const safeContainer = Math.max(usableWidth, MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN)
    const rightFloor =
      safeContainer - MAIN_MIN_WIDTH >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN
    const rightCeil = Math.min(
      RIGHT_PANEL_MAX,
      Math.max(rightFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      right: clampWidth(rightWidth, rightFloor, rightCeil)
    }
  }

  const safeContainer = Math.max(
    usableWidth,
    MAIN_MIN_WIDTH + SIDEBAR_HARD_MIN + (panels.rightPanelVisible ? SIDEBAR_HARD_MIN : 0)
  )
  if (!panels.rightPanelVisible) {
    const leftFloor =
      safeContainer - MAIN_MIN_WIDTH >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
    const leftCeil = Math.min(
      LEFT_PANEL_MAX,
      Math.max(leftFloor, safeContainer - MAIN_MIN_WIDTH)
    )
    return {
      left: clampWidth(leftWidth, leftFloor, leftCeil),
      right: clampWidth(rightWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)
    }
  }

  const availableSides = Math.max(
    SIDEBAR_HARD_MIN * 2,
    safeContainer - MAIN_MIN_WIDTH
  )
  const leftFloor =
    availableSides - SIDEBAR_HARD_MIN >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
  const rightFloor =
    availableSides - SIDEBAR_HARD_MIN >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN

  let nextLeft = clampWidth(leftWidth, leftFloor, LEFT_PANEL_MAX)
  let nextRight = clampWidth(rightWidth, rightFloor, RIGHT_PANEL_MAX)

  if (nextLeft + nextRight > availableSides) {
    const overflow = nextLeft + nextRight - availableSides
    const rightShrink = Math.min(overflow, nextRight - rightFloor)
    nextRight -= rightShrink
    const remaining = overflow - rightShrink
    if (remaining > 0) {
      nextLeft = Math.max(leftFloor, nextLeft - remaining)
    }
  }

  const maxLeft = Math.min(LEFT_PANEL_MAX, availableSides - rightFloor)
  nextLeft = clampWidth(nextLeft, leftFloor, Math.max(leftFloor, maxLeft))
  const maxRight = Math.min(RIGHT_PANEL_MAX, availableSides - nextLeft)
  nextRight = clampWidth(nextRight, rightFloor, Math.max(rightFloor, maxRight))

  return { left: nextLeft, right: nextRight }
}

export function useWorkbenchLayout({
  activeThreadId,
  latestAutoOpenDevPreviewUrl,
  latestDevPreviewUrl,
  route,
  workspaceRoot,
  writeAssistantOpen
}: {
  activeThreadId: string | null
  latestAutoOpenDevPreviewUrl: string | null
  latestDevPreviewUrl: string | null
  route: AppRoute
  workspaceRoot: string
  writeAssistantOpen: boolean
}) {
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(readStoredRightPanelMode)
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredWidth(RIGHT_PANEL_WIDTH_KEY, RIGHT_PANEL_DEFAULT)
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const previewThreadId = useRef<string | null>(activeThreadId)
  const autoOpenedPreviewUrlRef = useRef<string | null>(null)
  const rightPanelVisible = route === 'write' ? writeAssistantOpen : rightPanelMode !== null

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(RIGHT_PANEL_WIDTH_KEY, rightSidebarWidth)
  }, [rightSidebarWidth])

  useEffect(() => {
    persistRightPanelMode(rightPanelMode)
  }, [rightPanelMode])

  useEffect(() => {
    const onPreview = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (!detail?.path) return
      setFilePreviewTarget({
        ...detail,
        workspaceRoot: detail.workspaceRoot ?? workspaceRoot
      })
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
      setRightPanelMode('file')
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  }, [workspaceRoot])

  useEffect(() => {
    if (previewThreadId.current === activeThreadId) return
    previewThreadId.current = activeThreadId
    autoOpenedPreviewUrlRef.current = null
    if (rightPanelMode === 'browser') setRightPanelMode(null)
    if (rightPanelMode === 'file') {
      setRightPanelMode(null)
      setFilePreviewTarget(null)
    }
  }, [activeThreadId, rightPanelMode])

  useEffect(() => {
    if (!latestAutoOpenDevPreviewUrl || route !== 'chat') return
    if (autoOpenedPreviewUrlRef.current === latestAutoOpenDevPreviewUrl) return
    autoOpenedPreviewUrlRef.current = latestAutoOpenDevPreviewUrl
    setRightPanelMode('browser')
  }, [latestAutoOpenDevPreviewUrl, route])

  useEffect(() => {
    if (route !== 'write') return
    if (rightPanelMode !== null) setRightPanelMode(null)
  }, [route, rightPanelMode])

  useLayoutEffect(() => {
    const sync = (): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const next = fitWorkbenchWidths(
        containerWidth,
        leftSidebarWidth,
        rightSidebarWidth,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [leftSidebarCollapsed, leftSidebarWidth, rightPanelVisible, rightSidebarWidth])

  const toggleRightPanelMode = (nextMode: Exclude<RightPanelMode, null>): void => {
    setRightPanelMode((current) => (current === nextMode ? null : nextMode))
  }

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const openDevPreview = (): void => {
    if (latestDevPreviewUrl) {
      autoOpenedPreviewUrlRef.current = latestDevPreviewUrl
    }
    setRightPanelMode('browser')
  }

  const beginLeftResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leftSidebarCollapsed || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft + delta,
        startRight,
        {
          leftPanelVisible: true,
          rightPanelVisible
        }
      )
      setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const beginRightResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !rightPanelVisible) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft,
        startRight - delta,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible: true
        }
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      setRightSidebarWidth(next.right)
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return {
    beginLeftResize,
    beginRightResize,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setRightPanelMode,
    setRightSidebarWidth,
    shellRef,
    toggleLeftSidebar,
    toggleRightPanelMode
  }
}
