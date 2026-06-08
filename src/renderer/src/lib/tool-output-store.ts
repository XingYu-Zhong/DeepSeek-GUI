export type ToolOutputEntry = {
  callId: string
  toolName: string
  status: 'running' | 'success' | 'error'
  output: string
  updatedAt: number
}

type Listener = () => void

let entries: Record<string, ToolOutputEntry> = {}
const listeners: Listener[] = []

export function updateToolOutput(entry: ToolOutputEntry): void {
  entries = { ...entries, [entry.callId]: entry }
  listeners.forEach((fn) => fn())
}

export function getToolOutputs(): ToolOutputEntry[] {
  return Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getToolOutput(callId: string): ToolOutputEntry | undefined {
  return entries[callId]
}

export function clearToolOutputs(): void {
  entries = {}
  listeners.forEach((fn) => fn())
}

export function onToolOutputChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}
