import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, RefreshCw, Plus, Monitor } from 'lucide-react'
import type { SshProfileV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { getToolOutputs, onToolOutputChange, type ToolOutputEntry } from '../lib/tool-output-store'

type Props = {
  className?: string
  workspaceRoot?: string
  onCollapse?: () => void
}

type TerminalTab = {
  id: string
  title: string
  sessionId: string | null
}

export function TerminalPanel({ className = '', workspaceRoot, onCollapse }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const disposedRef = useRef(false)
  const [exited, setExited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const [sshProfiles, setSshProfiles] = useState<SshProfileV1[]>([])
  const [selectedSshId, setSelectedSshId] = useState<string>('')
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: '1', title: 'local', sessionId: null }
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [monitorMode, setMonitorMode] = useState(false)
  const [monitorEntries, setMonitorEntries] = useState<ToolOutputEntry[]>([])
  const tabCounter = useRef(1)

  useEffect(() => {
    rendererRuntimeClient.getSettings({ forceRefresh: false }).then((s) => {
      setSshProfiles(s.ssh?.profiles ?? [])
    }).catch(() => {})
  }, [])

  const selectedSsh = sshProfiles.find((p) => p.id === selectedSshId)
  const sshCommand = selectedSsh
    ? `ssh ${selectedSsh.keyPath ? `-i "${selectedSsh.keyPath}"` : ''} ${selectedSsh.user}@${selectedSsh.host} -p ${selectedSsh.port}`
    : null

  const dispose = useCallback(() => {
    if (disposedRef.current) return
    disposedRef.current = true
    const id = sessionIdRef.current
    if (id) {
      window.dsGui.destroyTerminal({ id }).catch(() => {})
      sessionIdRef.current = null
    }
    try { termRef.current?.dispose() } catch {}
    termRef.current = null
  }, [])

  const restart = useCallback(() => {
    dispose()
    disposedRef.current = false
    setExited(false)
    setError(null)
    setKey((k) => k + 1)
  }, [dispose])

  const addTab = useCallback(() => {
    tabCounter.current += 1
    const id = String(tabCounter.current)
    const title = selectedSsh ? selectedSsh.name : `shell ${tabCounter.current}`
    setTabs((prev) => [...prev, { id, title, sessionId: null }])
    setActiveTabId(id)
    // restart to create new PTY
    dispose()
    disposedRef.current = false
    setExited(false)
    setError(null)
    setKey((k) => k + 1)
  }, [selectedSsh, dispose])

  const closeTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) {
      onCollapse?.()
      return
    }
    const idx = tabs.findIndex((t) => t.id === tabId)
    const nextTabs = tabs.filter((t) => t.id !== tabId)
    setTabs(nextTabs)
    if (activeTabId === tabId) {
      const newActive = nextTabs[Math.min(idx, nextTabs.length - 1)]
      setActiveTabId(newActive.id)
      dispose()
      disposedRef.current = false
      setExited(false)
      setError(null)
      setKey((k) => k + 1)
    }
  }, [tabs, activeTabId, dispose, onCollapse])

  // Update active tab title when SSH changes
  useEffect(() => {
    setTabs((prev) => prev.map((t) =>
      t.id === activeTabId ? { ...t, title: selectedSsh ? selectedSsh.name : 'local' } : t
    ))
  }, [selectedSshId, activeTabId])

  useEffect(() => {
    disposedRef.current = false
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#161616',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        cursorAccent: '#161616',
        selectionBackground: '#ffffff18',
        black: '#1a1a2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
      allowProposedApi: true,
      smoothScrollDuration: 0,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitRef.current = fitAddon
    termRef.current = term

    setTimeout(() => { try { term.focus() } catch {} }, 50)

    const fitTimer = setTimeout(() => {
      try { fitAddon.fit() } catch {}
    }, 150)

    window.dsGui.createTerminal({
      cwd: workspaceRoot ?? undefined,
      cols: term.cols,
      rows: term.rows,
    }).then((result) => {
      if (disposedRef.current) return
      if (result.ok) {
        sessionIdRef.current = result.id
        term.writeln('\x1b[1;32m\u2713 Terminal ready\x1b[0m')
        term.writeln('')
        if (sshCommand) {
          setTimeout(() => {
            if (!disposedRef.current && sessionIdRef.current === result.id) {
              window.dsGui.writeToTerminal({ id: result.id, data: sshCommand + '\n' }).catch(() => {})
            }
          }, 300)
        }
      } else {
        setError(result.message)
        term.writeln('\x1b[1;31m\u2717 ' + result.message + '\x1b[0m')
      }
    }).catch((e) => {
      if (!disposedRef.current) setError(e instanceof Error ? e.message : String(e))
    })

    const unsubData = window.dsGui.onTerminalData((event) => {
      if (disposedRef.current) return
      if (event.id === sessionIdRef.current && termRef.current) {
        termRef.current.write(event.data)
      }
    })

    const unsubExit = window.dsGui.onTerminalExit((event) => {
      if (disposedRef.current) return
      if (event.id === sessionIdRef.current) {
        setExited(true)
        sessionIdRef.current = null
      }
    })

    const handleResize = (): void => {
      if (disposedRef.current) return
      try { fitAddon.fit() } catch {}
      if (sessionIdRef.current && termRef.current) {
        window.dsGui.resizeTerminal({
          id: sessionIdRef.current,
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        }).catch(() => {})
      }
    }

    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)

    term.onData((data) => {
      if (disposedRef.current) return
      if (sessionIdRef.current) {
        window.dsGui.writeToTerminal({ id: sessionIdRef.current, data }).catch(() => {})
      }
    })

    return () => {
      clearTimeout(fitTimer)
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      dispose()
    }
  }, [workspaceRoot, dispose, key, sshCommand])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className={`flex h-full flex-col bg-[#161616] border-l border-white/5 ${className}`}>
      {/* Tab bar + header */}
      <div className="flex items-center border-b border-white/10 shrink-0">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flex items-center gap-1 px-3 py-1.5 text-[12px] border-r border-white/10 shrink-0 transition ${
                tab.id === activeTabId
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/70'
              }`}
              onClick={() => {
                if (tab.id !== activeTabId) {
                  dispose()
                  disposedRef.current = false
                  setExited(false)
                  setError(null)
                  setActiveTabId(tab.id)
                  setKey((k) => k + 1)
                }
              }}
            >
              <span className="truncate max-w-[80px]">{tab.title}</span>
              {tabs.length > 1 ? (
                <span
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/20"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="px-2 py-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 shrink-0 transition"
            onClick={addTab}
            title="New tab"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-1 px-2 shrink-0">
          {error ? (
            <span className="text-[11px] text-red-400 truncate max-w-[120px]" title={error}>{error}</span>
          ) : null}
          {sshProfiles.length > 0 ? (
            <select
              className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[11px] text-white/60 focus:outline-none"
              value={selectedSshId}
              onChange={(e) => setSelectedSshId(e.target.value)}
            >
              <option value="">local</option>
              {sshProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : null}
          {exited ? (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[11px] text-white/60 hover:bg-white/10 transition flex items-center gap-1"
              onClick={restart}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-white/40 hover:text-white/70 hover:bg-white/10 transition"
            onClick={onCollapse}
            aria-label="Close terminal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {/* Terminal viewport */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        onClick={() => {
          if (!exited) try { termRef.current?.focus() } catch {}
        }}
      />
    </div>
  )
}
