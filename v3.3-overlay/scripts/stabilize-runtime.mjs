import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const appFile = path.join(root, "app.v3.js");
const codesFile = path.join(root, "v3.3-codes.js");
const featuresFile = path.join(root, "v3.4-features.js");
const cssFile = path.join(root, "v3.3-glass.css");

function read(file) { return fs.readFileSync(file, "utf8"); }
function write(file, value) { fs.writeFileSync(file, value); }
function replaceRequired(value, before, after, label) {
  if (!value.includes(before)) throw new Error(`Could not apply runtime stability patch: ${label}.`);
  return value.replace(before, after);
}

let app = read(appFile);

app = replaceRequired(
  app,
  '  function closeFlight(){state.selectedId=null;state.followSelected=false;el.detailsPanel.classList.add("hidden");updateSelectedAircraftFilter();renderFlightList();updateSelectedTrail();}',
  '  function closeFlight(){state.selectedId=null;state.followSelected=false;el.detailsPanel.classList.add("hidden");el.followBtn?.classList.remove("active");el.aircraftList?.querySelector(".aircraft-row.selected")?.classList.remove("selected");state.lastListRenderKey="";updateSelectedAircraftFilter();updateSelectedTrail();}',
  "constant-time aircraft close"
);

app = replaceRequired(
  app,
  `  async function loadAirportOps(){
    if(!state.selectedAirport)return;
    el.loadOpsBtn.disabled=true;el.loadOpsBtn.textContent="Refreshing…";
    try{
      const a=state.selectedAirport;
      const nearby=state.flights.map(f=>{const dist=distanceNm(f.latitude,f.longitude,a.lat,a.lon),toAirport=bearingTo(f.latitude,f.longitude,a.lat,a.lon),aligned=angleDiff(f.heading,toAirport)<75;return{...f,dist,aligned};}).filter(f=>f.dist<=35);
      const arrivals=nearby.filter(f=>!f.onGround&&(f.verticalRateFpm??0)<=400&&f.aligned).sort((x,y)=>x.dist-y.dist);
      const departures=nearby.filter(f=>f.onGround||(!f.aligned&&(f.verticalRateFpm??0)>=-300)).sort((x,y)=>x.dist-y.dist);
      const rows=(state.currentOpsDirection==="arrival"?arrivals:departures).slice(0,40);
      $("opsList").innerHTML=rows.length?rows.map(f=>\`<div class="data-row"><span>\${escapeHtml(f.callsign||f.icao24)} · \${fmtAlt(f.altitudeFt,f.onGround)} · \${fmtSpeed(f.speedKts)}</span><b>\${f.dist.toFixed(1)} nm</b></div>\`).join(""):'<div class="metadata-empty">No matching live aircraft are currently observed near this airport.</div>';
    }finally{el.loadOpsBtn.disabled=false;el.loadOpsBtn.textContent="Refresh observed traffic";}
  }`,
  `  async function loadAirportOps(){
    if(!state.selectedAirport)return;
    el.loadOpsBtn.disabled=true;el.loadOpsBtn.textContent="Refreshing…";
    try{
      const a=state.selectedAirport,arrivals=[],departures=[];
      for(const f of state.flights){
        if(!Number.isFinite(Number(f.latitude))||!Number.isFinite(Number(f.longitude)))continue;
        const dist=distanceNm(f.latitude,f.longitude,a.lat,a.lon);if(!Number.isFinite(dist)||dist>35)continue;
        const toAirport=bearingTo(f.latitude,f.longitude,a.lat,a.lon),aligned=angleDiff(f.heading,toAirport)<75,row={...f,dist};
        if(!f.onGround&&(f.verticalRateFpm??0)<=400&&aligned)arrivals.push(row);
        if(f.onGround||(!aligned&&(f.verticalRateFpm??0)>=-300))departures.push(row);
      }
      arrivals.sort((x,y)=>x.dist-y.dist);departures.sort((x,y)=>x.dist-y.dist);
      const rows=(state.currentOpsDirection==="arrival"?arrivals:departures).slice(0,40),list=$("opsList");
      list.innerHTML=rows.length?rows.map(f=>{const title=f.callsign||f.registration||f.icao24.toUpperCase(),sub=[f.registration&&f.registration!==title?f.registration:"",f.aircraftType||""].filter(Boolean).join(" · ")||f.icao24.toUpperCase();return \`<button class="airport-traffic-row" data-airport-traffic-icao="\${escapeHtml(f.icao24)}"><span class="airport-traffic-main"><b>\${escapeHtml(title)}</b><small>\${escapeHtml(sub)}</small></span><span class="airport-traffic-metrics"><b>\${f.dist.toFixed(1)} nm</b><small>\${fmtAlt(f.altitudeFt,f.onGround)} · \${fmtSpeed(f.speedKts)}</small></span></button>\`;}).join(""):'<div class="metadata-empty">No matching live aircraft are currently observed near this airport.</div>';
      list.querySelectorAll("[data-airport-traffic-icao]").forEach(button=>button.addEventListener("click",()=>{const id=button.dataset.airportTrafficIcao;if(id)void selectAircraft(id,true);}));
    }finally{el.loadOpsBtn.disabled=false;el.loadOpsBtn.textContent="Refresh observed traffic";}
  }`,
  "single-pass observed airport traffic renderer"
);

