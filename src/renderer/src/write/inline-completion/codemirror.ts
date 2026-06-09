import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension, EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { buildInlineCompletionRequestContext } from './context'
import {
  INLINE_COMPLETION_DEBOUNCE_MS,
  INLINE_COMPLETION_EMPTY_BURST_LIMIT,
  INLINE_COMPLETION_EMPTY_BURST_WINDOW_MS,
  INLINE_COMPLETION_EMPTY_COOLDOWN_MS,
  INLINE_COMPLETION_EMPTY_GLOBAL_COOLDOWN_MS,
  INLINE_COMPLETION_MIN_REQUEST_INTERVAL_MS,
  INLINE_LONG_COMPLETION_MIN_REQUEST_INTERVAL_MS,
  INLINE_LONG_COMPLETION_DEBOUNCE_MS
} from './constants'
import { evaluateInlineCompletionCandidate } from './feedback'
import {
  shouldRequestInlineCompletion,
  shouldRequestLongInlineCompletion
} from './policy'
import type {
  InlineCompletionFeedback,
  InlineCompletionRequestContext,
  InlineCompletionSuggestion
} from './types'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode
} from '@shared/write-inline-completion'

type InlineCompletionConfig = {
  debounceMs?: number
  getDebounceMs?: () => number
  getMinAcceptScore?: () => number
  getLongDebounceMs?: () => number
  getLongMinAcceptScore?: () => number
  isLongEnabled?: () => boolean
  isEnabled?: () => boolean
  getFilePath?: () => string
  language?: string
  getModel?: () => string
  requestCompletion: (
    context: InlineCompletionRequestContext,
    mode: WriteInlineCompletionMode
  ) => Promise<InlineCompletionSuggestion | null>
  onError?: (error: unknown) => void
  onFeedback?: (feedback: InlineCompletionFeedback) => void
}

const setInlineCompletionEffect = StateEffect.define<{
  text: string
  action: WriteInlineCompletionAction
  anchor: number
  feedback: InlineCompletionFeedback
}>()
const clearInlineCompletionEffect = StateEffect.define<null>()

const inlineCompletionState = StateField.define<{
  text: string
  action: WriteInlineCompletionAction
  anchor: number
  feedback: InlineCompletionFeedback
} | null>({
  create() {
    return null
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlineCompletionEffect)) return effect.value
      if (effect.is(clearInlineCompletionEffect)) return null
    }
    return value
  }
})

const inlineEditOriginalMark = Decoration.mark({ class: 'cm-inline-edit-original' })

type InlineEditAction = Extract<WriteInlineCompletionAction, { kind: 'edit' }>
type InlineEditReplacementAnchor = {
  position: number
  leading: boolean
}

function clipSignaturePart(text = '', head = 120, tail = 120): string {
  const source = String(text || '').replace(/\r\n?/g, '\n')
  if (source.length <= head + tail) return source
  return `${source.slice(0, head)}…${source.slice(source.length - tail)}`
}

export function inlineCompletionRequestSignature(
  context: InlineCompletionRequestContext,
  mode: WriteInlineCompletionMode
): string {
  const editCandidate = context.editCandidate
    ? `${context.editCandidate.from}:${context.editCandidate.to}:${clipSignaturePart(context.editCandidate.original, 80, 80)}`
    : ''
  return [
    mode,
    context.filePath,
    context.head,
    context.docLength,
    clipSignaturePart(context.currentLinePrefix, 0, 160),
    clipSignaturePart(context.currentLineSuffix, 160, 0),
    clipSignaturePart(context.previousNonEmptyLineText, 0, 120),
    clipSignaturePart(context.nextLineText, 120, 0),
    editCandidate
  ].join('\u001f')
}

export function inlineCompletionMinRequestInterval(mode: WriteInlineCompletionMode): number {
  return mode === 'long'
    ? INLINE_LONG_COMPLETION_MIN_REQUEST_INTERVAL_MS
    : INLINE_COMPLETION_MIN_REQUEST_INTERVAL_MS
}

