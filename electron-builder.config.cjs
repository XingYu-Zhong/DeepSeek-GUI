const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

function loadLocalReleaseEnv() {
  const candidates = [
    process.env.DEEPSEEK_GUI_RELEASE_ENV,
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://deepseek-gui.com/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'deepseek-gui')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(process.env.DEEPSEEK_GUI_UPDATE_CHANNEL || 'stable')
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (process.env.DEEPSEEK_GUI_APP_VERSION || '').trim()
const artifactVersion = releaseAppVersion || '${version}'

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`DEEPSEEK_GUI_UPDATE_CHANNEL must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `DEEPSEEK_GUI_APP_VERSION must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}

module.exports = {
  appId: 'com.xingyuzhong.deepseekgui',
  productName: 'DeepSeek GUI',
  asar: true,
  asarUnpack: [
    '**/kun/dist/**/*',
    '**/kun/package*.json',
    '**/kun/node_modules/**/*',
    // OCR worker entry — must be on real fs for child_process.fork()
    '**/out/main/ocr-worker-entry*',
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*',
    // tesseract.js OCR engine — unpacked so worker_threads + WASM can load
    // from real filesystem. Includes tesseract.js's runtime transitive
    // dependencies (bmp-js, idb-keyval, is-url, node-fetch,
    // regenerator-runtime, wasm-feature-detect, zlibjs) because the
    // worker resolves them via Node's ancestor node_modules walk, and
    // crossing from .unpacked back into the ASAR is not supported.
    '**/node_modules/tesseract.js/**/*',
    '**/node_modules/tesseract.js-core/**/*',
    '**/node_modules/bmp-js/**/*',
    '**/node_modules/idb-keyval/**/*',
    '**/node_modules/is-url/**/*',
    '**/node_modules/node-fetch/**/*',
    '**/node_modules/regenerator-runtime/**/*',
    '**/node_modules/wasm-feature-detect/**/*',
    '**/node_modules/zlibjs/**/*',
    // canvas (node-canvas) — native .node binary must be on real fs
    '**/node_modules/.pnpm/canvas*/**/*',
    // pdfjs-dist — standard_fonts data must be accessible for PDF rendering
    '**/node_modules/pdfjs-dist/**/*',
  ],
  npmRebuild: true,
  directories: {
    output: process.env.DEEPSEEK_GUI_DIST_DIR || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'scripts/vision-ocr.js',
    'kun/dist/**/*',
    'kun/package.json',
    'kun/package-lock.json',
    'kun/node_modules/**/*',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*',
    '!**/node_modules/openclaw/**/*',
    '!**/node_modules/path2d-polyfill/**/*'
  ],
  artifactName: `DeepSeek-GUI-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: genericUpdateUrl
    }
  ],
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    icon: './src/asset/img/deepseek.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    icon: './src/asset/img/deepseek.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'DeepSeek GUI',
    uninstallDisplayName: 'DeepSeek GUI',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/deepseek.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
