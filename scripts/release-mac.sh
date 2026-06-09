#!/usr/bin/env bash
set -euo pipefail

# macOS release: bump version, build dmg/zip, create draft GitHub release, upload Mac assets.
#
# Usage:
#   ./scripts/release-mac.sh
#   ./scripts/release-mac.sh --tag v0.1.3
#   ./scripts/release-mac.sh --r2              # upload and promote macOS latest on R2
#   ./scripts/release-mac.sh --stable --r2     # publish to the stable update channel
#   ./scripts/release-mac.sh --r2-upload-only  # upload archive only, no latest promotion
#   ./scripts/release-mac.sh --publish
#   ./scripts/release-mac.sh --p12 ... --p12-password ... --p8 ... --key-id ... --issuer ...
#
# Release notes default: summarize conventional commits since the previous tag.
#   --notes "..."        custom text only
#   --notes-file path    markdown file
#   --no-commit-notes    generic build info only (old behavior)
#
# Speed knobs:
#   MAC_RELEASE_PARALLEL=force      force parallel arm64/x64 builds even when signing
#   RELEASE_UPLOAD_CONCURRENCY=4    GitHub/R2 upload concurrency
#   DEEPSEEK_GUI_RUNTIME_CACHE=0    disable bundled runtime cache
#
# After this completes, run on Windows (same version):
#   ./scripts/release-win.sh --tag v<RELEASE_VERSION from output> --r2 --r2-promote --publish

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/release-common.sh
source "${ROOT}/scripts/lib/release-common.sh"
release_load_local_env

PUBLISH=false
CUSTOM_NOTES=""
NOTES_FILE=""
RELEASE_NOTES_FROM_COMMITS=1
RELEASE_TAG=""
P12_PATH="${P12_PATH:-${CSC_LINK:-}}"
P12_PASSWORD="${P12_PASSWORD:-${CSC_KEY_PASSWORD:-}}"
P8_PATH="${P8_PATH:-${APPLE_API_KEY:-}}"
KEY_ID="${KEY_ID:-${APPLE_API_KEY_ID:-}}"
ISSUER="${ISSUER:-${APPLE_API_ISSUER:-}}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-frontier}"
R2_UPLOAD="${R2_UPLOAD:-false}"
R2_PROMOTE="${R2_PROMOTE:-false}"
RELEASE_UPLOAD_CONCURRENCY="${RELEASE_UPLOAD_CONCURRENCY:-4}"
MAC_RELEASE_PARALLEL="${MAC_RELEASE_PARALLEL:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    --r2) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --r2-upload-only) R2_UPLOAD=true; R2_PROMOTE=false; shift ;;
    --r2-promote) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --tag) RELEASE_TAG="$2"; shift 2 ;;
    --channel) RELEASE_CHANNEL="$2"; shift 2 ;;
    --stable) RELEASE_CHANNEL=stable; shift ;;
    --frontier) RELEASE_CHANNEL=frontier; shift ;;
    --p12) P12_PATH="$2"; shift 2 ;;
    --p12-password) P12_PASSWORD="$2"; shift 2 ;;
    --p8) P8_PATH="$2"; shift 2 ;;
    --key-id) KEY_ID="$2"; shift 2 ;;
    --issuer) ISSUER="$2"; shift 2 ;;
    --notes) CUSTOM_NOTES="$2"; shift 2 ;;
    --notes-file) NOTES_FILE="$2"; shift 2 ;;
    --no-commit-notes) RELEASE_NOTES_FROM_COMMITS=0; shift ;;
    --help|-h)
      sed -n '4,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown flag: $1" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "release-mac.sh must run on macOS."

build_mac_arch() {
  local arch="$1"
  local output_dir="$2"
  local log_file="$3"

  mkdir -p "${output_dir}" "$(dirname "${log_file}")"
  cyan "  ${arch}: building dmg + zip -> ${output_dir}"
  DEEPSEEK_GUI_DIST_DIR="${output_dir}" \
    npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --mac dmg "--${arch}" \
    >"${log_file}" 2>&1
  DEEPSEEK_GUI_DIST_DIR="${output_dir}" \
    node "${ROOT}/scripts/zip-mac-app.cjs" "${arch}" \
    >>"${log_file}" 2>&1
}

