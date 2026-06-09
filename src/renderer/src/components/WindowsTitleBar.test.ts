import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import {
  buildWindowsTitleBarMenuSections,
  WindowsTitleBar,
  type WindowsTitleBarActions
} from './WindowsTitleBar'

function testActions(): WindowsTitleBarActions {
  return {
    createThread: vi.fn(),
    chooseWorkspace: vi.fn(),
    openSettings: vi.fn(),
    runDesktopCommand: vi.fn(),
    openLogDir: vi.fn(),
    showAbout: vi.fn()
  }
}

function testT(key: string): string {
  return key
}

describe('WindowsTitleBar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the desktop menu on Windows and Linux only', () => {
    const winHtml = renderToStaticMarkup(
      createElement(WindowsTitleBar, { platform: 'win32', actions: testActions() })
    )
    const linuxHtml = renderToStaticMarkup(
      createElement(WindowsTitleBar, { platform: 'linux', actions: testActions() })
    )
    const macHtml = renderToStaticMarkup(
      createElement(WindowsTitleBar, { platform: 'darwin', actions: testActions() })
    )

    expect(winHtml).toContain('ds-windows-titlebar')
    expect(linuxHtml).toContain('ds-windows-titlebar')
    expect(winHtml).toContain('File')
    expect(linuxHtml).toContain('File')
    expect(winHtml).toContain('Edit')
    expect(winHtml).toContain('View')
    expect(winHtml).toContain('Window')
    expect(winHtml).toContain('Help')
    expect(macHtml).toBe('')
  })

  it('maps menu items to desktop commands and app actions', async () => {
    const actions = testActions()
    const menus = buildWindowsTitleBarMenuSections(testT, actions)
    const item = (id: string) => {
      for (const menu of menus) {
        const found = menu.items.find((entry) => entry.id === id)
        if (found && found.kind !== 'separator') return found
      }
      throw new Error(`Missing menu item ${id}`)
    }

    await item('new-chat').onSelect()
    await item('choose-workspace').onSelect()
    await item('settings').onSelect()
    await item('copy').onSelect()
    await item('reload').onSelect()
    await item('maximize').onSelect()
    await item('open-log-dir').onSelect()

    expect(actions.createThread).toHaveBeenCalledTimes(1)
    expect(actions.chooseWorkspace).toHaveBeenCalledTimes(1)
    expect(actions.openSettings).toHaveBeenCalledTimes(1)
    expect(actions.runDesktopCommand).toHaveBeenCalledWith('copy')
    expect(actions.runDesktopCommand).toHaveBeenCalledWith('reload')
    expect(actions.runDesktopCommand).toHaveBeenCalledWith('toggleMaximize')
    expect(actions.openLogDir).toHaveBeenCalledTimes(1)
  })
})