export function isInlineCompletionEmptyFeedback(reason = ''): boolean {
  return reason === 'empty-candidate' || reason === 'blank-candidate'
}

class InlineCompletionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: InlineCompletionWidget): boolean {
    return other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-inline-completion'
    span.textContent = this.text
    return span
  }

  override get lineBreaks(): number {
    return this.text.split('\n').length - 1
  }
}

class InlineEditReplacementWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly leading = false
  ) {
    super()
  }

  override eq(other: InlineEditReplacementWidget): boolean {
    return other.text === this.text && other.leading === this.leading
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.leading
      ? 'cm-inline-completion cm-inline-edit-replacement cm-inline-edit-replacement-leading'
      : 'cm-inline-completion cm-inline-edit-replacement'

    const arrow = document.createElement('span')
    arrow.className = 'cm-inline-edit-arrow'
    arrow.textContent = '=>'

    const replacement = document.createElement('span')
    replacement.className = 'cm-inline-edit-text'
    replacement.textContent = this.text

    span.append(arrow, replacement)
    return span
  }

  override get lineBreaks(): number {
    return this.text.split('\n').length - 1
  }
}

function clearInlineCompletion(view: EditorView): void {
  const current = view.state.field(inlineCompletionState)
  if (!current) return
  view.dispatch({ effects: clearInlineCompletionEffect.of(null) })
}

function editActionMatches(state: EditorState, action: WriteInlineCompletionAction): boolean {
  if (action.kind !== 'edit') return false
  if (action.from < 0 || action.to < action.from || action.to > state.doc.length) return false
  return state.sliceDoc(action.from, action.to) === action.original
}

export function inlineEditReplacementAnchor(
  state: EditorState,
  action: InlineEditAction
): InlineEditReplacementAnchor {
  const startLine = state.doc.lineAt(action.from).number
  const endLine = state.doc.lineAt(Math.max(action.from, action.to - 1)).number
  if (startLine !== endLine) {
    return {
      position: action.from,
      leading: true
    }
  }
  return {
    position: action.to,
    leading: false
  }
}

function feedbackFromInteraction(
  decision: 'accept' | 'dismiss',
  completion: { feedback: InlineCompletionFeedback } | null
): InlineCompletionFeedback {
  return {
    phase: 'interaction',
    decision,
    reason: decision === 'accept' ? 'tab-applied' : 'escape-dismissed',
    score: completion?.feedback.score || 0,
    preview: completion?.feedback.preview || '',
    mode: completion?.feedback.mode
  }
}

function buildRequestContext(state: EditorState, config: InlineCompletionConfig): InlineCompletionRequestContext {
  return buildInlineCompletionRequestContext(state, {
    filePath: config.getFilePath?.() || '',
    language: config.language || 'markdown'
  })
}

const inlineCompletionRenderPlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none

    constructor(view: EditorView) {
      this.update({ state: view.state } as never)
    }

    update(update: { state: EditorState }): void {
      const completion = update.state.field(inlineCompletionState)
      if (
        !completion?.text ||
        completion.anchor !== update.state.selection.main.head ||
        !update.state.selection.main.empty
      ) {
        this.decorations = Decoration.none
        return
      }

      if (completion.action.kind === 'edit') {
        if (!editActionMatches(update.state, completion.action)) {
          this.decorations = Decoration.none
          return
        }
        const anchor = inlineEditReplacementAnchor(update.state, completion.action)
        const replacement = Decoration.widget({
          widget: new InlineEditReplacementWidget(completion.text, anchor.leading),
          side: anchor.leading ? -1 : 1
        })
        this.decorations = Decoration.set([
          inlineEditOriginalMark.range(completion.action.from, completion.action.to),
          replacement.range(anchor.position)
        ], true)
        return
      }

      const widget = Decoration.widget({
        widget: new InlineCompletionWidget(completion.text),
        side: 1
      })
      this.decorations = Decoration.set([widget.range(update.state.selection.main.head)], true)
    }
  },
  {
    decorations: (value) => value.decorations
  }
)

