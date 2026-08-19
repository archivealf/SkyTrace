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
cp "$OVERLAY/forge.config.cjs" "$ROOT/forge.config.cjs"
cp "$OVERLAY/config.example.json" "$ROOT/config.example.json"
cp "$OVERLAY/manifest.webmanifest" "$ROOT/manifest.webmanifest"
cp "$OVERLAY/service-worker.v3.js" "$ROOT/service-worker.v3.js"
cp "$OVERLAY/v3.3-commerce.js" "$ROOT/v3.3-commerce.js"
cp "$OVERLAY/v3.3-codes.js" "$ROOT/v3.3-codes.js"
cp "$OVERLAY/v3.3-platform.js" "$ROOT/v3.3-platform.js"
cp "$OVERLAY/v3.3-export-fix.js" "$ROOT/v3.3-export-fix.js"
cp "$OVERLAY/v3.3-glass.css" "$ROOT/v3.3-glass.css"
cp "$OVERLAY/README.md" "$ROOT/README.md"
cp "$OVERLAY/ATTRIBUTION.md" "$ROOT/ATTRIBUTION.md"
cp "$OVERLAY/install" "$ROOT/install"
cp "$OVERLAY/install-v3.3-rc" "$ROOT/install-v3.3-rc"
chmod +x "$ROOT/install" "$ROOT/install-v3.3-rc"

mkdir -p "$ROOT/lib" "$ROOT/api" "$ROOT/scripts"
cp "$OVERLAY/lib/account.js" "$ROOT/lib/account.js"
cp "$OVERLAY/lib/config.js" "$ROOT/lib/config.js"
cp "$OVERLAY/lib/live.js" "$ROOT/lib/live.js"
cp "$OVERLAY/lib/aircraft.js" "$ROOT/lib/aircraft.js"
cp "$OVERLAY/lib/weather.js" "$ROOT/lib/weather.js"
cp "$OVERLAY/lib/precipitation.js" "$ROOT/lib/precipitation.js"
cp "$OVERLAY/api/config.js" "$ROOT/api/config.js"
cp "$OVERLAY/api/health.js" "$ROOT/api/health.js"
cp "$OVERLAY/scripts/update-aviation-data.mjs" "$ROOT/scripts/update-aviation-data.mjs"
cp "$OVERLAY/scripts/generate-skytrace-icon.mjs" "$ROOT/scripts/generate-skytrace-icon.mjs"
cp "$OVERLAY/scripts/make-mac-icon.sh" "$ROOT/scripts/make-mac-icon.sh"
chmod +x "$ROOT/scripts/make-mac-icon.sh"
rm -f "$ROOT/lib/opensky.js"
node "$ROOT/scripts/generate-skytrace-icon.mjs" "$ROOT/assets/SkyTrace.png"

if [[ -n "${SKYTRACE_COMMERCE_URL:-}" ]]; then
  node - "$ROOT/electron-main.js" "$ROOT/lib/config.js" "$ROOT/config.example.json" <<'NODE'
const fs = require("fs");
const [electronFile, libConfigFile, exampleConfigFile] = process.argv.slice(2);
const configFiles = [electronFile, libConfigFile, exampleConfigFile];
const raw = String(process.env.SKYTRACE_COMMERCE_URL || "").trim().replace(/\/+$/, "");
let url;
try { url = new URL(raw); } catch { throw new Error("SKYTRACE_COMMERCE_URL must be a valid URL."); }
if (url.protocol !== "https:") throw new Error("SKYTRACE_COMMERCE_URL must use HTTPS for packaged releases.");
function replaceRequired(text, before, after, label) { if (!text.includes(before)) throw new Error(`Could not apply ${label} release patch.`); return text.replace(before, after); }
for (const file of configFiles) { let text = fs.readFileSync(file, "utf8"); text = text.split("http://127.0.0.1:8787").join(raw); fs.writeFileSync(file, text); }
let electron = fs.readFileSync(electronFile, "utf8");
electron = replaceRequired(electron,
`        {
          label: "SkyTrace Project",
          click: () => void shell.openExternal("https://github.com/archivealf/SkyTrace")
        }`,
`        {
          label: "Data Licences & Attribution",
          click: () => void shell.openPath(path.join(__dirname, "ATTRIBUTION.md"))
        },
        {
          label: "SkyTrace Project",
          click: () => void shell.openExternal("https://github.com/archivealf/SkyTrace")
        }`, "data-attribution Help menu");
