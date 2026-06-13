import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

function renderHero(options: {
  route?: 'chat' | 'claw'
  ready?: boolean
  hasWorkspace?: boolean
  runtimeError?: string | null
} = {}): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: options.route ?? 'chat',
      ready: options.ready ?? true,
      hasWorkspace: options.hasWorkspace ?? true,
      runtimeError: options.runtimeError ?? null,
      activeClawChannel: null,
      onPickWorkspace: () => undefined,
      onRetry: () => undefined,
      onOpenSettings: () => undefined,
      onSelectSuggestion: () => undefined
    })
  )
}

describe('MessageTimeline initial heatmap empty hero routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the collapsed Kun calendar for eligible initial chat states', () => {
    const html = renderHero()

    expect(html).toContain('Expand calendar')
    expect(html).not.toContain('Daily Kun usage calendar')
    expect(html).not.toContain('Start a new conversation')
  })

  it('keeps offline, missing-workspace, and Claw empty states gated away from the heatmap', () => {
    const offlineHtml = renderHero({ ready: false })
    expect(offlineHtml).toContain('Kun is waking the local agent')
    expect(offlineHtml).toContain('ds-kun-state-sleep')
    const workspaceHtml = renderHero({ hasWorkspace: false })
    expect(workspaceHtml).toContain('Choose working directory')
    expect(workspaceHtml).toContain('ds-kun-state-sit')
    const clawHtml = renderHero({ route: 'claw' })
    expect(clawHtml).toContain('Start a conversation with this assistant')
    expect(clawHtml).toContain('ds-kun-state-greet')
    expect(clawHtml).not.toContain('Kun usage')
  })

  it('shows the runtime error in the offline hero when one is available', () => {
    const html = renderHero({
      ready: false,
      runtimeError: i18n.t('common:runtimePortConflict')
    })

    expect(html).toContain('The runtime port is already in use.')
  })
})
