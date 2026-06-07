import type { UiFontScale } from '../../../shared/app-settings'
import { uiFontScaleFactor } from '../../../shared/ui-font-scale'

export type ThemePreference = 'system' | 'light' | 'dark'
export type { UiFontScale } from '../../../shared/app-settings'

let removeSystemListener: (() => void) | null = null

function resolvedMode(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies `data-theme` on `<html>` for Tailwind `dark:` variants and CSS variables.
 */
export function applyTheme(pref: ThemePreference): void {
  removeSystemListener?.()
  removeSystemListener = null

  const root = document.documentElement
  const apply = (): void => {
    const mode = resolvedMode(pref)
    root.setAttribute('data-theme', mode)
    if (
      window.dsGui?.platform !== 'darwin' &&
      typeof window.dsGui.setWindowsTitleBarTheme === 'function'
    ) {
      void window.dsGui.setWindowsTitleBarTheme(mode)
    }
  }

  if (pref === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      apply()
    }
    mq.addEventListener('change', onChange)
    removeSystemListener = (): void => {
      mq.removeEventListener('change', onChange)
    }
  }

  apply()
}

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement
  root.style.setProperty('--ds-ui-scale', String(uiFontScaleFactor(scale)))
}
