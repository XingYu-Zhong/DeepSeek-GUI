import type { ComponentPropsWithRef, MouseEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Streamdown, type StreamdownProps } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import 'streamdown/styles.css'
import { parseFileReferenceHref, rehypeFileReferences } from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useChatStore } from '../../store/chat-store'
import { StreamdownCode } from './StreamdownCode'

/** Reveal ~1/8 of the outstanding backlog per frame… */
const CATCHUP_DIVISOR = 8
/** …but never more than this, so a huge backlog (tab refocus, resumed
 * thread, burst from a fast model) drains as fast typing instead of a
 * near-instant wall of text. */
const MAX_STEP_PER_FRAME = 32

export function nextVisibleLength(current: number, target: number): number {
  if (current === target) return current
  // Live text shrank (interrupt / reset) — snap, never animate backwards.
  if (current > target) return target
  const backlog = target - current
  return current + Math.min(MAX_STEP_PER_FRAME, Math.max(1, Math.ceil(backlog / CATCHUP_DIVISOR)))
}

/**
 * Paces streaming text so it reveals sequentially, decoupled from SSE
 * chunk sizes. Without this, one bursty chunk spans several markdown
 * blocks and every affected line blurs in at once — the half-faded
 * patches scattered across bullets read as holes instead of typing.
 */
function useTypewriterText(text: string, streaming: boolean): string {
  // Start at the current length: re-entering a thread mid-turn must not
  // replay everything already on screen.
  const [visibleLength, setVisibleLength] = useState(() => text.length)
  const targetRef = useRef(text.length)
  targetRef.current = text.length

  useEffect(() => {
    if (!streaming) return
    let raf = requestAnimationFrame(function tick() {
      // When caught up this returns the same value, so React bails out of
      // re-rendering and the idle loop costs only the rAF callback.
      setVisibleLength((current) => nextVisibleLength(current, targetRef.current))
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [streaming])

  if (!streaming) return text
  let length = Math.min(visibleLength, text.length)
  // Don't cut a surrogate pair in half mid-reveal.
  const code = text.charCodeAt(length - 1)
  if (code >= 0xd800 && code <= 0xdbff) length += 1
  return text.slice(0, length)
}

const rehypePlugins = [
  rehypeFileReferences,
  [
    harden,
    {
      allowedLinkPrefixes: ['*']
    }
  ]
] satisfies StreamdownProps['rehypePlugins']

const components = {
  code: StreamdownCode,
  a: StreamdownLink
} satisfies StreamdownProps['components']

type StreamdownLinkProps = ComponentPropsWithRef<'a'> & { node?: unknown }

function StreamdownLink({
  href,
  children,
  className,
  title
}: StreamdownLinkProps): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const fileTarget = parseFileReferenceHref(href)
  const validation = useValidatedFileReference(fileTarget, workspaceRoot)
  const isExternal = href ? /^(https?:|mailto:)/i.test(href) : false
  const cleanClassName = className?.replace(/\bds-file-reference-link\b/g, '').trim()

  if (fileTarget && validation.status !== 'valid') {
    return (
      <span className={cleanClassName} title={title}>
        {children}
      </span>
    )
  }

  const resolvedFileTarget =
    fileTarget && validation.status === 'valid'
      ? { ...fileTarget, path: validation.path }
      : null

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (resolvedFileTarget) {
      event.preventDefault()
      previewWorkspaceFile({ ...resolvedFileTarget, workspaceRoot })
      return
    }

    if (isExternal && href && typeof window.kunGui?.openExternal === 'function') {
      event.preventDefault()
      void window.kunGui.openExternal(href).catch(() => undefined)
    }
  }

  const handleDoubleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!resolvedFileTarget) return
    event.preventDefault()
    void openWorkspacePathInEditor(resolvedFileTarget, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open file reference', {
          message: result.message,
          target: resolvedFileTarget
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <a
      href={href}
      title={title}
      className={[
        resolvedFileTarget ? 'ds-file-reference-link' : '',
        cleanClassName
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </a>
  )
}

type Props = {
  /** Markdown source */
  text: string
  /**
   * When true (live SSE chunking), uses Streamdown `streaming` mode with a
   * char-level blur-in on newly appended content.
   */
  streaming: boolean
  className?: string
}

export function StreamdownAssistant({ text, streaming, className }: Props): ReactElement {
  const pacedText = useTypewriterText(text, streaming)

  return (
    <Streamdown
      className={className}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      isAnimating={streaming}
      // Streamdown's own per-char animation must stay OFF: it diffs old vs
      // new chars by position in a count that excludes code/pre text, so
      // every time an inline-code chip closes during streaming the
      // positions shift and already-visible text re-animates from
      // transparent — the patchy "missing text" look. The pacing hook
      // above is the typewriter; revealed chars render crisp immediately.
      animated={false}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {pacedText}
    </Streamdown>
  )
}
