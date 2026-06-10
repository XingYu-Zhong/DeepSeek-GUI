# Windows release: build NSIS installer and upload to an existing GitHub release tag.
# Use the same tag created by release-mac.sh on macOS.
#
# Usage (PowerShell):
#   .\scripts\release-win.ps1 -Tag v0.1.1
#   .\scripts\release-win.ps1 -Tag v0.1.1 -Publish
#   .\scripts\release-win.ps1 -Tag v0.1.1 -R2 -PromoteR2 -Publish
#   .\scripts\release-win.ps1 -Tag v0.1.1 -Channel stable -R2 -PromoteR2
#
# Or copy dist\.release-meta.env from the Mac build machine:
#   .\scripts\release-win.ps1 -Publish
#
# npm:
#   npm run release:win -- -Tag v0.1.1 -R2 -PromoteR2 -Publish

param(
  [string]$Tag = '',
  [ValidateSet('', 'frontier', 'stable')]
  [string]$Channel = '',
  [switch]$Stable,
  [switch]$Frontier,
  [switch]$Publish,
  [switch]$R2,
  [switch]$PromoteR2
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) { Write-Host $Message -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host $Message -ForegroundColor Green }
function Write-Err([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Assert-Semver([string]$Version) {
  if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Err "Release tag must be vX.Y.Z. electron-updater cannot use four-part versions: $Version"
    exit 1
  }
}

function Normalize-ReleaseChannel([string]$Value) {
  if (-not $Value) { return 'frontier' }
  if ($Value -eq 'frontier' -or $Value -eq 'stable') { return $Value }
  Write-Err "Release channel must be frontier or stable, got: $Value"
  exit 1
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Err "$Name not found in PATH."
    exit 1
  }
}

function Load-LocalReleaseEnv([string]$RootPath) {
  $configured = [Environment]::GetEnvironmentVariable('DEEPSEEK_GUI_RELEASE_ENV', 'Process')
  $candidates = @()
  if ($configured) { $candidates += $configured }
  $candidates += (Join-Path $RootPath 'scripts\release.local.env')
  $candidates += (Join-Path $RootPath 'release.local.env')

  foreach ($candidate in $candidates) {
    if (-not $candidate -or -not (Test-Path $candidate)) { continue }
    Get-Content $candidate | ForEach-Object {
      $line = $_.Trim()
      if (-not $line -or $line.StartsWith('#')) { return }
      $match = [regex]::Match($line, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$')
      if (-not $match.Success) { return }
      $name = $match.Groups[1].Value
      $value = $match.Groups[2].Value.Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      Set-Item -Path "Env:$name" -Value $value
    }
    Write-Info "Loaded local release config: $candidate"
    return
  }
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
Load-LocalReleaseEnv $Root

if ($Stable -and $Frontier) {
  Write-Err 'Use only one of -Stable or -Frontier.'
  exit 1
}

$RequestedChannel = if ($Stable) {
  'stable'
} elseif ($Frontier) {
  'frontier'
} elseif ($Channel) {
  $Channel
} elseif ($env:RELEASE_CHANNEL) {
  $env:RELEASE_CHANNEL
} elseif ($env:DEEPSEEK_GUI_UPDATE_CHANNEL) {
  $env:DEEPSEEK_GUI_UPDATE_CHANNEL
} else {
  'frontier'
}
$ReleaseChannel = Normalize-ReleaseChannel $RequestedChannel
$ChannelExplicit = $Stable -or $Frontier -or [bool]$Channel

Require-Command 'node'
Require-Command 'npm'
Require-Command 'gh'

& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Err 'gh is not authenticated. Run: gh auth login'
  exit 1
}

$TagName = ''
if ($Tag.Trim()) {
  $TagName = $Tag.Trim()
  if (-not $TagName.StartsWith('v')) { $TagName = "v$TagName" }
} else {
  $MetaPath = Join-Path $Root 'dist\.release-meta.env'
  if (-not (Test-Path $MetaPath)) {
    Write-Err "Missing $MetaPath — pass -Tag vX.Y.Z (from Mac release) or copy dist\.release-meta.env from Mac."
    exit 1
  }
  Get-Content $MetaPath | ForEach-Object {
    if ($_ -match '^\s*TAG_NAME=(.+)\s*$') { $TagName = $Matches[1].Trim() }
    if (-not $ChannelExplicit -and $_ -match '^\s*RELEASE_CHANNEL=(.+)\s*$') {
      $ReleaseChannel = Normalize-ReleaseChannel ($Matches[1].Trim())
    }
  }
  if (-not $TagName) {
    Write-Err "Could not read TAG_NAME from $MetaPath"
    exit 1
  }
}

Write-Info "GitHub release tag: $TagName"
Write-Info "Release channel: $ReleaseChannel"
$ReleaseVersion = $TagName.TrimStart('v')
Assert-Semver $ReleaseVersion
$env:DEEPSEEK_GUI_APP_VERSION = $ReleaseVersion
$env:RELEASE_CHANNEL = $ReleaseChannel
$env:DEEPSEEK_GUI_UPDATE_CHANNEL = $ReleaseChannel
Write-Info "App version: $env:DEEPSEEK_GUI_APP_VERSION"

& gh release view $TagName 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Err "GitHub release $TagName not found — run release-mac.sh on macOS first."
  exit 1
}

