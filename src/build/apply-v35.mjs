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
  electron = replaceRequired(electron, serverStartMarker, `${serverStartMarker}\n\n  // Two independent transports carry the per-launch desktop token. The HttpOnly\n  // cookie is the normal path; the Electron network-layer header prevents a bad\n  // cookie store from trapping the renderer on the startup screen. Renderer JS\n  // never receives the token itself.\n  await session.defaultSession.cookies.set({\n    url: skyTraceServer.url,\n    name: "skytrace_desktop",\n    value: desktopToken,\n    httpOnly: true,\n    sameSite: "strict",\n    secure: false,\n    path: "/"\n  });\n  const desktopOrigin = new URL(skyTraceServer.url).origin;\n  session.defaultSession.webRequest.onBeforeSendHeaders(\n    { urls: [\`${'${desktopOrigin}'}/*\`] },\n    (details, callback) => {\n      const requestHeaders = { ...(details.requestHeaders || {}), "X-SkyTrace-Desktop": desktopToken };\n      callback({ cancel: false, requestHeaders });\n    }\n  );`, "desktop API auth transports");
}

const buildMenuMarker = "  buildMenu(configPath);\n  await createWindow(skyTraceServer.url);";
if (!electron.includes("installMacNativeMain({")) {
  electron = replaceRequired(electron, buildMenuMarker, `  buildMenu(configPath);\n  installMacNativeMain({\n    getMainWindow: () => mainWindow,\n    getServerUrl: () => skyTraceServer?.url || "",\n    configPath,\n    diagnosticLogPath: desktopLogPath()\n  });\n  installMacStartupRuntime({\n    getMainWindow: () => mainWindow,\n    diagnosticLogPath: desktopLogPath()\n  });\n  await createWindow(skyTraceServer.url);`, "Mac native main services");
}
write("electron-main.js", electron);

let server = read("server.js");
const headerMarker = '  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");';
if (!server.includes("Content-Security-Policy")) {
  server = replaceRequired(server, headerMarker, `${headerMarker}\n  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");`, "Content Security Policy");
}

const apiMarker = "async function api(req, res, url) {\n  const p = url.searchParams;";
if (!server.includes("desktopApiAuthorized")) {
  const helper = `function desktopApiAuthorized(req) {\n  const expected = String(globalThis.__SKYTRACE_DESKTOP_TOKEN__ || "");\n  if (!expected) return true;\n  const headerToken = String(req.headers["x-skytrace-desktop"] || "");\n  const cookies = String(req.headers.cookie || "").split(";").map(value => value.trim());\n  const pair = cookies.find(value => value.startsWith("skytrace_desktop="));\n  const cookieToken = pair ? decodeURIComponent(pair.slice("skytrace_desktop=".length)) : "";\n  const actual = headerToken || cookieToken;\n  if (actual.length !== expected.length) return false;\n  let different = 0;\n  for (let index = 0; index < expected.length; index++) different |= expected.charCodeAt(index) ^ actual.charCodeAt(index);\n  return different === 0;\n}\n\n`;
  server = replaceRequired(server, apiMarker, `${helper}async function api(req, res, url) {\n  if (!desktopApiAuthorized(req)) return json(res, 401, { ok: false, error: "SkyTrace desktop API authorization required." });\n  const p = url.searchParams;`, "desktop API authorization");
}
write("server.js", server);

let html = read("index.html");
if (!html.includes('/mac-native.css')) html = replaceRequired(html, "</head>", '  <link rel="stylesheet" href="/mac-native.css">\n</head>', "Mac native stylesheet");
if (!html.includes('/mac-native-renderer.js')) html = replaceRequired(html, "</body>", '  <script src="/mac-native-renderer.js"></script>\n</body>', "Mac native renderer");
if (!html.includes('/mac-startup-guard.js')) html = replaceRequired(html, "</body>", '  <script src="/mac-startup-guard.js"></script>\n</body>', "Mac startup guard");
html = html.split("3.4.0-rc1").join("3.5.0").split("V3.4.0 RC1").join("V3.5.0 DEV");
write("index.html", html);

for (const rel of ["server.js", "v3.3-commerce.js", "v3.4-polish.js"]) {
  if (!fs.existsSync(path.join(root, rel))) continue;
  const text = read(rel).split("3.4.0-rc1").join("3.5.0").split("V3.4.0 RC1").join("V3.5.0 DEV");
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
    fs.writeFileSync(changelog, `# SkyTrace Changelog\n\n## 3.5.0 Dev — Mac Native\n\n- Added native macOS menu-bar status and quick actions.\n- Added Notification Center aircraft alerts with click-through search.\n- Added proper SkyTrace Settings window and Launch at Login.\n- Added Command Centre (Cmd+K) and Cmd+1/2/3/4 workspace shortcuts.\n- Added private on-device Local Replay with retention and disk limits.\n- Added detachable aircraft analysis and full Airport Desk windows.\n- Added High Accuracy, Balanced and Battery Saver performance profiles.\n- Added cached/degraded traffic fallback and bundled-reference offline resilience.\n- Added redundant per-launch desktop API authorization using an HttpOnly cookie plus Electron network-layer header.\n- Added a packaged-renderer startup handshake, recovery guard and startup diagnostics.\n- V3.5 remains unsigned/not notarized and uses verified manual GitHub release installs instead of paid Apple signing.\n\n${old.replace(/^# SkyTrace Changelog\s*/, "")}`);
  }
}

console.log("Applied SkyTrace V3.5 Mac Native runtime, redundant desktop auth, startup recovery, local replay and desktop integration.");
