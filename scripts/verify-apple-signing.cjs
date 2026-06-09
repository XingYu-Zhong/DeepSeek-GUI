#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')

function parseArgs(argv) {
  const args = {}

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (!part.startsWith('--')) {
      continue
    }

    const key = part.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
      continue
    }

    args[key] = next
    i += 1
  }

  return args
}

function usage() {
console.log(`Usage:
  npm run verify:apple -- --p12 /path/to/developer-id.p12 --p12-password YOUR_PASSWORD --p8 /path/to/AuthKey_XXXXXX.p8 --key-id XXXXXX --issuer YOUR_ISSUER_UUID

Options:
  --p12               Path to the .p12 signing certificate file.
  --p12-base64        Base64 string for the same .p12 file.
  --p12-password      Password used when exporting the .p12 file.
  --p8                Path to the App Store Connect API key (.p8).
  --p8-base64         Base64 string for the same .p8 file.
  --key-id            App Store Connect API key ID.
  --issuer            App Store Connect issuer UUID.
  --expected-cn       Expected certificate CN prefix.
                      Default: "Developer ID Application:"
  --check-notary      Also ask Apple notarytool to validate the API key online.
  --help              Show this message.

Environment fallback:
  MAC_CODESIGN_P12_PATH
  MAC_CODESIGN_P12_BASE64
  MAC_CODESIGN_P12_PASSWORD
  CSC_LINK
  APPLE_API_KEY
  APPLE_API_KEY_BASE64
  APPLE_API_KEY_ID
  APPLE_API_ISSUER`)
}