const inlineCompletionController = (config: InlineCompletionConfig) =>
  ViewPlugin.fromClass(class {
    private sequence = 0
    private shortTimer: number | null = null
    private longTimer: number | null = null
    private readonly inFlightModes = new Set<WriteInlineCompletionMode>()
    private readonly pendingAfterInFlight = new Set<WriteInlineCompletionMode>()
    private readonly lastRequestStartedAt = new Map<WriteInlineCompletionMode, number>()
    private readonly emptyCooldowns = new Map<string, number>()
    private emptyEvents: number[] = []
    private globalEmptyCooldownUntil = 0

    constructor(private readonly view: EditorView) {
      this.schedule(view.state)
    }

    update(update: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; state: EditorState }): void {
      if (!update.docChanged && !update.selectionSet && !update.focusChanged) return
      this.schedule(update.state)
    }

    private schedule(state: EditorState): void {
      this.sequence += 1
      this.clearTimers()

      const requestContext = buildRequestContext(state, config)
      const shouldRequestShort = shouldRequestInlineCompletion(requestContext, config.isEnabled)
      const shouldRequestLong = shouldRequestLongInlineCompletion(
        requestContext,
        config.isEnabled,
        config.isLongEnabled
      )
      if (!shouldRequestShort && !shouldRequestLong) {
        clearInlineCompletion(this.view)
        return
      }

      const requestId = this.sequence
      if (shouldRequestShort) {
        this.shortTimer = window.setTimeout(() => {
          this.shortTimer = null
          void this.requestAndRender('short', requestId)
        }, config.getDebounceMs?.() ?? config.debounceMs ?? INLINE_COMPLETION_DEBOUNCE_MS)
      }
      if (shouldRequestLong) {
        this.longTimer = window.setTimeout(() => {
          this.longTimer = null
          void this.requestAndRender('long', requestId)
        }, config.getLongDebounceMs?.() ?? INLINE_LONG_COMPLETION_DEBOUNCE_MS)
      }
    }

    private async requestAndRender(mode: WriteInlineCompletionMode, requestId: number): Promise<void> {
      const latestState = this.view.state
      const latestContext = buildRequestContext(latestState, config)
      const shouldRequest = mode === 'long'
        ? shouldRequestLongInlineCompletion(latestContext, config.isEnabled, config.isLongEnabled)
        : shouldRequestInlineCompletion(latestContext, config.isEnabled)
      if (!shouldRequest) {
        clearInlineCompletion(this.view)
        return
      }
      const signature = inlineCompletionRequestSignature(latestContext, mode)
      const now = Date.now()
      this.pruneEmptyCooldowns(now)
      if (this.isInEmptyCooldown(signature, now)) {
        clearInlineCompletion(this.view)
        return
      }

      const lastStartedAt = this.lastRequestStartedAt.get(mode) ?? 0
      const minInterval = inlineCompletionMinRequestInterval(mode)
      const waitMs = minInterval - (now - lastStartedAt)
      if (waitMs > 0) {
        window.setTimeout(() => {
          if (requestId === this.sequence) void this.requestAndRender(mode, requestId)
        }, waitMs)
        return
      }

      if (this.inFlightModes.has(mode)) {
        this.pendingAfterInFlight.add(mode)
        return
      }

      this.inFlightModes.add(mode)
      this.lastRequestStartedAt.set(mode, now)
      let suggestion: InlineCompletionSuggestion | null = null
      try {
        suggestion = await config.requestCompletion(latestContext, mode).catch((error: unknown) => {
          config.onError?.(error)
          return null
        })
      } finally {
        this.inFlightModes.delete(mode)
        if (this.pendingAfterInFlight.delete(mode)) {
          this.schedule(this.view.state)
        }
      }

      if (requestId !== this.sequence) return
      if (this.view.state !== latestState) return

      const decision = evaluateInlineCompletionCandidate(latestContext, suggestion, {
        minAcceptScore: mode === 'long'
          ? config.getLongMinAcceptScore?.()
          : config.getMinAcceptScore?.(),
        longMinAcceptScore: config.getLongMinAcceptScore?.(),
        mode
      })
      config.onFeedback?.(decision.feedback)
      if (!decision.accepted && isInlineCompletionEmptyFeedback(decision.feedback.reason)) {
        this.recordEmptyResponse(signature, Date.now())
      }
      if (!decision.accepted || (decision.action?.kind === 'long' && config.isLongEnabled?.() === false)) {
        clearInlineCompletion(this.view)
        return
      }

      this.view.dispatch({
        effects: setInlineCompletionEffect.of({
          text: decision.text,
          action: decision.action ?? { kind: 'short', text: decision.text },
          anchor: latestContext.head,
          feedback: decision.feedback
        })
      })
    }

    private clearTimers(): void {
      if (this.shortTimer) window.clearTimeout(this.shortTimer)
      if (this.longTimer) window.clearTimeout(this.longTimer)
      this.shortTimer = null
      this.longTimer = null
    }

    private pruneEmptyCooldowns(now: number): void {
      for (const [signature, until] of this.emptyCooldowns) {
        if (until <= now) this.emptyCooldowns.delete(signature)
      }
      const cutoff = now - INLINE_COMPLETION_EMPTY_BURST_WINDOW_MS
      this.emptyEvents = this.emptyEvents.filter((time) => time >= cutoff)
    }

    private isInEmptyCooldown(signature: string, now: number): boolean {
      return now < this.globalEmptyCooldownUntil || now < (this.emptyCooldowns.get(signature) ?? 0)
    }

    private recordEmptyResponse(signature: string, now: number): void {
      this.pruneEmptyCooldowns(now)
      this.emptyCooldowns.set(signature, now + INLINE_COMPLETION_EMPTY_COOLDOWN_MS)
      this.emptyEvents.push(now)
      if (this.emptyEvents.length >= INLINE_COMPLETION_EMPTY_BURST_LIMIT) {
        this.globalEmptyCooldownUntil = now + INLINE_COMPLETION_EMPTY_GLOBAL_COOLDOWN_MS
        this.emptyEvents = []
      }
    }

    destroy(): void {
      this.sequence += 1
      this.clearTimers()
    }
  })

