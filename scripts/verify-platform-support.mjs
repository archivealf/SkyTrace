import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const mobileInteractionsCss = path.join(web, "web-mobile-interactions.css");
const webIndex = path.join(web, "index.html");
const webJs = path.join(web, "web.js");
const mobileJs = path.join(web, "web-mobile.js");
const iconSvg = path.join(web, "icon.svg");
const touchIconBase64 = path.join(web, "apple-touch-icon.png.b64");
const pwaHook = path.join(root, "commerce", "pwa-hook.js");
const redeemHook = path.join(root, "commerce", "redeem-hook.js");

requireText(manifest, '"display": "standalone"', "standalone web-app display mode");
requireText(manifest, '"start_url": "/app/"', "PWA start URL");
requireText(webIndex, 'rel="manifest" href="/app/manifest.webmanifest"', "web app manifest link");
requireText(webIndex, 'rel="apple-touch-icon"', "Apple Home Screen icon");
requireText(webIndex, "viewport-fit=cover", "iOS safe-area viewport");
requireText(webIndex, "/app/web-mobile.css?v=34.6", "versioned mobile proportion stylesheet");
requireText(webIndex, "/app/web-mobile-interactions.css?v=34.6", "versioned iPhone interaction stylesheet");
requireText(webIndex, "/app/web.js?v=34.6", "versioned live traffic runtime");
requireText(webIndex, "/app/web-mobile.js?v=34.6", "versioned iPhone interaction runtime");
requireText(webIndex, 'id="sheetHandle"', "iPhone minimise handle");
requireText(webIndex, 'meta name="color-scheme" content="dark"', "iOS dark color scheme metadata");
requireText(mobileCss, "--skytrace-vvh:100dvh", "visual viewport height fallback");
requireText(mobileCss, "env(safe-area-inset-bottom,0px)", "iOS bottom safe area");
requireText(mobileCss, "height:clamp(430px,62dvh,640px)", "balanced iPhone portrait sheet");
requireText(mobileCss, "width:clamp(380px,38vw,460px)", "purpose-built iPad panel proportions");
requireText(mobileCss, "grid-template-columns:repeat(4,minmax(0,1fr))", "landscape/iPad toolbar proportions");
requireText(mobileCss, "html.ios-ipad.ios-keyboard-open .panel", "iPad keyboard viewport handling");
requireText(mobileCss, "html.ios-keyboard-open .panel", "iPhone keyboard viewport handling");
requireText(mobileCss, "bottom:calc(var(--skytrace-panel-height) + max(8px,var(--skytrace-safe-bottom)) + 8px)", "measured phone-sheet map offset");
requireText(mobileInteractionsCss, ".panel.sheet-collapsed", "collapsed iPhone sheet state");
requireText(mobileInteractionsCss, "touch-action:none", "gesture-owned sheet handle");
requireText(mobileInteractionsCss, "--skytrace-sheet-drag", "live sheet drag transform");
requireText(mobileInteractionsCss, "html.ios-device #map", "iOS full-viewport map guard");
requireText(mobileInteractionsCss, "bottom:calc(0px - env(safe-area-inset-bottom,0px))", "map overdraw under iPhone home indicator");
requireText(mobileInteractionsCss, 'content:"Swipe up or tap to show controls"', "collapsed-sheet recovery cue");
requireText(webJs, "window.visualViewport", "iOS visual viewport runtime");
requireText(webJs, "let panelResizeObserver = null", "persistent panel ResizeObserver reference");
requireText(webJs, "restingViewportHeight", "stable pre-keyboard viewport baseline");
requireText(webJs, "ResizeObserver", "measured panel proportions");
requireText(webJs, 'root.classList.toggle("signed-in", inward)', "login/signed-in layout state");
requireText(webJs, 'root.classList.toggle("ios-keyboard-open", keyboardOpen)', "keyboard visibility state");
requireText(webJs, 'root.style.setProperty("--skytrace-panel-height"', "panel height CSS bridge");
requireText(webJs, "let refreshPromise = null", "single in-flight live traffic request");
requireText(webJs, 'map.on("dragend"', "user-pan live traffic refresh");
requireText(webJs, 'map.on("zoomend"', "user-zoom live traffic refresh");
requireText(webJs, "if (!map.isStyleLoaded()) return", "map-ready aircraft rendering guard");
requireAbsent(webJs, 'map.on("moveend"', "resize-triggered live traffic refresh loop");
requireText(mobileJs, "function setCollapsed", "interactive collapse controller");
requireText(mobileJs, "dragDistance > 54", "downward collapse threshold");
requireText(mobileJs, "dragDistance < -30", "upward expand threshold");
requireText(mobileJs, 'panel.addEventListener("click"', "whole-card collapsed-sheet recovery");
requireText(mobileJs, 'root.classList.add("skytrace-mobile-34-6")', "current iPhone shell marker");
requireText(mobileJs, 'productLabel.textContent = "SKYTRACE iPHONE · V3.4"', "visible iPhone mobile identity");
requireText(mobileJs, "registration.update()", "foreground service-worker update check");
requireText(iconSvg, '<rect width="512" height="512" fill="#101114"/>', "full-bleed mask-safe PWA icon");

requireFile(touchIconBase64, "Apple touch icon base64 source");
const touchPng = Buffer.from(read(touchIconBase64).replace(/\s+/g, ""), "base64");
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
if (touchPng.length < 33 || !touchPng.subarray(0,8).equals(pngSignature)) throw new Error("Apple touch icon is not a valid PNG.");
const touchWidth = touchPng.readUInt32BE(16);
const touchHeight = touchPng.readUInt32BE(20);
const touchColorType = touchPng[25];
if (touchWidth !== 180 || touchHeight !== 180) throw new Error(`Apple touch icon must be 180x180, found ${touchWidth}x${touchHeight}.`);
if (touchColorType === 4 || touchColorType === 6) throw new Error("Apple touch icon must be full-bleed without an alpha channel.");

requireText(sw, 'const CACHE = "skytrace-web-v34-6"', "versioned PWA cache");
requireText(sw, '"/app/web-mobile.css?v=34.6"', "cached mobile proportion stylesheet");
requireText(sw, '"/app/web-mobile-interactions.css?v=34.6"', "cached iPhone interaction stylesheet");
requireText(sw, '"/app/web.js?v=34.6"', "cached live traffic runtime");
requireText(sw, '"/app/web-mobile.js?v=34.6"', "cached iPhone interaction runtime");
requireText(sw, 'if (!url.pathname.startsWith("/app")) return;', "app-shell-only cache boundary");
requireAbsent(sw, "/v1/", "API caching route");
requireText(pwaHook, 'url.pathname === "/app/web-mobile-interactions.css"', "iPhone interaction stylesheet route");
requireText(pwaHook, 'url.pathname === "/app/web-mobile.js"', "iPhone interaction runtime route");
requireText(pwaHook, 'url.pathname === "/app/sw.js"', "service worker route");
requireText(pwaHook, 'url.pathname === "/app/apple-touch-icon.png"', "Apple touch icon route");
requireText(redeemHook, 'import "./pwa-hook.js";', "PWA preload");

console.log(`SkyTrace platform support verified: Windows x64 desktop + draggable iPhone/iPad PWA with home-indicator-safe map coverage and stable live traffic refresh${materialized ? " (materialized build)" : " (source tree)"}.`);
