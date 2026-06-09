#!/usr/bin/env bash
set -euo pipefail

# Windows release: build NSIS installer and upload to an existing GitHub release tag.
# Must use the same tag created by release-mac.sh.
#
# Usage:
#   ./scripts/release-win.sh --tag v0.1.1
#   ./scripts/release-win.sh --tag v0.1.1 --publish
#   ./scripts/release-win.sh --tag v0.1.1 --r2 --r2-promote --publish
#   ./scripts/release-win.sh --tag v0.1.1 --channel stable --r2 --r2-promote
#
# Or read tag from dist/.release-meta.env (copy from Mac build machine):
#   ./scripts/release-win.sh
#
# Native PowerShell (Git Bash not required):
#   .\scripts\release-win.ps1 -Tag v0.1.1 -R2 -PromoteR2 -Publish

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/release-common.sh
source "${ROOT}/scripts/lib/release-common.sh"
release_load_local_env

PUBLISH=false
RELEASE_TAG=""
REQUESTED_RELEASE_CHANNEL="${RELEASE_CHANNEL:-frontier}"
CHANNEL_EXPLICIT=false
R2_UPLOAD="${R2_UPLOAD:-false}"
R2_PROMOTE="${R2_PROMOTE:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    --tag) RELEASE_TAG="$2"; shift 2 ;;
    --channel) REQUESTED_RELEASE_CHANNEL="$2"; CHANNEL_EXPLICIT=true; shift 2 ;;
    --stable) REQUESTED_RELEASE_CHANNEL=stable; CHANNEL_EXPLICIT=true; shift ;;
    --frontier) REQUESTED_RELEASE_CHANNEL=frontier; CHANNEL_EXPLICIT=true; shift ;;
    --r2) R2_UPLOAD=true; shift ;;
    --r2-promote) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --help|-h)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown flag: $1" ;;
  esac
done

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows*) ;;
  *)
    die "release-win.sh must run on Windows (or MSYS/Git Bash on Windows)."
    ;;
esac

release_check_prerequisites
release_acquire_lock

if [[ -n "${RELEASE_TAG}" ]]; then
  RELEASE_CHANNEL="${REQUESTED_RELEASE_CHANNEL}"
  RELEASE_BUMP=none
  release_compute_version
elif [[ -f "${ROOT}/dist/.release-meta.env" ]]; then
  release_read_meta_file
  if $CHANNEL_EXPLICIT; then
    RELEASE_CHANNEL="${REQUESTED_RELEASE_CHANNEL}"
  fi
else
  die "Pass --tag vX.Y.Z (from release-mac.sh) or copy dist/.release-meta.env from Mac."
fi

RELEASE_ALLOW_EXISTING_TAG=1
release_ensure_tag_available
release_ensure_github_release_exists
release_prepare_builder_cache
release_export_update_channel
release_export_app_version
release_clean_dist_artifacts

cyan "Building Windows (tag ${TAG_NAME}, channel ${RELEASE_CHANNEL})..."
npm run dist:win || die "Windows build failed"

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

collect "Windows exe" "dist/DeepSeek-GUI-*-win-*.exe"
collect "Windows blockmap" "dist/DeepSeek-GUI-*-win-*.exe.blockmap"

cyan "Uploading ${#ASSETS[@]} Windows asset(s) to ${TAG_NAME}..."
for asset in "${ASSETS[@]}"; do
  green "  ↑ $(basename "${asset}")"
  gh release upload "${TAG_NAME}" "${asset}" --clobber \
    || die "gh release upload failed for ${asset}"
done

if [[ "${R2_UPLOAD}" == "true" ]]; then
  cyan "Uploading Windows asset metadata to R2 (${TAG_NAME})..."
  node "${ROOT}/scripts/publish-r2.mjs" upload --platform win --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 upload failed for Windows assets"
fi

if [[ "${R2_PROMOTE}" == "true" ]]; then
  cyan "Promoting ${TAG_NAME} as R2 latest..."
  node "${ROOT}/scripts/publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 promote failed"
fi

if $PUBLISH; then
  cyan "Publishing release ${TAG_NAME}..."
  gh release edit "${TAG_NAME}" --draft=false \
    || die "gh release edit --draft=false failed"
  verify_release_state 1 false "published"
else
  cyan "Release remains draft — run with --publish when macOS + Windows assets are ready."
fi

echo
green "Windows assets uploaded to ${TAG_NAME}."
cyan "  Channel: ${RELEASE_CHANNEL}"
