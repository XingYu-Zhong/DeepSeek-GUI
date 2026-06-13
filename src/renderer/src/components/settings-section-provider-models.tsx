import { useState, type ReactElement, type ReactNode } from 'react'
import {
  AudioLines,
  Brain,
  Clapperboard,
  Eye,
  Image as ImageIcon,
  MessageSquareText,
  Mic,
  Music2,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type {
  ModelProviderProfileV1,
  ModelReasoningEffort,
  ModelReasoningRequestProtocol
} from '@shared/app-settings'
import { Toggle } from './settings-controls'
import {
  CONTEXT_WINDOW_PRESETS,
  PROVIDER_MODEL_REASONING_EFFORT_CHOICES,
  PROVIDER_MODEL_REASONING_PROTOCOLS,
  applyProviderModelForm,
  chatModelIdLooksNonText,
  chatModelProfile,
  describeContextWindowTokens,
  newProviderModelForm,
  parseContextWindowInput,
  providerModelListEntries,
  providerModelFormForExisting,
  removeProviderModel,
  sortReasoningEfforts,
  validateProviderModelForm,
  type ProviderModelForm,
  type ProviderModelFormError,
  type ProviderModelKind
} from './provider-model-editor'

type Translate = (key: string, params?: Record<string, unknown>) => string

const fieldLabelClass = 'grid gap-1.5 text-[12px] font-semibold text-ds-muted'
const textInputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

const REASONING_PROTOCOL_LABEL_KEYS: Record<ModelReasoningRequestProtocol, string> = {
  'deepseek-chat-completions': 'providerModelReasoningProtocolDeepseek',
  'mimo-chat-completions': 'providerModelReasoningProtocolMimo',
  'openai-responses': 'providerModelReasoningProtocolResponses',
  'anthropic-thinking': 'providerModelReasoningProtocolAnthropic',
  none: 'providerModelReasoningProtocolNone'
}

const REASONING_EFFORT_LABEL_KEYS: Record<ModelReasoningEffort, string> = {
  auto: 'providerModelEffortAuto',
  off: 'providerModelEffortOff',
  low: 'providerModelEffortLow',
  medium: 'providerModelEffortMedium',
  high: 'providerModelEffortHigh',
  max: 'providerModelEffortMax'
}

const MODEL_KIND_META: Array<{
  kind: ProviderModelKind
  icon: typeof MessageSquareText
  titleKey: string
  descKey: string
}> = [
  {
    kind: 'chat',
    icon: MessageSquareText,
    titleKey: 'providerModelKindChat',
    descKey: 'providerModelKindChatDesc'
  },
  {
    kind: 'image',
    icon: ImageIcon,
    titleKey: 'providerModelKindImage',
    descKey: 'providerModelKindImageDesc'
  },
  {
    kind: 'speech',
    icon: Mic,
    titleKey: 'providerModelKindSpeech',
    descKey: 'providerModelKindSpeechDesc'
  },
  {
    kind: 'tts',
    icon: AudioLines,
    titleKey: 'providerModelKindTts',
    descKey: 'providerModelKindTtsDesc'
  },
  {
    kind: 'music',
    icon: Music2,
    titleKey: 'providerModelKindMusic',
    descKey: 'providerModelKindMusicDesc'
  },
  {
    kind: 'video',
    icon: Clapperboard,
    titleKey: 'providerModelKindVideo',
    descKey: 'providerModelKindVideoDesc'
  }
]

type EditorState = {
  mode: 'add' | 'edit'
  form: ProviderModelForm
  contextText: string
  aliasesText: string
}

function editorStateForNew(provider: ModelProviderProfileV1): EditorState {
  const form = newProviderModelForm('chat', provider)
  return {
    mode: 'add',
    form,
    contextText: form.contextWindowTokens ? describeContextWindowTokens(form.contextWindowTokens) : '',
    aliasesText: ''
  }
}

function editorStateForExisting(
  provider: ModelProviderProfileV1,
  kind: ProviderModelKind,
  modelId: string
): EditorState {
  const form = providerModelFormForExisting(provider, kind, modelId)
  return {
    mode: 'edit',
    form,
    contextText: form.contextWindowTokens ? describeContextWindowTokens(form.contextWindowTokens) : '',
    aliasesText: form.aliases.join(', ')
  }
}

function parseAliasesText(raw: string): string[] {
  return raw.split(/[\s,]+/).map((alias) => alias.trim()).filter(Boolean)
}

function effectiveFormForEditor(editor: EditorState): ProviderModelForm {
  const trimmedContext = editor.contextText.trim()
  const contextWindowTokens =
    editor.form.kind !== 'chat' || trimmedContext === ''
      ? null
      : parseContextWindowInput(trimmedContext) ?? Number.NaN
  return {
    ...editor.form,
    contextWindowTokens,
    aliases: parseAliasesText(editor.aliasesText)
  }
}

function formErrorMessage(t: Translate, error: ProviderModelFormError): string {
  switch (error.code) {
    case 'missingId':
      return t('providerModelErrorMissingId')
    case 'duplicate':
      return t(`providerModelErrorDuplicate${duplicateKindSuffix(error.kind)}`)
    case 'invalidContextWindow':
      return t('providerModelErrorContext')
    case 'noReasoningEfforts':
      return t('providerModelErrorNoEfforts')
  }
}

function duplicateKindSuffix(kind: ProviderModelKind): string {
  if (kind === 'chat') return 'Chat'
  if (kind === 'image') return 'Image'
  if (kind === 'speech') return 'Speech'
  if (kind === 'tts') return 'Tts'
  if (kind === 'music') return 'Music'
  return 'Video'
}

function ModelBadge({
  tone = 'muted',
  icon,
  children
}: {
  tone?: 'muted' | 'warning' | 'faint'
  icon?: ReactNode
  children: ReactNode
}): ReactElement {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
      : tone === 'faint'
        ? 'border-ds-border-muted bg-transparent text-ds-faint'
        : 'border-ds-border-muted bg-ds-main/60 text-ds-muted'
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10.5px] font-medium leading-4 ${toneClass}`}>
      {icon}
      {children}
    </span>
  )
}

function ModelName({ modelId }: { modelId: string }): ReactElement {
  return (
    <span className="group/model-name relative min-w-0" title={modelId}>
      <span className="block truncate font-mono text-[12.5px] text-ds-ink">{modelId}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1 max-w-[min(28rem,calc(100vw-3rem))] break-all rounded-lg border border-ds-border bg-white px-2.5 py-1.5 font-mono text-[12px] leading-5 text-ds-ink opacity-0 shadow-[0_12px_32px_rgba(20,47,95,0.16)] transition group-hover/model-name:opacity-100 dark:bg-ds-card"
      >
        {modelId}
      </span>
    </span>
  )
}

function chipButtonClass(active: boolean): string {
  return `inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition ${
    active
      ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  }`
}

function modelEntryKey(kind: ProviderModelKind, modelId: string): string {
  return `${kind}:${modelId.trim().toLowerCase()}`
}

function modelKindLabelKey(kind: ProviderModelKind): string {
  return MODEL_KIND_META.find((item) => item.kind === kind)?.titleKey ?? 'providerModelKindChat'
}

function ToggleField({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-card/60 px-3 py-2.5">
      <div className="grid gap-0.5">
        <span className="text-[12.5px] font-semibold text-ds-ink">{label}</span>
        <span className="text-[12px] leading-5 text-ds-faint">{description}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

export function ProviderModelsManager({
  provider,
  t,
  selectControlClass,
  onChange
}: {
  provider: ModelProviderProfileV1
  t: Translate
  selectControlClass: string
  onChange: (next: ModelProviderProfileV1) => void
}): ReactElement {
  const [editor, setEditor] = useState<EditorState | null>(null)

  const updateForm = (patch: Partial<ProviderModelForm>): void => {
    setEditor((prev) => prev ? { ...prev, form: { ...prev.form, ...patch } } : prev)
  }

  const saveEditor = (): void => {
    if (!editor) return
    const form = effectiveFormForEditor(editor)
    if (validateProviderModelForm(form, provider).length > 0) return
    onChange(applyProviderModelForm(provider, form))
    setEditor(null)
  }

  const deleteModel = (kind: ProviderModelKind, modelId: string): void => {
    onChange(removeProviderModel(provider, kind, modelId))
    setEditor((prev) =>
      prev?.mode === 'edit' && modelEntryKey(prev.form.kind, prev.form.originalModelId) === modelEntryKey(kind, modelId)
        ? null
        : prev
    )
  }

  const modelEntries = providerModelListEntries(provider)
  const effectiveForm = editor ? effectiveFormForEditor(editor) : null
  const errors = editor && effectiveForm ? validateProviderModelForm(effectiveForm, provider) : []
  const showNonTextWarning = Boolean(effectiveForm && chatModelIdLooksNonText(effectiveForm))
  const parsedContextTokens =
    editor && editor.contextText.trim() !== '' ? parseContextWindowInput(editor.contextText) : null
  const editingKey = editor?.mode === 'edit' ? modelEntryKey(editor.form.kind, editor.form.originalModelId) : ''
  const reasoningEffortPool = effectiveForm
    ? sortReasoningEfforts([...PROVIDER_MODEL_REASONING_EFFORT_CHOICES, ...effectiveForm.reasoningEfforts])
    : PROVIDER_MODEL_REASONING_EFFORT_CHOICES

  return (
    <div className="grid gap-2.5">
      <p className="text-[12px] leading-5 text-ds-faint">{t('providerModelListDesc')}</p>
      {modelEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-3 text-[12.5px] text-ds-faint">
          {t('providerModelEmpty')}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {modelEntries.map(({ kind, modelId }) => {
            const profile = kind === 'chat' ? chatModelProfile(provider, modelId) : undefined
            const active = editingKey !== '' && editingKey === modelEntryKey(kind, modelId)
            return (
              <li
                key={modelEntryKey(kind, modelId)}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${
                  active ? 'border-accent/60 bg-ds-main/45 ring-1 ring-accent/30' : 'border-ds-border bg-ds-card'
                }`}
              >
                <span className="grid min-w-0 flex-1 gap-1.5">
                  <ModelName modelId={modelId} />
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <ModelBadge tone={kind === 'chat' ? 'faint' : 'muted'}>
                      {t(modelKindLabelKey(kind))}
                    </ModelBadge>
                    {kind === 'chat' && profile ? (
                      <>
                        {profile.contextWindowTokens ? (
                          <ModelBadge>{t('providerModelContextBadge', {
                            size: describeContextWindowTokens(profile.contextWindowTokens)
                          })}</ModelBadge>
                        ) : null}
                        {profile.inputModalities.includes('image') ? (
                          <ModelBadge icon={<Eye className="h-2.5 w-2.5" strokeWidth={1.9} />}>
                            {t('modelProviderVisionBadge')}
                          </ModelBadge>
                        ) : null}
                        {profile.reasoning ? (
                          <ModelBadge icon={<Brain className="h-2.5 w-2.5" strokeWidth={1.9} />}>
                            {t('providerModelReasoningBadge')}
                          </ModelBadge>
                        ) : null}
                        {!profile.supportsToolCalling ? (
                          <ModelBadge tone="warning">{t('providerModelNoToolsBadge')}</ModelBadge>
                        ) : null}
                      </>
                    ) : kind === 'chat' ? (
                      <ModelBadge tone="faint">{t('providerModelDefaultProfileBadge')}</ModelBadge>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 pt-0.5">
                  <button
                    type="button"
                    aria-label={t('providerModelEditAction', { model: modelId })}
                    onClick={() => setEditor(editorStateForExisting(provider, kind, modelId))}
                    className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('providerModelDeleteAction', { model: modelId })}
                    onClick={() => deleteModel(kind, modelId)}
                    className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-red-600 dark:hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {editor === null ? (
        <button
          type="button"
          onClick={() => setEditor(editorStateForNew(provider))}
          className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('providerModelAdd')}
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-ds-border bg-ds-card/70 p-3.5">
          <h4 className="text-[13px] font-semibold text-ds-ink">
            {editor.mode === 'add'
              ? t('providerModelAddTitle')
              : t('providerModelEditTitle', { model: editor.form.originalModelId })}
          </h4>
          {editor.mode === 'add' ? (
            <div className="grid gap-2">
              <span className="text-[12px] font-semibold text-ds-muted">{t('providerModelKindLabel')}</span>
              <div className="grid gap-2 md:grid-cols-3">
                {MODEL_KIND_META.map(({ kind, icon: Icon, titleKey, descKey }) => {
                  const selected = editor.form.kind === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateForm({ kind })}
                      className={`grid gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                        selected
                          ? 'border-accent/60 bg-ds-main/45 ring-1 ring-accent/30'
                          : 'border-ds-border bg-ds-card hover:bg-ds-hover'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink">
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t(titleKey)}
                      </span>
                      <span className="text-[11.5px] leading-4 text-ds-faint">{t(descKey)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <label className={fieldLabelClass}>
            {t('providerModelIdLabel')}
            <input
              className={`${textInputClass} font-mono text-[13px]`}
              value={editor.form.modelId}
              placeholder={t('providerModelIdPlaceholder')}
              spellCheck={false}
              autoFocus
              onChange={(e) => updateForm({ modelId: e.target.value })}
            />
            <span className="text-[12px] font-normal leading-5 text-ds-faint">{t('providerModelIdHint')}</span>
            {showNonTextWarning ? (
              <span className="text-[12px] font-normal leading-5 text-amber-600 dark:text-amber-300">
                {t('providerModelNonTextWarning')}
              </span>
            ) : null}
          </label>
          {editor.form.kind === 'chat' ? (
            <>
              <div className="grid gap-1.5">
                <span className="text-[12px] font-semibold text-ds-muted">{t('providerModelContextLabel')}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {CONTEXT_WINDOW_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditor((prev) =>
                        prev ? { ...prev, contextText: describeContextWindowTokens(preset) } : prev
                      )}
                      className={chipButtonClass(parsedContextTokens === preset)}
                    >
                      {describeContextWindowTokens(preset)}
                    </button>
                  ))}
                  <input
                    className="w-36 min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 font-mono text-[12.5px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    value={editor.contextText}
                    placeholder={t('providerModelContextPlaceholder')}
                    spellCheck={false}
                    onChange={(e) => {
                      const value = e.target.value
                      setEditor((prev) => prev ? { ...prev, contextText: value } : prev)
                    }}
                  />
                  {parsedContextTokens ? (
                    <span className="text-[12px] text-ds-faint">
                      {t('providerModelContextParsed', { tokens: parsedContextTokens.toLocaleString() })}
                    </span>
                  ) : null}
                </div>
                <span className="text-[12px] leading-5 text-ds-faint">{t('providerModelContextHint')}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <ToggleField
                  label={t('providerModelVisionLabel')}
                  description={t('providerModelVisionDesc')}
                  checked={editor.form.visionInput}
                  onChange={(value) => updateForm({ visionInput: value })}
                />
                <ToggleField
                  label={t('providerModelToolsLabel')}
                  description={t('providerModelToolsDesc')}
                  checked={editor.form.supportsToolCalling}
                  onChange={(value) => updateForm({ supportsToolCalling: value })}
                />
              </div>
              <div className="grid gap-2">
                <ToggleField
                  label={t('providerModelReasoningLabel')}
                  description={t('providerModelReasoningDesc')}
                  checked={editor.form.reasoningEnabled}
                  onChange={(value) => updateForm({ reasoningEnabled: value })}
                />
                {editor.form.reasoningEnabled ? (
                  <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/30 p-3">
                    <div className="grid gap-1.5">
                      <span className="text-[12px] font-semibold text-ds-muted">
                        {t('providerModelReasoningEfforts')}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {reasoningEffortPool.map((effort) => {
                          const selected = editor.form.reasoningEfforts.includes(effort)
                          return (
                            <button
                              key={effort}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => updateForm({
                                reasoningEfforts: selected
                                  ? editor.form.reasoningEfforts.filter((item) => item !== effort)
                                  : sortReasoningEfforts([...editor.form.reasoningEfforts, effort])
                              })}
                              className={chipButtonClass(selected)}
                            >
                              {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('providerModelReasoningDefault')}
                        <select
                          className={selectControlClass}
                          value={editor.form.reasoningDefaultEffort}
                          onChange={(e) => updateForm({
                            reasoningDefaultEffort: e.target.value as ModelReasoningEffort
                          })}
                        >
                          {(editor.form.reasoningEfforts.length > 0
                            ? sortReasoningEfforts(editor.form.reasoningEfforts)
                            : reasoningEffortPool
                          ).map((effort) => (
                            <option key={effort} value={effort}>
                              {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('providerModelReasoningProtocol')}
                        <select
                          className={selectControlClass}
                          value={editor.form.reasoningProtocol}
                          onChange={(e) => updateForm({
                            reasoningProtocol: e.target.value as ModelReasoningRequestProtocol
                          })}
                        >
                          {PROVIDER_MODEL_REASONING_PROTOCOLS.map((protocol) => (
                            <option key={protocol} value={protocol}>
                              {t(REASONING_PROTOCOL_LABEL_KEYS[protocol])}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <span className="text-[12px] leading-5 text-ds-faint">
                      {t('providerModelReasoningProtocolHint')}
                    </span>
                  </div>
                ) : null}
              </div>
              <label className={fieldLabelClass}>
                {t('providerModelAliasesLabel')}
                <input
                  className={`${textInputClass} font-mono text-[13px]`}
                  value={editor.aliasesText}
                  placeholder={t('providerModelAliasesPlaceholder')}
                  spellCheck={false}
                  onChange={(e) => {
                    const value = e.target.value
                    setEditor((prev) => prev ? { ...prev, aliasesText: value } : prev)
                  }}
                />
                <span className="text-[12px] font-normal leading-5 text-ds-faint">
                  {t('providerModelAliasesHint')}
                </span>
              </label>
            </>
          ) : null}
          {errors.length > 0 && editor.form.modelId.trim() !== '' ? (
            <div className="grid gap-1">
              {errors.map((error) => (
                <span key={error.code} className="text-[12px] text-red-600 dark:text-red-300">
                  {formErrorMessage(t, error)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={errors.length > 0}
              onClick={saveEditor}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('providerModelSave')}
            </button>
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('providerModelCancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
