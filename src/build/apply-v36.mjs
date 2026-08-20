import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(sourceRoot, "..");
const root = path.resolve(process.argv[2] || repoRoot);

function source(rel) { return path.join(sourceRoot, rel); }
function target(rel) { return path.join(root, rel); }
function copy(from, to) {
  if (!fs.existsSync(source(from))) throw new Error(`Missing Product Preview source: ${from}`);
  fs.mkdirSync(path.dirname(target(to)), { recursive: true });
  fs.copyFileSync(source(from), target(to));
}
function read(rel) { return fs.readFileSync(target(rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(target(rel), text); }
function check(rel) {
  const result = spawnSync(process.execPath, ["--check", target(rel)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${rel}`);
}
function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Could not apply Product Preview patch: ${label}`);
  return text.replace(before, after);
}

for (const [from, to] of [
  ["desktop/v36-native-main.js", "v36-native-main.js"],
  ["renderer/v36-product.js", "v36-product.js"],
  ["renderer/v36-product.css", "v36-product.css"],
  ["renderer/v36-settings.js", "v36-settings.js"],
  ["renderer/v36-settings.css", "v36-settings.css"],
  ["renderer/v36-detached.js", "v36-detached.js"],
  ["renderer/v36-detached.css", "v36-detached.css"]
]) copy(from, to);
for (const rel of ["v36-native-main.js", "v36-product.js", "v36-settings.js", "v36-detached.js"]) check(rel);

let electron = read("electron-main.js");
if (!electron.includes('from "./v36-native-main.js"')) {
  const marker = 'import { installMacStartupRuntime } from "./mac-startup-runtime.js";';
  electron = replaceRequired(electron, marker, `${marker}\nimport { installV36ProductNative } from "./v36-native-main.js";`, "Product Preview native import");
}
if (!electron.includes("installV36ProductNative();")) {
  electron = replaceRequired(electron, "  await createWindow(skyTraceServer.url);", "  installV36ProductNative();\n  await createWindow(skyTraceServer.url);", "Product Preview native install");
}
write("electron-main.js", electron);

let html = read("index.html");
const maplibreMatch = html.match(/https:\/\/unpkg\.com\/maplibre-gl(?:@([^/\"']+))?\/dist\/maplibre-gl\.js/i);
const maplibreVersion = maplibreMatch?.[1] && maplibreMatch[1] !== "latest" ? maplibreMatch[1] : "6.4.1";
html = html
  .replace(/https:\/\/unpkg\.com\/maplibre-gl(?:@[^/\"']+)?\/dist\/maplibre-gl\.css/gi, "/node_modules/maplibre-gl/dist/maplibre-gl.css")
  .replace(/https:\/\/unpkg\.com\/maplibre-gl(?:@[^/\"']+)?\/dist\/maplibre-gl\.js/gi, "/node_modules/maplibre-gl/dist/maplibre-gl.js");
if (!html.includes('/v36-product.css')) html = replaceRequired(html, "</head>", '  <link rel="stylesheet" href="/v36-product.css">\n</head>', "Product Preview stylesheet");
if (!html.includes('/v36-product.js')) {
  const marker = '  <script src="/mac-native-renderer.js"></script>';
  html = replaceRequired(html, marker, `  <script src="/v36-product.js"></script>\n${marker}`, "Product Preview runtime before Mac native renderer");
}
write("index.html", html);

let settings = read("mac-settings.html");
if (!settings.includes('/v36-settings.css')) settings = replaceRequired(settings, "</head>", '  <link rel="stylesheet" href="/v36-settings.css">\n</head>', "settings addon stylesheet");
if (!settings.includes('/v36-settings.js')) settings = replaceRequired(settings, "</body>", '  <script src="/v36-settings.js"></script>\n</body>', "settings addon runtime");
write("mac-settings.html", settings);

let detached = read("mac-detached.html");
if (!detached.includes('/v36-detached.css')) detached = replaceRequired(detached, "</head>", '  <link rel="stylesheet" href="/v36-detached.css">\n</head>', "detached addon stylesheet");
if (!detached.includes('/v36-detached.js')) detached = replaceRequired(detached, "</body>", '  <script src="/v36-detached.js"></script>\n</body>', "detached addon runtime");
write("mac-detached.html", detached);

const packagePath = target("package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.dependencies = { ...(pkg.dependencies || {}), "maplibre-gl": maplibreVersion };
pkg.description = "SkyTrace V3.5 Mac Native Product Preview with onboarding, verified update checks, Timeline replay, advanced watchlists/geofences, notification history, Command Centre 2.0 and locally packaged MapLibre.";
pkg.scripts = pkg.scripts || {};
if (!String(pkg.scripts.check || "").includes("v36-product.js")) pkg.scripts.check = `${pkg.scripts.check || "node scripts/check-runtime.mjs"} && node --check v36-native-main.js && node --check v36-product.js && node --check v36-settings.js && node --check v36-detached.js`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const changelog = target("CHANGELOG.md");
if (fs.existsSync(changelog)) {
  const old = fs.readFileSync(changelog, "utf8");
  if (!old.includes("Product Preview R4")) fs.writeFileSync(changelog, old.replace(/^# SkyTrace Changelog\s*/, "# SkyTrace Changelog\n\n## Product Preview R4\n\n- Added first-run onboarding and a What's New experience.\n- Added verified GitHub update checks for the unsigned manual-release workflow.\n- Added SkyTrace Timeline: private local airspace rewind, playback speeds, filtering and CSV export.\n- Added named Watchlists 2.0 and circle/polygon geofence alerts.\n- Added an in-app Notification Center with local alert history.\n- Added Command Centre 2.0 and expanded Mac keyboard shortcuts.\n- Added adaptive zoom-based aircraft label decluttering with watchlist priority labels.\n- Added aircraft notes/tags/quick-watch tools and Airport Desk favorites.\n- Replaced CDN-loaded MapLibre JS/CSS with the packaged maplibre-gl dependency.\n\n"));
}

console.log(`Applied SkyTrace Product Preview R4 with local MapLibre ${maplibreVersion}.`);
