import type { LocalTool } from './local-tool-host.js'
import type {
  BuiltinLocalToolsOptions,
  BuiltinToolName,
  ToolName,
  ToolsOptions
} from './builtin-tool-types.js'
import { createBashLocalTool } from './builtin-bash-tool.js'
import { createEditLocalTool, createWriteLocalTool } from './builtin-file-tools.js'
import { createReadLocalTool } from './builtin-read-tool.js'
import { createFindLocalTool, createGrepLocalTool, createLsLocalTool } from './builtin-search-tools.js'

export * from './builtin-tool-types.js'
export * from './builtin-tool-operations.js'
export * from './builtin-read-tool.js'
export * from './builtin-file-tools.js'
export * from './builtin-search-tools.js'
export * from './builtin-bash-tool.js'

export function createBuiltinLocalTool(
  toolName: BuiltinToolName,
  options: BuiltinLocalToolsOptions = {}
): LocalTool {
  switch (toolName) {
    case 'read':
      return createReadLocalTool(options.read)
    case 'bash':
      return createBashLocalTool(options.bash)
    case 'edit':
      return createEditLocalTool(options.edit)
    case 'write':
      return createWriteLocalTool(options.write)
    case 'grep':
      return createGrepLocalTool(options.grep)
    case 'find':
      return createFindLocalTool(options.find)
    case 'ls':
      return createLsLocalTool(options.ls)
  }
}

export function createTool(toolName: ToolName, options: ToolsOptions = {}): LocalTool {
  return createBuiltinLocalTool(toolName, options)
}

export function createToolDefinition(toolName: ToolName, options: ToolsOptions = {}): LocalTool {
  return createBuiltinLocalTool(toolName, options)
}

export function buildBuiltinLocalTools(options: BuiltinLocalToolsOptions = {}): LocalTool[] {
  return [
    createReadLocalTool(options.read),
    createBashLocalTool(options.bash),
    createEditLocalTool(options.edit),
    createWriteLocalTool(options.write),
    createGrepLocalTool(options.grep),
    createFindLocalTool(options.find),
    createLsLocalTool(options.ls)
  ]
}

export function createAllTools(options: ToolsOptions = {}): Record<ToolName, LocalTool> {
  return buildBuiltinLocalToolRecord(options)
}

export function buildCodingBuiltinLocalTools(options: BuiltinLocalToolsOptions = {}): LocalTool[] {
  return [
    createReadLocalTool(options.read),
    createBashLocalTool(options.bash),
    createEditLocalTool(options.edit),
    createWriteLocalTool(options.write)
  ]
}

export function createCodingTools(options: ToolsOptions = {}): LocalTool[] {
  return buildCodingBuiltinLocalTools(options)
}

export function buildReadOnlyBuiltinLocalTools(options: BuiltinLocalToolsOptions = {}): LocalTool[] {
  return [
    createReadLocalTool(options.read),
    createGrepLocalTool(options.grep),
    createFindLocalTool(options.find),
    createLsLocalTool(options.ls)
  ]
}

export function createReadOnlyTools(options: ToolsOptions = {}): LocalTool[] {
  return buildReadOnlyBuiltinLocalTools(options)
}

export function buildBuiltinLocalToolRecord(
  options: BuiltinLocalToolsOptions = {}
): Record<BuiltinToolName, LocalTool> {
  return {
    read: createReadLocalTool(options.read),
    bash: createBashLocalTool(options.bash),
    edit: createEditLocalTool(options.edit),
    write: createWriteLocalTool(options.write),
    grep: createGrepLocalTool(options.grep),
    find: createFindLocalTool(options.find),
    ls: createLsLocalTool(options.ls)
  }
}

export function createAllToolDefinitions(options: ToolsOptions = {}): Record<ToolName, LocalTool> {
  return buildBuiltinLocalToolRecord(options)
}

export function createCodingToolDefinitions(options: ToolsOptions = {}): LocalTool[] {
  return buildCodingBuiltinLocalTools(options)
}

export function createReadOnlyToolDefinitions(options: ToolsOptions = {}): LocalTool[] {
  return buildReadOnlyBuiltinLocalTools(options)
}
