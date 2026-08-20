import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(sourceRoot, "..");
const root = path.resolve(process.argv[2] || repoRoot);

function copy(from, to) {
  const source = path.join(sourceRoot, from);
  const target = path.join(root, to);
  if (!fs.existsSync(source)) throw new Error(`Missing V3.5 source file: ${from}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(path.join(root, rel), text); }
function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Could not apply V3.5 patch: ${label}`);
  return text.replace(before, after);
}

function externalOrigins(html, tag, attribute) {
  const out = new Set();
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    const value = String(match[1] || "").trim();
    if (!/^https?:\/\//i.test(value)) continue;
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error(`V3.5 packaged frontend contains insecure external ${tag} dependency: ${value}`);
    out.add(url.origin);
  }
  return [...out].sort();
}

for (const [from, to] of [
  ["desktop/mac-native-main.js", "mac-native-main.js"],
  ["desktop/mac-native-preload.cjs", "mac-native-preload.cjs"],
  ["desktop/mac-startup-runtime.js", "mac-startup-runtime.js"],
  ["renderer/mac-native-renderer.js", "mac-native-renderer.js"],
  ["renderer/mac-native.css", "mac-native.css"],
  ["renderer/mac-startup-guard.js", "mac-startup-guard.js"],
  ["renderer/settings/mac-settings.html", "mac-settings.html"],
  ["renderer/settings/mac-settings.css", "mac-settings.css"],
  ["renderer/settings/mac-settings.js", "mac-settings.js"],
  ["renderer/detached/mac-detached.html", "mac-detached.html"],
  ["renderer/detached/mac-detached.css", "mac-detached.css"],
  ["renderer/detached/mac-detached.js", "mac-detached.js"]
]) copy(from, to);

// Read the fully materialized base document before applying V3.5. The release
// CSP is generated from packaged external script/style dependencies so a
// security header can never silently block a dependency needed to boot.
let html = read("index.html");
const scriptOrigins = externalOrigins(html, "script", "src");
const styleOrigins = externalOrigins(html, "link", "href");
const scriptSource = ["'self'", "'unsafe-inline'", ...scriptOrigins].join(" ");
const styleSource = ["'self'", "'unsafe-inline'", ...styleOrigins].join(" ");
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSource}`,
  `style-src ${styleSource}`,
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "font-src 'self' data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join("; ");

let electron = read("electron-main.js");
const electronImport = 'import { app, BrowserWindow, Menu, shell, dialog, nativeImage } from "electron";';
if (!electron.includes('from "./mac-native-main.js"')) {
  electron = replaceRequired(
    electron,
    electronImport,
    `${electronImport}\nimport { session } from "electron";\nimport crypto from "node:crypto";\nimport { installMacNativeMain, macNativePreloadPath, openMacSettings } from "./mac-native-main.js";\nimport { installMacStartupRuntime } from "./mac-startup-runtime.js";`,
    "native imports"
  );
}

const webSecurityMarker = "      webSecurity: true\n";
if (!electron.includes("preload: macNativePreloadPath")) {
  electron = replaceRequired(electron, webSecurityMarker, `      webSecurity: true,\n      preload: macNativePreloadPath\n`, "sandboxed preload");
}

const settingsMenuOld = `    {\n      label: "Open config.json",\n      accelerator: "CmdOrCtrl+,",\n      click: () => void shell.openPath(configPath)\n    },`;
if (!electron.includes('label: "Settings…"')) {
  electron = replaceRequired(electron, settingsMenuOld, `    {\n      label: "Settings…",\n      accelerator: "CmdOrCtrl+,",\n      click: () => void openMacSettings()\n    },\n    {\n      label: "Open config.json",\n      click: () => void shell.openPath(configPath)\n    },`, "native Settings menu");
}

const desktopGlobalMarker = "  globalThis.__SKYTRACE_DESKTOP__ = true;";
if (!electron.includes("__SKYTRACE_DESKTOP_TOKEN__")) {
  electron = replaceRequired(electron, desktopGlobalMarker, `${desktopGlobalMarker}\n  const desktopToken = crypto.randomBytes(32).toString("hex");\n  globalThis.__SKYTRACE_DESKTOP_TOKEN__ = desktopToken;`, "ephemeral desktop API token");
}

const serverStartMarker = `  skyTraceServer = await startSkyTraceServer({\n    port: 0,\n    host: "127.0.0.1",\n    quiet: true\n  });`;
if (!electron.includes("X-SkyTrace-Desktop")) {
  electron = replaceRequired(electron, serverStartMarker, `${serverStartMarker}\n\n  // Two independent transports carry the per-launch desktop token. The HttpOnly\n  // cookie is the normal path; the Electron network-layer header is a second\n  // path if Chromium cookie state is unavailable. Renderer JS never sees the\n  // token itself.\n  await session.defaultSession.cookies.set({\n    url: skyTraceServer.url,\n    name: "skytrace_desktop",\n    value: desktopToken,\n    httpOnly: true,\n    sameSite: "strict",\n    secure: false,\n    path: "/"\n  });\n  const desktopOrigin = new URL(skyTraceServer.url).origin;\n  session.defaultSession.webRequest.onBeforeSendHeaders(\n    { urls: [\`${'${desktopOrigin}'}/api/*\`] },\n    (details, callback) => {\n      const requestHeaders = { ...(details.requestHeaders || {}), "X-SkyTrace-Desktop": desktopToken };\n      callback({ cancel: false, requestHeaders });\n    }\n  );`, "desktop API auth transports");
}

