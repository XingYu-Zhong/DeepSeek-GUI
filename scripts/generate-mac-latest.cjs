#!/usr/bin/env node

const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { readdir, stat, writeFile } = require('node:fs/promises')
const { basename, resolve, join } = require('node:path')

function usage() {
  console.error('Usage: node scripts/generate-mac-latest.cjs [distDir]')
}

function sha512Base64(path) {
  const hash = createHash('sha512')
  return new Promise((resolvePromise, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('base64')))
  })
}

function sortMacArtifacts(a, b) {
  const order = new Map([
    ['x64.zip', 0],
    ['arm64.zip', 1],
    ['x64.dmg', 2],
    ['arm64.dmg', 3]
  ])
  const keyA = `${a.arch}.${a.ext}`
  const keyB = `${b.arch}.${b.ext}`
  return (order.get(keyA) ?? 99) - (order.get(keyB) ?? 99) || a.fileName.localeCompare(b.fileName)
}

async function main() {
  const distDir = resolve(process.argv[2] || 'dist')
  const entries = await readdir(distDir)
  const artifacts = []

  for (const fileName of entries) {
    const match = fileName.match(/^DeepSeek-GUI-(.+)-mac-(arm64|x64)\.(zip|dmg)$/)
    if (!match) continue
    artifacts.push({
      fileName,
      version: match[1],
      arch: match[2],
      ext: match[3],
      path: join(distDir, fileName)
    })
  }

  if (!artifacts.length) {
    throw new Error(`No macOS zip/dmg artifacts found in ${distDir}`)
  }

  const versions = new Set(artifacts.map((artifact) => artifact.version))
  if (versions.size !== 1) {
    throw new Error(`Mac artifacts contain mixed versions: ${Array.from(versions).join(', ')}`)
  }

  artifacts.sort(sortMacArtifacts)

  const files = []
  for (const artifact of artifacts) {
    const info = await stat(artifact.path)
    files.push({
      url: basename(artifact.fileName),
      sha512: await sha512Base64(artifact.path),
      size: info.size
    })
  }

  const primary = files.find((file) => file.url.endsWith('-mac-x64.zip')) ||
    files.find((file) => file.url.endsWith('.zip')) ||
    files[0]

  const lines = [
    `version: ${artifacts[0].version}`,
    'files:',
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ]

  const latestPath = join(distDir, 'latest-mac.yml')
  await writeFile(latestPath, lines.join('\n'), 'utf8')
  console.log(`Generated ${latestPath}`)
}

main().catch((error) => {
  usage()
  console.error(`[generate-mac-latest] ${error.message}`)
  process.exit(1)
})
