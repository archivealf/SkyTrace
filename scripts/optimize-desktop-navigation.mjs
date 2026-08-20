import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appFile = path.join(root, "app.v3.js");
const cssFile = path.join(root, "v3.3-glass.css");
const serverFile = path.join(root, "server.js");

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Required materialized file is missing: ${path.relative(root, file)}`);
  return fs.readFileSync(file, "utf8");
}

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Could not apply desktop navigation optimization: ${label}.`);
  return text.replace(before, after);
}

let app = read(appFile);

app = replaceRequired(
  app,
  '    mapMoving: false, renderRaf: 0, searchTimer: null, renderedAircraftCount: 0, fps: 0,\n    performanceMode: localStorage.getItem("skytrace.performanceMode") !== "off", lastListRenderKey: "",',
  '    mapMoving: false, renderRaf: 0, searchTimer: null, renderedAircraftCount: 0, fps: 0, pendingFlightRefresh: false,\n    aircraftLabelsBeforeMove: null, performanceMode: localStorage.getItem("skytrace.performanceMode") !== "off", lastListRenderKey: "",',
  "desktop navigation state"
);

app = replaceRequired(
  app,
  'state.map=new maplibregl.Map({',
  'state.map=new maplibregl.Map({fadeDuration:0,crossSourceCollisions:false,',
  "MapLibre low-overhead options"
);

app = replaceRequired(
  app,
  '    const z=state.map?.getZoom?.()||5;const budget=z<4?550:z<6?900:z<8?1400:1900;',
  '    const z=state.map?.getZoom?.()||5;let budget=z<4?360:z<6?650:z<8?1000:1400;if(state.fps>0&&state.fps<42)budget=Math.max(260,Math.round(budget*.72));if(state.fps>0&&state.fps<30)budget=Math.max(220,Math.round(budget*.72));',
  "adaptive aircraft render budget"
);

app = replaceRequired(
  app,
  '    if(state.loading&&!force)return; if((document.hidden||state.mapMoving)&&!force)return; state.loading=true; el.refreshBtn.disabled=true;',
  '    if(state.loading){if(force)state.pendingFlightRefresh=true;return;} if((document.hidden||state.mapMoving)&&!force)return; if(force)state.pendingFlightRefresh=false; state.loading=true; el.refreshBtn.disabled=true;',
  "single in-flight flight refresh"
);

const loadingResetMatches = app.match(/state\.loading=false;/g) || [];
if (loadingResetMatches.length !== 1) {
  throw new Error(`Could not safely queue final flight refresh: expected one state.loading=false marker, found ${loadingResetMatches.length}.`);
}
app = app.replace(
  'state.loading=false;',
  'state.loading=false;if(state.pendingFlightRefresh&&!state.mapMoving){state.pendingFlightRefresh=false;queueMicrotask(()=>fetchFlights({force:true}));}'
);

app = replaceRequired(
  app,
  '    state.map.on("movestart",()=>{state.mapMoving=true;});\n    state.map.on("moveend",()=>{state.mapMoving=false;el.viewportLabel.textContent=viewportText();clearTimeout(state.moveTimer);state.moveTimer=setTimeout(()=>{fetchAirports();if(state.layers.navaids)fetchNavaids();syncMarkers();state.secondsLeft=Math.min(state.secondsLeft,4);},350);});',
  `    state.map.on("movestart",()=>{\n      state.mapMoving=true;document.documentElement.classList.add("map-moving");clearTimeout(state.moveTimer);\n      if(state.performanceMode&&state.map.getLayer("aircraft-labels")){\n        try{state.aircraftLabelsBeforeMove=state.map.getLayoutProperty("aircraft-labels","visibility")||"visible";state.map.setLayoutProperty("aircraft-labels","visibility","none");}catch{}\n      }\n    });\n    state.map.on("moveend",()=>{\n      state.mapMoving=false;document.documentElement.classList.remove("map-moving");el.viewportLabel.textContent=viewportText();\n      if(state.map.getLayer("aircraft-labels")&&state.aircraftLabelsBeforeMove){try{state.map.setLayoutProperty("aircraft-labels","visibility",state.aircraftLabelsBeforeMove);}catch{}state.aircraftLabelsBeforeMove=null;}\n      clearTimeout(state.moveTimer);\n      if(state.loading)state.pendingFlightRefresh=true;else void fetchFlights({force:true});\n      state.moveTimer=setTimeout(()=>{fetchAirports();if(state.layers.navaids)fetchNavaids();},180);\n    });`,
  "immediate viewport traffic refresh"
);

fs.writeFileSync(appFile, app);

let css = read(cssFile);
const movementCss = `

/* V3.4 desktop navigation: keep the WebGL map compositor light while the user pans/zooms. */
.performance-mode.map-moving .flightdeck-sheet,
.performance-mode.map-moving .command-search,
.performance-mode.map-moving .live-cluster,
.performance-mode.map-moving .brand-orb,
.performance-mode.map-moving .round-button,
.performance-mode.map-moving .flightdeck-rail{
  backdrop-filter:none!important;
  -webkit-backdrop-filter:none!important;
  box-shadow:none!important;
}
.performance-mode.map-moving .flightdeck-sheet:before,
.performance-mode.map-moving .command-search:before,
.performance-mode.map-moving .live-cluster:before,
.performance-mode.map-moving .flightdeck-rail:before,
.performance-mode.map-moving .brand-orb:before{display:none!important}
`;
if (!css.includes("V3.4 desktop navigation: keep the WebGL map compositor light")) css += movementCss;
fs.writeFileSync(cssFile, css);

let server = read(serverFile);
server = replaceRequired(
  server,
  '  return t - last < 1200;',
  '  return t - last < 650;',
  "responsive local flight refresh limiter"
);
fs.writeFileSync(serverFile, server);

const checks = [
  [app, 'pendingFlightRefresh: false', "queued live refresh state"],
  [app, 'crossSourceCollisions:false', "MapLibre collision optimization"],
  [app, 'void fetchFlights({force:true})', "immediate move-end refresh"],
  [app, 'classList.add("map-moving")', "map movement compositor state"],
  [app, 'state.fps>0&&state.fps<42', "adaptive low-FPS aircraft budget"],
  [css, '.performance-mode.map-moving .flightdeck-sheet', "movement glass optimization"],
  [server, 'return t - last < 650;', "faster local refresh allowance"]
];
for (const [text, needle, label] of checks) {
  if (!text.includes(needle)) throw new Error(`Desktop navigation verification failed: ${label}.`);
}

console.log("Applied SkyTrace desktop navigation optimization: smooth movement, adaptive aircraft budget, queued requests and immediate viewport traffic refresh.");
