/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        allowpopups?: string
        partition?: string
        src?: string
        webpreferences?: string
      }
    }
  }
}
