const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

function getNotaryCredentials() {
  const keyId = process.env.APPLE_API_KEY_ID
  const issuer = process.env.APPLE_API_ISSUER
  const keyPath = process.env.APPLE_API_KEY
  const keyBase64 = process.env.APPLE_API_KEY_BASE64

  if (!keyId || !issuer || (!keyPath && !keyBase64)) {
    return null
  }

  if (keyPath) {
    return { keyId, issuer, keyPath, cleanup: null }
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-notary-'))
  const tempKeyPath = join(tempDir, `AuthKey_${keyId}.p8`)
  writeFileSync(tempKeyPath, Buffer.from(keyBase64, 'base64'))

  return {
    keyId,
    issuer,
    keyPath: tempKeyPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true })
  }
}

function runNotaryToolJson(args) {
  const output = execFileSync('xcrun', ['notarytool', ...args, '--output-format', 'json'], {
    encoding: 'utf8'
  })
  console.log(output.trim())

  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Failed to parse notarytool JSON output: ${error.message}`)
  }
}

function isBundleLike(path) {
  return /\.(app|appex|bundle|framework|plugin|xpc)$/i.test(path)
}

function isLikelySignedFile(path, info) {
  if (/\.(dylib|node|so)$/i.test(path)) return true
  return info.isFile() && (info.mode & 0o111) !== 0 && /\/Contents\/(?:MacOS|Frameworks)\//.test(path)
}

function collectSignedCodeCandidates(appBundle) {
  const candidates = new Set([appBundle])
  const stack = [appBundle]

  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) continue

      if (info.isDirectory()) {
        if (isBundleLike(path)) candidates.add(path)
        stack.push(path)
        continue
      }

      if (isLikelySignedFile(path, info)) {
        candidates.add(path)
      }
    }
  }

  return Array.from(candidates).sort()
}

function readCodeSignatureDetails(path) {
  const result = spawnSync('codesign', ['--display', '--verbose=4', path], {
    encoding: 'utf8'
  })
  if (result.error) {
    throw result.error
  }
  const details = `${result.stdout || ''}${result.stderr || ''}`

  if (result.status !== 0) {
    throw new Error(`codesign --display failed for ${path} with status ${result.status}\n${details}`)
  }

  return details
}

function verifySecureTimestamps(appBundle) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle], {
    stdio: 'inherit'
  })

  const candidates = collectSignedCodeCandidates(appBundle)
  console.log(`[mac-notarize] Verifying secure timestamps for ${candidates.length} signed code candidate(s).`)
  for (const candidate of candidates) {
    const details = readCodeSignatureDetails(candidate)
    if (!/^Timestamp=/m.test(details)) {
      throw new Error(
        `The signature is missing a secure timestamp: ${candidate}. Ensure electron-builder mac.timestamp is enabled.`
      )
    }
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const creds = getNotaryCredentials()
  if (!creds) {
    console.log('[mac-notarize] No Apple notary credentials found, skipping notarization.')
    return
  }

  const appBundle = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appBundle)) {
    throw new Error(`App bundle not found for notarization: ${appBundle}`)
  }

  const zipPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}-notary.zip`)

  try {
    verifySecureTimestamps(appBundle)

    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appBundle, zipPath], {
      stdio: 'inherit'
    })

    const submitResult = runNotaryToolJson([
        'submit',
        zipPath,
        '--wait',
        '--key',
        creds.keyPath,
        '--key-id',
        creds.keyId,
        '--issuer',
        creds.issuer
      ])

    if (submitResult.status !== 'Accepted') {
      if (submitResult.id) {
        try {
          const logResult = runNotaryToolJson([
            'log',
            submitResult.id,
            '--key',
            creds.keyPath,
            '--key-id',
            creds.keyId,
            '--issuer',
            creds.issuer
          ])
          console.log(`[mac-notarize] Detailed log URL: ${logResult.developerLogUrl || '<none>'}`)
        } catch (error) {
          console.error(`[mac-notarize] Failed to fetch Apple notary log: ${error.message}`)
        }
      }

      throw new Error(
        `Apple notarization failed with status: ${submitResult.status || 'unknown'}`
      )
    }

    execFileSync('xcrun', ['stapler', 'staple', appBundle], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', appBundle], { stdio: 'inherit' })
  } finally {
    rmSync(zipPath, { force: true })
    creds.cleanup?.()
  }
}

exports._internals = {
  collectSignedCodeCandidates,
  isBundleLike,
  isLikelySignedFile,
  readCodeSignatureDetails
}
