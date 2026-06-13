const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

// 品牌升级后构建环境变量改用 KUN_* 前缀;旧的 DEEPSEEK_GUI_* 仍然
// 兼容读取,避免 CI / 本地发布脚本一刀切失效。
function envWithLegacyFallback(kunName, legacyName) {
  const value = process.env[kunName]
  if (value !== undefined && value !== '') return value
  return process.env[legacyName]
}

function loadLocalReleaseEnv() {
  const candidates = [
    envWithLegacyFallback('KUN_RELEASE_ENV', 'DEEPSEEK_GUI_RELEASE_ENV'),
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

// R2 release prefix 维持旧值不动:线上老版本轮询的就是
// `…/deepseek-gui/channels/<channel>/latest/`,prefix 一改老客户端就再也
// 收不到更新。默认公开域名优先使用 kun-agent,运行时仍会兜底旧域名。
const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://www.kun-agent.com/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'deepseek-gui')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(
  envWithLegacyFallback('KUN_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || 'stable'
)
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  envWithLegacyFallback('KUN_APP_VERSION', 'DEEPSEEK_GUI_APP_VERSION') || ''
).trim()
const artifactVersion = releaseAppVersion || '${version}'

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`KUN_UPDATE_CHANNEL (or legacy DEEPSEEK_GUI_UPDATE_CHANNEL) must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `KUN_APP_VERSION (or legacy DEEPSEEK_GUI_APP_VERSION) must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}

module.exports = {
  // appId 永远保持旧值,即使品牌已改名 Kun:
  //  - macOS 端 Squirrel.Mac 校验更新包签名时锚定 bundle identifier,
  //    换了 id 老版本会拒绝安装新版本;
  //  - Windows 端 NSIS 以 appId 派生卸载 GUID,换了 id 升级安装不会
  //    卸载旧版本,用户会装出两份应用;
  //  - macOS TCC 权限、通知授权也都挂在这个 id 上。
  appId: 'com.xingyuzhong.deepseekgui',
  productName: 'Kun',
  asar: true,
  asarUnpack: [
    '**/kun/dist/**/*',
    '**/kun/package*.json',
    '**/kun/node_modules/**/*',
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*'
  ],
  npmRebuild: true,
  directories: {
    output: envWithLegacyFallback('KUN_DIST_DIR', 'DEEPSEEK_GUI_DIST_DIR') || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'kun/dist/**/*',
    'kun/package.json',
    'kun/package-lock.json',
    'kun/node_modules/**/*',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*'
    // node_modules/openclaw (the vendor/openclaw-shim file: dep) must ship:
    // the WeChat bridge imports @tencent-weixin/openclaw-weixin/dist at
    // runtime to send media, and that chain resolves openclaw/plugin-sdk/*.
  ],
  artifactName: `Kun-${artifactVersion}-\${os}-\${arch}.\${ext}`,
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
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      // 语音输入：渲染进程通过 getUserMedia 录音做语音转文字。
      NSMicrophoneUsageDescription: 'Kun uses the microphone for voice-to-text input.'
    },
    // macOS 不会自动套圆角遮罩,图标文件本身需要是「圆角方块 + 透明边距」
    icon: './src/asset/img/kun_mac.png',
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
    // Windows does not mask app icons for us; use the rounded asset so
    // desktop/start-menu/taskbar shortcuts do not show a hard square edge.
    // Ship a multi-size .ico (16/24/32/48/64/72/96/128/256) so Explorer and
    // the desktop render crisp icons at small sizes (#222). Regenerate with:
    // npx --yes png2icons src/asset/img/kun_mac.png build/icon -icowe -bc
    icon: './build/icon.ico',
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
    shortcutName: 'Kun',
    uninstallDisplayName: 'Kun',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/kun.png',
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