$env:ELECTRON_BUILDER_CACHE = Join-Path $Root '.cache\electron-builder'
New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
  (Join-Path $Root 'dist\win-unpacked'), `
  (Join-Path $Root 'dist\win-arm64-unpacked'), `
  (Join-Path $Root 'dist\mac'), `
  (Join-Path $Root 'dist\mac-arm64'), `
  (Join-Path $Root 'dist\linux-unpacked')
Remove-Item -Force -ErrorAction SilentlyContinue `
  (Join-Path $Root 'dist\DeepSeek-GUI-*'), `
  (Join-Path $Root 'dist\DeepSeek GUI-*'), `
  (Join-Path $Root 'dist\latest*.yml'), `
  (Join-Path $Root 'dist\*.blockmap')

Write-Info 'Building Windows installer...'
& npm run dist:win
if ($LASTEXITCODE -ne 0) {
  Write-Err 'Windows build failed (npm run dist:win).'
  exit 1
}

$DistDir = Join-Path $Root 'dist'
$AssetSpecs = @(
  @{ Label = 'Windows exe'; Filter = '*-win-*.exe' },
  @{ Label = 'Windows blockmap'; Filter = '*-win-*.exe.blockmap' }
)

$Assets = @()
foreach ($spec in $AssetSpecs) {
  $files = @(Get-ChildItem -Path $DistDir -Filter $spec.Filter -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) {
    Write-Err "Missing asset: $($spec.Label) ($($spec.Filter))"
    exit 1
  }
  foreach ($file in $files) {
    $Assets += $file.FullName
    Write-Ok "  ✓ $($spec.Label): $($file.Name)"
  }
}

Write-Info "Uploading $($Assets.Count) file(s) to $TagName..."
foreach ($asset in $Assets) {
  Write-Ok "  ↑ $(Split-Path $asset -Leaf)"
  & gh release upload $TagName $asset --clobber
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Upload failed for $asset"
    exit 1
  }
}

if ($R2 -or $PromoteR2) {
  Write-Info "Uploading Windows asset metadata to R2 ($TagName)..."
  & node (Join-Path $Root 'scripts\publish-r2.mjs') upload --platform win --tag $TagName --channel $ReleaseChannel
  if ($LASTEXITCODE -ne 0) {
    Write-Err 'R2 upload failed for Windows assets.'
    exit 1
  }
}

if ($PromoteR2) {
  Write-Info "Promoting $TagName as R2 latest..."
  & node (Join-Path $Root 'scripts\publish-r2.mjs') promote --tag $TagName --channel $ReleaseChannel
  if ($LASTEXITCODE -ne 0) {
    Write-Err 'R2 promote failed.'
    exit 1
  }
}

if ($Publish) {
  Write-Info "Publishing release $TagName..."
  & gh release edit $TagName --draft=false
  if ($LASTEXITCODE -ne 0) {
    Write-Err 'gh release edit --draft=false failed'
    exit 1
  }
  Write-Ok "Release $TagName is now public."
} else {
  Write-Info 'Release remains draft. Re-run with -Publish when ready.'
}

Write-Ok "Windows assets uploaded to $TagName."
