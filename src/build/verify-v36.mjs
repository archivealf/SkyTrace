import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] || process.cwd());
const failures = [];
const read = rel => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { failures.push(`missing ${rel}`); return ""; } };
const need = (rel, token, label) => { if (!read(rel).includes(token)) failures.push(`${rel}: missing ${label}`); };
const forbid = (rel, token, label) => { if (read(rel).includes(token)) failures.push(`${rel}: forbidden ${label}`); };
const needFile = (rel, label) => {
  const file = path.join(root, rel);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 32) failures.push(`${rel}: invalid ${label}`);
  } catch { failures.push(`${rel}: missing ${label}`); }
};

for (const rel of ["v36-native-main.js", "v36-product.js", "v36-settings.js", "v36-detached.js", "mac-native-main.js"]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { failures.push(`missing ${rel}`); continue; }
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) failures.push(`${rel}: syntax check failed`);
}

need("index.html", "/v36-product.js", "Product Preview runtime");
need("index.html", "/v36-product.css", "Product Preview stylesheet");
need("index.html", "/vendor/maplibre-gl/maplibre-gl.js", "packaged MapLibre JS");
need("index.html", "/vendor/maplibre-gl/maplibre-gl.css", "packaged MapLibre CSS");
forbid("index.html", "/node_modules/maplibre-gl/", "MapLibre path into Forge-excluded node_modules");
forbid("index.html", "unpkg.com/maplibre-gl", "external MapLibre CDN dependency");
forbid("index.html", "Connecting to OpenSky", "stale OpenSky provider status label");
need("package.json", '"maplibre-gl"', "MapLibre dependency");
need("package.json", "node scripts/vendor-maplibre.mjs", "MapLibre postinstall vendor step");
need("electron-main.js", "installV36ProductNative();", "Product Preview native IPC installer");
need("mac-native-preload.cjs", "skytrace:app:version", "version bridge");
need("mac-native-preload.cjs", "skytrace:file:save-text", "native export bridge");
need("mac-native-preload.cjs", "skytrace:system:open-external", "safe external release bridge");

// Before npm install there is no node_modules tree yet. Once dependencies exist,
// the postinstall vendoring step must also have produced real packaged assets.
if (fs.existsSync(path.join(root, "node_modules", "maplibre-gl", "package.json"))) {
  needFile("vendor/maplibre-gl/maplibre-gl.js", "vendored MapLibre JS");
  needFile("vendor/maplibre-gl/maplibre-gl.css", "vendored MapLibre CSS");
  needFile("vendor/maplibre-gl/VERSION", "vendored MapLibre version marker");
}

need("mac-native-main.js", "Launch at Login was removed from SkyTrace", "removed login feature migration marker");
need("mac-native-main.js", "io.skytrace.desktop.login.plist", "legacy login plist cleanup");
forbid("mac-native-main.js", "app.setLoginItemSettings", "Electron login-item API");
forbid("mac-native-main.js", "skytrace:login-item", "login-item IPC");
forbid("mac-native-main.js", "launchAtLogin", "Launch at Login settings state");
forbid("mac-native-preload.cjs", "getLaunchAtLogin", "Launch at Login preload getter");
forbid("mac-native-preload.cjs", "setLaunchAtLogin", "Launch at Login preload setter");
forbid("mac-settings.html", "Launch at Login", "Launch at Login settings UI");
forbid("mac-settings.js", "launchAtLogin", "Launch at Login settings model");
forbid("v36-product.js", "v36OnboardLogin", "Launch at Login onboarding control");
forbid("v36-product.js", "Launch SkyTrace at login", "Launch at Login onboarding text");

need("v36-product.js", "showOnboarding", "first-run onboarding");
need("v36-product.js", "checkForUpdates", "update checker");
need("v36-product.js", "SkyTrace Timeline", "Timeline UI");
need("v36-product.js", "evaluateWatchlists", "watchlist rule engine");
need("v36-product.js", "evaluateGeofences", "geofence engine");
need("v36-product.js", "pointInPolygon", "polygon geofences");
need("v36-product.js", "renderAlerts", "in-app Notification Center");
need("v36-product.js", "executeCommand", "Command Centre 2.0");
need("v36-product.js", "showWhatsNewIfNeeded", "What's New");
need("v36-product.css", "data-skytrace-zoom-band", "adaptive label decluttering");
need("mac-settings.html", "/v36-settings.js", "updates/keyboard settings addon");
need("mac-detached.html", "/v36-detached.js", "aircraft/Airport Desk workspace addon");
need("v36-detached.js", "function ensureWorkspace()", "detached workspace refresh reattachment");
need("v36-detached.js", "setInterval(ensureWorkspace, 750)", "detached workspace periodic refresh resilience");
need("v36-detached.js", 'content.querySelector(".hero-grid")', "aircraft rendered-state guard");
need("v36-detached.js", 'content.querySelector(".stat-grid")', "Airport Desk rendered-state guard");

if (failures.length) {
  console.error("SkyTrace Product Preview verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Verified Product Preview R4.6: packaged vendored MapLibre, onboarding, updates, Timeline, Watchlists 2.0, geofences, Notification Center, refresh-resilient enhanced workspaces, Command Centre 2.0, What's New and keyboard shortcuts; Launch at Login is removed and legacy login state is cleaned up.");
