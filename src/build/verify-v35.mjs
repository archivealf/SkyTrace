import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const failures = [];
const read = rel => {
  try { return fs.readFileSync(path.join(root, rel), "utf8"); }
  catch { failures.push(`missing ${rel}`); return ""; }
};
const requireText = (rel, needle, label = needle) => {
  const text = read(rel);
  if (!text.includes(needle)) failures.push(`${rel}: missing ${label}`);
};

for (const file of [
  "mac-native-main.js", "mac-native-preload.cjs", "mac-startup-runtime.js", "mac-native-renderer.js", "mac-native.css", "mac-startup-guard.js",
  "mac-settings.html", "mac-settings.js", "mac-settings.css",
  "mac-detached.html", "mac-detached.js", "mac-detached.css"
]) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);
}

const pkg = JSON.parse(read("package.json") || "{}");
if (pkg.version !== "3.5.0") failures.push(`package.json: expected 3.5.0, got ${pkg.version || "missing"}`);
requireText("electron-main.js", "preload: macNativePreloadPath", "sandboxed native preload");
requireText("electron-main.js", "__SKYTRACE_DESKTOP_TOKEN__", "ephemeral desktop API token");
requireText("electron-main.js", "skytrace_desktop", "HttpOnly desktop API cookie");
requireText("electron-main.js", "X-SkyTrace-Desktop", "Electron-injected desktop API header");
requireText("electron-main.js", "installMacStartupRuntime", "packaged startup runtime");
requireText("electron-main.js", 'label: "Settings…"', "native Settings menu");
requireText("mac-native-main.js", "new Tray", "menu-bar integration");
requireText("mac-native-main.js", "new Notification", "Notification Center integration");
requireText("mac-native-main.js", "setLoginItemSettings", "Launch at Login");
requireText("mac-native-main.js", "local-replay.ndjson", "private local replay storage");
requireText("mac-native-preload.cjs", "reportReady", "sandboxed startup ready bridge");
requireText("mac-startup-runtime.js", "renderer-ready", "main-process startup handshake logging");
requireText("mac-startup-runtime.js", "SKYTRACE_SMOKE_TEST", "packaged startup smoke-test exit path");
requireText("mac-native-renderer.js", "macCommandPalette", "Cmd+K command centre");
requireText("mac-native-renderer.js", "skytrace-local-replay", "local replay map layer");
requireText("mac-native-renderer.js", "SkyTrace local fallback", "degraded traffic fallback");
requireText("mac-startup-guard.js", "health-and-shell-ready", "independent startup health guard");
requireText("mac-startup-guard.js", "recovery-shell-ready", "startup recovery mode");
requireText("mac-startup-guard.js", "reportStartupError", "renderer startup error reporting");
requireText("mac-detached.js", "Orbit / hold estimate", "advanced aircraft analysis");
requireText("mac-detached.js", "Airport Desk", "Airport Desk");
requireText("server.js", "Content-Security-Policy", "CSP");
requireText("server.js", "desktopApiAuthorized", "desktop API authorization");
requireText("server.js", 'req.headers["x-skytrace-desktop"]', "desktop auth header acceptance");
requireText("index.html", "/mac-native-renderer.js", "Mac native renderer load");
requireText("index.html", "/mac-startup-guard.js", "Mac startup guard load");
requireText("index.html", "/mac-native.css", "Mac native stylesheet load");
requireText("desktop-services.js", 'CURRENT_RELEASE_TAG = "v3.5.0"', "V3.5 update channel identity");
requireText("v3.4-polish.js", "health-and-shell-ready", "startup health watchdog");
requireText("v3.4-polish.js", '.skytrace-startup[aria-hidden=\"true\"]', "legacy splash hide compatibility");
requireText("v3.4-polish.js", "loading.remove()", "startup overlay removal fail-safe");

const forge = read("forge.config.cjs");
for (const paidSigningMarker of ["osxSign", "osxNotarize", "notarize", "APPLE_ID", "CSC_LINK"]) {
  if (forge.includes(paidSigningMarker)) failures.push(`forge.config.cjs unexpectedly contains signing/notarization marker: ${paidSigningMarker}`);
}

if (failures.length) {
  console.error("SkyTrace V3.5 verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Verified SkyTrace V3.5 Mac Native: unsigned build, native shell, redundant desktop auth, packaged startup handshake/recovery, private replay and offline fallback are present.");