const buildMenuMarker = "  buildMenu(configPath);\n  await createWindow(skyTraceServer.url);";
if (!electron.includes("installMacNativeMain({")) {
  electron = replaceRequired(electron, buildMenuMarker, `  buildMenu(configPath);\n  installMacNativeMain({\n    getMainWindow: () => mainWindow,\n    getServerUrl: () => skyTraceServer?.url || "",\n    configPath,\n    diagnosticLogPath: desktopLogPath()\n  });\n  installMacStartupRuntime({\n    getMainWindow: () => mainWindow,\n    diagnosticLogPath: desktopLogPath()\n  });\n  await createWindow(skyTraceServer.url);`, "Mac native main services");
}
write("electron-main.js", electron);

let server = read("server.js");
const headerMarker = '  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");';
if (!server.includes("Content-Security-Policy")) {
  server = replaceRequired(
    server,
    headerMarker,
    `${headerMarker}\n  res.setHeader("Content-Security-Policy", ${JSON.stringify(contentSecurityPolicy)});`,
    "Content Security Policy"
  );
}

const apiMarker = "async function api(req, res, url) {\n  const p = url.searchParams;";
if (!server.includes("desktopApiAuthorized")) {
  const helper = `function desktopTokenMatches(actual, expected) {\n  actual = String(actual || "");\n  expected = String(expected || "");\n  if (!expected || actual.length !== expected.length) return false;\n  let different = 0;\n  for (let index = 0; index < expected.length; index++) different |= expected.charCodeAt(index) ^ actual.charCodeAt(index);\n  return different === 0;\n}\n\nfunction desktopApiAuthorized(req) {\n  const expected = String(globalThis.__SKYTRACE_DESKTOP_TOKEN__ || "");\n  if (!expected) return true;\n  const headerToken = String(req.headers["x-skytrace-desktop"] || "");\n  const cookies = String(req.headers.cookie || "").split(";").map(value => value.trim());\n  const pair = cookies.find(value => value.startsWith("skytrace_desktop="));\n  let cookieToken = "";\n  if (pair) {\n    try { cookieToken = decodeURIComponent(pair.slice("skytrace_desktop=".length)); } catch { cookieToken = ""; }\n  }\n  return desktopTokenMatches(headerToken, expected) || desktopTokenMatches(cookieToken, expected);\n}\n\n`;
  server = replaceRequired(server, apiMarker, `${helper}async function api(req, res, url) {\n  if (!desktopApiAuthorized(req)) return json(res, 401, { ok: false, error: "SkyTrace desktop API authorization required." });\n  const p = url.searchParams;`, "desktop API authorization");
}
write("server.js", server);

// The V3.5 renderer originally reintroduced a document-wide MutationObserver.
// renderMacPanel() mutates text nodes, so that observer could retrigger itself
// indefinitely and starve startup timers/network callbacks. Replace it with a
// bounded readiness poll and install the fetch wrapper before DOMContentLoaded
// so the first flight request is covered as well.
let macRenderer = read("mac-native-renderer.js");
if (!macRenderer.includes("window.__skytraceMacFetchEarly")) {
  macRenderer = replaceRequired(
    macRenderer,
    "  function resolveMap() {",
    "  patchFetch();\n  window.__skytraceMacFetchEarly = true;\n\n  function resolveMap() {",
    "early Mac fetch wrapper"
  );
}
const observerBlock = `    ensureMacPanel();\n    const observer = new MutationObserver(() => ensureMacPanel());\n    observer.observe(document.documentElement, { childList: true, subtree: true });`;
if (macRenderer.includes(observerBlock)) {
  macRenderer = macRenderer.replace(observerBlock, `    ensureMacPanel();\n    let panelAttempts = 0;\n    const panelTimer = setInterval(() => {\n      panelAttempts += 1;\n      if ($("macNativeView") || panelAttempts >= 40) { clearInterval(panelTimer); return; }\n      ensureMacPanel();\n    }, 250);`);
}
if (macRenderer.includes("observer.observe(document.documentElement")) {
  throw new Error("V3.5 Mac renderer still contains a document-wide MutationObserver after startup-loop repair.");
}
write("mac-native-renderer.js", macRenderer);

