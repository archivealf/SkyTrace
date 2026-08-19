import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'));
const appPath=path.join(root,'app.v3.js');
const htmlPath=path.join(root,'index.html');
let app=fs.readFileSync(appPath,'utf8');
let html=fs.readFileSync(htmlPath,'utf8');
function rr(before, after, label){ if(!app.includes(before)) throw new Error(`Missing ${label}`); app=app.replace(before, after); }
function rh(before, after, label){ if(!html.includes(before)) throw new Error(`Missing HTML ${label}`); html=html.replace(before, after); }

rr(
'    currentOpsDirection: "arrival", moveTimer: null, timelineTimer: null, activeDetailTab: "aircraft",\n    previousFlights: new Map(), events: new Map(), routeCache: new Map()',
'    currentOpsDirection: "arrival", moveTimer: null, timelineTimer: null, activeDetailTab: "aircraft",\n    mapMoving: false, renderRaf: 0, searchTimer: null, renderedAircraftCount: 0, fps: 0,\n    performanceMode: localStorage.getItem("skytrace.performanceMode") !== "off", lastListRenderKey: "",\n    previousFlights: new Map(), events: new Map(), aircraftLastSeen: new Map(), lastPruneAt: 0, routeCache: new Map()',
'state performance fields');

rr(
'  function liveryHtml(flight,small=false){ const a=airlineFor(flight); return `<span class="mini-plane" style="--heading:${small?0:(flight?.heading||0)}deg;--p:${a.primary};--s:${a.secondary}">${PLANE_SVG(flight)}</span>`; }\n\n',
`  function liveryHtml(flight,small=false){ const a=airlineFor(flight); return \`<span class="mini-plane" style="--heading:\${small?0:(flight?.heading||0)}deg;--p:\${a.primary};--s:\${a.secondary}">\${PLANE_SVG(flight)}</span>\`; }\n\n  function applyPerformanceMode(){\n    document.documentElement.classList.toggle("performance-mode",state.performanceMode);\n    const toggle=$("performanceMode");if(toggle)toggle.checked=state.performanceMode;\n    localStorage.setItem("skytrace.performanceMode",state.performanceMode?"on":"off");\n    if(state.map?.getLayer?.("aircraft-labels")){\n      try{state.map.setLayerZoomRange("aircraft-labels",state.performanceMode?5.8:4.8,24);}catch{}\n    }\n  }\n  function hashIcao(value){let h=2166136261;for(const c of String(value||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}\n  function flightsForMap(){\n    const pool=state.filtered;if(!state.performanceMode)return pool;\n    const z=state.map?.getZoom?.()||5;const budget=z<4?550:z<6?900:z<8?1400:1900;\n    if(pool.length<=budget)return pool;\n    const watch=new Set(state.watchlist),priority=[],normal=[];\n    for(const f of pool){const special=f.icao24===state.selectedId||watch.has(f.icao24)||f.emergency||["7500","7600","7700"].includes(String(f.squawk||""));(special?priority:normal).push(f);}\n    const left=Math.max(0,budget-priority.length);normal.sort((a,b)=>hashIcao(a.icao24)-hashIcao(b.icao24));\n    return priority.concat(normal.slice(0,left));\n  }\n  function scheduleFilterRefresh(delay=0){\n    if(delay){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>scheduleFilterRefresh(),delay);return;}\n    if(state.renderRaf)cancelAnimationFrame(state.renderRaf);state.renderRaf=requestAnimationFrame(()=>{state.renderRaf=0;applyFilters();syncMarkers();});\n  }\n  function pruneTransientAircraft(){\n    const now=Date.now();if(now-state.lastPruneAt<60000)return;state.lastPruneAt=now;const cutoff=now-15*60*1000;\n    const keep=new Set(state.watchlist);if(state.selectedId)keep.add(state.selectedId);\n    for(const [icao,last] of state.aircraftLastSeen){if(last>=cutoff||keep.has(icao))continue;state.aircraftLastSeen.delete(icao);state.previousFlights.delete(icao);state.events.delete(icao);state.trails.delete(icao);}\n  }\n  function startPerformanceHud(){\n    let frames=0,last=performance.now();\n    const tick=(now)=>{frames++;if(now-last>=1000){state.fps=Math.round(frames*1000/(now-last));frames=0;last=now;const out=$("perfStatus");if(out)out.textContent=\`\${state.fps} FPS · \${state.renderedAircraftCount}/\${state.filtered.length} AC\`;}requestAnimationFrame(tick);};\n    requestAnimationFrame(tick);\n  }\n\n`,
'performance helpers');

