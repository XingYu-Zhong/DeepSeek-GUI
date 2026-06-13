import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline, goalTimelinePaddingClass, liveTurnProgressClass, summarizeToolBlock } from './MessageTimeline'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { ProcessSectionRow } from './message-timeline-process'

const labels: Record<string, string> = {
  toolActionCommand: 'Ran command',
  toolBuiltinRead: 'Read',
  toolBuiltinWrite: 'Write',
  toolBuiltinEdit: 'Edit',
  toolBuiltinGrep: 'Search',
  toolBuiltinFind: 'Find',
  toolBuiltinLs: 'List',
  toolBuiltinBash: 'Bash'
}

const t = (key: string) => labels[key] ?? (key === 'toolActionCommand' ? 'Ran command' : key)

const activeThread: NormalizedThread = {
  id: 'thr_1',
  title: 'Thread',
  updatedAt: '2026-06-07T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    ...overrides
  }
}

describe('MessageTimeline tool summaries', () => {
  it('summarizes built-in read/write/edit tools with their file path', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'read: file',
          meta: { toolName: 'read' },
          filePath: '/tmp/readme.md'
        }),
        t
      )
    ).toBe('Read /tmp/readme.md')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'write: file',
          meta: { toolName: 'write' },
          filePath: '/tmp/out.ts'
        }),
        t
      )
    ).toBe('Write /tmp/out.ts')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'edit: file',
          meta: { toolName: 'edit' },
          filePath: '/tmp/app.ts'
        }),
        t
      )
    ).toBe('Edit /tmp/app.ts')
  })

  it('summarizes built-in grep/find with pattern context', () => {
    const grep = summarizeToolBlock(
      toolBlock({
        summary: 'grep: search',
        meta: { toolName: 'grep', pattern: 'needle' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(grep).toBe('Search needle · /tmp/src')

    const find = summarizeToolBlock(
      toolBlock({
        summary: 'find: files',
        meta: { toolName: 'find', pattern: '*.ts' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(find).toBe('Find *.ts · /tmp/src')
  })

  it('summarizes built-in ls with its path and bash with its command', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'ls: list',
          meta: { toolName: 'ls' },
          filePath: '/tmp/project'
        }),
        t
      )
    ).toBe('List /tmp/project')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'bash: exec',
          toolKind: 'command_execution',
          meta: { toolName: 'bash', command: 'npm test' }
        }),
        t
      )
    ).toBe('Ran command npm test')
  })
})

