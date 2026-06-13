import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

/**
 * Tests for the "runtime offline" hero (`RuntimeWakeHero` inside
 * `MessageTimelineEmptyHero`). See issue #78 — when the user-reported port
 * conflict occurred, the hero only showed a vague "正在唤醒本地智能体" title
 * while the specific error lived in a faint detail paragraph below. Users
 * skimmed the title, thought the app was still loading, and never opened
 * Settings. The fix: when `runtimeError` is present, surface the localized
 * error in the title slot so the user sees the real cause immediately.
 */

function renderOfflineHero(runtimeError: string | null = null): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: 'chat',
      ready: false,
      hasWorkspace: true,
      runtimeError,
      activeClawChannel: null,
      onPickWorkspace: () => undefined,
      onRetry: () => undefined,
      onOpenSettings: () => undefined,
      onSelectSuggestion: () => undefined
    })
  )
}

describe('MessageTimelineEmptyHero — runtime offline hero (issue #78)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses the waking title when no runtime error is available', () => {
    const html = renderOfflineHero(null)
    expect(html).toContain('Kun is waking the local agent')
    expect(html).not.toContain('Cannot connect to the local runtime')
  })

  it('switches to the error title and surfaces the localized error when a runtime error is provided', () => {
    const portConflict = i18n.t('common:runtimePortConflict')
    const html = renderOfflineHero(portConflict)
    // New error title should appear (so users see the failure immediately)
    expect(html).toContain('Cannot connect to the local runtime')
    // The old "waking" title must NOT appear — that's the bug we're fixing
    expect(html).not.toContain('Kun is waking the local agent')
    // The specific localized port-conflict message should appear in the body
    expect(html).toContain(portConflict)
  })

  it('treats whitespace-only runtimeError as no error', () => {
    const html = renderOfflineHero('   \n  ')
    // Falls back to the generic waking hero
    expect(html).toContain('Kun is waking the local agent')
    expect(html).not.toContain('Cannot connect to the local runtime')
  })

  it('keeps both the retry and open-settings actions visible on the error hero', () => {
    const html = renderOfflineHero(i18n.t('common:runtimePortConflict'))
    expect(html).toContain('Retry')
    expect(html).toContain('Open Settings')
  })

  it('plays the waking loading effects only while genuinely reconnecting', () => {
    // Still probing: stage carries the is-waking modifier with the Zzz /
    // sonar / caret decorations.
    const waking = renderOfflineHero(null)
    expect(waking).toContain('is-waking')
    expect(waking).toContain('ds-runtime-wake-zzz')
    expect(waking).toContain('ds-runtime-wake-sonar')
    expect(waking).toContain('ds-runtime-wake-caret')

    // Runtime error: same #78 principle as the title swap — an error state
    // must not look like it is still loading, so the effects are dropped.
    const errored = renderOfflineHero(i18n.t('common:runtimePortConflict'))
    expect(errored).not.toContain('is-waking')
    expect(errored).not.toContain('ds-runtime-wake-zzz')
    expect(errored).not.toContain('ds-runtime-wake-sonar')
    expect(errored).not.toContain('ds-runtime-wake-caret')
  })
})

describe('MessageTimelineEmptyHero — runtime offline hero (issue #78, zh-CN)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('uses 正在唤醒 title when no runtime error is available', () => {
    const html = renderOfflineHero(null)
    expect(html).toContain('正在唤醒本地智能体')
    expect(html).not.toContain('无法连接到本地运行时')
  })

  it('switches to 无法连接到本地运行时 title and surfaces the localized port-conflict error', () => {
    const portConflict = i18n.t('common:runtimePortConflict')
    const html = renderOfflineHero(portConflict)
    expect(html).toContain('无法连接到本地运行时')
    expect(html).not.toContain('正在唤醒本地智能体')
    expect(html).toContain(portConflict)
  })
})