rr(
'  function ensureLiveryImage(flight){\n    if(!state.map)return"";const key=liveryImageKey(flight);\n    if(!state.map.hasImage(key)){\n      try{state.map.addImage(key,makeLiveryImage(flight),{pixelRatio:2});state.liveryImages.add(key);}catch(err){console.warn("Could not add livery image",key,err);}\n    }\n    return key;\n  }',
'  function ensureLiveryImage(flight){\n    if(!state.map)return"";let key=liveryImageKey(flight),imageFlight=flight;\n    if(!state.map.hasImage(key)&&state.performanceMode&&state.liveryImages.size>=128){key=`sky-generic-${shapeForCategory(flight?.category)}`;imageFlight={...flight,callsign:""};}\n    if(!state.map.hasImage(key)){\n      try{state.map.addImage(key,makeLiveryImage(imageFlight),{pixelRatio:2});state.liveryImages.add(key);}catch(err){console.warn("Could not add livery image",key,err);}\n    }\n    return key;\n  }',
'livery cache cap');

rr(
'    if(state.loading&&!force)return; if(document.hidden&&!force)return; state.loading=true; el.refreshBtn.disabled=true;',
'    if(state.loading&&!force)return; if((document.hidden||state.mapMoving)&&!force)return; state.loading=true; el.refreshBtn.disabled=true;',
'pause refresh while map moves');

rr(
'      for(const f of state.flights)recordTelemetryEvents(f);\n      updateTrails(state.flights); applyFilters(); syncMarkers(); updateStats(); checkWatchAlerts();',
'      for(const f of state.flights){recordTelemetryEvents(f);state.aircraftLastSeen.set(f.icao24,Date.now());}\n      pruneTransientAircraft();updateTrails(state.flights); applyFilters(); syncMarkers(); checkWatchAlerts();',
'fetch render dedupe');

rr(
'  function upsertFlight(f){ recordTelemetryEvents(f);const i=state.flights.findIndex(x=>x.icao24===f.icao24); if(i>=0)state.flights[i]=f; else state.flights.push(f); updateTrails([f]); applyFilters();syncMarkers();updateStats(); }',
'  function upsertFlight(f){ recordTelemetryEvents(f);state.aircraftLastSeen.set(f.icao24,Date.now());const i=state.flights.findIndex(x=>x.icao24===f.icao24); if(i>=0)state.flights[i]=f; else state.flights.push(f); updateTrails([f]); applyFilters();syncMarkers(); }',
'upsert stats dedupe');

rr(
'        if(pts.length>720)pts.splice(0,pts.length-720);',
'        const cap=f.icao24===state.selectedId||state.watchlist.includes(f.icao24)?720:120;if(pts.length>cap)pts.splice(0,pts.length-cap);',
'adaptive trail cache');

rr(
'  function switchView(view){state.activeView=view;document.querySelectorAll(".mode-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));document.querySelectorAll(".side-view").forEach(v=>v.classList.remove("active"));$(`${view}View`)?.classList.add("active");if(view==="airports")renderAirportList(state.airportSearchResults.length?state.airportSearchResults:state.airports);if(view==="watchlist")renderWatchlist();}',
'  function switchView(view){state.activeView=view;document.querySelectorAll(".mode-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));document.querySelectorAll(".side-view").forEach(v=>v.classList.remove("active"));$(`${view}View`)?.classList.add("active");if(view==="flights"){state.lastListRenderKey="";renderFlightList();}if(view==="airports")renderAirportList(state.airportSearchResults.length?state.airportSearchResults:state.airports);if(view==="watchlist")renderWatchlist();}',
'render active view on switch');

