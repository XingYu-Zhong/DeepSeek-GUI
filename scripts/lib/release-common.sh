#!/usr/bin/env bash
# Shared helpers for release-mac.sh / release-win.sh / release.sh

red()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }
cyan() { printf '\033[36m%s\033[0m\n' "$*" >&2; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { red "[ERROR] $*"; exit 1; }

release_validate_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

release_normalize_channel() {
  local raw="${1:-frontier}"
  case "${raw}" in
    stable|frontier) printf '%s\n' "${raw}" ;;
    *) die "Release channel must be stable or frontier, got: ${raw}" ;;
  esac
}

release_export_update_channel() {
  RELEASE_CHANNEL="$(release_normalize_channel "${RELEASE_CHANNEL:-frontier}")"
  export RELEASE_CHANNEL
  export DEEPSEEK_GUI_UPDATE_CHANNEL="${RELEASE_CHANNEL}"
  cyan "  Channel: ${RELEASE_CHANNEL}"
}

release_git() {
  if command -v gh >/dev/null 2>&1; then
    git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
  else
    git "$@"
  fi
}

release_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  cd "$(cd "${script_dir}/../.." && pwd)"
  pwd
}

release_load_local_env() {
  local env_file="${DEEPSEEK_GUI_RELEASE_ENV:-}"

  if [[ -z "${env_file}" ]]; then
    if [[ -f "${ROOT}/scripts/release.local.env" ]]; then
      env_file="${ROOT}/scripts/release.local.env"
    elif [[ -f "${ROOT}/release.local.env" ]]; then
      env_file="${ROOT}/release.local.env"
    fi
  fi

  [[ -n "${env_file}" && -f "${env_file}" ]] || return 0

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
  cyan "Loaded local release config: ${env_file}"
}

release_check_prerequisites() {
  command -v node >/dev/null 2>&1 || die "node not found — install Node.js >= 22"
  command -v npm  >/dev/null 2>&1 || die "npm not found"
  command -v gh   >/dev/null 2>&1 || die "gh not found — install GitHub CLI (brew install gh)"
  gh auth status >/dev/null 2>&1 || die "gh not authenticated — run: gh auth login"
}

# Computes RELEASE_VERSION / TAG_NAME / RELEASE_NAME / BASE_VERSION / LATEST_TAG.
# Set RELEASE_BUMP=none and RELEASE_TAG=vX.Y.Z to pin an existing tag (Windows upload).
release_compute_version() {
  BASE_VERSION=$(node -p "require('./package.json').version")
  release_validate_semver "${BASE_VERSION}" || die "package.json version must be x.y.z for auto-update, got: ${BASE_VERSION}"

  if [[ "${RELEASE_BUMP:-}" == "none" && -n "${RELEASE_TAG:-}" ]]; then
    TAG_NAME="${RELEASE_TAG}"
    [[ "${TAG_NAME}" == v* ]] || TAG_NAME="v${TAG_NAME}"
    RELEASE_VERSION="${TAG_NAME#v}"
    release_validate_semver "${RELEASE_VERSION}" || die "Release tag must be vX.Y.Z. electron-updater cannot use four-part versions: ${TAG_NAME}"
    RELEASE_NAME="DeepSeek GUI ${RELEASE_VERSION}"
    LATEST_TAG=""
    return
  fi

  local remote_tags
  remote_tags=$(
    release_git ls-remote --tags origin 2>/dev/null \
      | awk '{ print $2 }' \
      | sed '/\^{}$/d' \
      | sed -n 's#^refs/tags/v##p'
  )
  LATEST_TAG=$(
    printf '%s\n' "${remote_tags}" \
      | awk '/^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/' \
      | sort -V \
      | tail -n1
  )
  local latest_semver_tag
  latest_semver_tag=$(
    printf '%s\n' "${remote_tags}" \
      | awk '/^[0-9]+\.[0-9]+\.[0-9]+$/' \
      | sort -V \
      | tail -n1
  )

  local source_version="${latest_semver_tag:-${BASE_VERSION}}"
  IFS='.' read -ra SEG <<< "${source_version}"
  MAJOR="${SEG[0]:-0}"
  MINOR="${SEG[1]:-0}"
  PATCH="${SEG[2]:-0}"
  PATCH=$((PATCH + 1))
  RELEASE_VERSION="${MAJOR}.${MINOR}.${PATCH}"

  TAG_NAME="v${RELEASE_VERSION}"
  RELEASE_NAME="DeepSeek GUI ${RELEASE_VERSION}"
}

