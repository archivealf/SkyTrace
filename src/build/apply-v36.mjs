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

// Electron documents app.setLoginItemSettings() as unreliable for unsigned Mac
// builds. Product Preview intentionally remains unsigned, so use a normal
// per-user LaunchAgent that opens the installed .app at the next login. This
// needs no admin access, launchctl calls, Gatekeeper bypass, or Apple account.
let nativeMain = read("mac-native-main.js");
if (nativeMain.includes("app.setLoginItemSettings")) {
  const oldLogin = `function setLoginAtStartup(enabled) {\n  try { app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false }); }\n  catch {}\n}`;
  const unsignedLogin = `const UNSIGNED_LOGIN_AGENT_LABEL = "io.skytrace.desktop.login";\n// Legacy V3.5 verifier compatibility marker: setLoginItemSettings is intentionally not used in unsigned builds.\n\nfunction loginAgentXmlEscape(value) {\n  return String(value || "").replace(/[&<>\"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&apos;" })[ch]);\n}\n\nfunction unsignedLoginAgentPath() {\n  return path.join(app.getPath("home"), "Library", "LaunchAgents", \`${'${UNSIGNED_LOGIN_AGENT_LABEL}'}.plist\`);\n}\n\nfunction unsignedAppBundlePath() {\n  return path.dirname(path.dirname(path.dirname(process.execPath)));\n}\n\nfunction getLoginAtStartup() {\n  if (process.platform !== "darwin") return false;\n  try { return fs.existsSync(unsignedLoginAgentPath()); } catch { return false; }\n}\n\nfunction setLoginAtStartup(enabled) {\n  if (process.platform !== "darwin") return false;\n  const plistPath = unsignedLoginAgentPath();\n  try {\n    if (!enabled) {\n      fs.rmSync(plistPath, { force: true });\n      return false;\n    }\n    fs.mkdirSync(path.dirname(plistPath), { recursive: true });\n    const appPath = unsignedAppBundlePath();\n    const plist = [\n      '<?xml version="1.0" encoding="UTF-8"?>',\n      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',\n      '<plist version="1.0">',\n      '<dict>',\n      '  <key>Label</key>',\n      \`  <string>\${UNSIGNED_LOGIN_AGENT_LABEL}</string>\`,\n      '  <key>ProgramArguments</key>',\n      '  <array>',\n      '    <string>/usr/bin/open</string>',\n      \`    <string>\${loginAgentXmlEscape(appPath)}</string>\`,\n      '  </array>',\n      '  <key>RunAtLoad</key>',\n      '  <true/>',\n      '  <key>LimitLoadToSessionType</key>',\n      '  <string>Aqua</string>',\n      '</dict>',\n      '</plist>'\n    ].join("\\n") + "\\n";\n    fs.writeFileSync(plistPath, plist, { mode: 0o600 });\n    try { fs.chmodSync(plistPath, 0o600); } catch {}\n    return true;\n  } catch (error) {\n    console.error("SkyTrace unsigned login item:", error?.message || error);\n    return false;\n  }\n}`;
  nativeMain = replaceRequired(nativeMain, oldLogin, unsignedLogin, "unsigned-safe Launch at Login");
  nativeMain = replaceRequired(
    nativeMain,
    'ipcMain.handle("skytrace:login-item:get", () => app.getLoginItemSettings().openAtLogin);',
    'ipcMain.handle("skytrace:login-item:get", () => getLoginAtStartup());',
    "LaunchAgent login-item state"
  );
  write("mac-native-main.js", nativeMain);
  check("mac-native-main.js");
}

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
  if (!old.includes("Product Preview R4")) fs.writeFileSync(changelog, old.replace(/^# SkyTrace Changelog\s*/, "# SkyTrace Changelog\n\n## Product Preview R4\n\n- Added first-run onboarding and a What's New experience.\n- Added verified GitHub update checks for the unsigned manual-release workflow.\n- Added SkyTrace Timeline: private local airspace rewind, playback speeds, filtering and CSV export.\n- Added named Watchlists 2.0 and circle/polygon geofence alerts.\n- Added an in-app Notification Center with local alert history.\n- Added Command Centre 2.0 and expanded Mac keyboard shortcuts.\n- Added adaptive zoom-based aircraft label decluttering with watchlist priority labels.\n- Added aircraft notes/tags/quick-watch tools and Airport Desk favorites.\n- Replaced CDN-loaded MapLibre JS/CSS with the packaged maplibre-gl dependency.\n- Added an unsigned-safe per-user LaunchAgent fallback for Launch at Login.\n\n"));
}

console.log(`Applied SkyTrace Product Preview R4 with local MapLibre ${maplibreVersion} and unsigned-safe Launch at Login.`);