rr(
'  function applyFilters(){state.filtered=state.flights.filter(passes);renderFlightList();updateStats();}',
'  function applyFilters(){state.filtered=state.flights.filter(passes);if(state.activeView==="flights")renderFlightList();updateStats();}',
'lazy flight list');

rr(
'    if(!rows.length){el.aircraftList.innerHTML=\'<div class="empty-state">No aircraft match this view.<br>Pan the map or clear the filters.</div>\';return;}\n    el.aircraftList.innerHTML=rows.map(f=>{const a=airlineFor(f),special=["7500","7600","7700"].includes(String(f.squawk||""))||f.emergency;return`<button class="aircraft-row ${state.selectedId===f.icao24?"selected":""} ${special?"emergency":""}" data-icao="${f.icao24}"><span class="row-livery">${liveryHtml(f,true)}</span><span class="row-main"><span class="row-callsign">${escapeHtml(f.callsign)}</span><span class="row-sub">${escapeHtml(f.registration||f.aircraftType||a.name)} · ${escapeHtml(a.name)}</span></span><span class="row-values"><strong>${fmtAlt(f.altitudeFt,f.onGround)}</strong><span>${fmtSpeed(f.speedKts)}</span></span></button>`}).join("");\n    el.aircraftList.querySelectorAll(".aircraft-row").forEach(b=>b.addEventListener("click",()=>{const f=state.flights.find(x=>x.icao24===b.dataset.icao);if(f){selectAircraft(f.icao24,true);state.map.easeTo({center:[f.longitude,f.latitude],zoom:Math.max(7,state.map.getZoom()),duration:650});}}));',
'    if(!rows.length){state.lastListRenderKey="empty";el.aircraftList.innerHTML=\'<div class="empty-state">No aircraft match this view.<br>Pan the map or clear the filters.</div>\';return;}\n    const renderKey=rows.map(f=>`${f.icao24}:${f.callsign}:${f.registration||""}:${f.aircraftType||""}:${f.altitudeFt}:${f.speedKts}:${f.onGround?1:0}:${state.selectedId===f.icao24?1:0}`).join("|");\n    if(renderKey===state.lastListRenderKey)return;state.lastListRenderKey=renderKey;\n    el.aircraftList.innerHTML=rows.map(f=>{const a=airlineFor(f),special=["7500","7600","7700"].includes(String(f.squawk||""))||f.emergency;return`<button class="aircraft-row ${state.selectedId===f.icao24?"selected":""} ${special?"emergency":""}" data-icao="${f.icao24}"><span class="row-livery">${liveryHtml(f,true)}</span><span class="row-main"><span class="row-callsign">${escapeHtml(f.callsign)}</span><span class="row-sub">${escapeHtml(f.registration||f.aircraftType||a.name)} · ${escapeHtml(a.name)}</span></span><span class="row-values"><strong>${fmtAlt(f.altitudeFt,f.onGround)}</strong><span>${fmtSpeed(f.speedKts)}</span></span></button>`}).join("");',
'flight list diff/delegation');

rr(
'    const features=state.layers.aircraft?state.filtered.map(aircraftFeature):[];\n    src.setData({type:"FeatureCollection",features});',
'    const mapFlights=state.layers.aircraft?flightsForMap():[];const features=mapFlights.map(aircraftFeature);state.renderedAircraftCount=features.length;\n    src.setData({type:"FeatureCollection",features});',
'adaptive map budget');