release_export_app_version() {
  release_validate_semver "${RELEASE_VERSION}" || die "Invalid release version for electron-updater: ${RELEASE_VERSION}"
  export DEEPSEEK_GUI_APP_VERSION="${RELEASE_VERSION}"
  cyan "  App:     ${DEEPSEEK_GUI_APP_VERSION}"
}

release_ensure_tag_available() {
  if release_git ls-remote --tags origin "refs/tags/${TAG_NAME}" | grep -q "${TAG_NAME}"; then
    if [[ "${RELEASE_ALLOW_EXISTING_TAG:-}" == "1" ]]; then
      cyan "Using existing tag ${TAG_NAME} on origin."
      return
    fi
    die "Tag ${TAG_NAME} already exists on origin."
  fi
}

release_ensure_github_release_exists() {
  if gh release view "${TAG_NAME}" >/dev/null 2>&1; then
    cyan "GitHub release ${TAG_NAME} already exists — will upload assets."
    return
  fi
  die "GitHub release ${TAG_NAME} not found — run release-mac.sh on macOS first."
}

release_prepare_builder_cache() {
  export ELECTRON_BUILDER_CACHE="${ROOT}/.cache/electron-builder"
  mkdir -p "${ELECTRON_BUILDER_CACHE}"
}

release_acquire_lock() {
  local lock_dir="${ROOT}/.cache/release.lock"
  mkdir -p "${ROOT}/.cache"
  if ! mkdir "${lock_dir}" 2>/dev/null; then
    die "Another release script is already running (lock: ${lock_dir})."
  fi
  trap 'rm -rf "'"${lock_dir}"'"' EXIT
}

