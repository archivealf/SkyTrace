#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B64="$ROOT/assets/SkyTrace.png.base64"
SRC="$ROOT/assets/SkyTrace.png"
ICONSET="$ROOT/assets/SkyTrace.iconset"
OUT="$ROOT/assets/SkyTrace.icns"

# Decode with Node so this works the same on Intel/Apple Silicon macOS and Linux CI.
node -e 'const fs=require("fs"); const src=process.argv[1]; const out=process.argv[2]; const b64=fs.readFileSync(src,"utf8").replace(/\s+/g,""); fs.writeFileSync(out, Buffer.from(b64,"base64"));' "$B64" "$SRC"
trap 'rm -f "$SRC"' EXIT

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$SRC" --out "$ICONSET/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET"

echo "Created $OUT"
