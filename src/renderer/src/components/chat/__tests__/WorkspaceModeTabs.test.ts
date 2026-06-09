import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders two tab buttons', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    // Both buttons exist
    expect(html).toContain('Code')
    expect(html).toContain('Write')
    // Both have role="tab"
    expect(html.match(/role="tab"/g)?.length).toBe(2)
  })

  it('uses horizontal row layout not vertical column', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    // Container should have flex-row, not flex-col
    expect(html).toContain('flex-row')
    expect(html).not.toContain('flex-col')
  })

  it('buttons use flex-1 for equal width instead of w-full', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    // Each button should have flex-1 to distribute space equally
    const flex1Matches = html.match(/flex-1/g)
    expect(flex1Matches?.length).toBe(2)
  })

  it('marks active button with aria-selected true', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    // Code active
    const htmlCode = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )
    // Exactly one button has aria-selected="true" and one has aria-selected="false"
    const selectedTrue = htmlCode.match(/aria-selected="true"/g)
    const selectedFalse = htmlCode.match(/aria-selected="false"/g)
    expect(selectedTrue?.length).toBe(1)
    expect(selectedFalse?.length).toBe(1)

    // Write active
    const htmlWrite = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'write',
        onCodeOpen,
        onWriteOpen
      })
    )
    const selectedTrueW = htmlWrite.match(/aria-selected="true"/g)
    const selectedFalseW = htmlWrite.match(/aria-selected="false"/g)
    expect(selectedTrueW?.length).toBe(1)
    expect(selectedFalseW?.length).toBe(1)
  })

  it('preserves truncate class on button text for narrow sidebars', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    // Both label spans should have truncate class
    const truncateMatches = html.match(/truncate/g)
    expect(truncateMatches?.length).toBe(2)
  })

  it('preserves min-w-0 on buttons for flex truncation', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    // min-w-0 must be present to allow truncate to work in flex children
    expect(html).toContain('min-w-0')
  })

  it('renders role="tablist" container with descriptive aria-label', () => {
    const onCodeOpen = vi.fn()
    const onWriteOpen = vi.fn()

    const html = renderToStaticMarkup(
      createElement(WorkspaceModeTabs, {
        activeView: 'chat',
        onCodeOpen,
        onWriteOpen
      })
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('Code / Write')
  })
})
