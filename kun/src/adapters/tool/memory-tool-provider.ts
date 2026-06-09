import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { MemoryStore } from '../../memory/memory-store.js'

export function buildMemoryToolProviders(store: MemoryStore | undefined): CapabilityToolProvider[] {
  if (!store) return []
  return [{
    id: 'memory',
    kind: 'memory',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'memory_create',
        description: 'Create a long-term memory after explicit user approval.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            scope: { type: 'string', enum: ['user', 'workspace', 'project'] },
            workspace: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } }
          },
          required: ['content'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          const content = typeof args.content === 'string' ? args.content.trim() : ''
          if (!content) return { output: { error: 'content is required' }, isError: true }
          return {
            output: {
              memory: await store.create({
                content,
                scope: args.scope === 'user' || args.scope === 'project' ? args.scope : 'workspace',
                workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
                sourceThreadId: context.threadId,
                sourceTurnId: context.turnId,
                tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
              })
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_update',
        description: 'Update or disable an existing long-term memory.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            disabled: { type: 'boolean' }
          },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return {
            output: {
              memory: await store.update(args.id, {
                ...(typeof args.content === 'string' ? { content: args.content } : {}),
                ...(typeof args.disabled === 'boolean' ? { disabled: args.disabled } : {})
              })
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_delete',
        description: 'Delete a long-term memory by writing a tombstone.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return { output: { memory: await store.delete(args.id) } }
        }
      })
    ]
  }]
}
