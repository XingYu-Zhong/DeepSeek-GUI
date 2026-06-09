export type GuiPlanCommand =
  | { kind: 'open' }
  | { kind: 'create'; request: string }

export function parseGuiPlanCommand(input: string): GuiPlanCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/plan')) return null
  const next = trimmed.at('/plan'.length)
  if (next && !/\s/.test(next)) return null
  const request = trimmed.slice('/plan'.length).trim()
  return request ? { kind: 'create', request } : { kind: 'open' }
}
