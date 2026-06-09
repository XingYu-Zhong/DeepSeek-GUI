#!/bin/bash
set -euo pipefail

# Deprecated compatibility wrapper.
# macOS now builds macOS artifacts only; Windows artifacts are built on Windows.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-win|--skip-linux)
      echo "release-all-mac.sh: ignoring legacy $1; macOS builds no Windows/Linux assets." >&2
      shift
      ;;
    --skip-mac)
      echo "release-all-mac.sh: --skip-mac is no longer supported; run release-win on Windows instead." >&2
      exit 1
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

echo "release-all-mac.sh is deprecated; building macOS assets only." >&2
echo "Run npm run release:win on Windows for Windows assets." >&2
exec "${ROOT}/scripts/release-mac.sh" "${ARGS[@]}"
