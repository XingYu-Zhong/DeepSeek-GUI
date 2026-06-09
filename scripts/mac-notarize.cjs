const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
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
