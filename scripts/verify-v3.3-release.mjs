import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = "3.3.1-performance-rc";
const BLOCKED_HOSTS = [
  "opensky-network.org",
  "api.adsbdb.com",
  "api.open-meteo.com",
  "api.rainviewer.com"
];

function text(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function requireContains(rel, needle, label = needle) {
  const value = text(rel);
  if (!value.includes(needle)) throw new Error(`${rel} is missing ${label}.`);
}
function requireAbsent(rel, needle, label = needle) {
  const value = text(rel);
  if (value.includes(needle)) throw new Error(`${rel} still contains stale ${label}.`);
}
function requireFileAbsent(rel, label = rel) {
  if (fs.existsSync(path.join(root, rel))) throw new Error(`${label} must not be present in the commercial runtime.`);
}

const pkg = JSON.parse(text("package.json"));
if (pkg.version !== "3.3.1") throw new Error(`package.json version is ${pkg.version}; expected 3.3.1.`);
if (pkg?.config?.forge !== "./forge.config.cjs") throw new Error("package.json is not using the canonical forge.config.cjs.");

requireContains("forge.config.cjs", 'appBundleId: "io.skytrace.desktop"', "SkyTrace bundle identifier");
requireContains("forge.config.cjs", "asar: true", "ASAR packaging");
requireContains("index.html", `window.SKYTRACE_BUILD=\"${BUILD}\"`, "V3.3.1 build marker");
requireContains("index.html", 'id="performanceMode"', "Performance Mode control");
requireContains("index.html", 'id="perfStatus"', "performance HUD");
requireContains("app.v3.js", "function flightsForMap()", "adaptive aircraft renderer");
requireContains("app.v3.js", 'localStorage.getItem("skytrace.performanceMode")', "persisted Performance Mode");
requireContains("v3.3-commerce.js", `window.SKYTRACE_BUILD = \"${BUILD}\"`, "commerce build marker");
requireContains("v3.3-commerce.js", 'appVersion.textContent = "V3.3.1 RC"', "visible V3.3.1 RC label");
requireContains("server.js", BUILD, "server build marker");
requireContains("api/config.js", BUILD, "API config build marker");
requireContains("api/health.js", BUILD, "API health build marker");
requireContains("electron-main.js", "SkyTrace data licences and attribution", "ASAR-safe attribution dialog");
requireAbsent("electron-main.js", 'shell.openPath(path.join(__dirname, "ATTRIBUTION.md"))', "ASAR-unsafe attribution openPath");

requireContains("install", "install-v3.3-rc", "shared V3.3.1 launcher target");
requireAbsent("install", "V3.2", "V3.2 launcher text");
requireAbsent("install", "v3.2", "V3.2 launcher path");
requireContains("install-v3.3-rc", 'REF="v3.3-commerce"', "V3.3 installer branch");
requireContains("install-v3.3-rc", 'EXPECTED_VERSION="3.3.1"', "installer version guard");
requireContains("install-v3.3-rc", 'EXPECTED_BUNDLE_ID="io.skytrace.desktop"', "installer bundle-ID guard");
requireContains("install-v3.3-rc", "Contents/Resources/app.asar", "installer ASAR guard");
requireAbsent("install-v3.3-rc", "/main", "main-branch fallback");
requireAbsent("install-v3.3-rc", "V3.2", "V3.2 installer text");
requireAbsent("install-v3.3-rc", "v3.2", "V3.2 installer path");
requireContains("README.md", "v3.3-commerce/install", "V3.3 RC install link");
requireAbsent("README.md", "main/install", "old main installer link");

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

  const runtimeFiles = [
    "app.v3.js",
    "server.js",
    "electron-main.js",
    "lib/config.js",
    "lib/live.js",
    "lib/aircraft.js",
    "lib/weather.js",
    "lib/precipitation.js",
    "api/config.js",
    "api/health.js"
  ];
  for (const rel of runtimeFiles) {
    const value = text(rel);
    for (const host of BLOCKED_HOSTS) {
      if (value.includes(host)) throw new Error(`${rel} contains restricted provider host ${host}.`);
    }
  }
}

console.log(`Verified SkyTrace ${BUILD}: identity, packaging, performance and free commercial provider stack are consistent.`);
