import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionEditCandidate,
  WriteInlineCompletionMode,
  WriteInlineCompletionRequest
} from '@shared/write-inline-completion'

export type InlineCompletionRequestContext = {
  filePath: string
  language: string
  head: number
  lineNumber: number
  column: number
  docLength: number
  prefix: string
  suffix: string
  prefixWindow: string
  suffixWindow: string
  currentLinePrefix: string
  currentLineSuffix: string
  currentLineText: string
  previousLineText: string
  previousNonEmptyLineText: string
  nextLineText: string
  indentation: string
  isAtLineEnd: boolean
  currentLinePrefixTrimmed: string
  currentLineSuffixTrimmed: string
  docPreview: string
  isBlankLine: boolean
  hasMeaningfulPrefix: boolean
  hasStructuralContext: boolean
  hasListContext: boolean
  hasQuoteContext: boolean
  hasHeadingContext: boolean
  hasTableContext: boolean
  endsWithWordChar: boolean
  endsWithSentencePunctuation: boolean
  previousLineEndsWithSentencePunctuation: boolean
  prefersNewLineCompletion: boolean
  isParagraphBreakOpportunity: boolean
  nextCharIsWord: boolean
  looksLikeUrlTail: boolean
  editCandidate?: WriteInlineCompletionEditCandidate
}

export type InlineCompletionSuggestion = {
  text: string
  mode?: WriteInlineCompletionMode
  action?: WriteInlineCompletionAction
}

export type InlineCompletionFeedback = {
  phase: 'candidate' | 'interaction'
  decision: 'show' | 'suppress' | 'accept' | 'dismiss'
  reason: string
  score: number
  preview: string
  mode?: WriteInlineCompletionMode
  cursor?: {
    line: number
    column: number
  }
}

export type InlineCompletionPayload = WriteInlineCompletionRequest
