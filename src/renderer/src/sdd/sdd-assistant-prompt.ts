export function composeSddAssistantPrompt(options: {
  userPrompt: string
  draftMarkdown: string
  draftRelativePath: string
  workspaceRoot: string
}): string {
  return [
    'You are helping clarify and improve an SDD requirement draft inside DeepSeek GUI.',
    `Workspace: ${options.workspaceRoot}`,
    `Draft file: ${options.draftRelativePath}`,
    '',
    'Current draft:',
    '```markdown',
    options.draftMarkdown.trim() || '(empty draft)',
    '```',
    '',
    'User request:',
    options.userPrompt.trim(),
    '',
    'Answer with concrete requirement improvements, research notes, or questions.',
    'If the user asks you to update the draft, edit the draft file directly and keep the Markdown concise.'
  ].join('\n')
}