copy_mac_arch_artifacts() {
  local arch="$1"
  local output_dir="$2"
  local files=()

  shopt -s nullglob
  files=("${output_dir}"/DeepSeek-GUI-*-mac-"${arch}".*)
  shopt -u nullglob

  [[ ${#files[@]} -gt 0 ]] || die "No macOS ${arch} artifacts found in ${output_dir}"
  cp -p "${files[@]}" "${ROOT}/dist/"
}

build_macos_parallel() {
  local build_root="${ROOT}/dist/.mac-build"
  local arm64_output="${build_root}/arm64"
  local x64_output="${build_root}/x64"
  local arm64_log="${build_root}/arm64.log"
  local x64_log="${build_root}/x64.log"
  local arm64_pid
  local x64_pid
  local failures=0

  rm -rf "${build_root}"
  mkdir -p "${ROOT}/dist" "${build_root}"

  cyan "Building renderer/main once..."
  npm run build || die "electron-vite build failed"

  cyan "Preparing electron-builder..."
  npx --yes electron-builder@26.8.1 --version >/dev/null \
    || die "Failed to prepare electron-builder"

  cyan "Building macOS arm64 and x64 in parallel..."
  build_mac_arch arm64 "${arm64_output}" "${arm64_log}" &
  arm64_pid=$!
  build_mac_arch x64 "${x64_output}" "${x64_log}" &
  x64_pid=$!

  if wait "${arm64_pid}"; then
    green "  ✓ arm64 build complete"
  else
    red "  ✗ arm64 build failed; last log lines:"
    tail -n 120 "${arm64_log}" >&2 || true
    failures=1
  fi

  if wait "${x64_pid}"; then
    green "  ✓ x64 build complete"
  else
    red "  ✗ x64 build failed; last log lines:"
    tail -n 120 "${x64_log}" >&2 || true
    failures=1
  fi

  [[ "${failures}" -eq 0 ]] || die "macOS parallel build failed"

  copy_mac_arch_artifacts arm64 "${arm64_output}"
  copy_mac_arch_artifacts x64 "${x64_output}"
  node "${ROOT}/scripts/generate-mac-latest.cjs" "${ROOT}/dist" \
    || die "Failed to generate merged latest-mac.yml"
}

build_macos() {
  if $SIGNING && [[ "${MAC_RELEASE_PARALLEL}" != "force" ]]; then
    cyan "Building macOS serially because Developer ID signing is enabled."
    npm run dist:mac || die "macOS build failed"
    return
  fi

  if [[ "${MAC_RELEASE_PARALLEL}" == "0" ]]; then
    cyan "Building macOS serially (MAC_RELEASE_PARALLEL=0)..."
    npm run dist:mac || die "macOS build failed"
    return
  fi

  build_macos_parallel
}

release_check_prerequisites
release_apply_signing_env
release_acquire_lock

cyan "Computing release version..."
if [[ -n "${RELEASE_TAG}" ]]; then
  RELEASE_BUMP=none
fi
release_compute_version

cyan "  Base:    ${BASE_VERSION}"
cyan "  Latest:  ${LATEST_TAG:-<none>}"
cyan "  Next:    ${RELEASE_VERSION}  (tag: ${TAG_NAME})"
release_export_update_channel
release_export_app_version

release_ensure_tag_available
release_prepare_builder_cache
release_clean_dist_artifacts

cyan "Building macOS..."
build_macos

release_write_meta_file

ASSETS=()
collect() {
  local label="$1"
  shift
  local matched=()
  local pattern file

  shopt -s nullglob
  for pattern in "$@"; do
    for file in ${pattern}; do
      [[ -f "${file}" ]] || continue
      matched+=("${file}")
    done
  done
  shopt -u nullglob

  if [[ ${#matched[@]} -eq 0 ]]; then
    red "  ✗ ${label}"
    die "Missing asset: ${label}"
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

collect_optional() {
  local label="$1"
  shift
  local matched=()
  local pattern file

  shopt -s nullglob
  for pattern in "$@"; do
    for file in ${pattern}; do
      [[ -f "${file}" ]] || continue
      matched+=("${file}")
    done
  done
  shopt -u nullglob

  if [[ ${#matched[@]} -eq 0 ]]; then
    yellow "  • ${label}: none"
    return
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

# artifactName: ${productName}-${version}-mac-${arch}.dmg|zip
collect "macOS arm64 dmg" "dist/DeepSeek-GUI-*-mac-arm64.dmg"
collect "macOS x64 dmg" "dist/DeepSeek-GUI-*-mac-x64.dmg"
collect "macOS arm64 zip" "dist/DeepSeek-GUI-*-mac-arm64.zip"
collect "macOS x64 zip" "dist/DeepSeek-GUI-*-mac-x64.zip"
collect_optional "macOS blockmap" "dist/DeepSeek-GUI-*-mac-*.zip.blockmap"

upload_github_assets() {
  local tag="$1"
  shift
  local concurrency="${RELEASE_UPLOAD_CONCURRENCY}"
  local failures=0
  local pids=()
  local files=()

  if ! [[ "${concurrency}" =~ ^[1-9][0-9]*$ ]]; then
    concurrency=4
  fi

  for asset in "$@"; do
    green "  ↑ $(basename "${asset}")"
    gh release upload "${tag}" "${asset}" --clobber &
    pids+=("$!")
    files+=("${asset}")

    if [[ ${#pids[@]} -ge ${concurrency} ]]; then
      if wait "${pids[0]}"; then
        green "  ✓ $(basename "${files[0]}")"
      else
        red "  ✗ $(basename "${files[0]}")"
        failures=1
      fi
      pids=("${pids[@]:1}")
      files=("${files[@]:1}")
    fi
  done

  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      green "  ✓ $(basename "${files[$i]}")"
    else
      red "  ✗ $(basename "${files[$i]}")"
      failures=1
    fi
  done

  [[ "${failures}" -eq 0 ]] || die "One or more GitHub release uploads failed."
}

NOTES_TMP=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
UNSIGNED_NOTE=""
if ! $SIGNING; then
  UNSIGNED_NOTE=$(
    cat <<'EOF'

### ⚠️ macOS: Unsigned Build

This is an unsigned build. macOS Gatekeeper will block first launch.
Run this after downloading:

```sh
xattr -cr "DeepSeek GUI.app"
# or
npm run mac:unquarantine
```
EOF
  )
fi

release_write_notes_file "${NOTES_TMP}"
echo "${UNSIGNED_NOTE}" >>"${NOTES_TMP}"

cyan "Creating GitHub release ${TAG_NAME}..."
GITHUB_RELEASE_FLAGS=(--draft)
if [[ "${RELEASE_CHANNEL}" == "frontier" ]]; then
  GITHUB_RELEASE_FLAGS+=(--prerelease)
fi
gh release create "${TAG_NAME}" \
  --title "${RELEASE_NAME}" \
  --notes-file "${NOTES_TMP}" \
  --target "$(release_git branch --show-current)" \
  "${GITHUB_RELEASE_FLAGS[@]}" \
  || die "gh release create failed"

cyan "Uploading ${#ASSETS[@]} macOS asset(s) to GitHub (concurrency ${RELEASE_UPLOAD_CONCURRENCY})..."
upload_github_assets "${TAG_NAME}" "${ASSETS[@]}"

if [[ "${R2_UPLOAD}" == "true" ]]; then
  cyan "Uploading macOS asset metadata to R2 (${TAG_NAME})..."
  node "${ROOT}/scripts/publish-r2.mjs" upload --platform mac --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 upload failed for macOS assets"
fi

if [[ "${R2_PROMOTE}" == "true" ]]; then
  cyan "Promoting ${TAG_NAME} as R2 latest..."
  node "${ROOT}/scripts/publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 promote failed"
fi

if $PUBLISH; then
  die "Use --publish only after Windows assets are uploaded (release-win.sh --publish)."
fi

rm -f "${NOTES_TMP}"

echo
green "macOS release ${TAG_NAME} ready (draft)."
cyan "  Meta: dist/.release-meta.env"
cyan "  Channel: ${RELEASE_CHANNEL}"
cyan "  Next on Windows: ./scripts/release-win.sh --tag ${TAG_NAME} --channel ${RELEASE_CHANNEL}"
cyan "  https://github.com/XingYu-Zhong/DeepSeek-GUI/releases/tag/${TAG_NAME}"