rr(
'  function updateStats(){ const v=state.filtered,a=v.filter(f=>!f.onGround);el.visibleMetric.textContent=v.length.toLocaleString();el.airborneMetric.textContent=a.length.toLocaleString();el.groundMetric.textContent=(v.length-a.length).toLocaleString();const al=a.map(f=>f.altitudeFt).filter(Number.isFinite),sp=a.map(f=>f.speedKts).filter(Number.isFinite);el.averageAltitude.textContent=al.length?`${Math.round(al.reduce((x,y)=>x+y,0)/al.length).toLocaleString()} ft`:"—";el.averageSpeed.textContent=sp.length?`${Math.round(sp.reduce((x,y)=>x+y,0)/sp.length).toLocaleString()} kt`:"—"; renderStats(); }',
'  function updateStats(){ const v=state.filtered;let airborne=0,altN=0,altSum=0,speedN=0,speedSum=0;for(const f of v){if(f.onGround)continue;airborne++;if(Number.isFinite(f.altitudeFt)){altN++;altSum+=f.altitudeFt;}if(Number.isFinite(f.speedKts)){speedN++;speedSum+=f.speedKts;}}el.visibleMetric.textContent=v.length.toLocaleString();el.airborneMetric.textContent=airborne.toLocaleString();el.groundMetric.textContent=(v.length-airborne).toLocaleString();el.averageAltitude.textContent=altN?`${Math.round(altSum/altN).toLocaleString()} ft`:"—";el.averageSpeed.textContent=speedN?`${Math.round(speedSum/speedN).toLocaleString()} kt`:"—";if(!el.statsPanel.classList.contains("hidden"))renderStats(); }',
'one-pass lazy stats');

rr(
'  async function fetchAirports({search=null}={}){try{let p;if(search){p=await jsonFetch(`/api/airports?q=${encodeURIComponent(search)}&limit=40`);state.airportSearchResults=p.airports||[];renderAirportList(state.airportSearchResults);if(state.airportSearchResults[0]){const a=state.airportSearchResults[0];state.map.flyTo({center:[a.lon,a.lat],zoom:8,essential:true});}}else{const q=new URLSearchParams({...getBoundsQuery(),zoom:state.map.getZoom().toFixed(1),limit:"1200"});p=await jsonFetch(`/api/airports?${q}`);state.airports=p.airports||[];renderAirportLayer();renderAirportList(state.airports);}}catch(err){console.error(err);}}',
'  async function fetchAirports({search=null}={}){try{let p;if(search){p=await jsonFetch(`/api/airports?q=${encodeURIComponent(search)}&limit=40`);state.airportSearchResults=p.airports||[];renderAirportList(state.airportSearchResults);if(state.airportSearchResults[0]){const a=state.airportSearchResults[0];state.map.flyTo({center:[a.lon,a.lat],zoom:8,essential:true});}}else{const q=new URLSearchParams({...getBoundsQuery(),zoom:state.map.getZoom().toFixed(1),limit:"1200"});p=await jsonFetch(`/api/airports?${q}`);state.airports=p.airports||[];renderAirportLayer();if(state.activeView==="airports")renderAirportList(state.airports);}}catch(err){console.error(err);}}',
'lazy airport list');

rr(
'    el.altitudeRange.addEventListener("input",()=>{state.altitudeMax=Number(el.altitudeRange.value);el.altitudeLabel.textContent=`${state.altitudeMax.toLocaleString()} ft`;applyFilters();syncMarkers();});\n    el.searchInput.addEventListener("input",()=>{state.searchTerm=el.searchInput.value.trim();applyFilters();syncMarkers();});',
'    el.altitudeRange.addEventListener("input",()=>{state.altitudeMax=Number(el.altitudeRange.value);el.altitudeLabel.textContent=`${state.altitudeMax.toLocaleString()} ft`;scheduleFilterRefresh();});\n    el.searchInput.addEventListener("input",()=>{state.searchTerm=el.searchInput.value.trim();scheduleFilterRefresh(120);});',
'debounced filters');

rr(
'    document.querySelectorAll(".mode-tab").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));',
'    document.querySelectorAll(".mode-tab").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));\n    el.aircraftList.addEventListener("click",e=>{const b=e.target.closest?.(".aircraft-row");if(!b)return;const f=state.flights.find(x=>x.icao24===b.dataset.icao);if(f)selectAircraft(f.icao24,true);});\n    $("performanceMode")?.addEventListener("change",e=>{state.performanceMode=Boolean(e.target.checked);applyPerformanceMode();state.lastListRenderKey="";syncMarkers();showToast(state.performanceMode?"Performance mode enabled.":"Quality mode enabled — all aircraft are rendered.");});',
'event delegation + performance toggle');

rr(
'  function initMap(){\n    state.map=new maplibregl.Map(',
'  function initMap(){\n    applyPerformanceMode();startPerformanceHud();\n    state.map=new maplibregl.Map(',
'perf startup');

