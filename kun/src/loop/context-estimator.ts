import type { TurnItem } from '../contracts/items.js'

/**
 * Very small token estimator. The estimator prefers reported usage
 * when available, otherwise approximates one token per ~4 characters of
 * item text. The estimator is intentionally simple: the goal is to
 * trigger compaction at a reasonable threshold, not to model provider
 * tokenizers exactly.
 */
export class ContextEstimator {
  private readonly charsPerToken: number

  constructor(charsPerToken = 4) {
    this.charsPerToken = charsPerToken
  }

  estimateItem(item: TurnItem): number {
    const text = this.collectText(item)
    return Math.max(1, Math.ceil(text.length / this.charsPerToken))
  }

  estimateItems(items: TurnItem[]): number {
    return items.reduce((sum, item) => sum + this.estimateItem(item), 0)
  }

  private collectText(item: TurnItem): string {
    switch (item.kind) {
      case 'user_message':
      case 'assistant_text':
      case 'assistant_reasoning':
        return item.text
      case 'tool_call':
        return `${item.toolName} ${JSON.stringify(item.arguments)}`
      case 'tool_result':
        return typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
      case 'approval':
        return `${item.toolName} ${item.summary}`
      case 'user_input':
        return item.prompt
      case 'compaction':
        return item.summary
      case 'review':
        return `${item.title} ${item.reviewText ?? ''} ${item.output ? JSON.stringify(item.output) : ''}`
      case 'error':
        return item.message
    }
  }
}
