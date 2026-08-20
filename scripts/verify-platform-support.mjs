import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlay = path.join(root, "v3.3-overlay");
const desktopRoot = fs.existsSync(overlay) ? overlay : root;
const materialized = desktopRoot === root;

function read(file) { return fs.readFileSync(file, "utf8"); }
function requireFile(file, label = file) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing.`);
}
function requireText(file, needle, label = needle) {
  requireFile(file);
  if (!read(file).includes(needle)) throw new Error(`${path.relative(root, file)} is missing ${label}.`);
}
function requireAbsent(file, needle, label = needle) {
  requireFile(file);
  if (read(file).includes(needle)) throw new Error(`${path.relative(root, file)} contains forbidden ${label}.`);
}
function requireMissing(file, label = file) {
  if (fs.existsSync(file)) throw new Error(`${label} must not exist.`);
}

// Native Windows support remains part of the platform gate.
const pkgFile = path.join(desktopRoot, "package.json");
const forgeFile = path.join(desktopRoot, "forge.config.cjs");
const electronFile = path.join(desktopRoot, "electron-main.js");
const packageJson = JSON.parse(read(pkgFile));

if (packageJson?.devDependencies?.["@electron-forge/maker-squirrel"] !== "7.11.2") throw new Error("Windows Squirrel maker dependency is missing or unexpected.");
if (packageJson?.scripts?.check !== "node scripts/check-runtime.mjs") throw new Error("Desktop runtime checks are not cross-platform.");
if (!String(packageJson?.scripts?.["app:win"] || "").includes("--platform=win32")) throw new Error("Windows package script is missing.");
if (!String(packageJson?.scripts?.["make:win"] || "").includes("--platform=win32")) throw new Error("Windows make script is missing.");
requireText(forgeFile, 'name: "@electron-forge/maker-squirrel"', "Squirrel.Windows maker");
requireText(forgeFile, 'platforms: ["win32"]', "Windows maker platform");
requireText(forgeFile, 'setupExe: "SkyTraceSetup.exe"', "Windows Setup.exe name");
requireText(forgeFile, 'icon: iconBase', "cross-platform packager icon");
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

// iPhone/iPad PWA 34.8: one renderer, one mobile layout, no dot-renderer race.
const web = path.join(root, "commerce", "web");
const manifest = path.join(web, "manifest.webmanifest");
const sw = path.join(web, "sw.js");
const mobileCss = path.join(web, "web-mobile.css");
const retiredInteractionsCss = path.join(web, "web-mobile-interactions.css");
const retiredAircraftJs = path.join(web, "web-ios-aircraft.js");
const webIndex = path.join(web, "index.html");
const webJs = path.join(web, "web.js");
const mobileJs = path.join(web, "web-mobile.js");
const iconSvg = path.join(web, "icon.svg");
const touchIconBase64 = path.join(web, "apple-touch-icon.png.b64");
const pwaHook = path.join(root, "commerce", "pwa-hook.js");
const commercePkgFile = path.join(root, "commerce", "package.json");
const airlines = path.join(root, "airlines.v2.2.js");
const redeemHook = path.join(root, "commerce", "redeem-hook.js");

requireText(manifest, '"display": "standalone"', "standalone web-app display mode");
requireText(manifest, '"start_url": "/app/"', "PWA start URL");
requireText(webIndex, "viewport-fit=cover", "iOS edge-to-edge viewport");
requireText(webIndex, 'meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"', "iOS translucent status bar");
requireText(webIndex, 'meta name="skytrace-web-build" content="34.8"', "PWA 34.8 identity");
requireText(webIndex, '/app/web-mobile.css?v=34.8', "versioned mobile stylesheet");
requireText(webIndex, '/app/airlines.js?v=34.8', "shared airline/livery palette");
requireText(webIndex, '/app/web.js?v=34.8', "unified aircraft/live runtime");
requireText(webIndex, '/app/web-mobile.js?v=34.8', "versioned mobile controller");
requireAbsent(webIndex, "web-ios-aircraft.js", "duplicate aircraft runtime");
requireAbsent(webIndex, "web-mobile-interactions.css", "retired competing iOS stylesheet");
requireText(webIndex, 'id="sheetHandle"', "iPhone bottom-sheet handle");
requireMissing(retiredInteractionsCss, "retired iOS interaction stylesheet");
requireMissing(retiredAircraftJs, "retired duplicate iOS aircraft renderer");

requireText(mobileCss, "--skytrace-screen-h:100vh", "physical/layout screen height fallback");
requireText(mobileCss, "height:max(100vh,var(--skytrace-screen-h))!important", "full iOS map coverage");
requireText(mobileCss, "--skytrace-map-fallback:#9eb8ee", "non-black WebKit repaint fallback");
requireText(mobileCss, "env(safe-area-inset-bottom,0px)", "iOS safe-area control positioning");
requireText(mobileCss, ".panel.sheet-collapsed", "collapsible iPhone bottom sheet");
requireText(mobileCss, "Swipe up or tap for controls", "collapsed-sheet recovery cue");
requireText(mobileCss, ".flight-livery", "livery-aware traffic rows");
requireText(mobileCss, ".aircraft-detail", "mobile aircraft detail UI");
requireText(mobileCss, "html.ios-keyboard-open .panel", "keyboard-only control resizing");
requireAbsent(mobileCss, "#map{height:var(--skytrace-vvh", "VisualViewport-sized map");

requireText(mobileJs, "root.classList.add('skytrace-mobile-34-8')", "iOS 34.8 runtime identity");
requireText(mobileJs, "function physicalScreenHeight", "physical screen coverage bridge");
requireText(mobileJs, "--skytrace-screen-h", "screen height CSS bridge");
requireText(mobileJs, "window.visualViewport", "keyboard-only VisualViewport handling");
requireText(mobileJs, "window.skytraceMobileSheet", "mobile sheet API");
requireText(mobileJs, "ResizeObserver", "measured bottom-sheet height");
requireText(mobileJs, "dragDistance > 58", "downward collapse gesture");
requireText(mobileJs, "dragDistance < -30", "upward expand gesture");
requireText(mobileJs, "window.skytraceResizeMap", "orientation resize bridge");

requireText(airlines, "window.skytraceAirlineFor", "desktop airline identity engine");
requireText(airlines, "British Airways", "desktop livery palette data");
requireText(airlines, "Ryanair", "desktop livery palette data");
requireText(airlines, "Emirates", "desktop livery palette data");

requireText(webJs, "window.skytraceAirlineFor", "shared airline palette use in core renderer");
requireText(webJs, "function aircraftKind", "aircraft silhouette classifier");
requireText(webJs, "function createAircraftImage", "livery aircraft image renderer");
requireText(webJs, "id: 'aircraft-icons'", "aircraft symbol layer");
requireText(webJs, "type: 'symbol'", "plane-symbol rendering");
requireText(webJs, "'icon-rotate': ['get', 'heading']", "heading-aware aircraft symbols");
requireText(webJs, "id: 'aircraft-hit'", "large aircraft touch-target layer");
requireText(webJs, "function nearestFlight", "manual touch hit-testing");
requireText(webJs, "coarsePointer ? 40 : 24", "enlarged iPhone aircraft hit radius");
requireText(webJs, "async function selectFlight", "tap-to-open aircraft details");
requireText(webJs, "function detailMarkup", "basic aircraft details for every signed-in user");
requireText(webJs, "/v1/v34/aircraft-profile", "Advanced Aircraft enrichment");
requireText(webJs, "/v1/v34/aircraft-note", "private aircraft note support");
requireText(webJs, "function removeLegacyAircraftLayer", "legacy dot cleanup");
requireText(webJs, "map.removeLayer('aircraft')", "legacy dot layer removal");
requireText(webJs, "let refreshPromise = null", "single in-flight live traffic request");
requireText(webJs, "map.on('dragend'", "user-pan traffic refresh");
requireText(webJs, "map.on('zoomend'", "user-zoom traffic refresh");
requireAbsent(webJs, "id: 'aircraft', type: 'circle'", "dot-only aircraft renderer");
requireAbsent(webJs, "map.on('moveend'", "resize-triggered refresh loop");

requireText(pwaHook, 'url.pathname === "/app/airlines.js"', "PWA airline palette route");
requireText(pwaHook, "AIRLINES_FILE", "fixed root airline asset path");
requireText(pwaHook, 'url.pathname === "/app/web-mobile.js"', "iOS controller route");
requireAbsent(pwaHook, "web-ios-aircraft.js", "retired aircraft route");
requireAbsent(pwaHook, "web-mobile-interactions.css", "retired stylesheet route");
requireText(redeemHook, 'import "./pwa-hook.js";', "PWA preload");

const commercePackage = JSON.parse(read(commercePkgFile));
const commerceCheck = String(commercePackage?.scripts?.check || "");
if (!commerceCheck.includes("../airlines.v2.2.js")) throw new Error("Commerce check must syntax-check the shared airline palette.");
if (!commerceCheck.includes("web/web.js")) throw new Error("Commerce check must syntax-check the unified web renderer.");
if (commerceCheck.includes("web-ios-aircraft.js")) throw new Error("Commerce check still references the retired aircraft runtime.");

requireText(sw, 'const CACHE = "skytrace-web-v34-8"', "PWA 34.8 cache");
requireText(sw, '"/app/airlines.js?v=34.8"', "cached airline palette");
requireText(sw, '"/app/web-mobile.css?v=34.8"', "cached unified mobile stylesheet");
requireText(sw, '"/app/web.js?v=34.8"', "cached unified live/aircraft runtime");
requireText(sw, '"/app/web-mobile.js?v=34.8"', "cached mobile controller");
requireAbsent(sw, "web-ios-aircraft.js", "retired aircraft cache entry");
requireText(sw, 'if (!url.pathname.startsWith("/app")) return;', "app-shell-only service worker boundary");
requireAbsent(sw, "/v1/", "API caching route");

requireFile(touchIconBase64, "Apple touch icon base64 source");
const touchPng = Buffer.from(read(touchIconBase64).replace(/\s+/g, ""), "base64");
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
if (touchPng.length < 33 || !touchPng.subarray(0,8).equals(pngSignature)) throw new Error("Apple touch icon is not a valid PNG.");
const touchWidth = touchPng.readUInt32BE(16);
const touchHeight = touchPng.readUInt32BE(20);
const touchColorType = touchPng[25];
if (touchWidth !== 180 || touchHeight !== 180) throw new Error(`Apple touch icon must be 180x180, found ${touchWidth}x${touchHeight}.`);
if (touchColorType === 4 || touchColorType === 6) throw new Error("Apple touch icon must be full-bleed without an alpha channel.");
requireText(iconSvg, '<rect width="512" height="512" fill="#101114"/>', "full-bleed PWA icon");

console.log(`SkyTrace platform support verified: Windows x64 desktop + iPhone/iPad PWA 34.8 with one livery aircraft renderer, touch selection, details and full-screen viewport coverage${materialized ? " (materialized build)" : " (source tree)"}.`);
