import type { ToolBlock } from '../../agent/types'

export function readNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!meta) return undefined
  const v = meta[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function formatToolTitle(block: ToolBlock, t: (key: string) => string): string {
  if (block.toolKind === 'file_change') return t('toolActionFile')
  if (block.toolKind === 'command_execution') return t('toolActionCommand')
  return t('toolActionTool')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${s}s`
  }
  if (ms < 86_400_000) {
    const totalMinutes = Math.round(ms / 60_000)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${h}h ${m}m`
  }
  const totalHours = Math.round(ms / 3_600_000)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return `${d}d ${h}h`
}