write(appFile, app);

let codes = read(codesFile);
const oldCodesObserver = `  installStyles();
  installRedeemCard();
  const observer = new MutationObserver(installRedeemCard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();`;
if (codes.includes(oldCodesObserver)) {
  codes = codes.replace(oldCodesObserver, `  const boot = () => { installStyles(); installRedeemCard(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();`);
}
if (codes.includes("MutationObserver")) throw new Error("Redeem runtime still contains a document MutationObserver.");
write(codesFile, codes);

let features = read(featuresFile);
const oldFeaturesObserver = `ensure();new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true});})();`;
if (features.includes(oldFeaturesObserver)) {
  features = features.replace(oldFeaturesObserver, `const boot=()=>ensure();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();})();`);
}
features = replaceRequired(
  features,
  `function drawReplay(){const m=map();if(!m||!state.replay.length)return;const end=Math.min(state.replay.length,state.index+1),by=new Map();for(const p of state.replay.slice(0,end)){if(!by.has(p.icao))by.set(p.icao,[]);by.get(p.icao).push([Number(p.longitude),Number(p.latitude)])}const fc={type:'FeatureCollection',features:[...by].filter(([,c])=>c.length>1).map(([icao,c])=>({type:'Feature',properties:{icao},geometry:{type:'LineString',coordinates:c}}))};setLayer('v34-replay',fc,'#60a5fa',false);const at=state.replay[state.index]?.recordedAt;if(at)$('replayInfo').textContent=\`${new Date(Number(at)).toLocaleString()} · ${end.toLocaleString()} observations rendered.\`}`,
  `function drawReplay(){const m=map();if(!m||!state.replay.length)return;const end=Math.min(state.replay.length,state.index+1),by=new Map();for(let i=0;i<end;i++){const p=state.replay[i];if(!by.has(p.icao))by.set(p.icao,[]);by.get(p.icao).push([Number(p.longitude),Number(p.latitude)])}const fc={type:'FeatureCollection',features:[...by].filter(([,c])=>c.length>1).map(([icao,c])=>({type:'Feature',properties:{icao},geometry:{type:'LineString',coordinates:c}}))};setLayer('v34-replay',fc,'#60a5fa',false);const at=state.replay[state.index]?.recordedAt;if(at)$('replayInfo').textContent=\`${new Date(Number(at)).toLocaleString()} · ${end.toLocaleString()} observations rendered.\`}`,
  "allocation-free V3.4 replay redraw"
);
features = replaceRequired(
  features,
  `function playReplay(){if(state.timer){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play';return}if(!state.replay.length)return toast('Load Replay+ first.');$('replayPlay').textContent='Pause';const speed=Number($('replaySpeed').value)||1;state.timer=setInterval(()=>{state.index++;if(state.index>=state.replay.length){clearInterval(state.timer);state.timer=null;state.index=state.replay.length-1;$('replayPlay').textContent='Play'}$('replayTimeline').value=state.index;drawReplay()},Math.max(30,240/speed))}`,
  `function playReplay(){if(state.timer){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play';return}if(!state.replay.length)return toast('Load Replay+ first.');if(state.index>=state.replay.length-1)state.index=0;$('replayTimeline').value=state.index;drawReplay();$('replayPlay').textContent='Pause';const speed=Number($('replaySpeed').value)||1,step=Math.max(1,Math.ceil(state.replay.length/300));state.timer=setInterval(()=>{state.index=Math.min(state.replay.length-1,state.index+step);$('replayTimeline').value=state.index;drawReplay();if(state.index>=state.replay.length-1){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play'}},Math.max(60,300/speed))}`,
  "bounded V3.4 replay playback"
);
if (features.includes("MutationObserver")) throw new Error("V3.4 runtime still contains a document MutationObserver.");
write(featuresFile, features);

let css = read(cssFile);
if (!css.includes(".airport-traffic-row{")) {
  css += `\n/* Stable, scroll-contained airport observed traffic rows. */\n.airport-panel .ops-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;overscroll-behavior:contain;margin-top:8px;padding-right:2px}\n.airport-traffic-row{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,.045);color:var(--text);padding:9px 10px;contain:layout paint style}\n.airport-traffic-row:hover{background:rgba(255,255,255,.075);border-color:var(--border-bright)}\n.airport-traffic-main,.airport-traffic-metrics{min-width:0}.airport-traffic-main b,.airport-traffic-main small,.airport-traffic-metrics b,.airport-traffic-metrics small{display:block}.airport-traffic-main b{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.airport-traffic-main small,.airport-traffic-metrics small{font-size:8px;color:var(--muted);margin-top:2px}.airport-traffic-metrics{text-align:right;white-space:nowrap}.airport-traffic-metrics b{font-size:9px}\n.performance-mode .airport-traffic-row{transition:background-color .14s ease,border-color .14s ease}\n`;
}
write(cssFile, css);

console.log("Applied SkyTrace runtime stability patch: observer loops removed, aircraft close made constant-time, airport traffic renderer optimized, Replay+ work bounded.");
