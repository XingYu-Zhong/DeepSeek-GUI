import { runOcrMcpServerFromArgv } from './ocr-mcp-server'

void runOcrMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[ocr-mcp] missing --gui-ocr-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[ocr-mcp] server failed:', error)
    process.exit(1)
  })
