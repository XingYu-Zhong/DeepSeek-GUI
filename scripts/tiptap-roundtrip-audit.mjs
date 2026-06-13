#!/usr/bin/env node
// Round-trip fidelity audit for the Tiptap markdown migration (Phase 0 gate).
//
// For every markdown file in the corpus we measure:
//   stable  — serialize(parse(s1)) === s1 where s1 = serialize(parse(md)).
//             Instability means autosave would keep rewriting the file forever.
//   exact   — s1 === md (modulo trailing newline). Pure formatting fidelity.
//   text    — plain text extracted from parse(md) matches plain text of parse(s1).
//             Text loss means real content was dropped, not just reformatted.
//
// Usage: node scripts/tiptap-roundtrip-audit.mjs [--verbose] [--sample <file>]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'release', 'build', '.git', 'vendor'])
const verbose = process.argv.includes('--verbose')
const sampleArg = process.argv.indexOf('--sample')

const [{ StarterKit }, { MarkdownManager }, { TableKit }, { TaskList, TaskItem }, { Image }] =
  await Promise.all([
    import('@tiptap/starter-kit'),
    import('@tiptap/markdown'),
    import('@tiptap/extension-table'),
    import('@tiptap/extension-list'),
    import('@tiptap/extension-image')
  ])

function createManager() {
  return new MarkdownManager({
    markedOptions: { gfm: true },
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image
    ]
  })
}

function collectMarkdownFiles(dir, acc) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      collectMarkdownFiles(full, acc)
    } else if (entry.endsWith('.md') && stats.size > 0 && stats.size < 512 * 1024) {
      acc.push(full)
    }
  }
  return acc
}

function plainText(node, acc = []) {
  if (!node) return acc
  if (node.type === 'text' && node.text) acc.push(node.text)
  if (Array.isArray(node.content)) {
    for (const child of node.content) plainText(child, acc)
  }
  return acc
}

function normalizeText(parts) {
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function firstDiffLine(a, b) {
  const linesA = a.split('\n')
  const linesB = b.split('\n')
  for (let i = 0; i < Math.max(linesA.length, linesB.length); i += 1) {
    if (linesA[i] !== linesB[i]) {
      return { line: i + 1, before: linesA[i] ?? '<EOF>', after: linesB[i] ?? '<EOF>' }
    }
  }
  return null
}

function audit(markdown) {
  const manager = createManager()
  const doc1 = manager.parse(markdown)
  const s1 = manager.serialize(doc1)
  const doc2 = manager.parse(s1)
  const s2 = manager.serialize(doc2)

  const trimmedSource = markdown.replace(/\n+$/, '')
  return {
    stable: s1 === s2,
    exact: s1 === trimmedSource,
    textPreserved: normalizeText(plainText(doc1)) === normalizeText(plainText(doc2)),
    sourceTextPreserved:
      normalizeText(plainText(doc1)).length > 0 || trimmedSource.trim().length === 0,
    s1,
    s2,
    diff: s1 === trimmedSource ? null : firstDiffLine(trimmedSource, s1),
    instabilityDiff: s1 === s2 ? null : firstDiffLine(s1, s2)
  }
}

if (sampleArg >= 0) {
  const file = process.argv[sampleArg + 1]
  const markdown = readFileSync(file, 'utf8')
  const result = audit(markdown)
  console.log(JSON.stringify({ file, stable: result.stable, exact: result.exact }, null, 2))
  if (result.diff) console.log('first diff:', JSON.stringify(result.diff, null, 2))
  if (result.instabilityDiff) {
    console.log('INSTABILITY:', JSON.stringify(result.instabilityDiff, null, 2))
  }
  process.exit(0)
}

const files = collectMarkdownFiles(ROOT, [])
const summary = { total: 0, stable: 0, exact: 0, textPreserved: 0, failures: [], normalized: [] }

for (const file of files) {
  const markdown = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  let result
  try {
    result = audit(markdown)
  } catch (error) {
    summary.total += 1
    summary.failures.push({ file: rel, error: error.message })
    continue
  }
  summary.total += 1
  if (result.stable) summary.stable += 1
  else summary.failures.push({ file: rel, instability: result.instabilityDiff })
  if (result.exact) summary.exact += 1
  else summary.normalized.push({ file: rel, diff: result.diff })
  if (result.textPreserved) summary.textPreserved += 1
}

console.log('--- tiptap markdown round-trip audit ---')
console.log(`corpus: ${summary.total} files`)
console.log(`stable (idempotent after 1 pass): ${summary.stable}/${summary.total}`)
console.log(`exact (byte-identical): ${summary.exact}/${summary.total}`)
console.log(`text preserved across passes: ${summary.textPreserved}/${summary.total}`)

if (summary.failures.length > 0) {
  console.log('\nINSTABILITY / ERRORS (hard gate failures):')
  for (const failure of summary.failures.slice(0, 20)) {
    console.log(' ', JSON.stringify(failure))
  }
}

if (verbose && summary.normalized.length > 0) {
  console.log('\nnormalization diffs (soft, formatting-only):')
  for (const item of summary.normalized.slice(0, 40)) {
    console.log(' ', item.file, '->', JSON.stringify(item.diff))
  }
}

process.exit(summary.failures.length > 0 ? 1 : 0)