fs.writeFileSync(electronFile, electron);
console.log(`Configured packaged SkyTrace account service: ${raw}`);
console.log("Commercial provider stack: ADSB.lol, Mictronics/VRS, MET Norway, NASA GIBS, AviationWeather.gov, OurAirports and OpenFreeMap.");
NODE
fi

node "$OVERLAY/scripts/optimize-performance.mjs" "$ROOT"
node - "$ROOT/index.html" "$ROOT/app.v3.js" <<'NODE'
const fs = require("fs");
const htmlFile = process.argv[2];
const appFile = process.argv[3];
let html = fs.readFileSync(htmlFile, "utf8");
if (!html.includes('/v3.3-glass.css')) html = html.replace('<link rel="stylesheet" href="/styles.v3.css" />', '<link rel="stylesheet" href="/styles.v3.css" />\n  <link rel="stylesheet" href="/v3.3-glass.css" />');
if (!html.includes('/v3.3-platform.js')) html = html.replace('<script src="/app.v3.js"></script>', '<script src="/v3.3-platform.js"></script>\n<script src="/app.v3.js"></script>');
if (!html.includes('/v3.3-export-fix.js')) html = html.replace('<script src="/v3.3-platform.js"></script>', '<script src="/v3.3-platform.js"></script>\n<script src="/v3.3-export-fix.js"></script>');
if (!html.includes('/v3.3-commerce.js')) html = html.replace('<script src="/app.v3.js"></script>', '<script src="/app.v3.js"></script>\n<script src="/v3.3-commerce.js"></script>');
if (!html.includes('/v3.3-codes.js')) html = html.replace('<script src="/v3.3-commerce.js"></script>', '<script src="/v3.3-commerce.js"></script>\n<script src="/v3.3-codes.js"></script>');
html = html.replace('window.SKYTRACE_BUILD="3.2.0-free";', 'window.SKYTRACE_BUILD="3.3.0-commerce-glass";');
fs.writeFileSync(htmlFile, html);
let app = fs.readFileSync(appFile, "utf8");
app = app.replace('}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; showToast(err.message,5000); }', '}catch(err){ console.error(err); el.sourceStatus.textContent="Flight feed unavailable"; el.loading.classList.add("done"); showToast(err.message,5000); }');
app = app.replace('if("serviceWorker"in navigator)navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});', 'if("serviceWorker"in navigator&&!navigator.userAgent.includes("Electron"))navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});');
app = app.replace('function initMap(){\n    applyPerformanceMode();startPerformanceHud();\n    state.map=new maplibregl.Map(', 'function initMap(){\n    applyPerformanceMode();startPerformanceHud();\n    setTimeout(()=>{if(!el.loading.classList.contains("done")){el.loading.querySelector("span").textContent="Aviation data is taking longer than expected";el.loading.classList.add("done");}},10000);\n    state.map=new maplibregl.Map(');
fs.writeFileSync(appFile, app);
NODE
node "$OVERLAY/scripts/finalize-v3.3.mjs" "$ROOT"
rm -rf "$ROOT/source-payload-fixed" "$ROOT/.github"
rm -f "$ROOT/trigger-build.txt"
rm -rf "$OVERLAY"
echo "Materialized SkyTrace V3.3.1 Performance RC with Cloud/Replay/Admin feature layer."
