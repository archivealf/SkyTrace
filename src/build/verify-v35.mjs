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

function externalScriptOrigins(html) {
  const origins = new Set();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const value = String(match[1] || "").trim();
    if (/^https?:\/\//i.test(value)) origins.add(new URL(value).origin);
  }
  return [...origins];
}

function externalStyleOrigins(html) {
  const origins = new Set();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel=["'][^"']*stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    if (/^https?:\/\//i.test(href)) origins.add(new URL(href).origin);
  }
  return [...origins];
}

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
requireText("electron-main.js", 'urls: [`${desktopOrigin}/api/*`]', "API-scoped desktop header injection");
requireText("electron-main.js", "installMacStartupRuntime", "packaged startup runtime");
requireText("electron-main.js", 'label: "Settings…"', "native Settings menu");

requireText("mac-native-main.js", "new Tray", "menu-bar integration");
requireText("mac-native-main.js", "new Notification", "Notification Center integration");
requireText("mac-native-main.js", "setLoginItemSettings", "Launch at Login");
requireText("mac-native-main.js", "local-replay.ndjson", "private local replay storage");
requireText("mac-native-main.js", "hardenChildWindowNavigation", "privileged child-window navigation guard");
requireText("mac-native-main.js", "replayQueue: Promise.resolve()", "serialized local replay writes");
requireText("mac-native-main.js", "lastReplayIngestAt", "local replay sampling throttle");

requireText("mac-native-preload.cjs", "reportReady", "sandboxed startup ready bridge");
requireText("mac-startup-runtime.js", "renderer-ready", "main-process startup handshake logging");
requireText("mac-startup-runtime.js", "payloadHealthy", "authenticated runtime startup contract");
requireText("mac-startup-runtime.js", "SKYTRACE_SMOKE_TEST", "packaged startup smoke-test exit path");

requireText("mac-native-renderer.js", "macCommandPalette", "Cmd+K command centre");
requireText("mac-native-renderer.js", "skytrace-local-replay", "local replay map layer");
requireText("mac-native-renderer.js", "SkyTrace local fallback", "degraded traffic fallback");
requireText("mac-native-renderer.js", "window.__skytraceMacFetchEarly", "first-request fetch wrapping");
if (read("mac-native-renderer.js").includes("observer.observe(document.documentElement")) {
  failures.push("mac-native-renderer.js: document-wide MutationObserver can self-trigger and starve startup");
}

requireText("mac-startup-guard.js", "health-auth-runtime-shell-ready", "full startup readiness contract");
requireText("mac-startup-guard.js", 'probeJson("/api/config", "auth")', "desktop API authorization startup probe");
requireText("mac-startup-guard.js", "runtimeLooksReady", "real renderer runtime startup probe");
requireText("mac-startup-guard.js", "hard-timeout-recovery", "absolute browser-only startup recovery");
requireText("mac-startup-guard.js", "window.skytraceNative || null", "optional native bridge");
if (read("mac-startup-guard.js").includes("MutationObserver")) {
  failures.push("mac-startup-guard.js: startup recovery must use bounded polling rather than a permanent DOM observer");
}

requireText("app.v3.js", "window.__SKYTRACE_MAP__=state.map=new maplibregl.Map(", "base MapLibre instance exposure");
requireText("mac-detached.js", "Orbit / hold estimate", "advanced aircraft analysis");
requireText("mac-detached.js", "Airport Desk", "Airport Desk");
requireText("mac-detached.js", "AbortSignal.timeout(12000)", "detached API timeout");
requireText("mac-detached.js", "if (loading || closed) return", "detached refresh overlap guard");
requireText("mac-detached.js", "scheduleNext", "serialized detached refresh scheduler");
requireText("mac-settings.js", "Settings service unavailable", "Settings IPC recovery state");
requireText("mac-settings.js", 'window.addEventListener("unhandledrejection"', "Settings rejection reporting");

const server = read("server.js");
requireText("server.js", "Content-Security-Policy", "CSP");
requireText("server.js", "desktopApiAuthorized", "desktop API authorization");
requireText("server.js", 'req.headers["x-skytrace-desktop"]', "desktop auth header acceptance");
requireText("server.js", "desktopTokenMatches(headerToken, expected) || desktopTokenMatches(cookieToken, expected)", "independent header/cookie auth fallback");
requireText("server.js", "!globalThis.__SKYTRACE_DESKTOP__ && rateLimited(req)", "desktop refresh rate-limit isolation");
requireText("server.js", 'path.resolve(__dirname, `.${rel}`)', "canonical static-path containment");
requireText("server.js", 'return json(res, 404, { ok: false, error: "Unknown SkyTrace API route." })', "JSON 404 for unknown API routes");
requireText("server.js", 'catch { res.statusCode = 400; return res.end("Bad request"); }', "malformed URL-path handling");
requireText("server.js", 'stream.on("error"', "static stream error handling");

const html = read("index.html");
requireText("index.html", "/mac-native-renderer.js", "Mac native renderer load");
requireText("index.html", '<script defer src="/mac-startup-guard.js"></script>', "early deferred Mac startup guard");
requireText("index.html", "data-skytrace-loader-failsafe", "inline hard splash fail-safe");
requireText("index.html", "/mac-native.css", "Mac native stylesheet load");

const csp = server.match(/setHeader\("Content-Security-Policy",\s*"([^"]+)"\)/)?.[1] || "";
if (!csp) {
  failures.push("server.js: could not parse generated Content-Security-Policy");
} else {
  const scriptDirective = csp.split(";").map(x => x.trim()).find(x => x.startsWith("script-src ")) || "";
  const styleDirective = csp.split(";").map(x => x.trim()).find(x => x.startsWith("style-src ")) || "";
  for (const origin of externalScriptOrigins(html)) {
    if (!scriptDirective.includes(origin)) failures.push(`server.js: CSP blocks packaged external script origin ${origin}`);
  }
  for (const origin of externalStyleOrigins(html)) {
    if (!styleDirective.includes(origin)) failures.push(`server.js: CSP blocks packaged external stylesheet origin ${origin}`);
  }
}

requireText("desktop-services.js", 'CURRENT_RELEASE_TAG = "v3.5.0"', "V3.5 update channel identity");
requireText("v3.4-polish.js", "health-and-shell-ready", "legacy startup health watchdog");
requireText("v3.4-polish.js", '.skytrace-startup[aria-hidden=\"true\"]', "legacy splash hide compatibility");
requireText("v3.4-polish.js", "loading.remove()", "legacy startup overlay removal fail-safe");
if (read("v3.4-polish.js").includes('document.querySelector(".loading, .loading-screen')) {
  failures.push("v3.4-polish.js: generic .loading selector can turn non-startup spinners into the full-screen launch overlay");
}

const forge = read("forge.config.cjs");
requireText("forge.config.cjs", '/^\\/src($|\\/)/', "canonical source exclusion from app.asar");
for (const paidSigningMarker of ["osxSign", "osxNotarize", "notarize", "APPLE_ID", "CSC_LINK"]) {
  if (forge.includes(paidSigningMarker)) failures.push(`forge.config.cjs unexpectedly contains signing/notarization marker: ${paidSigningMarker}`);
}

if (failures.length) {
  console.error("SkyTrace V3.5 verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Verified SkyTrace V3.5 Mac Native R3: no startup mutation storm, authenticated runtime boot, CSP dependency compatibility, guarded child windows, serialized replay, safe server routing, resilient detached/settings windows, map exposure and unsigned packaging invariants are present.");
