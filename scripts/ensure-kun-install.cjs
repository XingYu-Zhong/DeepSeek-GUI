const { existsSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const REQUIRED_PATHS = [
  'kun/package-lock.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]
const KUN_SQLITE_MODULE_PATH = 'kun/node_modules/better-sqlite3'

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  })
}

function ensureKunInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path))) {
    const installKun = run('npm', ['--prefix', 'kun', 'ci'])
    if (installKun.status !== 0) {
      process.exit(installKun.status || 1)
    }
  }

  if (existsSync(KUN_SQLITE_MODULE_PATH)) {
    rmSync(KUN_SQLITE_MODULE_PATH, { recursive: true, force: true })
    return
  }
}

ensureKunInstall()
