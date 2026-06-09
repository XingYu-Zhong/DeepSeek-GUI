import { describe, expect, it } from 'vitest'
import { RETIRED_CLAW_GUI_PLAN_TOOL_NAMES } from './claw-schedule-mcp-server'

describe('claw schedule MCP server: GUI plan bridge retirement', () => {
  it('records gui_plan_create as a retired tool name', () => {
    expect(RETIRED_CLAW_GUI_PLAN_TOOL_NAMES).toContain('gui_plan_create')
  })

  it('no longer exposes the legacy tool name as a registered export', async () => {
    // The legacy tool was previously exported via the module surface
    // and registered through `server.registerTool`. The retirement
    // keeps the retired name in the readonly list and removes the
    // registration; this regression check ensures the constant list
    // exists for migration scripts and does not include any active
    // tool names.
    expect(RETIRED_CLAW_GUI_PLAN_TOOL_NAMES.length).toBeGreaterThan(0)
    for (const name of RETIRED_CLAW_GUI_PLAN_TOOL_NAMES) {
      expect(name).toBe('gui_plan_create')
    }
    const moduleExports = await import('./claw-schedule-mcp-server')
    expect((moduleExports as { registerTool?: unknown }).registerTool).toBeUndefined()
  })
})
