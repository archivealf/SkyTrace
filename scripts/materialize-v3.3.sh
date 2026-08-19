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

# GitHub release builds inject the public HTTPS account/payment backend without
# committing secrets. Because these builds are monetized, providers whose hosted
# services require separate commercial permission are disabled. Local/dev builds
# keep the existing defaults for evaluation and prototyping under provider terms.
if [[ -n "${SKYTRACE_COMMERCE_URL:-}" ]]; then
  node - "$ROOT/electron-main.js" "$ROOT/lib/config.js" "$ROOT/config.example.json" "$ROOT/server.js" <<'NODE'
const fs = require("fs");
const [electronFile, libConfigFile, exampleConfigFile, serverFile] = process.argv.slice(2);
const configFiles = [electronFile, libConfigFile, exampleConfigFile];
const raw = String(process.env.SKYTRACE_COMMERCE_URL || "").trim().replace(/\/+$/, "");
let url;
try { url = new URL(raw); } catch { throw new Error("SKYTRACE_COMMERCE_URL must be a valid URL."); }
if (url.protocol !== "https:") throw new Error("SKYTRACE_COMMERCE_URL must use HTTPS for packaged releases.");

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Could not apply ${label} release patch.`);
  return text.replace(before, after);
}

for (const file of configFiles) {
  let text = fs.readFileSync(file, "utf8");
  text = text.split("http://127.0.0.1:8787").join(raw);
  text = text.split("openSkyFallback: true").join("openSkyFallback: false");
  text = text.split("adsbdb: true").join("adsbdb: false");
  text = text.split("openMeteo: true").join("openMeteo: false");
  text = text.split("rainViewer: true").join("rainViewer: false");
  text = text.split('"openSkyFallback": true').join('"openSkyFallback": false');
  text = text.split('"adsbdb": true').join('"adsbdb": false');
  text = text.split('"openMeteo": true').join('"openMeteo": false');
  text = text.split('"rainViewer": true').join('"rainViewer": false');
  fs.writeFileSync(file, text);
}

// Runtime gates keep restricted hosted providers disabled even if an older user
// config contains values from a local/non-commercial build.
let libConfig = fs.readFileSync(libConfigFile, "utf8");
libConfig = replaceRequired(
  libConfig,
  '        live: raw?.providers?.live === "opensky" ? "opensky" : "adsblol",',
  '        live: "adsblol",',
  "OpenSky primary-provider commercial runtime gate"
);
libConfig = replaceRequired(
  libConfig,
  "        openSkyFallback: raw?.providers?.openSkyFallback !== false,",
  "        openSkyFallback: false,",
  "OpenSky fallback commercial runtime gate"
);
libConfig = replaceRequired(
  libConfig,
  "        adsbdb: raw?.providers?.adsbdb !== false,",
  "        adsbdb: false,",
  "ADSBDB commercial runtime gate"
);
libConfig = replaceRequired(
  libConfig,
  "        openMeteo: raw?.providers?.openMeteo !== false,",
  "        openMeteo: false,",
  "Open-Meteo commercial runtime gate"
);
libConfig = replaceRequired(
  libConfig,
  "        rainViewer: raw?.providers?.rainViewer !== false",
  "        rainViewer: false",
  "RainViewer commercial runtime gate"
);
fs.writeFileSync(libConfigFile, libConfig);

// Make licence/provider attribution directly reachable from the macOS Help menu.
let electron = fs.readFileSync(electronFile, "utf8");
electron = replaceRequired(
  electron,
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
        }`,
  "data-attribution Help menu"
);
fs.writeFileSync(electronFile, electron);

// Do not leave restricted provider proxy routes callable in commercial builds.
let server = fs.readFileSync(serverFile, "utf8");
server = replaceRequired(
  server,
`    if (url.pathname === "/api/aircraft") {
      return json(
        res,
        200,
        await getAircraftMetadata(p.get("icao"), p.get("callsign") || "")
      );
    }`,
`    if (url.pathname === "/api/aircraft") {
      if (!config.providers.adsbdb) {
        return json(res, 404, { ok: false, error: "Aircraft enrichment is disabled in this commercial build." });
      }
      return json(
        res,
        200,
        await getAircraftMetadata(p.get("icao"), p.get("callsign") || "")
      );
    }`,
  "commercial aircraft-enrichment endpoint guard"
);
server = replaceRequired(
  server,
`    if (url.pathname === "/api/route") {
      return json(res, 200, await getFlightRoute(p.get("callsign")));
    }`,
`    if (url.pathname === "/api/route") {
      if (!config.providers.adsbdb) {
        return json(res, 404, { ok: false, error: "Route enrichment is disabled in this commercial build." });
      }
      return json(res, 200, await getFlightRoute(p.get("callsign")));
    }`,
  "commercial route-enrichment endpoint guard"
);
server = replaceRequired(
  server,
`    if (url.pathname === "/api/weather") {
      return json(res, 200, await getWeather(p.get("lat"), p.get("lon")));
    }`,
`    if (url.pathname === "/api/weather") {
      if (!config.providers.openMeteo) {
        return json(res, 404, { ok: false, error: "General weather is disabled in this commercial build." });
      }
      return json(res, 200, await getWeather(p.get("lat"), p.get("lon")));
    }`,
  "commercial weather endpoint guard"
);
fs.writeFileSync(serverFile, server);

console.log(`Configured packaged SkyTrace account service: ${raw}`);
console.log("Commercial release policy: OpenSky, ADSBDB, Open-Meteo free API and RainViewer are disabled.");
NODE
fi

# Run performance rewrites against the verified V3.2 renderer before the V3.3
# startup/service-worker tweaks below alter the exact source patterns.
node "$OVERLAY/scripts/optimize-performance.mjs" "$ROOT"

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
app = app.replace('function initMap(){\n    applyPerformanceMode();startPerformanceHud();\n    state.map=new maplibregl.Map(', 'function initMap(){\n    applyPerformanceMode();startPerformanceHud();\n    setTimeout(()=>{if(!el.loading.classList.contains("done")){el.loading.querySelector("span").textContent="Aviation data is taking longer than expected";el.loading.classList.add("done");}},10000);\n    state.map=new maplibregl.Map(');
fs.writeFileSync(appFile, app);

let live = fs.readFileSync(liveFile, "utf8");
live = live.replace('  if (radius > 245) return null;\n\n  const r = Math.max(1, Math.min(245, radius));', '  const r = Math.max(1, Math.min(245, radius));');
fs.writeFileSync(liveFile, live);
NODE

rm -rf "$OVERLAY"
echo "Materialized SkyTrace V3.3 Commerce + Liquid Glass."