function acceptInlineCompletionFactory(config: InlineCompletionConfig) {
  return (view: EditorView): boolean => {
    const completion = view.state.field(inlineCompletionState)
    if (!completion?.text || completion.anchor !== view.state.selection.main.head) return false

    const head = view.state.selection.main.head
    if (completion.action.kind === 'edit') {
      if (!editActionMatches(view.state, completion.action)) {
        view.dispatch({ effects: clearInlineCompletionEffect.of(null) })
        return false
      }
      const nextHead = completion.action.from + completion.text.length
      view.dispatch({
        changes: {
          from: completion.action.from,
          to: completion.action.to,
          insert: completion.text
        },
        selection: { anchor: nextHead },
        effects: clearInlineCompletionEffect.of(null)
      })
      config.onFeedback?.(feedbackFromInteraction('accept', completion))
      return true
    }

    const nextHead = head + completion.text.length
    view.dispatch({
      changes: { from: head, insert: completion.text },
      selection: { anchor: nextHead },
      effects: clearInlineCompletionEffect.of(null)
    })
    config.onFeedback?.(feedbackFromInteraction('accept', completion))
    return true
  }
}

function rejectInlineCompletionFactory(config: InlineCompletionConfig) {
  return (view: EditorView): boolean => {
    const completion = view.state.field(inlineCompletionState)
    if (!completion || completion.anchor !== view.state.selection.main.head) return false
    view.dispatch({ effects: clearInlineCompletionEffect.of(null) })
    config.onFeedback?.(feedbackFromInteraction('dismiss', completion))
    return true
  }
}

export function buildInlineCompletionExtension(config: InlineCompletionConfig): Extension {
  return [
    inlineCompletionState,
    inlineCompletionRenderPlugin,
    inlineCompletionController(config),
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptInlineCompletionFactory(config) },
        { key: 'Escape', run: rejectInlineCompletionFactory(config) }
      ])
    )
  ]
}