describe('MessageTimeline Kun runtime metadata smoke', () => {
  beforeEach(() => {
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: 'thr_1',
      threads: [activeThread],
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      clawChannels: [],
      activeClawChannelId: ''
    })
  })

  it('renders user image attachments as thumbnails instead of attachment chips', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_1',
      text: '为什么图片完全没有识别啊',
      meta: {
        attachmentIds: ['att_1'],
        attachments: [{
          id: 'att_1',
          name: 'image.png',
          mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,abc'
        }]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).toContain('为什么图片完全没有识别啊')
    expect(html).not.toContain('Attachments 1')
    expect(html).not.toContain('ds-media-printer-reveal')
  })

  it('renders generated image previews with the printer reveal effect', () => {
    const block: ToolBlock = toolBlock({
      id: 'tool_img',
      summary: 'generate_image',
      meta: {
        generatedFiles: [
          {
            name: 'painting.png',
            mimeType: 'image/png',
            previewUrl: 'data:image/png;base64,paint'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(GeneratedFilesPanel, { blocks: [block] }))

    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,paint"')
    expect(html).toContain('ds-media-printer-reveal')
  })

  it('renders managed Claw prompts as the user-visible message', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_claw',
      text: [
        '[Claw managed instructions]',
        '',
        '[Claw IM agent instructions]',
        '',
        '[Agent name]',
        'kun',
        '',
        '---',
        '[Current user request]',
        '[Feishu / Lark inbound message]',
        'Chat type: p2p',
        'Sender: user-1',
        '',
        'hi'
      ].join('\n')
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('hi')
    expect(html).not.toContain('Claw managed instructions')
    expect(html).not.toContain('Agent name')
    expect(html).not.toContain('Feishu / Lark inbound message')
  })

  it('renders attachment, Skill, memory, web source, and child-agent chips in bubbles', () => {
    const block: ToolBlock = toolBlock({
      summary: 'web_search: docs',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'Kun docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('Attachments 1')
    expect(html).toContain('Skills 1')
    expect(html).toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
    expect(html).toContain('https://example.com/kun')
  })

  it('renders the same runtime metadata on process timeline rows', () => {
    const block: ChatBlock = toolBlock({
      summary: 'delegate: research',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'Kun docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Attachments 1')
    expect(html).toContain('Skills 1')
    expect(html).toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
  })

  it('keeps running tool calls collapsed by default while showing active status', () => {
    const block: ChatBlock = toolBlock({
      summary: 'read: file',
      status: 'running',
      detail: 'partial tool output while running',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: true,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Read')
    expect(html).toContain('/tmp/readme.md')
    expect(html).not.toContain('ds-work-logo')
    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('partial tool output while running')
    expect(html).toContain('ds-process-file-reference')
  })

  it('expands active reasoning so the current process is visible', () => {
    const block: ChatBlock = {
      kind: 'reasoning',
      id: 'live-reasoning',
      text: 'current reasoning summary'
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'reasoning', kind: 'reasoning', blocks: [block] },
        processing: true,
        singleReasoningSection: true,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo')
    expect(html).toContain('current reasoning summary')
  })

  it('keeps same-batch tool calls collapsed by default', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const grepBlock: ChatBlock = toolBlock({
      id: 'tool_grep',
      summary: 'grep: search',
      detail: 'grep detail should stay tucked away',
      meta: { toolName: 'grep', pattern: 'needle' },
      filePath: '/tmp/src'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, grepBlock] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Used 2 tools')
    expect(html).not.toContain('ds-work-stack')
    expect(html).not.toContain('/tmp/readme.md')
    expect(html).not.toContain('needle')
    expect(html).not.toContain('read detail should stay tucked away')
    expect(html).not.toContain('grep detail should stay tucked away')
  })

  it('auto-expands pending request_user_input while keeping other tool details tucked away', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const inputBlock: ChatBlock = {
      kind: 'user_input',
      id: 'ui_1',
      requestId: 'input_1',
      status: 'pending',
      questions: [
        {
          header: 'Dinner',
          id: 'dinner',
          question: 'What should we eat tonight?',
          options: [
            {
              label: 'Noodles',
              description: 'Fast and warm'
            }
          ]
        }
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, inputBlock] },
        processing: true,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-work-stack')
    expect(html).toContain('What should we eat tonight?')
    expect(html).toContain('Noodles')
    expect(html).not.toContain('read detail should stay tucked away')
  })

  it('auto-expands pending approvals while keeping other tool details tucked away', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const approvalBlock: ChatBlock = {
      kind: 'approval',
      id: 'approval_appr_1',
      approvalId: 'appr_1',
      status: 'pending',
      toolName: 'edit',
      summary: 'Run edit(path="/tmp/app.ts")'
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, approvalBlock] },
        processing: true,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-work-stack')
    expect(html).toContain('Run edit(path=&quot;/tmp/app.ts&quot;)')
    expect(html).toMatch(/Approval required|需要审批|approvalTitle/)
    expect(html).toMatch(/Allow|允许|approvalAllow/)
    expect(html).not.toContain('read detail should stay tucked away')
  })

  it('renders request_user_input without options as a freeform answer field', () => {
    const inputBlock: ChatBlock = {
      kind: 'user_input',
      id: 'ui_freeform',
      requestId: 'input_freeform',
      status: 'pending',
      questions: [
        {
          header: 'Input',
          id: 'direction',
          question: '你更想去南方还是北方？',
          options: []
        }
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-input', kind: 'execution', blocks: [inputBlock] },
        processing: true,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('你更想去南方还是北方？')
    expect(html).toContain('<textarea')
    expect(html).not.toContain('userInputOther')
    expect(html).not.toContain('其他')
  })

  it('expands the live work timeline by default while keeping tool details collapsed', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'inspect this file'
      },
      toolBlock({
        summary: 'read: file',
        status: 'running',
        detail: 'running timeline detail should stay collapsed',
        meta: { toolName: 'read' },
        filePath: '/tmp/project/src/app.ts'
      })
    ]
    useChatStore.setState({
      busy: true,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: { user_1: Date.now() }
    })

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Read')
    expect(html).toContain('/tmp/project/src/app.ts')
    expect(html).not.toContain('running timeline detail should stay collapsed')
  })

  it('keeps completed runtime errors visible instead of folding them into the work summary', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'draw this'
      },
      {
        kind: 'system',
        id: 'error_1',
        text: 'model request failed with status 400',
        detail: [
          'Code: http_400',
          '',
          'Severity: error',
          '',
          'Message:',
          'full provider body only visible in the expanded error detail'
        ].join('\n'),
        code: 'http_400',
        severity: 'error'
      }
    ]
    useChatStore.setState({
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {}
    })

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('request failed with status 400')
    expect(html).toContain('Code: http_400')
    expect(html).toContain('full provider body only visible in the expanded error detail')
  })

  it('adds extra bottom padding only for chat timelines with an active goal banner', () => {
    expect(goalTimelinePaddingClass('chat', true)).toBe('pb-32 md:pb-40')
    expect(goalTimelinePaddingClass('chat', false)).toBe('pb-10')
    expect(goalTimelinePaddingClass('claw', true)).toBe('pb-10')
  })

  it('pushes the live progress row above the goal banner when a goal is active', () => {
    expect(liveTurnProgressClass(true)).toContain('mb-16 md:mb-20')
    expect(liveTurnProgressClass(false)).not.toContain('mb-16 md:mb-20')
  })
})
