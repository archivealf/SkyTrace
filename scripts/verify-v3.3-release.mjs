import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = "3.3.1-performance-rc";

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

const pkg = JSON.parse(text("package.json"));
if (pkg.version !== "3.3.1") throw new Error(`package.json version is ${pkg.version}; expected 3.3.1.`);

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

requireContains("install", 'REF="v3.3-commerce"', "V3.3 installer branch");
requireContains("install", 'EXPECTED_VERSION="3.3.1"', "installer version guard");
requireAbsent("install", "/main", "main-branch fallback");
requireAbsent("install", "V3.2", "V3.2 installer text");
requireAbsent("install", "v3.2", "V3.2 installer path");

requireContains("README.md", "v3.3-commerce/install", "V3.3 RC install link");
requireAbsent("README.md", "main/install", "old main installer link");

if (process.env.SKYTRACE_COMMERCE_URL) {
  requireAbsent("app.v3.js", "api.rainviewer.com", "direct RainViewer API access");
  requireContains("app.v3.js", "/api/provider-disabled/rainviewer", "RainViewer commercial guard");
  requireContains("lib/config.js", "openSkyFallback: false", "OpenSky fallback commercial gate");
  requireContains("lib/config.js", "adsbdb: false", "ADSBDB commercial gate");
  requireContains("lib/config.js", "openMeteo: false", "Open-Meteo commercial gate");
  requireContains("lib/config.js", "rainViewer: false", "RainViewer commercial gate");
}

console.log(`Verified SkyTrace ${BUILD}: installer, identity, performance patch and commercial gates are consistent.`);
