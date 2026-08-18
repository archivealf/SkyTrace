#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$ROOT/v3.3-overlay"

if [[ ! -f "$ROOT/scripts/materialize-v3.2.sh" ]]; then
  echo "SkyTrace V3.2 materializer is missing."
  exit 1
fi

bash "$ROOT/scripts/materialize-v3.2.sh"

if [[ ! -d "$OVERLAY" ]]; then
  echo "SkyTrace V3.3 overlay is missing."
  exit 1
fi

cp "$OVERLAY/server.js" "$ROOT/server.js"
cp "$OVERLAY/electron-main.js" "$ROOT/electron-main.js"
cp "$OVERLAY/package.json" "$ROOT/package.json"
cp "$OVERLAY/config.example.json" "$ROOT/config.example.json"
cp "$OVERLAY/manifest.webmanifest" "$ROOT/manifest.webmanifest"
cp "$OVERLAY/service-worker.v3.js" "$ROOT/service-worker.v3.js"
cp "$OVERLAY/v3.3-commerce.js" "$ROOT/v3.3-commerce.js"
cp "$OVERLAY/v3.3-glass.css" "$ROOT/v3.3-glass.css"
mkdir -p "$ROOT/lib"
cp "$OVERLAY/lib/account.js" "$ROOT/lib/account.js"
cp "$OVERLAY/lib/config.js" "$ROOT/lib/config.js"

node - "$ROOT/index.html" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
let html = fs.readFileSync(file, "utf8");
if (!html.includes('/v3.3-glass.css')) {
  html = html.replace('<link rel="stylesheet" href="/styles.v3.css" />', '<link rel="stylesheet" href="/styles.v3.css" />\n  <link rel="stylesheet" href="/v3.3-glass.css" />');
}
if (!html.includes('/v3.3-commerce.js')) {
  html = html.replace('<script src="/app.v3.js"></script>', '<script src="/app.v3.js"></script>\n<script src="/v3.3-commerce.js"></script>');
}
html = html.replace('window.SKYTRACE_BUILD="3.2.0-free";', 'window.SKYTRACE_BUILD="3.3.0-commerce-glass";');
fs.writeFileSync(file, html);
NODE

rm -rf "$OVERLAY"
echo "Materialized SkyTrace V3.3 Commerce + Liquid Glass."