rr(
'    state.map.on("load",async()=>{addMapSources();setupEvents();startTimers();startTimelinePolling();renderWatchlist();await Promise.all([fetchFlights({force:true}),fetchAirports(),refreshWatchlistStates()]);if("serviceWorker"in navigator)navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});});',
'    state.map.on("load",async()=>{addMapSources();applyPerformanceMode();setupEvents();startTimers();startTimelinePolling();renderWatchlist();await Promise.all([fetchFlights({force:true}),fetchAirports(),refreshWatchlistStates()]);if("serviceWorker"in navigator)navigator.serviceWorker.register("/service-worker.v3.js", { updateViaCache: "none" }).catch(()=>{});});',
'performance layer settings after map load');

rr(
'  function setMapStyle(){const style=state.darkStyle?"https://tiles.openfreemap.org/styles/dark":"https://tiles.openfreemap.org/styles/liberty";state.map.setStyle(style);state.map.once("styledata",()=>{if(state.map.isStyleLoaded()){addMapSources();renderAirportLayer();fetchNavaids();syncMarkers();if(state.layers.radar)toggleRadar(true);}});}',
'  function setMapStyle(){const style=state.darkStyle?"https://tiles.openfreemap.org/styles/dark":"https://tiles.openfreemap.org/styles/liberty";state.map.setStyle(style);state.map.once("styledata",()=>{if(state.map.isStyleLoaded()){addMapSources();applyPerformanceMode();renderAirportLayer();fetchNavaids();syncMarkers();if(state.layers.radar)toggleRadar(true);}});}',
'performance layer settings after style change');

rr(
'    state.map.on("moveend",()=>{el.viewportLabel.textContent=viewportText();clearTimeout(state.moveTimer);state.moveTimer=setTimeout(()=>{fetchAirports();if(state.layers.navaids)fetchNavaids();state.secondsLeft=Math.min(state.secondsLeft,4);},350);});',
'    state.map.on("movestart",()=>{state.mapMoving=true;});\n    state.map.on("moveend",()=>{state.mapMoving=false;el.viewportLabel.textContent=viewportText();clearTimeout(state.moveTimer);state.moveTimer=setTimeout(()=>{fetchAirports();if(state.layers.navaids)fetchNavaids();syncMarkers();state.secondsLeft=Math.min(state.secondsLeft,4);},350);});',
'map movement scheduling');

rh(
'    <label class="toggle-row"><span>Flight trail</span><input type="checkbox" id="layerTrail" checked /></label>\n    <button class="layer-action" id="globeBtn">',
'    <label class="toggle-row"><span>Flight trail</span><input type="checkbox" id="layerTrail" checked /></label>\n    <label class="toggle-row" title="Caps crowded map rendering and reduces glass effects"><span>Performance mode</span><input type="checkbox" id="performanceMode" checked /></label>\n    <button class="layer-action" id="globeBtn">',
'performance toggle');

rh(
'    <div class="status-wide"><span>VIEWPORT</span><strong id="viewportLabel">United Kingdom</strong></div>\n    <div><span>APP</span><strong>V3.2 FREE</strong></div>',
'    <div class="status-wide"><span>VIEWPORT</span><strong id="viewportLabel">United Kingdom</strong></div>\n    <div><span>PERF</span><strong id="perfStatus">—</strong></div>\n    <div><span>APP</span><strong>V3.2 FREE</strong></div>',
'performance HUD');

fs.writeFileSync(appPath,app);fs.writeFileSync(htmlPath,html);
const verifyApp=fs.readFileSync(appPath,'utf8'),verifyHtml=fs.readFileSync(htmlPath,'utf8');
for(const token of ['flightsForMap','pruneTransientAircraft','startPerformanceHud','performanceMode']) if(!verifyApp.includes(token)) throw new Error(`Performance patch verification failed: ${token}`);
if(!verifyHtml.includes('id="performanceMode"')||!verifyHtml.includes('id="perfStatus"')) throw new Error('Performance controls were not injected.');
console.log('Applied SkyTrace V3.3 performance patch: adaptive rendering, bounded trail cache, lazy DOM/stats, debounced filters and FPS HUD.');
