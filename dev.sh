#!/usr/bin/env bash
# Apex Explorer — dev helper
# Usage: bash dev.sh [command]
#   validate  — check manifest.json is valid + list all extension files
#   zip       — package for Chrome Web Store upload
#   clean     — remove build artifacts

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-validate}" in

validate)
  echo "=== Manifest check ==="
  python -c "import json; json.load(open('$DIR/manifest.json')); print('  manifest.json: OK')" 2>/dev/null \
    || node -e "JSON.parse(require('fs').readFileSync('$DIR/manifest.json')); console.log('  manifest.json: OK')" 2>/dev/null \
    || echo "  manifest.json: FAILED (could not parse)"

  echo ""
  echo "=== Extension files ==="
  ls -la "$DIR"/manifest.json "$DIR"/background.js "$DIR"/content.js \
         "$DIR"/popup.html "$DIR"/popup.css "$DIR"/popup.js \
         "$DIR"/icons/icon16.png "$DIR"/icons/icon48.png "$DIR"/icons/icon128.png 2>/dev/null

  echo ""
  echo "=== Quick reload ==="
  echo "  1. chrome://extensions → click reload ↻ on Apex Explorer"
  echo "  2. Reload any open QBO tab"
  echo "  3. Check DevTools console for [Apex] logs"
  ;;

zip)
  VER=$(python -c "import json; print(json.load(open('$DIR/manifest.json'))['version'])" 2>/dev/null \
    || node -e "console.log(JSON.parse(require('fs').readFileSync('$DIR/manifest.json'))['version'])")
  OUT="$DIR/apex-explorer-v${VER}.zip"
  rm -f "$OUT"

  cd "$DIR"
  zip -r "$OUT" \
    manifest.json background.js content.js \
    popup.html popup.css popup.js \
    icons/ \
    -x "*.git*" "*.claude*" "CLAUDE.md" "README.md" "dev.sh" "*.zip" "*.crx" "*.pem"

  echo ""
  echo "=== Packaged ==="
  echo "  $OUT"
  ls -lh "$OUT"
  ;;

clean)
  rm -f "$DIR"/*.zip "$DIR"/*.crx "$DIR"/*.pem
  echo "Cleaned build artifacts"
  ;;

*)
  echo "Usage: bash dev.sh [validate|zip|clean]"
  ;;

esac
