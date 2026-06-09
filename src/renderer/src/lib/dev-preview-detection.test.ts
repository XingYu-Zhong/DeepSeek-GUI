import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  extractAutoOpenDevPreviewUrls,
  extractDetectedDevPreviewUrls,
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls
} from './dev-preview-detection'

function user(text: string): ChatBlock {
  return { kind: 'user', id: `user:${text}`, text }
}

function assistant(text: string): ChatBlock {
  return { kind: 'assistant', id: `assistant:${text}`, text }
}

function commandExecutionBlock(input: {
  summary?: string
  detail?: string
  status?: 'running' | 'success' | 'error'
  command: string
}): ChatBlock {
  return {
    kind: 'tool',
    id: `tool:${input.command}`,
    summary: input.summary ?? input.command,
    detail: input.detail,
    status: input.status ?? 'success',
    toolKind: 'command_execution',
    meta: { command: input.command }
  }
}

describe('dev preview detection', () => {
  it('ignores architectural explanations that only mention preview config and localhost', () => {
    const blocks: ChatBlock[] = [
      user('explain the project'),
      assistant(
        [
          '开发预览 URL 白名单',
          '',
          '- 允许的来源包括 `http://localhost:5173` 和 `http://127.0.0.1:5173`。',
          '- 这里主要是配置说明，不是在提示你打开页面。'
        ].join('\n')
      )
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual([])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('shows a preview card for explicit assistant navigation hints without auto-opening', () => {
    const blocks: ChatBlock[] = [
      user('where is the frontend'),
      assistant('前端现在运行在 http://localhost:3000 ，你可以直接访问看看。')
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual(['http://localhost:3000/'])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('auto-opens when a dev server command announces a local URL', () => {
    const blocks: ChatBlock[] = [
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'running',
        detail: 'VITE v5.4.0  ready in 180 ms\n  Local:   http://localhost:5173/\n'
      })
    ]

    expect(extractDetectedDevPreviewUrls(blocks)).toEqual(['http://localhost:5173/'])
    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual(['http://localhost:5173/'])
  })

  it('ignores runtime API URLs even when they are local', () => {
    const blocks: ChatBlock[] = [
      user('how does the runtime work'),
      assistant('GUI 通过 runtime:request 请求 http://localhost:3000/v1/threads 来拉取线程列表。')
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual([])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('does not auto-open failed dev server commands that only expose a bound port', () => {
    const blocks: ChatBlock[] = [
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'error',
        detail: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3000'
      })
    ]

    expect(extractDetectedDevPreviewUrls(blocks)).toEqual([])
    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })
})
