import type { UiFontScale } from './app-settings-types'

export function uiFontScaleFactor(scale: UiFontScale): number {
  if (scale === 'small') return 0.82
  if (scale === 'large') return 1
  return 0.88
}
