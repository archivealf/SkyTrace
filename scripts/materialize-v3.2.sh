#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

B64="$TMP/skytrace-v3.2.zip.b64"
ZIP="$TMP/skytrace-v3.2.zip"
EXPECTED="f1b6dbf212009023792875cf4444d389bcc5fb15cf4c71e8a766e87109ea0a0e"

cat "$ROOT"/v3.2-bundle/chunk*.b64 > "$B64"

node -e 'const fs=require("fs"); const input=fs.readFileSync(process.argv[1],"utf8").replace(/\s+/g,""); fs.writeFileSync(process.argv[2],Buffer.from(input,"base64"));' "$B64" "$ZIP"

ACTUAL="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "SkyTrace V3.2 source bundle checksum mismatch."
  echo "Expected: $EXPECTED"
  echo "Actual:   $ACTUAL"
  exit 1
fi

if command -v ditto >/dev/null 2>&1; then
  ditto -x -k "$ZIP" "$ROOT"
elif command -v unzip >/dev/null 2>&1; then
  unzip -oq "$ZIP" -d "$ROOT"
else
  echo "Neither ditto nor unzip is available to extract SkyTrace."
  exit 1
fi

# Remove legacy V3.1 paid-provider/interception-era files from the materialized tree.
rm -rf "$ROOT/source-payload" "$ROOT/v3.2-bundle"
rm -f \
  "$ROOT/api/acars.js" \
  "$ROOT/api/track.js" \
  "$ROOT/api/airport-ops.js" \
  "$ROOT/lib/airframes.js" \
  "$ROOT/scripts/assemble-source.mjs"

echo "Materialized SkyTrace V3.2 Free Stack."