function fail(message) {
  console.error(`[fail] ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`[pass] ${message}`)
}

function info(message) {
  console.log(`[info] ${message}`)
}

function requireCommand(command) {
  try {
    execFileSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' })
    pass(`Found command: ${command}`)
  } catch {
    fail(`Missing required command: ${command}`)
  }
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    })
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : ''
    const stdout = error.stdout ? String(error.stdout).trim() : ''
    const detail = stderr || stdout || error.message
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
}

function readPkcs12Certificate(p12Path, p12Password) {
  const baseArgs = [
    'pkcs12',
    '-in',
    p12Path,
    '-clcerts',
    '-nokeys',
    '-passin',
    `pass:${p12Password}`
  ]

  try {
    return run('openssl', baseArgs)
  } catch (error) {
    const message = String(error.message)
    const needsLegacyProvider =
      message.includes('RC2-40-CBC') || message.includes('inner_evp_generic_fetch:unsupported')

    if (!needsLegacyProvider) {
      throw error
    }

    info('P12 uses a legacy PKCS#12 cipher. Retrying with OpenSSL legacy compatibility mode.')
    return run('openssl', ['pkcs12', '-legacy', ...baseArgs.slice(1)])
  }
}

function ensureFile(path, label) {
  if (!path) {
    fail(`${label} is missing`)
    return false
  }

  if (!existsSync(path)) {
    fail(`${label} not found: ${path}`)
    return false
  }

  pass(`${label} found: ${path}`)
  return true
}

function extractCn(subjectLine) {
  const match = subjectLine.match(/CN=([^,]+)/)
  return match ? match[1] : ''
}

function verifyP8Contents(p8Path, expectedKeyId) {
  const raw = readFileSync(p8Path, 'utf8').trim()
  if (!raw.includes('BEGIN PRIVATE KEY')) {
    fail(`P8 file does not look like a private key: ${p8Path}`)
    return
  }

  pass('P8 file contains a PEM private key')

  if (expectedKeyId) {
    const expectedName = `AuthKey_${expectedKeyId}.p8`
    if (basename(p8Path) === expectedName) {
      pass(`P8 filename matches key id: ${expectedName}`)
    } else {
      fail(`P8 filename does not match key id. Expected ${expectedName}, got ${basename(p8Path)}`)
    }
  }
}

function verifyP12Certificate(p12Path, p12Password, expectedCnPrefix) {
  const certPem = readPkcs12Certificate(p12Path, p12Password)

  pass('P12 password is valid and the certificate can be read')

  const subject = run('openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253'], {
    input: certPem
  }).trim()
  const issuer = run('openssl', ['x509', '-noout', '-issuer', '-nameopt', 'RFC2253'], {
    input: certPem
  }).trim()
  const dates = run('openssl', ['x509', '-noout', '-dates'], { input: certPem }).trim()
  const fingerprint = run('openssl', ['x509', '-noout', '-fingerprint', '-sha1'], {
    input: certPem
  }).trim()
  const text = run('openssl', ['x509', '-noout', '-text'], { input: certPem })

  info(subject)
  info(issuer)
  info(dates)
  info(fingerprint)

  const cn = extractCn(subject)
  if (!cn) {
    fail('Could not extract certificate CN from the P12 file')
  } else if (cn.startsWith(expectedCnPrefix)) {
    pass(`Certificate CN matches expected type: ${cn}`)
  } else {
    fail(`Certificate CN is not a ${expectedCnPrefix} certificate: ${cn}`)
  }

  if (text.includes('Code Signing')) {
    pass('Certificate includes the Code Signing extended key usage')
  } else {
    fail('Certificate does not advertise Code Signing usage')
  }

  return cn
}

function verifyP12Import(p12Path, p12Password, expectedCnPrefix, tempRoot) {
  const keychainPath = join(tempRoot, 'verify-signing.keychain-db')
  const keychainPassword = 'deepseek-gui-verify'

  try {
    run('security', ['create-keychain', '-p', keychainPassword, keychainPath])
    run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath])
    run('security', ['set-keychain-settings', keychainPath])
    run('security', [
      'import',
      p12Path,
      '-k',
      keychainPath,
      '-P',
      p12Password,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security'
    ])

    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', keychainPath]).trim()
    info(identities)

    if (identities.includes('0 valid identities found')) {
      fail('P12 imported, but no valid code signing identity was found in the temp keychain')
      return
    }

    if (identities.includes(expectedCnPrefix)) {
      pass(`Temp keychain exposes a ${expectedCnPrefix} identity`)
    } else {
      fail(`Temp keychain does not expose a ${expectedCnPrefix} identity`)
    }
  } finally {
    try {
      run('security', ['delete-keychain', keychainPath])
    } catch (error) {
      info(`Temp keychain cleanup warning: ${error.message}`)
    }
  }
}

function verifyNotaryCredentialsOnline(p8Path, keyId, issuer) {
  if (!p8Path || !keyId || !issuer) {
    fail('Online notary check requires --p8/--p8-base64, --key-id and --issuer')
    return
  }

  const output = run('xcrun', [
    'notarytool',
    'history',
    '--key',
    p8Path,
    '--key-id',
    keyId,
    '--issuer',
    issuer,
    '--output-format',
    'json'
  ]).trim()

  info(output)
  pass('Apple notarytool accepted the API key credentials')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === 'true') {
    usage()
    return
  }

  if (process.platform !== 'darwin') {
    fail('This verification script currently targets macOS only')
    return
  }

  const p12Path = args.p12 || process.env.MAC_CODESIGN_P12_PATH
  const p12Base64 = args['p12-base64'] || process.env.MAC_CODESIGN_P12_BASE64 || process.env.CSC_LINK
  const p12Password = args['p12-password'] || process.env.MAC_CODESIGN_P12_PASSWORD
  const p8PathArg = args.p8 || process.env.APPLE_API_KEY
  const p8Base64 = args['p8-base64'] || process.env.APPLE_API_KEY_BASE64
  const keyId = args['key-id'] || process.env.APPLE_API_KEY_ID
  const issuer = args.issuer || process.env.APPLE_API_ISSUER
  const expectedCnPrefix = args['expected-cn'] || 'Developer ID Application:'
  const shouldCheckNotary = args['check-notary'] === 'true'

  const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-verify-'))
  let p8Path = p8PathArg

  try {
    requireCommand('openssl')
    requireCommand('security')
    if (shouldCheckNotary) {
      requireCommand('xcrun')
    }

    if (!p12Password) {
      fail('P12 password is missing. Pass --p12-password or set MAC_CODESIGN_P12_PASSWORD')
      return
    }
    pass('P12 password was provided')

    let resolvedP12Path = p12Path
    if (!resolvedP12Path && p12Base64) {
      resolvedP12Path = join(tempRoot, 'certificate-from-base64.p12')
      writeFileSync(resolvedP12Path, Buffer.from(p12Base64, 'base64'))
      pass('Decoded base64 P12 into a temporary certificate file')
    }

    if (!ensureFile(resolvedP12Path, 'P12 file')) {
      return
    }

    if (!p8Path && p8Base64) {
      const tempP8Name = keyId ? `AuthKey_${keyId}.p8` : 'AuthKey_from_base64.p8'
      p8Path = join(tempRoot, tempP8Name)
      writeFileSync(p8Path, Buffer.from(p8Base64, 'base64'))
      pass('Decoded APPLE_API_KEY_BASE64 into a temporary P8 file')
    }

    if (p8Path) {
      if (!ensureFile(p8Path, 'P8 file')) {
        return
      }
      verifyP8Contents(p8Path, keyId)
    } else {
      info('No P8 file was provided, skipping local P8 file validation')
    }

    if (keyId) {
      pass(`Key ID provided: ${keyId}`)
    } else {
      info('No key id provided, skipping key id consistency checks')
    }

    if (issuer) {
      pass(`Issuer provided: ${issuer}`)
    } else {
      info('No issuer provided, skipping issuer presence checks')
    }

    verifyP12Certificate(resolvedP12Path, p12Password, expectedCnPrefix)
    verifyP12Import(resolvedP12Path, p12Password, expectedCnPrefix, tempRoot)

    if (shouldCheckNotary) {
      verifyNotaryCredentialsOnline(p8Path, keyId, issuer)
    }

    if (process.exitCode && process.exitCode !== 0) {
      info('One or more verification steps failed')
      return
    }

    pass('Apple signing credentials look good for local verification')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main()
