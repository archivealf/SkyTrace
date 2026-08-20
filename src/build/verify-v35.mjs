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
  "mac-native-main.js", "mac-native-preload.cjs", "mac-native-renderer.js", "mac-native.css",
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
requireText("electron-main.js", 'label: "Settings…"', "native Settings menu");
requireText("mac-native-main.js", "new Tray", "menu-bar integration");
requireText("mac-native-main.js", "new Notification", "Notification Center integration");
requireText("mac-native-main.js", "setLoginItemSettings", "Launch at Login");
requireText("mac-native-main.js", "local-replay.ndjson", "private local replay storage");
requireText("mac-native-renderer.js", "macCommandPalette", "Cmd+K command centre");
requireText("mac-native-renderer.js", "skytrace-local-replay", "local replay map layer");
requireText("mac-native-renderer.js", "SkyTrace local fallback", "degraded traffic fallback");
requireText("mac-detached.js", "Orbit / hold estimate", "advanced aircraft analysis");
requireText("mac-detached.js", "Airport Desk", "Airport Desk");
requireText("server.js", "Content-Security-Policy", "CSP");
requireText("server.js", "desktopApiAuthorized", "desktop API authorization");
requireText("index.html", "/mac-native-renderer.js", "Mac native renderer load");
requireText("index.html", "/mac-native.css", "Mac native stylesheet load");
requireText("desktop-services.js", 'CURRENT_RELEASE_TAG = "v3.5.0"', "V3.5 update channel identity");

const forge = read("forge.config.cjs");
for (const paidSigningMarker of ["osxSign", "osxNotarize", "notarize", "APPLE_ID", "CSC_LINK"]) {
  if (forge.includes(paidSigningMarker)) failures.push(`forge.config.cjs unexpectedly contains signing/notarization marker: ${paidSigningMarker}`);
}

if (failures.length) {
  console.error("SkyTrace V3.5 verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Verified SkyTrace V3.5 Mac Native: unsigned build, native shell, private replay, offline fallback and desktop API hardening are present.");
