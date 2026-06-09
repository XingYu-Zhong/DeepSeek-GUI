import type { FormEvent, ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  PanelRightClose,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X
} from 'lucide-react'
import type { ChatBlock } from '../agent/types'
import {
  DEFAULT_DEV_PREVIEW_URL,
  normalizeDevPreviewUrlInput
} from '@shared/dev-preview-url'
import {
  extractDetectedDevPreviewUrls,
  formatDevPreviewUrlLabel
} from '../lib/dev-preview-detection'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'

type DevWebviewTag = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  goBack(): void
  goForward(): void
  reloadIgnoringCache(): void
}

type WebviewNavigateEvent = Event & {
  url: string
}

type WebviewFailLoadEvent = Event & {
  errorCode: number
  errorDescription: string
  isMainFrame: boolean
}

type WebviewTitleEvent = Event & {
  title: string
}

const PREVIEW_URL_STORAGE_KEY = 'deepseekgui.devPreview.url'
const PREVIEW_AUTO_FOLLOW_STORAGE_KEY = 'deepseekgui.devPreview.autoFollow'

function readStoredUrl(): string | null {
  try {
    const raw = readBrowserStorageItem(PREVIEW_URL_STORAGE_KEY)
    const normalized = raw ? normalizeDevPreviewUrlInput(raw) : null
    if (!normalized) return null
    if (normalized === DEFAULT_DEV_PREVIEW_URL) {
      removeBrowserStorageItem(PREVIEW_URL_STORAGE_KEY)
      return null
    }
    const parsed = new URL(normalized)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    if (/^\/(?:health|metrics|readyz?|livez?|v\d+)(?:\/|$)/.test(pathname)) return null
    if (/\/(?:health|metrics|readyz?|livez?)(?:\/|$)/.test(pathname)) return null
    return normalized
  } catch {
    return null
  }
}

function persistUrl(url: string): void {
  writeBrowserStorageItem(PREVIEW_URL_STORAGE_KEY, url)
}

function readStoredAutoFollow(): boolean {
  const raw = readBrowserStorageItem(PREVIEW_AUTO_FOLLOW_STORAGE_KEY)
  return raw == null ? true : raw === 'true'
}

function persistAutoFollow(value: boolean): void {
  writeBrowserStorageItem(PREVIEW_AUTO_FOLLOW_STORAGE_KEY, String(value))
}