if (!html.includes('/mac-native.css')) {
  html = replaceRequired(html, "</head>", '  <link rel="stylesheet" href="/mac-native.css">\n</head>', "Mac native stylesheet");
}
if (!html.includes('/mac-startup-guard.js')) {
  const earlyStartupGuard = `  <script defer src="/mac-startup-guard.js"></script>\n  <script>\n    window.setTimeout(function () {\n      var nodes = document.querySelectorAll('#loading,.loading-screen,.startup-screen,.skytrace-startup,[data-loading="true"]');\n      for (var i = 0; i < nodes.length; i++) {\n        try {\n          nodes[i].hidden = true;\n          nodes[i].setAttribute('aria-hidden', 'true');\n          nodes[i].setAttribute('data-loading', 'false');\n          nodes[i].style.setProperty('display', 'none', 'important');\n          nodes[i].style.setProperty('visibility', 'hidden', 'important');\n          nodes[i].style.setProperty('pointer-events', 'none', 'important');\n          nodes[i].remove();\n        } catch (_) {}\n      }\n      document.documentElement.setAttribute('data-skytrace-loader-failsafe', 'complete');\n    }, 18000);\n  </script>\n`;
  html = replaceRequired(html, "</head>", `${earlyStartupGuard}</head>`, "early browser-only startup guard");
}
if (!html.includes('/mac-native-renderer.js')) {
  html = replaceRequired(html, "</body>", '  <script src="/mac-native-renderer.js"></script>\n</body>', "Mac native renderer");
}
html = html.split("3.4.0-rc1").join("3.5.0").split("V3.4.0 RC1").join("V3.5.0 DEV");
write("index.html", html);

for (const rel of ["server.js", "v3.3-commerce.js", "v3.4-polish.js"]) {
  if (!fs.existsSync(path.join(root, rel))) continue;
  let text = read(rel).split("3.4.0-rc1").join("3.5.0").split("V3.4.0 RC1").join("V3.5.0 DEV");
  if (rel === "v3.4-polish.js") {
    text = text.replace('document.querySelector(".loading, .loading-screen, .startup-screen, [data-loading]")', 'document.querySelector(".loading-screen, .startup-screen, [data-loading]")');
  }
  write(rel, text);
}

if (fs.existsSync(path.join(root, "desktop-services.js"))) {
  let services = read("desktop-services.js");
  services = services.replace('const CURRENT_RELEASE_TAG = "v3.4.0-rc1";', 'const CURRENT_RELEASE_TAG = "v3.5.0";');
  services = services.replace('const CURRENT_RELEASE_LABEL = "SkyTrace V3.4.0 RC1";', 'const CURRENT_RELEASE_LABEL = "SkyTrace V3.5.0 Dev";');
  write("desktop-services.js", services);
}

const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = "3.5.0";
pkg.description = "SkyTrace V3.5 Mac Native aviation intelligence with menu-bar tools, native alerts, private local replay, Airport Desk, offline fallback and detached analysis windows.";
pkg.scripts = pkg.scripts || {};
pkg.scripts.check = `${pkg.scripts.check || "node scripts/check-runtime.mjs"} && node --check mac-native-main.js && node --check mac-native-preload.cjs && node --check mac-startup-runtime.js && node --check mac-native-renderer.js && node --check mac-startup-guard.js && node --check mac-settings.js && node --check mac-detached.js`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const changelog = path.join(root, "CHANGELOG.md");
if (fs.existsSync(changelog)) {
  const old = fs.readFileSync(changelog, "utf8");
  if (!old.includes("## 3.5.0 Dev")) {
    fs.writeFileSync(changelog, `# SkyTrace Changelog\n\n## 3.5.0 Dev — Mac Native\n\n- Added native macOS menu-bar status and quick actions.\n- Added Notification Center aircraft alerts with click-through search.\n- Added proper SkyTrace Settings window and Launch at Login.\n- Added Command Centre (Cmd+K) and Cmd+1/2/3/4 workspace shortcuts.\n- Added private on-device Local Replay with retention and disk limits.\n- Added detachable aircraft analysis and full Airport Desk windows.\n- Added High Accuracy, Balanced and Battery Saver performance profiles.\n- Added cached/degraded traffic fallback and bundled-reference offline resilience.\n- Added redundant per-launch desktop API authorization using an HttpOnly cookie plus Electron network-layer header.\n- Added a packaged-renderer startup handshake, browser-only recovery guard and hard splash fail-safe.\n- Removed the V3.5 document-wide mutation loop that could starve renderer startup.\n- V3.5 remains unsigned/not notarized and uses verified manual GitHub release installs instead of paid Apple signing.\n\n${old.replace(/^# SkyTrace Changelog\s*/, "")}`);
  }
}

console.log(`Applied SkyTrace V3.5 Mac Native runtime, startup-loop repair, redundant desktop auth, CSP dependency allowlist and native integration (${scriptOrigins.length} external script origin(s), ${styleOrigins.length} external style origin(s)).`);