release_clean_dist_artifacts() {
  rm -rf "${ROOT}/dist/mac" "${ROOT}/dist/mac-arm64" "${ROOT}/dist/.mac-build" "${ROOT}/dist/win-unpacked" "${ROOT}/dist/linux-unpacked"
  rm -f "${ROOT}"/dist/DeepSeek-GUI-* "${ROOT}"/dist/DeepSeek\ GUI-* "${ROOT}"/dist/latest*.yml "${ROOT}"/dist/*.blockmap
}

release_apply_signing_env() {
  SIGNING=false
  if [[ -n "${P12_PATH}" && -n "${P12_PASSWORD}" && -n "${P8_PATH}" && -n "${KEY_ID}" && -n "${ISSUER}" ]]; then
    SIGNING=true
  elif [[ -n "${P12_PATH}${P12_PASSWORD}${P8_PATH}${KEY_ID}${ISSUER}" ]]; then
    die "Signing requires ALL five flags: --p12, --p12-password, --p8, --key-id, --issuer"
  fi

  if $SIGNING; then
    for f in "${P12_PATH}" "${P8_PATH}"; do
      [[ -f "${f}" ]] || die "File not found: ${f}"
    done
    export CSC_LINK="${P12_PATH}"
    export CSC_KEY_PASSWORD="${P12_PASSWORD}"
    export APPLE_API_KEY="${P8_PATH}"
    export APPLE_API_KEY_ID="${KEY_ID}"
    export APPLE_API_ISSUER="${ISSUER}"
    export MAC_SIGN=1
    cyan "Signing:  ✓ Developer ID"
    cyan "Notarize: ✓ Apple notary"
  else
    unset CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER MAC_SIGN 2>/dev/null || true
    cyan "Signing:  ✗ (unsigned)"
    cyan "Notarize: ✗ (skipped)"
  fi
}

release_write_meta_file() {
  local meta="${ROOT}/dist/.release-meta.env"
  mkdir -p "${ROOT}/dist"
  cat >"${meta}" <<EOF
RELEASE_VERSION=${RELEASE_VERSION}
TAG_NAME=${TAG_NAME}
RELEASE_NAME=${RELEASE_NAME}
BASE_VERSION=${BASE_VERSION}
RELEASE_CHANNEL=${RELEASE_CHANNEL:-frontier}
EOF
  cyan "Wrote ${meta}"
}

release_read_meta_file() {
  local meta="${ROOT}/dist/.release-meta.env"
  [[ -f "${meta}" ]] || die "Missing ${meta} — run ./scripts/release-mac.sh first or pass --tag vX.Y.Z"
  # shellcheck disable=SC1090
  source "${meta}"
}

# Writes release notes: custom > file > auto from conventional commits (+ build footer).
release_write_notes_file() {
  local dest="$1"
  local use_commit_notes="${RELEASE_NOTES_FROM_COMMITS:-1}"

  if [[ -n "${NOTES_FILE}" ]]; then
    cp "${NOTES_FILE}" "${dest}"
    return
  fi

  if [[ -n "${CUSTOM_NOTES}" ]]; then
    echo "${CUSTOM_NOTES}" >"${dest}"
    return
  fi

  if [[ "${use_commit_notes}" == "1" ]]; then
    local since_ref=""
    if [[ -n "${LATEST_TAG:-}" ]]; then
      since_ref="v${LATEST_TAG}"
    fi
    cyan "Generating release notes from git commits${since_ref:+ since ${since_ref}}..."
    node "${ROOT}/scripts/generate-release-notes.cjs" ${since_ref:+"${since_ref}"} >"${dest}" \
      || die "Failed to generate release notes from commits"
  else
    {
      echo "Automated release from local build."
      echo
    } >"${dest}"
  fi

  {
    echo ""
    echo "---"
    echo ""
    echo "### 构建信息"
    echo ""
    echo "- Release version: \`${RELEASE_VERSION}\`"
    echo "- Release channel: \`${RELEASE_CHANNEL:-frontier}\`"
    echo "- Base version: \`${BASE_VERSION}\`"
    echo "- Branch: \`$(release_git branch --show-current)\`"
    echo "- Commit: \`$(release_git rev-parse --short HEAD)\`"
    if [[ "${SIGNING:-false}" == true ]]; then
      echo "- macOS: ✅ Developer ID 签名 + 公证"
    else
      echo "- macOS: 未签名构建"
    fi
    echo "- 平台: ${RELEASE_PLATFORMS_NOTE:-macOS (arm64 + Intel x64) · Windows (\`release-win.ps1\` / \`release-win.sh\`)}"
  } >>"${dest}"
}

verify_release_state() {
  local expected_assets="$1"
  local expected_draft="$2"
  local label="$3"
  local attempt
  local draft
  local asset_count

  cyan "Verifying ${label} release on GitHub..."
  for attempt in {1..30}; do
    if draft=$(
      gh release view "${TAG_NAME}" --json isDraft --jq '.isDraft' 2>/dev/null
    ) && asset_count=$(
      gh release view "${TAG_NAME}" --json assets --jq '.assets | length' 2>/dev/null
    ); then
      if [[ "${draft}" == "${expected_draft}" && "${asset_count}" -ge "${expected_assets}" ]]; then
        green "  ✓ GitHub release verified (${asset_count} asset(s), draft=${draft})"
        return
      fi
    fi
    sleep 2
  done

  die "GitHub release verification timed out — expected draft=${expected_draft}, assets>=${expected_assets}"
}
