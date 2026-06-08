import type { DsGuiApi } from '../shared/ds-gui-api'

// Terminal-specific types extended from DsGuiApi
export type TerminalCreateResult = { ok: true; id: string } | { ok: false; message: string }
export type TerminalWriteResult = { ok: true } | { ok: false; message: string }
export type TerminalResizeResult = { ok: true } | { ok: false; message: string }

export type TerminalDataEvent = { id: string; data: string }
export type TerminalExitEvent = { id: string; code: number }
