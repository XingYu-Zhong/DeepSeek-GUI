#!/usr/bin/env bash
set -euo pipefail
APP_PATH="${1:-dist/mac-arm64/DeepSeek GUI.app}"
if [ ! -d "$APP_PATH" ]; then
  echo "App not found: $APP_PATH" >&2
  echo "Usage: npm run mac:unquarantine -- '/path/to/DeepSeek GUI.app'" >&2
  exit 1
fi
xattr -cr "$APP_PATH"
echo "Removed quarantine attributes: $APP_PATH"
