import { describe, expect, it } from 'vitest'
import { WRITE_PROTOTYPE_DEFAULT_PROMPT } from '@shared/write-prototype'
import { buildSddPrototypeTurnPrompt } from './sdd-prototype-prompt'

describe('buildSddPrototypeTurnPrompt', () => {
  it('binds the agent to the exact reserved prototype path', () => {
    const prompt = buildSddPrototypeTurnPrompt({
      mode: 'text',
      text: '需求：扫码登录页面。',
      prototypeRelativePath: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/proto/prototype-1.html',
      workspaceRoot: '/tmp/ws'
    })
    expect(prompt).toContain('Reserved prototype file: .kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/proto/prototype-1.html')
    expect(prompt).toContain('`.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/proto/prototype-1.html`')
    expect(prompt).toContain('Do not create or modify any other file')
    expect(prompt).toContain(WRITE_PROTOTYPE_DEFAULT_PROMPT)
    expect(prompt).toContain('需求：扫码登录页面。')
    expect(prompt).not.toContain('attached image')
  })

  it('uses the custom prompt and the image specification wording in image mode', () => {
    const prompt = buildSddPrototypeTurnPrompt({
      mode: 'image',
      prototypeRelativePath: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/proto/p.html',
      workspaceRoot: '/tmp/ws',
      customPrompt: '暗色主题，组件圆角。'
    })
    expect(prompt).toContain('暗色主题，组件圆角。')
    expect(prompt).not.toContain(WRITE_PROTOTYPE_DEFAULT_PROMPT)
    expect(prompt).toContain('attached image')
    expect(prompt).toContain('visual specification')
  })

  it('clips overlong requirement text', () => {
    const prompt = buildSddPrototypeTurnPrompt({
      mode: 'text',
      text: 'x'.repeat(20_000),
      prototypeRelativePath: '.kunsdd/requirements/123e4567-e89b-12d3-a456-426614174000/proto/p.html',
      workspaceRoot: '/tmp/ws'
    })
    expect(prompt.length).toBeLessThan(8_000)
  })
})