function formatAddressInput(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

type LoadOptions = {
  keepAutoFollow?: boolean
}

export function resolveInitialDevBrowserUrl(input: {
  normalizedPreferredUrl?: string | null
  storedUrl?: string | null
  latestDetectedUrl?: string | null
}): string | null {
  return input.normalizedPreferredUrl ?? input.storedUrl ?? input.latestDetectedUrl ?? null
}

export function canUseElectronWebviewEnvironment(input: {
  openExternalAvailable: boolean
  userAgent: string
}): boolean {
  return input.openExternalAvailable && /\bElectron\//.test(input.userAgent)
}

export function DevBrowserPanel({
  blocks,
  preferredUrl,
  className,
  onCollapse
}: {
  blocks: ChatBlock[]
  preferredUrl?: string | null
  className?: string
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const webviewRef = useRef<DevWebviewTag | null>(null)
  const iframeLoadedUrlRef = useRef<string | null>(null)
  const detectedUrls = useMemo(() => extractDetectedDevPreviewUrls(blocks), [blocks])
  const latestDetectedUrl = detectedUrls[0] ?? null
  const useElectronWebview = canUseElectronWebviewEnvironment({
    openExternalAvailable: typeof window.dsGui?.openExternal === 'function',
    userAgent: window.navigator.userAgent
  })
  const normalizedPreferredUrl = useMemo(
    () => (preferredUrl ? normalizeDevPreviewUrlInput(preferredUrl) : null),
    [preferredUrl]
  )
  const initialUrl = resolveInitialDevBrowserUrl({
    normalizedPreferredUrl,
    storedUrl: readStoredUrl(),
    latestDetectedUrl
  })
  const preferredUrlRef = useRef<string | null>(normalizedPreferredUrl)
  const [activeUrl, setActiveUrl] = useState<string | null>(initialUrl)
  const [draftUrl, setDraftUrl] = useState(() => (initialUrl ? formatAddressInput(initialUrl) : ''))
  const [autoFollow, setAutoFollow] = useState(readStoredAutoFollow)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [iframeBackStack, setIframeBackStack] = useState<string[]>([])
  const [iframeForwardStack, setIframeForwardStack] = useState<string[]>([])
  const [iframeReloadNonce, setIframeReloadNonce] = useState(0)
  const [previewInstanceNonce, setPreviewInstanceNonce] = useState(0)
  const canNavigateBack = useElectronWebview ? canGoBack : iframeBackStack.length > 0
  const canNavigateForward = useElectronWebview ? canGoForward : iframeForwardStack.length > 0

  useEffect(() => {
    persistAutoFollow(autoFollow)
  }, [autoFollow])

  useEffect(() => {
    if (activeUrl) persistUrl(activeUrl)
  }, [activeUrl])

  useEffect(() => {
    if (!normalizedPreferredUrl || preferredUrlRef.current === normalizedPreferredUrl) return
    preferredUrlRef.current = normalizedPreferredUrl
    setAutoFollow(true)
    setActiveUrl(normalizedPreferredUrl)
    setDraftUrl(formatAddressInput(normalizedPreferredUrl))
    setPageTitle('')
    setLoading(true)
    setLoadError(null)
  }, [normalizedPreferredUrl])

  useEffect(() => {
    if (!autoFollow || !latestDetectedUrl || latestDetectedUrl === activeUrl) return
    setActiveUrl(latestDetectedUrl)
    setDraftUrl(formatAddressInput(latestDetectedUrl))
    setPageTitle('')
    setLoading(true)
    setLoadError(null)
  }, [activeUrl, autoFollow, latestDetectedUrl])

  useEffect(() => {
    const webview = webviewRef.current
    if (!useElectronWebview || !activeUrl || !webview) return

    const syncNavigationState = (): void => {
      try {
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
        const currentUrl = normalizeDevPreviewUrlInput(webview.getURL())
        if (currentUrl) {
          setActiveUrl(currentUrl)
          setDraftUrl(formatAddressInput(currentUrl))
        }
      } catch {
        /* webview may not be attached yet */
      }
    }

    const handleStartLoading = (): void => {
      setLoading(true)
      setLoadError(null)
    }
    const handleStopLoading = (): void => {
      setLoading(false)
      syncNavigationState()
    }
    const handleNavigate: EventListener = (event): void => {
      const currentUrl = normalizeDevPreviewUrlInput((event as WebviewNavigateEvent).url)
      if (!currentUrl) return
      setActiveUrl(currentUrl)
      setDraftUrl(formatAddressInput(currentUrl))
      setLoadError(null)
      syncNavigationState()
    }
    const handleFailLoad: EventListener = (event): void => {
      const failEvent = event as WebviewFailLoadEvent
      if (!failEvent.isMainFrame || failEvent.errorCode === -3) return
      setLoading(false)
      setLoadError(failEvent.errorDescription || t('browserLoadFailed'))
      syncNavigationState()
    }
    const handleTitle: EventListener = (event): void => {
      setPageTitle((event as WebviewTitleEvent).title)
    }

    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFailLoad)
    webview.addEventListener('page-title-updated', handleTitle)

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFailLoad)
      webview.removeEventListener('page-title-updated', handleTitle)
    }
  }, [activeUrl, previewInstanceNonce, t, useElectronWebview])

  useEffect(() => {
    if (useElectronWebview || !activeUrl) return
    iframeLoadedUrlRef.current = null
    setLoading(true)
    setLoadError(null)

    const timeout = window.setTimeout(() => {
      if (iframeLoadedUrlRef.current === activeUrl) return
      setLoading(false)
      setLoadError(t('browserLoadFailed'))
    }, 10000)

    return () => window.clearTimeout(timeout)
  }, [activeUrl, iframeReloadNonce, t, useElectronWebview])

  const loadUrl = (value: string, options: LoadOptions = {}): void => {
    const normalized = normalizeDevPreviewUrlInput(value)
    if (!normalized) {
      setLoadError(t('browserInvalidUrl'))
      return
    }
    if (!options.keepAutoFollow) setAutoFollow(false)
    setLoadError(null)
    setPageTitle('')
    setDraftUrl(formatAddressInput(normalized))
    if (normalized === activeUrl) {
      reload()
      return
    }
    if (!useElectronWebview && activeUrl && normalized !== activeUrl) {
      setIframeBackStack((stack) => [...stack, activeUrl].slice(-30))
      setIframeForwardStack([])
    }
    setLoading(true)
    setActiveUrl(normalized)
  }

  const submitUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    loadUrl(draftUrl)
  }

  const reload = (): void => {
    if (!activeUrl) return
    if (!useElectronWebview) {
      const normalized = normalizeDevPreviewUrlInput(activeUrl)
      if (!normalized) return
      iframeLoadedUrlRef.current = null
      setIframeReloadNonce((nonce) => nonce + 1)
      setLoading(true)
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    const webview = webviewRef.current
    if (!webview) {
      setPreviewInstanceNonce((nonce) => nonce + 1)
      return
    }
    try {
      webview.reloadIgnoringCache()
    } catch {
      setPreviewInstanceNonce((nonce) => nonce + 1)
    }
  }

  const resetPreview = (): void => {
    setAutoFollow(false)
    setLoadError(null)
    setPageTitle('')
    setCanGoBack(false)
    setCanGoForward(false)
    setIframeBackStack([])
    setIframeForwardStack([])
    iframeLoadedUrlRef.current = null
    setIframeReloadNonce(0)
    setPreviewInstanceNonce((nonce) => nonce + 1)
    setDraftUrl('')
    setLoading(false)
    setActiveUrl(null)
    removeBrowserStorageItem(PREVIEW_URL_STORAGE_KEY)
  }

  const openExternal = (): void => {
    if (!activeUrl) return
    const normalized = normalizeDevPreviewUrlInput(activeUrl)
    if (!normalized) return
    if (typeof window.dsGui?.openExternal === 'function') {
      void window.dsGui.openExternal(normalized).catch(() => undefined)
      return
    }
    window.open(normalized, '_blank', 'noopener,noreferrer')
  }

  const goBack = (): void => {
    if (!activeUrl) return
    if (!useElectronWebview) {
      const previousUrl = iframeBackStack.at(-1)
      if (!previousUrl) return
      setIframeBackStack((stack) => stack.slice(0, -1))
      setIframeForwardStack((stack) => [activeUrl, ...stack].slice(0, 30))
      setLoadError(null)
      setPageTitle('')
      setLoading(true)
      setActiveUrl(previousUrl)
      setDraftUrl(formatAddressInput(previousUrl))
      return
    }
    try {
      if (webviewRef.current?.canGoBack()) webviewRef.current.goBack()
    } catch {
      /* ignore unavailable webview navigation */
    }
  }

  const goForward = (): void => {
    if (!activeUrl) return
    if (!useElectronWebview) {
      const nextUrl = iframeForwardStack[0]
      if (!nextUrl) return
      setIframeForwardStack((stack) => stack.slice(1))
      setIframeBackStack((stack) => [...stack, activeUrl].slice(-30))
      setLoadError(null)
      setPageTitle('')
      setLoading(true)
      setActiveUrl(nextUrl)
      setDraftUrl(formatAddressInput(nextUrl))
      return
    }
    try {
      if (webviewRef.current?.canGoForward()) webviewRef.current.goForward()
    } catch {
      /* ignore unavailable webview navigation */
    }
  }

  const primaryDetectedUrl = latestDetectedUrl ?? detectedUrls[0] ?? null
  const tabLabel = activeUrl
    ? pageTitle || formatDevPreviewUrlLabel(activeUrl)
    : t('browserNewTab')

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white backdrop-blur-xl dark:bg-ds-canvas ${className ?? ''}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-10 min-w-0 items-center gap-2 border-b border-ds-border-muted/70 bg-ds-surface-subtle/55 px-3 dark:bg-white/[0.035]">
          <div className="flex h-8 min-w-0 max-w-[15rem] items-center gap-2 rounded-[8px] bg-white px-2.5 pl-3 text-[12px] font-semibold text-ds-ink shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:bg-white/[0.09]">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{tabLabel}</span>
            <button
              type="button"
              onClick={onCollapse}
              className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10"
              aria-label={t('browserCloseTab')}
              title={t('browserCloseTab')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.85} />
            </button>
          </div>
          <button
            type="button"
            onClick={resetPreview}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-white hover:text-ds-ink dark:hover:bg-white/10"
            aria-label={t('browserNewTab')}
            title={t('browserNewTab')}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <form onSubmit={submitUrl} className="flex h-12 min-w-0 items-center gap-2 px-3">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>

          <div className="flex shrink-0 items-center gap-1 rounded-full bg-ds-surface-subtle p-0.5 dark:bg-white/[0.08]">
            <button
              type="button"
              onClick={goBack}
              disabled={!canNavigateBack}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-white hover:text-ds-ink disabled:cursor-default disabled:opacity-35 dark:hover:bg-white/10"
              aria-label={t('browserBack')}
              title={t('browserBack')}
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={goForward}
              disabled={!canNavigateForward}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-white hover:text-ds-ink disabled:cursor-default disabled:opacity-35 dark:hover:bg-white/10"
              aria-label={t('browserForward')}
              title={t('browserForward')}
            >
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={reload}
              disabled={!activeUrl}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-white hover:text-ds-ink disabled:cursor-default disabled:opacity-35 dark:hover:bg-white/10"
              aria-label={t('browserReload')}
              title={t('browserReload')}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
            </button>
          </div>

          <div className="flex h-8 min-w-[7rem] flex-1 items-center gap-2 rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 text-ds-muted transition focus-within:border-ds-border-strong focus-within:bg-white dark:bg-white/[0.07] dark:focus-within:bg-white/10">
            <Globe2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <input
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              className="h-full w-full min-w-0 bg-transparent text-[13px] font-medium text-ds-ink outline-none"
              placeholder={t('browserAddressPlaceholder')}
              spellCheck={false}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('browserOpen')}
              title={t('browserOpen')}
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setAutoFollow((value) => !value)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-ds-hover ${
                autoFollow ? 'text-sky-500 dark:text-sky-300' : 'text-ds-faint hover:text-ds-ink'
              }`}
              aria-label={t('browserAutoFollow')}
              aria-pressed={autoFollow}
              title={t('browserAutoFollow')}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={resetPreview}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('browserReset')}
              title={t('browserReset')}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={openExternal}
              disabled={!activeUrl}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-35"
              aria-label={t('browserOpenExternal')}
              title={t('browserOpenExternal')}
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </form>

        {pageTitle ? (
          <div className="min-w-0 truncate px-3 pb-2 text-[11px] font-medium leading-4 text-ds-muted">
            {pageTitle}
          </div>
        ) : null}

        {detectedUrls.length > 0 ? (
          <div className="flex min-w-0 gap-1.5 overflow-x-auto px-3 pb-2">
            {detectedUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => loadUrl(url, { keepAutoFollow: url === latestDetectedUrl })}
                className="shrink-0 rounded-full border border-ds-border-muted bg-ds-surface-subtle px-2.5 py-1 text-[10.5px] font-medium text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink dark:bg-white/[0.06]"
                title={url}
              >
                {formatDevPreviewUrlLabel(url)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loadError ? (
        <div className="shrink-0 border-b border-red-200/70 bg-red-50/85 px-3 py-2 text-[11px] leading-5 text-red-800 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-100">
          {loadError}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-white dark:bg-ds-canvas">
        {!activeUrl ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Globe2 className="h-16 w-16 text-zinc-400 dark:text-zinc-500" strokeWidth={1.45} />
            <div className="mt-7 text-[14px] font-semibold text-ds-ink">
              {t('browserEmptyTitle')}
            </div>
            <div className="mt-2 text-[12px] font-medium text-ds-faint">
              {t('browserEmptySubtitle')}
            </div>
            <button
              type="button"
              onClick={() => {
                if (primaryDetectedUrl) {
                  loadUrl(primaryDetectedUrl, { keepAutoFollow: primaryDetectedUrl === latestDetectedUrl })
                  return
                }
                setAutoFollow(true)
              }}
              className="mt-6 inline-flex h-8 items-center justify-center rounded-full bg-ds-surface-subtle px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
            >
              {t('browserShowAll')}
            </button>
          </div>
        ) : useElectronWebview ? (
          <webview
            key={`webview:${previewInstanceNonce}`}
            ref={webviewRef}
            src={activeUrl}
            partition="persist:deepseek-dev-browser"
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            className="flex h-full w-full bg-white"
          />
        ) : (
          <iframe
            key={`iframe:${previewInstanceNonce}:${activeUrl}:${iframeReloadNonce}`}
            src={activeUrl}
            title={pageTitle || t('browserTitle')}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => {
              iframeLoadedUrlRef.current = activeUrl
              setLoading(false)
              setLoadError(null)
            }}
            className="block h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </aside>
  )
}
