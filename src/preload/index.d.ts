import type { DsGuiApi } from '../shared/ds-gui-api'

export type * from '../shared/ds-gui-api'

declare global {
  interface Window {
    dsGui: DsGuiApi
  }
}
