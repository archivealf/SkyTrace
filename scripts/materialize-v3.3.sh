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

node - "$ROOT/index.html" "$ROOT/app.v3.js" <<'NODE'
const fs = require("fs");
const htmlFile = process.argv[2];
const appFile = process.argv[3];

let html = fs.readFileSync(htmlFile, "utf8");
if (!html.includes('/v3.3-glass.css')) {
  html = html.replace('<link rel="stylesheet" href="/styles.v3.css" />', '<link rel="stylesheet" href="/styles.v3.css" />\n  <link rel="stylesheet" href="/v3.3-glass.css" />');
}
if (!html.includes('/v3.3-commerce.js')) {
  html = html.replace('<script src="/app.v3.js"></script>', '<script src="/app.v3.js"></script>\n<script src="/v3.3-commerce.js"></script>');
}
html = html.replace('window.SKYTRACE_BUILD="3.2.0-free";', 'window.SKYTRACE_BUILD="3.3.0-commerce-glass";');
fs.writeFileSync(htmlFile, html);

let app = fs.readFileSync(appFile, "utf8");

// Never let a failed live-feed request trap the whole app behind the startup sheet.
app = app.replace(
  '}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; showToast(err.message,5000); }',
  '}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; el.loading.classList.add("done"); showToast(err.message,5000); }'
);

// Electron does not need the PWA service worker. Avoid Chromium quota/service-worker DB noise.
app = app.replace(
  'if("serviceWorker"in navigator)navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});',
  'if("serviceWorker"in navigator&&!navigator.userAgent.includes("Electron"))navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});'
);

// If MapLibre/style loading itself stalls, reveal the UI instead of leaving an endless Connecting screen.
app = app.replace(
  'function initMap(){\n    state.map=new maplibregl.Map(',
  'function initMap(){\n    setTimeout(()=>{if(!el.loading.classList.contains("done")){el.loading.querySelector("span").textContent="Aviation data is taking longer than expected";el.loading.classList.add("done");}},10000);\n    state.map=new maplibregl.Map('
);

fs.writeFileSync(appFile, app);
NODE

rm -rf "$OVERLAY"
echo "Materialized SkyTrace V3.3 Commerce + Liquid Glass."
