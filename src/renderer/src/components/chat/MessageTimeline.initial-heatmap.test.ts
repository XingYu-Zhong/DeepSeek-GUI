import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

function renderHero(options: {
  route?: 'chat' | 'claw'
  ready?: boolean
  hasWorkspace?: boolean
} = {}): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: options.route ?? 'chat',
      ready: options.ready ?? true,
      hasWorkspace: options.hasWorkspace ?? true,
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

  it('shows the Kun heatmap for eligible initial chat states', () => {
    const html = renderHero()

    expect(html).toContain('Kun usage')
    expect(html).not.toContain('Start a new conversation')
  })

  it('keeps offline, missing-workspace, and Claw empty states gated away from the heatmap', () => {
    const offlineHtml = renderHero({ ready: false })
    expect(offlineHtml).toContain('DeepSeek-GUI is waking the local agent')
    expect(offlineHtml).toContain('ds-runtime-wake-logo')
    expect(offlineHtml).toContain('ds-work-logo')
    expect(renderHero({ hasWorkspace: false })).toContain('Choose working directory')
    const clawHtml = renderHero({ route: 'claw' })
    expect(clawHtml).toContain('Start a conversation with this assistant')
    expect(clawHtml).toContain('ds-claw-empty-whale-logo')
    expect(clawHtml).toContain('ds-work-logo')
    expect(clawHtml).not.toContain('Kun usage')
  })
})
