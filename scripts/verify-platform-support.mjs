import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const overlay = path.join(root, "v3.3-overlay");
const desktopRoot = fs.existsSync(overlay) ? overlay : root;
const materialized = desktopRoot === root;

function read(file) { return fs.readFileSync(file, "utf8"); }
function requireFile(file, label = file) { if (!fs.existsSync(file)) throw new Error(`${label} is missing.`); }
function requireText(file, needle, label = needle) {
  requireFile(file);
  if (!read(file).includes(needle)) throw new Error(`${path.relative(root, file)} is missing ${label}.`);
}
function requireAbsent(file, needle, label = needle) {
  requireFile(file);
  if (read(file).includes(needle)) throw new Error(`${path.relative(root, file)} contains forbidden ${label}.`);
}

const pkgFile = path.join(desktopRoot, "package.json");
const forgeFile = path.join(desktopRoot, "forge.config.cjs");
const electronFile = path.join(desktopRoot, "electron-main.js");
const packageJson = JSON.parse(read(pkgFile));

if (packageJson?.devDependencies?.["@electron-forge/maker-squirrel"] !== "7.11.2") throw new Error("Windows Squirrel maker dependency is missing or unexpected.");
if (packageJson?.scripts?.check !== "node scripts/check-runtime.mjs") throw new Error("Runtime checks are not cross-platform.");
if (!String(packageJson?.scripts?.["app:win"] || "").includes("--platform=win32")) throw new Error("Windows package script is missing.");
if (!String(packageJson?.scripts?.["make:win"] || "").includes("--platform=win32")) throw new Error("Windows make script is missing.");
requireText(forgeFile, 'name: "@electron-forge/maker-squirrel"', "Squirrel.Windows maker");
requireText(forgeFile, 'platforms: ["win32"]', "Windows maker platform");
requireText(forgeFile, 'setupExe: "SkyTraceSetup.exe"', "Windows Setup.exe name");
requireText(forgeFile, 'icon: iconBase', "extensionless cross-platform packager icon");
requireText(electronFile, 'app.setAppUserModelId("io.skytrace.desktop")', "Windows AppUserModelID");
requireText(electronFile, "if (isMac)", "macOS-only titlebar options");
requireText(electronFile, "icon: !isMac", "Windows/Linux BrowserWindow icon");

const checker = path.join(desktopRoot, "scripts", "check-runtime.mjs");
const icoGenerator = path.join(desktopRoot, "scripts", "generate-skytrace-ico.mjs");
requireFile(checker, "cross-platform runtime checker");
requireText(icoGenerator, "SIZES = [16, 24, 32, 48, 64, 128, 256]", "multi-size Windows icon generator");
if (materialized) {
  const ico = path.join(root, "assets", "SkyTrace.ico");
  requireFile(ico, "materialized Windows icon");
  if (fs.statSync(ico).size < 1024) throw new Error("Materialized Windows icon is unexpectedly small.");
}

const web = path.join(root, "commerce", "web");
const manifest = path.join(web, "manifest.webmanifest");
const sw = path.join(web, "sw.js");
const mobileCss = path.join(web, "web-mobile.css");
const webIndex = path.join(web, "index.html");
const pwaHook = path.join(root, "commerce", "pwa-hook.js");
const redeemHook = path.join(root, "commerce", "redeem-hook.js");

requireText(manifest, '"display": "standalone"', "standalone web-app display mode");
requireText(manifest, '"start_url": "/app/"', "PWA start URL");
requireText(webIndex, 'rel="manifest" href="/app/manifest.webmanifest"', "web app manifest link");
requireText(webIndex, 'rel="apple-touch-icon"', "Apple Home Screen icon");
requireText(webIndex, "viewport-fit=cover", "iOS safe-area viewport");
requireText(webIndex, "/app/web-mobile.css?v=34.2", "mobile override stylesheet");
requireText(mobileCss, "env(safe-area-inset-bottom)", "iOS bottom safe area");
requireText(mobileCss, "min-height:44px", "touch target sizing");
requireText(sw, 'const CACHE = "skytrace-web-v34-2"', "versioned PWA cache");
requireText(sw, 'if (!url.pathname.startsWith("/app")) return;', "app-shell-only cache boundary");
requireAbsent(sw, "/v1/", "API caching route");
requireText(pwaHook, 'url.pathname === "/app/sw.js"', "service worker route");
requireText(pwaHook, 'url.pathname === "/app/apple-touch-icon.png"', "Apple touch icon route");
requireText(redeemHook, 'import "./pwa-hook.js";', "PWA preload");

console.log(`SkyTrace platform support verified: Windows x64 desktop + iPhone/iPad PWA${materialized ? " (materialized build)" : " (source tree)"}.`);
