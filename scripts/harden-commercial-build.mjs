import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "app.v3.js");
const htmlPath = path.join(root, "index.html");

let app = fs.readFileSync(appPath, "utf8");
let html = fs.readFileSync(htmlPath, "utf8");

const radarStart = app.indexOf("  async function toggleRadar(on){");
const radarEnd = radarStart >= 0 ? app.indexOf("\n\n  async function refreshWatchlistStates()", radarStart) : -1;
if (radarStart < 0 || radarEnd < 0) {
  throw new Error("Could not locate the legacy weather-radar renderer function.");
}

const precipitationFunction = `  async function toggleRadar(on){state.layers.radar=on;if(!on){if(state.map.getLayer("weather-radar"))state.map.removeLayer("weather-radar");if(state.map.getSource("weather-radar"))state.map.removeSource("weather-radar");return;}try{await jsonFetch("/api/precipitation");if(state.map.getLayer("weather-radar"))state.map.removeLayer("weather-radar");if(state.map.getSource("weather-radar"))state.map.removeSource("weather-radar");state.map.addSource("weather-radar",{type:"raster",tiles:["/api/precipitation-tile/{z}/{x}/{y}.png"],tileSize:256,maxzoom:6,attribution:'NASA GPM IMERG · <a href="https://earthdata.nasa.gov/gibs/" target="_blank" rel="noopener noreferrer">NASA GIBS</a>'});state.map.addLayer({id:"weather-radar",type:"raster",source:"weather-radar",paint:{"raster-opacity":.58}},"airports-circle");showToast("Precipitation enabled · NASA GPM IMERG");}catch(err){$("layerRadar").checked=false;state.layers.radar=false;showToast(\`Precipitation unavailable: \${err.message}\`,5000);}}`;
app = app.slice(0, radarStart) + precipitationFunction + app.slice(radarEnd);
app = app.replace("<span>Open-Meteo weather</span>", "<span>MET Norway weather</span>");

const radarControl = /<label class="toggle-row"[^>]*><span>Weather radar(?: \(unavailable\))?<\/span><input type="checkbox" id="layerRadar"[^>]*\/><\/label>/;
if (!radarControl.test(html)) {
  throw new Error("Expected weather-radar layer control was not found.");
}
html = html.replace(
  radarControl,
  '<label class="toggle-row" title="NASA GPM IMERG satellite precipitation estimate"><span>Precipitation</span><input type="checkbox" id="layerRadar" /></label>'
);

fs.writeFileSync(appPath, app);
fs.writeFileSync(htmlPath, html);

const runtimeFiles = [
  "app.v3.js",
  "server.js",
  "electron-main.js",
  "lib/live.js",
  "lib/aircraft.js",
  "lib/weather.js",
  "lib/precipitation.js",
  "lib/config.js"
];
const blocked = [
  "opensky-network.org",
  "api.adsbdb.com",
  "api.open-meteo.com",
  "api.rainviewer.com"
];
for (const rel of runtimeFiles) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const needle of blocked) {
    if (text.includes(needle)) throw new Error(`${rel} still contains restricted provider endpoint ${needle}.`);
  }
}

const appCheck = fs.readFileSync(appPath, "utf8");
const htmlCheck = fs.readFileSync(htmlPath, "utf8");
if (!appCheck.includes('/api/precipitation-tile/{z}/{x}/{y}.png')) throw new Error("NASA precipitation renderer was not installed.");
if (!appCheck.includes("MET Norway weather")) throw new Error("MET Norway weather UI label was not installed.");
if (!htmlCheck.includes("<span>Precipitation</span>")) throw new Error("Precipitation layer control was not installed.");
if (/id="layerRadar"[^>]*disabled/.test(htmlCheck)) throw new Error("Precipitation control is unexpectedly disabled.");

console.log("Commercial provider hardening complete: approved free commercial providers are active and restricted endpoints are absent.");
