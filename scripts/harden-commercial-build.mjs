import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "app.v3.js");
const htmlPath = path.join(root, "index.html");

const rainViewerEndpoint = "https://api.rainviewer.com/public/weather-maps.json";
const blockedEndpoint = "/api/provider-disabled/rainviewer";

let app = fs.readFileSync(appPath, "utf8");
let html = fs.readFileSync(htmlPath, "utf8");

if (!app.includes(rainViewerEndpoint)) {
  throw new Error("Expected RainViewer renderer endpoint was not found; commercial hardening needs review.");
}

app = app.split(rainViewerEndpoint).join(blockedEndpoint);

const radarControl = '<label class="toggle-row"><span>Weather radar</span><input type="checkbox" id="layerRadar" /></label>';
const hardenedRadarControl = '<label class="toggle-row" title="RainViewer is disabled in public commercial builds"><span>Weather radar (unavailable)</span><input type="checkbox" id="layerRadar" disabled /></label>';

if (!html.includes(radarControl)) {
  throw new Error("Expected weather-radar control was not found; commercial hardening needs review.");
}

html = html.replace(radarControl, hardenedRadarControl);

fs.writeFileSync(appPath, app);
fs.writeFileSync(htmlPath, html);

const appCheck = fs.readFileSync(appPath, "utf8");
const htmlCheck = fs.readFileSync(htmlPath, "utf8");

if (appCheck.includes("api.rainviewer.com")) {
  throw new Error("Commercial build still contains a direct RainViewer API endpoint.");
}
if (!appCheck.includes(blockedEndpoint)) {
  throw new Error("RainViewer network guard was not applied.");
}
if (!/id="layerRadar"\s+disabled/.test(htmlCheck)) {
  throw new Error("Commercial build weather-radar control is not disabled.");
}

console.log("Commercial hardening complete: direct RainViewer renderer access is blocked and the radar control is disabled.");
