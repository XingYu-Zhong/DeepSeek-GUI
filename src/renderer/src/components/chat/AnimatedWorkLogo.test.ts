import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatedWorkLogo } from './AnimatedWorkLogo'
import { WorkMetaRow } from './message-timeline-cards'

describe('AnimatedWorkLogo', () => {
  it('renders layered logo markup for swim animation', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, className: 'extra-class', size: 'md' })
    )

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-md')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).toContain('is-active')
    expect(html).toContain('extra-class')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-current')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-ripple')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-wake')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).toContain('ds-work-logo-bubbles')
    expect(html).toContain('ds-work-logo-echo')
    expect(html).toContain('ds-work-logo-track')
    expect(html).toContain('ds-work-logo-body')
    expect(html).toContain('ds-work-logo-image')
    expect(html).toContain('ds-work-logo-tail')
  })

  it('defaults to a static logo unless active', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo))

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).not.toContain('is-active')
  })

  it('keeps wave and splash layers mounted in static state to avoid layout churn', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { size: 'sm' }))

    expect(html).toContain('ds-work-logo-sm')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).not.toContain('is-active')
  })

  it('can render a desynchronized trailing phase', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { active: true, phase: 'trail' }))

    expect(html).toContain('is-active')
    expect(html).toContain('ds-work-logo-phase-trail')
  })

  it('keeps the processing work row as text-only status', () => {
    const html = renderToStaticMarkup(
      createElement(WorkMetaRow, {
        processing: true,
        stepCount: 3,
        expanded: true,
        onToggle: () => undefined
      })
    )

    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo-slot')
  })

  it('keeps the swim animation layers wired in CSS', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const baseShellCss = await readFile(new URL('../../styles/base-shell.css', import.meta.url), 'utf8')

    for (const layer of [
      'gust',
      'swell',
      'wave-front',
      'breaker',
      'wake',
      'foam',
      'waterline',
      'crest',
      'splash',
      'spray',
      'bubbles'
    ]) {
      expect(baseShellCss).toContain(`ds-work-logo-${layer}`)
    }

    expect(baseShellCss).toContain('.ds-work-logo.is-active .ds-work-logo-body::after')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-waterline')
    expect(baseShellCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
