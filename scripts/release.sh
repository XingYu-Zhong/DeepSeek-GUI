#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# release.sh - macOS GitHub Release wrapper
#
# Default behavior builds macOS artifacts and creates a draft GitHub release
# with the next version tag. Windows artifacts are built separately on Windows.
# The legacy --all flag is kept as a macOS-only alias.
#
#   bash ./scripts/release-mac.sh              # or bash ./scripts/release.sh
#   bash ./scripts/release.sh --r2
#   .\scripts\release-win.ps1 -Tag v0.1.3 -R2 -PromoteR2
#
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--all" ]]; then
  shift
  echo "release.sh --all is deprecated; building macOS assets only." >&2
  echo "Run npm run release:win on Windows for Windows assets." >&2
fi

exec "${ROOT}/scripts/release-mac.sh" "$@"
