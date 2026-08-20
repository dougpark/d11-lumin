#!/usr/bin/env bash
# Uploads everything under cdn-assets/ to the CDN_BUCKET R2 bucket (served at
# https://cdn.d11cloud.com), preserving each file's path relative to cdn-assets/
# as its object key. Run via `just sync-cdn` after adding/changing a file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/../cdn-assets"
BUCKET="cdn-bucket"

content_type_for() {
  case "${1##*.}" in
    png) echo "image/png" ;;
    jpg|jpeg) echo "image/jpeg" ;;
    svg) echo "image/svg+xml" ;;
    webp) echo "image/webp" ;;
    gif) echo "image/gif" ;;
    ico) echo "image/x-icon" ;;
    *) echo "application/octet-stream" ;;
  esac
}

# Design-tool master files that must never end up as public CDN objects. Keep them in
# cdn-assets/ for source control, but store them under a "_src/" subfolder (also skipped
# below) as the primary way to exclude them — this extension list is just a safety net.
SKIP_EXTENSIONS="psd|psb|ai|sketch|fig|xcf|procreate|xd"

if [ ! -d "$ASSETS_DIR" ]; then
  echo "No cdn-assets/ directory found at $ASSETS_DIR — nothing to sync."
  exit 0
fi

find "$ASSETS_DIR" -type f ! -name '.gitkeep' ! -path '*/_src/*' | while read -r file; do
  ext="$(echo "${file##*.}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ext" =~ ^($SKIP_EXTENSIONS)$ ]]; then
    echo "Skipping source file: ${file#"$ASSETS_DIR"/}"
    continue
  fi
  key="${file#"$ASSETS_DIR"/}"
  ct="$(content_type_for "$file")"
  echo "Uploading $key ($ct)..."
  bunx wrangler r2 object put "$BUCKET/$key" \
    --file "$file" \
    --content-type "$ct" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote
done

echo "Done."
