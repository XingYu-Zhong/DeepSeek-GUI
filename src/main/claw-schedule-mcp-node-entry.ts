import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'

void runClawScheduleMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[claw-schedule-mcp] missing --gui-schedule-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[claw-schedule-mcp] server failed:', error)
    process.exit(1)
  })
