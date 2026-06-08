const { execFileSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const KUN_RUNTIME_REQUIRED_PATHS = [
  'kun/dist/cli/serve-entry.js',
  'kun/package.json',
  'kun/package-lock.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function prunePackedKunDependencies(context) {
  const root = unpackedAppRoot(context)
  const kunDir = join(root, 'kun')
  if (!existsSync(kunDir)) return

  assertExists(join(kunDir, 'package.json'), 'Kun package manifest')
  assertExists(join(kunDir, 'node_modules'), 'Kun node_modules')

  const prune = npmCommand(['prune', '--omit=dev', '--ignore-scripts'])
  execFileSync(prune.command, prune.args, {
    cwd: kunDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    },
    stdio: 'inherit'
  })

  // Keep native SQLite on the app root dependency so electron-builder's
  // native-module rebuild owns the target arch and Electron ABI.
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  rmSync(join(kunDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true })
}

function validateBundledKunRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

async function afterPack(context) {
  prunePackedKunDependencies(context)
  validateBundledKunRuntime(context)
  maybeAdhocSignMacApp(context)
}

exports.KUN_RUNTIME_REQUIRED_PATHS = KUN_RUNTIME_REQUIRED_PATHS
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  npmCommand,
  prunePackedKunDependencies,
  validateBundledKunRuntime
}
exports.default = afterPack
