#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$ROOT/v3.3-overlay"

[[ -f "$ROOT/scripts/materialize-v3.2.sh" ]] || { echo "SkyTrace V3.2 materializer is missing."; exit 1; }
bash "$ROOT/scripts/materialize-v3.2.sh"
[[ -d "$OVERLAY" ]] || { echo "SkyTrace V3.3 overlay is missing."; exit 1; }

cp "$OVERLAY/server.js" "$ROOT/server.js"
cp "$OVERLAY/electron-main.js" "$ROOT/electron-main.js"
cp "$OVERLAY/package.json" "$ROOT/package.json"
cp "$OVERLAY/config.example.json" "$ROOT/config.example.json"
cp "$OVERLAY/manifest.webmanifest" "$ROOT/manifest.webmanifest"
cp "$OVERLAY/service-worker.v3.js" "$ROOT/service-worker.v3.js"
cp "$OVERLAY/v3.3-commerce.js" "$ROOT/v3.3-commerce.js"
cp "$OVERLAY/v3.3-glass.css" "$ROOT/v3.3-glass.css"
mkdir -p "$ROOT/lib" "$ROOT/scripts"
cp "$OVERLAY/lib/account.js" "$ROOT/lib/account.js"
cp "$OVERLAY/lib/config.js" "$ROOT/lib/config.js"
cp "$OVERLAY/scripts/generate-skytrace-icon.mjs" "$ROOT/scripts/generate-skytrace-icon.mjs"
cp "$OVERLAY/scripts/make-mac-icon.sh" "$ROOT/scripts/make-mac-icon.sh"
chmod +x "$ROOT/scripts/make-mac-icon.sh"
node "$ROOT/scripts/generate-skytrace-icon.mjs" "$ROOT/assets/SkyTrace.png"

# GitHub release builds can inject a public HTTPS account/payment backend without
# committing any Stripe secrets. Local builds keep the loopback default.
if [[ -n "${SKYTRACE_COMMERCE_URL:-}" ]]; then
  node - "$ROOT/electron-main.js" "$ROOT/lib/config.js" "$ROOT/config.example.json" <<'NODE'
const fs = require("fs");
const files = process.argv.slice(2);
const raw = String(process.env.SKYTRACE_COMMERCE_URL || "").trim().replace(/\/+$/, "");
let url;
try { url = new URL(raw); } catch { throw new Error("SKYTRACE_COMMERCE_URL must be a valid URL."); }
if (url.protocol !== "https:") throw new Error("SKYTRACE_COMMERCE_URL must use HTTPS for packaged releases.");
for (const file of files) {
  let text = fs.readFileSync(file, "utf8");
  text = text.split("http://127.0.0.1:8787").join(raw);
  fs.writeFileSync(file, text);
}
console.log(`Configured packaged SkyTrace account service: ${raw}`);
NODE
fi

node - "$ROOT/index.html" "$ROOT/app.v3.js" "$ROOT/lib/live.js" <<'NODE'
const fs = require("fs");
const htmlFile = process.argv[2];
const appFile = process.argv[3];
const liveFile = process.argv[4];

let html = fs.readFileSync(htmlFile, "utf8");
if (!html.includes('/v3.3-glass.css')) html = html.replace('<link rel="stylesheet" href="/styles.v3.css" />', '<link rel="stylesheet" href="/styles.v3.css" />\n  <link rel="stylesheet" href="/v3.3-glass.css" />');
if (!html.includes('/v3.3-commerce.js')) html = html.replace('<script src="/app.v3.js"></script>', '<script src="/app.v3.js"></script>\n<script src="/v3.3-commerce.js"></script>');
html = html.replace('window.SKYTRACE_BUILD="3.2.0-free";', 'window.SKYTRACE_BUILD="3.3.0-commerce-glass";');
fs.writeFileSync(htmlFile, html);

let app = fs.readFileSync(appFile, "utf8");
app = app.replace('}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; showToast(err.message,5000); }', '}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; el.loading.classList.add("done"); showToast(err.message,5000); }');
app = app.replace('if("serviceWorker"in navigator)navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});', 'if("serviceWorker"in navigator&&!navigator.userAgent.includes("Electron"))navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});');
app = app.replace('function initMap(){\n    state.map=new maplibregl.Map(', 'function initMap(){\n    setTimeout(()=>{if(!el.loading.classList.contains("done")){el.loading.querySelector("span").textContent="Aviation data is taking longer than expected";el.loading.classList.add("done");}},10000);\n    state.map=new maplibregl.Map(');
fs.writeFileSync(appFile, app);

let live = fs.readFileSync(liveFile, "utf8");
live = live.replace('  if (radius > 245) return null;\n\n  const r = Math.max(1, Math.min(245, radius));', '  const r = Math.max(1, Math.min(245, radius));');
fs.writeFileSync(liveFile, live);
NODE

rm -rf "$OVERLAY"
echo "Materialized SkyTrace V3.3 Commerce + Liquid Glass."
