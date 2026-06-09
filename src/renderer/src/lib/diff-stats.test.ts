import { describe, expect, it } from 'vitest'
import {
  extractUnifiedDiffText,
  looksLikeUnifiedDiff
} from './diff-stats'

const patch = [
  'diff --git a/src/demo.ts b/src/demo.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/demo.ts',
  '+++ b/src/demo.ts',
  '@@ -1,1 +1,1 @@',
  '-old',
  '+new'
].join('\n')

describe('diff-stats', () => {
  it('extracts raw unified diff text', () => {
    expect(extractUnifiedDiffText(patch)).toBe(patch)
    expect(looksLikeUnifiedDiff(patch)).toBe(true)
  })

  it('extracts unified diff text from JSON tool output', () => {
    const detail = JSON.stringify(
      {
        path: '/tmp/workspace/src/demo.ts',
        replacements: 1,
        bytes_written: 42,
        diff: patch
      },
      null,
      2
    )

    expect(extractUnifiedDiffText(detail)).toBe(patch)
    expect(looksLikeUnifiedDiff(detail)).toBe(true)
  })
})
