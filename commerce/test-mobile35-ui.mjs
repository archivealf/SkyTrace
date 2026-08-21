import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
};
const forbidText = (source, text, label) => {
  if (source.includes(text)) throw new Error(`Forbidden ${label}: ${text}`);
};

const legacyMobile = read('web/web-mobile.js');
const mobileFix = read('web/web-mobile-35-fix.js');
const credits = read('web/web-credits-35.js');
const index = read('web/index.html');
const webView = read('../ios-native/SkyTraceApp/SkyTraceWebView.swift');
const appInfo = read('../ios-native/Config/Info.plist');
const widgetInfo = read('../ios-native/SkyTraceActivityWidget/Info.plist');

requireText(legacyMobile, 'const mobile35Build =', 'Mobile 35 legacy-sheet guard');
requireText(legacyMobile, 'if (!mobile35Build) root.classList.add', 'legacy class isolation');
requireText(legacyMobile, 'if (!mobile35Build) {', 'legacy pointer-handler isolation');

requireText(mobileFix, 'map.getFilter', 'idempotent MapLibre filter repair');
forbidText(mobileFix, "map.on('idle', queueRepair)", 'unbounded MapLibre idle repair loop');

requireText(credits, 'versionLabel.textContent !== expectedLabel', 'idempotent credits observer');
requireText(credits, "const BUILD = '35.0.7'", 'credits build identity');

requireText(index, 'skytrace-web-build" content="35.0.7', 'web build identity');
requireText(index, 'native-ios-app', 'native iOS document marker');

requireText(webView, 'window.__SKYTRACE_NATIVE_IOS__ = true;', 'WKWebView native marker');
requireText(webView, 'webViewWebContentProcessDidTerminate', 'WKWebView process recovery');
requireText(webView, 'delaysContentTouches = false', 'WKWebView touch responsiveness');

requireText(appInfo, '<string>35.0.7</string>', 'native app version');
requireText(appInfo, '<string>2</string>', 'native app build');
requireText(widgetInfo, '<string>35.0.7</string>', 'widget version');

console.log('SkyTrace Mobile 35 UI regression checks passed: no observer loop, no legacy sheet conflict, idempotent map repair, native WKWebView recovery enabled.');
