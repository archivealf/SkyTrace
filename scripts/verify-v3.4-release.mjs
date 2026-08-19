import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "3.4.0";
const BUILD = "3.4.0-rc1";
const DISPLAY = "V3.4.0 RC1";
const BLOCKED_HOSTS = ["opensky-network.org", "api.adsbdb.com", "api.open-meteo.com", "api.rainviewer.com"];

function text(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function requireContains(rel, needle, label = needle) { if (!text(rel).includes(needle)) throw new Error(`${rel} is missing ${label}.`); }
function requireAbsent(rel, needle, label = needle) { if (text(rel).includes(needle)) throw new Error(`${rel} still contains stale ${label}.`); }
function requireFileAbsent(rel, label = rel) { if (fs.existsSync(path.join(root, rel))) throw new Error(`${label} must not be present in the commercial runtime.`); }

const pkg = JSON.parse(text("package.json"));
if (pkg.version !== VERSION) throw new Error(`package.json version is ${pkg.version}; expected ${VERSION}.`);
if (pkg?.config?.forge !== "./forge.config.cjs") throw new Error("package.json is not using the canonical forge.config.cjs.");
requireContains("forge.config.cjs", 'appBundleId: "io.skytrace.desktop"', "SkyTrace bundle identifier");
requireContains("forge.config.cjs", "asar: true", "ASAR packaging");
requireContains("index.html", `window.SKYTRACE_BUILD=\"${BUILD}\"`, "V3.4.0 RC1 build marker");
requireContains("index.html", 'id="performanceMode"', "Performance Mode control");
requireContains("index.html", 'id="perfStatus"', "performance HUD");
requireContains("index.html", '/v3.3-platform.js', "Cloud feature layer script");
requireContains("index.html", '/v3.3-export-fix.js', "safe history export script");
requireContains("index.html", '/v3.3-codes.js', "redeem-code UI script");
requireContains("index.html", '/v3.3-entitlement-sync.js', "live entitlement sync script");
requireContains("index.html", '/v3.4-features.js', "V3.4 Operations feature script");
requireContains("app.v3.js", "function flightsForMap()", "adaptive aircraft renderer");
requireContains("app.v3.js", 'localStorage.getItem("skytrace.performanceMode")', "persisted Performance Mode");
requireContains("v3.3-commerce.js", `window.SKYTRACE_BUILD = \"${BUILD}\"`, "commerce build marker");
requireContains("v3.3-commerce.js", `appVersion.textContent = \"${DISPLAY}\"`, "visible V3.4.0 RC1 label");
requireContains("v3.3-codes.js", "Have a SkyTrace code?", "redeem-code store UI");
requireContains("v3.3-entitlement-sync.js", "/api/account/me", "account entitlement refresh endpoint");
requireContains("v3.3-entitlement-sync.js", "setInterval", "background entitlement refresh");
requireContains("v3.3-platform.js", "SKYTRACE CLOUD", "Cloud UI");
requireContains("v3.3-platform.js", "Cloud Replay+", "Cloud Replay UI");
requireContains("v3.3-platform.js", "Airport Intelligence", "Airport Intelligence UI");
requireContains("v3.3-platform.js", "Workspaces", "saved workspace UI");
requireContains("v3.3-platform.js", "Bookmarks", "bookmark UI");
requireContains("v3.3-platform.js", "Alerts", "alert UI");
requireContains("v3.3-platform.js", "Export KML", "KML history export");
requireContains("v3.3-export-fix.js", "/api/account/history-export", "in-app history download path");
requireContains("v3.4-features.js", "Operational weather", "V3.4 operational weather UI");
requireContains("v3.4-features.js", "Global Replay+", "V3.4 global replay UI");
requireContains("v3.4-features.js", "Aircraft profile", "V3.4 aircraft profile UI");
requireContains("v3.4-features.js", "Airport Ops+", "V3.4 airport operations UI");
requireContains("server.js", BUILD, "server build marker");
requireContains("server.js", 'url.pathname === "/api/account/redeem"', "local redeem-code proxy");
requireContains("server.js", 'url.pathname === "/api/account/cloud"', "cloud-sync proxy");
requireContains("server.js", 'url.pathname === "/api/account/history"', "cloud replay proxy");
requireContains("server.js", 'url.pathname === "/api/airport-intelligence"', "Airport Intelligence endpoint");
requireContains("server.js", 'url.pathname === "/api/v34/operations"', "V3.4 Operations proxy");
requireContains("server.js", 'url.pathname === "/api/v34/replay"', "V3.4 global replay proxy");
requireContains("server.js", 'url.pathname === "/api/v34/aircraft-profile"', "V3.4 aircraft profile proxy");
requireContains("lib/account.js", 'remote("/v1/redeem"', "commerce redeem-code proxy");
requireContains("lib/account.js", 'remote("/v1/cloud"', "commerce cloud-sync proxy");
requireContains("lib/account.js", 'remote(`/v1/history', "commerce history proxy");
requireContains("lib/account.js", 'remote("/v1/v34/operations"', "V3.4 Operations account proxy");
requireContains("lib/account.js", 'remote(`/v1/v34/replay', "V3.4 replay account proxy");
requireContains("scripts/apply-v34.mjs", "entitlement sync", "V3.4 entitlement-sync materialization patch");
requireContains("api/config.js", BUILD, "API config build marker");
requireContains("api/health.js", BUILD, "API health build marker");
requireContains("electron-main.js", "SkyTrace data licences and attribution", "ASAR-safe attribution dialog");
requireAbsent("electron-main.js", 'shell.openPath(path.join(__dirname, "ATTRIBUTION.md"))', "ASAR-unsafe attribution openPath");
requireContains("install", "install-v3.4-rc1", "shared V3.4 RC1 launcher target");
requireContains("install-v3.4-rc1", 'REF="v3.3-commerce"', "RC1 source branch");
requireContains("install-v3.4-rc1", 'EXPECTED_VERSION="3.4.0"', "installer version guard");
requireContains("install-v3.4-rc1", 'EXPECTED_BUNDLE_ID="io.skytrace.desktop"', "installer bundle-ID guard");
requireContains("install-v3.4-rc1", "Contents/Resources/app.asar", "installer ASAR guard");
requireContains("install-v3.4-rc1", "Apple Silicon (arm64)", "Apple Silicon installer label");
requireContains("install-v3.4-rc1", "Intel (x86_64)", "Intel installer label");
requireAbsent("install-v3.4-rc1", "/main", "main-branch fallback");
requireAbsent("install-v3.4-rc1", "V3.2", "V3.2 installer text");
requireContains("README.md", "SkyTrace V3.4.0 RC1", "V3.4 RC1 README identity");
requireContains("README.md", "v3.3-commerce/install", "RC1 install link");
requireAbsent("README.md", "main/install", "old main installer link");
requireContains("CHANGELOG.md", "3.4.0 RC1", "RC1 changelog entry");
for (const rel of ["index.html", "v3.3-commerce.js", "server.js", "api/config.js", "api/health.js"]) {
  requireAbsent(rel, "3.3.1-performance-rc", "V3.3.1 build marker");
  requireAbsent(rel, "V3.3.1 RC", "V3.3.1 visible release label");
}

if (process.env.SKYTRACE_COMMERCE_URL) {
  requireFileAbsent("lib/opensky.js", "OpenSky runtime module");
  requireContains("lib/live.js", "https://api.adsb.lol", "ADSB.lol live provider");
  requireContains("lib/live.js", "STALE_TTL", "live stale-cache fallback");
  requireContains("lib/aircraft.js", "https://vrs-standing-data.adsb.lol/routes", "VRS route data provider");
  requireContains("lib/weather.js", "https://api.met.no/weatherapi/locationforecast/2.0/compact", "MET Norway Locationforecast");
  requireContains("lib/precipitation.js", "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi", "NASA GIBS precipitation provider");
  requireContains("scripts/update-aviation-data.mjs", "wiedehopf/tar1090-db/csv/aircraft.csv.gz", "Mictronics/tar1090 aircraft data refresh");
  requireContains("app.v3.js", "/api/precipitation-tile/{z}/{x}/{y}.png", "precipitation map tile route");
  requireContains("app.v3.js", "MET Norway weather", "MET Norway UI label");
  requireContains("index.html", "<span>Precipitation</span>", "precipitation map control");
  requireAbsent("index.html", 'id="layerRadar" disabled', "disabled precipitation control");
  requireContains("server.js", 'url.pathname === "/api/precipitation"', "precipitation metadata API");
  requireContains("server.js", "precipitation-tile", "precipitation tile API");
  requireContains("lib/config.js", "liveStaleCache", "stale-cache provider config");
  requireContains("lib/config.js", "aircraftEnrichment", "aircraft enrichment provider config");
  requireContains("lib/config.js", "generalWeather", "general weather provider config");
  requireContains("lib/config.js", "precipitation", "precipitation provider config");
  requireContains("ATTRIBUTION.md", "Mictronics", "Mictronics attribution");
  requireContains("ATTRIBUTION.md", "MET Norway", "MET Norway attribution");
  requireContains("ATTRIBUTION.md", "NASA GPM IMERG", "NASA precipitation attribution");
  const runtimeFiles = ["app.v3.js","v3.3-codes.js","v3.3-entitlement-sync.js","v3.3-platform.js","v3.3-export-fix.js","v3.4-features.js","server.js","electron-main.js","lib/config.js","lib/account.js","lib/live.js","lib/aircraft.js","lib/weather.js","lib/precipitation.js","api/config.js","api/health.js"];
  for (const rel of runtimeFiles) {
    const value = text(rel);
    for (const host of BLOCKED_HOSTS) if (value.includes(host)) throw new Error(`${rel} contains restricted provider host ${host}.`);
  }
}

console.log(`Verified SkyTrace ${DISPLAY} (${BUILD}): identity, packaging, runtime stability, commerce, Cloud tools, V3.4 Operations/Replay/Profile and free commercial provider stack are consistent.`);
