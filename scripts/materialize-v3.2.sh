#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

B64="$TMP/skytrace-base.zip.b64"
ZIP="$TMP/skytrace-base.zip"
EXPECTED="f1b6dbf212009023792875cf4444d389bcc5fb15cf4c71e8a766e87109ea0a0e"

cat "$ROOT"/v3.2-bundle/chunk*.b64 > "$B64"

node -e 'const fs=require("fs"); const input=fs.readFileSync(process.argv[1],"utf8").replace(/\s+/g,""); fs.writeFileSync(process.argv[2],Buffer.from(input,"base64"));' "$B64" "$ZIP"

ACTUAL="$(node -e 'const fs=require("fs"),crypto=require("crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$ZIP")"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "SkyTrace base source bundle checksum mismatch."
  echo "Expected: $EXPECTED"
  echo "Actual:   $ACTUAL"
  exit 1
fi

if command -v ditto >/dev/null 2>&1; then
  ditto -x -k "$ZIP" "$ROOT"
elif command -v unzip >/dev/null 2>&1; then
  unzip -oq "$ZIP" -d "$ROOT"
elif command -v tar >/dev/null 2>&1; then
  tar -xf "$ZIP" -C "$ROOT"
else
  echo "No supported ZIP extraction tool is available (ditto, unzip or tar)."
  exit 1
fi

# Remove legacy paid-provider/interception-era files from the materialized tree.
rm -rf "$ROOT/source-payload" "$ROOT/v3.2-bundle"
rm -f \
  "$ROOT/api/acars.js" \
  "$ROOT/api/track.js" \
  "$ROOT/api/airport-ops.js" \
  "$ROOT/lib/airframes.js" \
  "$ROOT/scripts/assemble-source.mjs"

echo "Materialized SkyTrace base source."
