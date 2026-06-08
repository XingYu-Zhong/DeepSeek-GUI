import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, RefreshCw } from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import type { ToolBlock } from '../agent/types'

type Props = {
  className?: string
  onCollapse?: () => void
}

export function KunOutputPanel({ className = '', onCollapse }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const blocks = useChatStore((s) => s.blocks)
  const busy = useChatStore((s) => s.busy)

  const toolBlocks = blocks.filter(
    (b): b is ToolBlock => b.kind === 'tool'
  )

  const refreshOutput = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.clear()

    if (toolBlocks.length === 0) {
      term.writeln('\x1b[1;33mWaiting for tool output...\x1b[0m')
      term.writeln('')
      term.writeln('\x1b[2mKun will display command output here as it executes.\x1b[0m')
      return
    }

    for (const block of toolBlocks) {
      const icon = block.status === 'running' ? '\x1b[1;33m\u25b6\x1b[0m'
        : block.status === 'success' ? '\x1b[1;32m\u2713\x1b[0m'
        : '\x1b[1;31m\u2717\x1b[0m'

      term.writeln(`${icon} \x1b[1m${block.toolKind ?? 'tool'}\x1b[0m — ${block.summary}`)

      if (block.detail) {
        // Strip ANSI if already present, we'll write it as-is since xterm handles it
        const lines = block.detail.split('\n')
        for (const line of lines.slice(0, 200)) {
          term.write(`  ${line}\r\n`)
        }
        if (lines.length > 200) {
          term.writeln(`  \x1b[2m... (${lines.length - 200} more lines)\x1b[0m`)
        }
      }

      if (block.meta) {
        const exitCode = block.meta['exit_code'] as number | undefined
        if (exitCode !== undefined) {
          term.writeln(`  exit: ${exitCode}`)
        }
        const duration = block.meta['duration_ms'] as number | undefined
        if (duration !== undefined) {
          term.writeln(`  time: ${duration}ms`)
        }
      }
      term.writeln('')
    }
  }, [toolBlocks])

  useEffect(() => {
    const container = ref.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#161616',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        black: '#1a1a2e',
        green: '#4ade80',
        yellow: '#facc15',
        red: '#f87171',
        blue: '#60a5fa',
        white: '#e4e4e7',
      },
      allowProposedApi: true,
      cols: 80,
      rows: 30,
      smoothScrollDuration: 0,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    termRef.current = term

    setTimeout(() => { try { fitAddon.fit() } catch {} }, 100)

    const handleResize = (): void => {
      try { fitAddon.fit() } catch {}
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  // Refresh output when tool blocks change
  useEffect(() => {
    refreshOutput()
  }, [refreshOutput])

  return (
    <div className={`flex h-full flex-col bg-[#161616] border-l border-white/5 ${className}`}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white/70 select-none">Kun Output</span>
          {busy ? (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-white/40 hover:text-white/70 hover:bg-white/10 transition flex items-center gap-1"
            onClick={refreshOutput}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-white/40 hover:text-white/70 hover:bg-white/10 transition"
            onClick={onCollapse}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div ref={ref} className="flex-1 min-h-0" />
    </div>
  )
}
