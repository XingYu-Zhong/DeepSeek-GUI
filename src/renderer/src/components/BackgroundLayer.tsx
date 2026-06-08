import type { BackgroundImageSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'

let cached: BackgroundImageSettingsV1 = { dataUrl: '', opacity: 0.15, blur: 0 }
let initialized = false

export function getBackgroundImage(): BackgroundImageSettingsV1 {
  return cached
}

export function setBackgroundImage(bg: BackgroundImageSettingsV1): void {
  cached = bg
  applyBg(bg)
}

function applyBg(bg: BackgroundImageSettingsV1): void {
  const body = document.body

  let style = document.getElementById('custom-bg-style') as HTMLStyleElement | null

  if (bg.dataUrl) {
    body.classList.add('custom-bg-enabled')

    if (!style) {
      style = document.createElement('style')
      style.id = 'custom-bg-style'
      document.head.appendChild(style)
    }

    style.textContent = `
      /* background image layer */
      body.custom-bg-enabled::before {
        content: '' !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: -1 !important;
        pointer-events: none !important;
        background-image: url(${bg.dataUrl}) !important;
        background-size: cover !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
        background-attachment: fixed !important;
        opacity: ${bg.opacity} !important;
        filter: ${bg.blur > 0 ? `blur(${bg.blur}px)` : 'none'} !important;
      }

      /* hide theme gradients */
      body.custom-bg-enabled::after {
        display: none !important;
      }
      body.custom-bg-enabled .ds-stage-surface::before {
        display: none !important;
      }

      /* make all major surfaces transparent */
      body.custom-bg-enabled .bg-ds-main,
      body.custom-bg-enabled .bg-ds-sidebar,
      body.custom-bg-enabled .bg-ds-canvas,
      body.custom-bg-enabled .bg-ds-card,
      body.custom-bg-enabled .bg-ds-elevated,
      body.custom-bg-enabled .bg-ds-subtle,
      body.custom-bg-enabled [class*="bg-ds-main"],
      body.custom-bg-enabled [class*="bg-ds-sidebar"],
      body.custom-bg-enabled [class*="bg-ds-canvas"],
      body.custom-bg-enabled [class*="bg-ds-card"],
      body.custom-bg-enabled [class*="bg-ds-elevated"],
      body.custom-bg-enabled [class*="bg-ds-subtle"],
      body.custom-bg-enabled .ds-workbench-shell,
      body.custom-bg-enabled .ds-stage-surface,
      body.custom-bg-enabled .ds-drag,
      body.custom-bg-enabled .ds-no-drag {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
    `
  } else {
    body.classList.remove('custom-bg-enabled')
    if (style) style.remove()
  }
}

export function initBackgroundImage(): void {
  if (initialized) return
  initialized = true

  rendererRuntimeClient
    .getSettings({ forceRefresh: false })
    .then((s) => {
      setBackgroundImage(
        s.backgroundImage ?? { dataUrl: '', opacity: 0.15, blur: 0 }
      )
    })
    .catch(() => {})
}
