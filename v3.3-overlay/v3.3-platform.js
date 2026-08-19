(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const cloud = { authenticated: false, user: null, entitlements: [], effectiveEntitlements: [], watchlist: [], alerts: [], bookmarks: [], workspaces: [] };
  const runtime = { map: null, lastFlights: [], fired: new Map(), replayLoaded: false };

  function esc(v) { return String(v ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[m]); }
  function toast(message, ms = 4500) {
    const node = $("toast"); if (!node) return;
    node.textContent = message; node.classList.remove("hidden");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add("hidden"), ms);
  }
  async function jsonFetch(url, options) {
    const response = await fetch(url, options); let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }
  function has(key) { return cloud.effectiveEntitlements.includes(key) || cloud.effectiveEntitlements.includes("pro"); }

  function patchFetch() {
    if (window.__skytracePlatformFetchPatched) return;
    window.__skytracePlatformFetchPatched = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        if (/\/api\/flights(?:\?|$)/.test(url) && response.ok) {
          const clone = response.clone();
          clone.json().then(data => {
            if (Array.isArray(data?.flights)) {
              runtime.lastFlights = data.flights;
              evaluateAlerts(data.flights);
              renderLiveCloudStats();
            }
          }).catch(() => {});
        }
      } catch {}
      return response;
    };
  }

  function patchMap() {
    if (runtime.map || window.__skytracePlatformMapPatched) return;
    if (!window.maplibregl?.Map) return setTimeout(patchMap, 100);
    window.__skytracePlatformMapPatched = true;
    const Original = window.maplibregl.Map;
    class SkyTraceMap extends Original {
      constructor(...args) { super(...args); runtime.map = this; window.__SKYTRACE_MAP__ = this; this.once("load", () => renderLiveCloudStats()); }
    }
    Object.setPrototypeOf(SkyTraceMap, Original);
    window.maplibregl.Map = SkyTraceMap;
  }

  function installStyles() {
    if ($("skytraceCloudStyles")) return;
    const style = document.createElement("style"); style.id = "skytraceCloudStyles";
    style.textContent = `
      .cloud-scroll{display:flex;flex-direction:column;gap:10px;padding-bottom:22px}.cloud-card{border:1px solid #ffffff18;background:#ffffff08;border-radius:16px;padding:13px}.cloud-card h3{margin:2px 0 6px;font-size:14px}.cloud-card p{margin:0 0 10px;color:var(--muted,#9298a6);font-size:11px;line-height:1.45}.cloud-row{display:flex;gap:7px;align-items:center}.cloud-row+.cloud-row{margin-top:7px}.cloud-input,.cloud-select{min-width:0;flex:1;border:1px solid #ffffff1c;background:#05070caa;color:inherit;border-radius:10px;padding:9px 10px;font-size:11px;outline:none}.cloud-button{border:1px solid #ffffff20;background:#ffffff10;color:inherit;border-radius:10px;padding:9px 10px;font-weight:700;font-size:11px;cursor:pointer}.cloud-button:disabled{opacity:.45}.cloud-button.danger{border-color:#ff6a7655}.cloud-list{display:flex;flex-direction:column;gap:6px;margin-top:9px}.cloud-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 9px;border:1px solid #ffffff12;border-radius:11px;background:#0002}.cloud-item strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.cloud-item small{display:block;color:var(--muted,#9298a6);font-size:9px;margin-top:2px}.cloud-actions{display:flex;gap:5px}.cloud-icon{border:0;background:#ffffff0c;color:inherit;border-radius:8px;padding:6px 8px;cursor:pointer}.cloud-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.cloud-stat{padding:8px;border-radius:10px;background:#ffffff08;text-align:center}.cloud-stat b{display:block;font-size:16px}.cloud-stat span{font-size:8px;color:var(--muted,#9298a6);letter-spacing:.06em}.cloud-lock{padding:9px;border:1px dashed #ffffff22;border-radius:11px;color:var(--muted,#9298a6);font-size:10px;line-height:1.4}.airport-ops{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0}.airport-ops div{background:#ffffff08;border-radius:9px;padding:7px;text-align:center}.airport-ops b{display:block;font-size:15px}.airport-ops span{font-size:8px;color:var(--muted,#9298a6)}.airport-move{font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 0;border-bottom:1px solid #ffffff0c}.replay-meta{font-size:9px;color:var(--muted,#9298a6);margin-top:7px}.cloud-badge{font-size:8px;border:1px solid #ffffff20;border-radius:999px;padding:3px 6px;color:var(--muted,#9298a6)}.cloud-mode-tab span{font-size:16px}@media(max-width:520px){.cloud-row{flex-wrap:wrap}.cloud-row>.cloud-input,.cloud-row>.cloud-select{flex-basis:100%}.airport-ops{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(style);
  }

  function ensureUi() {
    installStyles();
    const rail = document.querySelector(".flightdeck-rail");
    if (rail && !rail.querySelector('[data-view="cloud"]')) {
      const button = document.createElement("button"); button.className = "mode-tab cloud-mode-tab"; button.dataset.view = "cloud";
      button.innerHTML = "<span>☁</span><b>Cloud</b>"; rail.appendChild(button);
      button.addEventListener("click", () => switchCloud());
    }
    const sidebar = $("sidebar");
    if (sidebar && !$("cloudView")) {
      const section = document.createElement("section"); section.className = "side-view"; section.id = "cloudView";
      section.innerHTML = `
        <div class="sidebar-head"><div><div class="eyebrow">SKYTRACE CLOUD</div><h1>Synced tools</h1></div><span class="cloud-badge" id="cloudAccountBadge">Sign in</span></div>
        <div class="scroll-list cloud-scroll">
          <article class="cloud-card"><h3>Live watch</h3><p>Synced aircraft/callsign watchlist and live alert matching.</p><div class="cloud-stat-grid"><div class="cloud-stat"><b id="cloudFlightCount">0</b><span>VISIBLE</span></div><div class="cloud-stat"><b id="cloudWatchHits">0</b><span>WATCH HITS</span></div><div class="cloud-stat"><b id="cloudAlertCount">0</b><span>ALERTS</span></div></div></article>
          <article class="cloud-card"><h3>Watchlist</h3><div class="cloud-row"><select class="cloud-select" id="watchKind"><option value="callsign">Callsign</option><option value="icao">ICAO hex</option><option value="registration">Registration</option><option value="type">Aircraft type</option></select><input class="cloud-input" id="watchValue" placeholder="BAW123 / 40621D"><button class="cloud-button" id="watchAdd">Add</button></div><div class="cloud-list" id="watchList"></div></article>
          <article class="cloud-card"><h3>Alerts</h3><p>Advanced Aircraft alerts fire while SkyTrace is running. Area alerts use the current map centre.</p><div id="alertGate"><div class="cloud-row"><select class="cloud-select" id="alertKind"><option value="callsign">Callsign appears</option><option value="icao">ICAO appears</option><option value="registration">Registration appears</option><option value="type">Aircraft type appears</option><option value="squawk">Squawk equals</option><option value="emergency">Emergency reported</option><option value="altitude_above">Altitude above</option><option value="altitude_below">Altitude below</option><option value="area">Enters current map area</option></select><input class="cloud-input" id="alertValue" placeholder="Value"><button class="cloud-button" id="alertAdd">Add</button></div><div class="cloud-list" id="alertList"></div></div></article>
          <article class="cloud-card"><h3>Bookmarks</h3><p>Save airports, aircraft or the current map position to your account.</p><div class="cloud-row"><select class="cloud-select" id="bookmarkKind"><option value="airport">Airport</option><option value="aircraft">Aircraft</option><option value="location">Current map</option></select><input class="cloud-input" id="bookmarkValue" placeholder="EGLL / G-EUPJ"><button class="cloud-button" id="bookmarkAdd">Save</button></div><div class="cloud-list" id="bookmarkList"></div></article>
          <article class="cloud-card"><h3>Workspaces</h3><p>Save the map camera and active map/layer/filter controls, then restore them on any signed-in Mac.</p><div class="cloud-row"><input class="cloud-input" id="workspaceName" maxlength="50" placeholder="Heathrow evening"><button class="cloud-button" id="workspaceSave">Save current</button></div><div class="cloud-list" id="workspaceList"></div></article>
          <article class="cloud-card"><h3>Cloud Replay+</h3><p>Replay server-synced ADS-B observations collected while signed-in SkyTrace clients are viewing them. History is retained for 30 days.</p><div id="replayGate"><div class="cloud-row"><input class="cloud-input" id="replayFrom" type="datetime-local"><input class="cloud-input" id="replayTo" type="datetime-local"></div><div class="cloud-row"><input class="cloud-input" id="replayIcao" placeholder="ICAO hex (optional)"><button class="cloud-button" id="replayLoad">Load</button><button class="cloud-button" id="replayClear">Clear</button></div><div class="cloud-row"><button class="cloud-button" id="replayCsv">Export CSV</button><button class="cloud-button" id="replayGeo">Export GeoJSON</button><button class="cloud-button" id="replayKml">Export KML</button></div><canvas id="replayChart" width="520" height="120" style="width:100%;height:90px;margin-top:8px;border-radius:10px;background:#0002"></canvas><div class="replay-meta" id="replayMeta">No cloud replay loaded.</div></div></article>
          <article class="cloud-card"><h3>Airport Intelligence</h3><p>Live observed traffic, arrival/departure estimates, runway/frequency reference and aviation weather in one panel.</p><div id="airportGate"><div class="cloud-row"><input class="cloud-input" id="airportIntelCode" maxlength="4" placeholder="EGLL"><button class="cloud-button" id="airportIntelLoad">Analyse</button></div><div id="airportIntelResult"></div></div></article>
        </div>`;
      const footer = sidebar.querySelector("footer.source-row"); sidebar.insertBefore(section, footer || null);
      bindUi(); setDefaultReplayTimes();
    }
  }

  function switchCloud() {
    document.querySelectorAll(".mode-tab").forEach(b => b.classList.toggle("active", b.dataset.view === "cloud"));
    document.querySelectorAll(".side-view").forEach(v => v.classList.toggle("active", v.id === "cloudView"));
    $("sidebar")?.classList.remove("collapsed"); loadCloud();
  }

  async function loadAccount() {
    try {
      const p = await jsonFetch("/api/account/me");
      cloud.authenticated = Boolean(p.authenticated); cloud.user = p.user || null;
      cloud.entitlements = p.entitlements || []; cloud.effectiveEntitlements = p.effectiveEntitlements || [];
    } catch { cloud.authenticated = false; cloud.user = null; cloud.entitlements = []; cloud.effectiveEntitlements = []; }
  }
  async function loadCloud() {
    await loadAccount();
    if (!cloud.authenticated) {
      $("cloudAccountBadge").textContent = "Sign in";
      for (const id of ["watchList","alertList","bookmarkList","workspaceList"]) if ($(id)) $(id).innerHTML = '<div class="cloud-lock">Sign in to your SkyTrace account to sync this section.</div>';
      renderGates(); return;
    }
    $("cloudAccountBadge").textContent = cloud.user?.username || "Signed in";
    try {
      const p = await jsonFetch("/api/account/cloud");
      cloud.watchlist = p.watchlist || []; cloud.alerts = p.alerts || []; cloud.bookmarks = p.bookmarks || []; cloud.workspaces = p.workspaces || [];
    } catch (e) { toast(e.message); }
    renderAll();
  }

  async function upsert(kind, key, label, data = {}) {
    if (!cloud.authenticated) return toast("Sign in to sync SkyTrace Cloud.");
    const p = await jsonFetch("/api/account/cloud/upsert", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ kind, key, label, data }) });
    await loadCloud(); return p.item;
  }
  async function remove(item) {
    await jsonFetch("/api/account/cloud/delete", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id:item.id }) });
    await loadCloud();
  }

  function itemHtml(item, subtitle, actions = "") {
    return `<div class="cloud-item"><div><strong>${esc(item.label || item.key)}</strong><small>${esc(subtitle)}</small></div><div class="cloud-actions">${actions}<button class="cloud-icon" data-cloud-delete="${esc(item.id)}">×</button></div></div>`;
  }
  function bindDeleteButtons() {
    document.querySelectorAll("[data-cloud-delete]").forEach(btn => btn.onclick = () => {
      const all = [...cloud.watchlist, ...cloud.alerts, ...cloud.bookmarks, ...cloud.workspaces];
      const item = all.find(x => x.id === btn.dataset.cloudDelete); if (item) void remove(item);
    });
  }
  function renderAll() {
    renderGates(); renderWatchlist(); renderAlerts(); renderBookmarks(); renderWorkspaces(); renderLiveCloudStats();
  }
  function renderGates() {
    if ($("alertGate")) $("alertGate").classList.toggle("hidden", !has("advanced_aircraft"));
    if ($("alertGate")?.parentElement) {
      let lock = $("alertGateLock");
      if (!has("advanced_aircraft") && !lock) { lock = document.createElement("div"); lock.id="alertGateLock"; lock.className="cloud-lock"; lock.textContent="Advanced Aircraft or SkyTrace Pro unlocks synced live alerts."; $("alertGate").parentElement.appendChild(lock); }
      if (has("advanced_aircraft")) lock?.remove();
    }
    if ($("replayGate")) $("replayGate").classList.toggle("hidden", !has("replay_plus"));
    if ($("replayGate")?.parentElement) {
      let lock = $("replayGateLock");
      if (!has("replay_plus") && !lock) { lock = document.createElement("div"); lock.id="replayGateLock"; lock.className="cloud-lock"; lock.textContent="Replay+ or SkyTrace Pro unlocks 30-day Cloud Replay and exports."; $("replayGate").parentElement.appendChild(lock); }
      if (has("replay_plus")) lock?.remove();
    }
    if ($("airportGate")) $("airportGate").classList.toggle("hidden", !has("airport_intelligence"));
    if ($("airportGate")?.parentElement) {
      let lock = $("airportGateLock");
      if (!has("airport_intelligence") && !lock) { lock = document.createElement("div"); lock.id="airportGateLock"; lock.className="cloud-lock"; lock.textContent="Airport Intelligence or SkyTrace Pro unlocks this operations panel."; $("airportGate").parentElement.appendChild(lock); }
      if (has("airport_intelligence")) lock?.remove();
    }
  }
  function renderWatchlist() {
    if (!$("watchList")) return;
    $("watchList").innerHTML = cloud.watchlist.length ? cloud.watchlist.map(i => itemHtml(i, `${i.data?.kind || "target"}: ${i.data?.value || i.key}`)).join("") : '<div class="cloud-lock">No synced watchlist items yet.</div>';
    bindDeleteButtons();
  }
  function renderAlerts() {
    if (!$("alertList") || !has("advanced_aircraft")) return;
    $("alertList").innerHTML = cloud.alerts.length ? cloud.alerts.map(i => itemHtml(i, describeAlert(i))).join("") : '<div class="cloud-lock">No alerts yet.</div>';
    bindDeleteButtons();
  }
  function renderBookmarks() {
    if (!$("bookmarkList")) return;
    $("bookmarkList").innerHTML = cloud.bookmarks.length ? cloud.bookmarks.map(i => itemHtml(i, i.data?.kind || "bookmark", `<button class="cloud-icon" data-bookmark-open="${esc(i.id)}">↗</button>`)).join("") : '<div class="cloud-lock">No bookmarks saved.</div>';
    document.querySelectorAll("[data-bookmark-open]").forEach(b => b.onclick = () => openBookmark(cloud.bookmarks.find(i => i.id === b.dataset.bookmarkOpen)));
    bindDeleteButtons();
  }
  function renderWorkspaces() {
    if (!$("workspaceList")) return;
    $("workspaceList").innerHTML = cloud.workspaces.length ? cloud.workspaces.map(i => itemHtml(i, `${Number(i.data?.zoom || 0).toFixed(1)} zoom`, `<button class="cloud-icon" data-workspace-load="${esc(i.id)}">Load</button>`)).join("") : '<div class="cloud-lock">No workspaces saved.</div>';
    document.querySelectorAll("[data-workspace-load]").forEach(b => b.onclick = () => applyWorkspace(cloud.workspaces.find(i => i.id === b.dataset.workspaceLoad)));
    bindDeleteButtons();
  }
  function renderLiveCloudStats() {
    if ($("cloudFlightCount")) $("cloudFlightCount").textContent = runtime.lastFlights.length;
    const hits = runtime.lastFlights.filter(f => cloud.watchlist.some(w => matchTarget(f, w.data || {}))).length;
    if ($("cloudWatchHits")) $("cloudWatchHits").textContent = hits;
    if ($("cloudAlertCount")) $("cloudAlertCount").textContent = cloud.alerts.length;
  }

  function normalize(v) { return String(v || "").trim().toUpperCase(); }
  function matchTarget(f, data) {
    const kind = data.kind, val = normalize(data.value);
    if (kind === "callsign") return normalize(f.callsign) === val;
    if (kind === "icao") return normalize(f.icao24) === val;
    if (kind === "registration") return normalize(f.registration) === val;
    if (kind === "type") return normalize(f.aircraftType) === val;
    return false;
  }
  function describeAlert(item) {
    const d = item.data || {};
    if (d.kind === "area") return `Area · ${Number(d.radiusNm || 25)} nm around ${Number(d.lat).toFixed(2)}, ${Number(d.lon).toFixed(2)}`;
    if (d.kind === "emergency") return "Any reported emergency";
    return `${String(d.kind || "alert").replaceAll("_"," ")} · ${d.value || ""}`;
  }
  function alertMatch(f, d) {
    const val = normalize(d.value);
    if (["callsign","icao","registration","type"].includes(d.kind)) return matchTarget(f, d);
    if (d.kind === "squawk") return normalize(f.squawk) === val;
    if (d.kind === "emergency") return Boolean(f.emergency) || ["7500","7600","7700"].includes(String(f.squawk || ""));
    if (d.kind === "altitude_above") return Number(f.altitudeFt) > Number(d.value);
    if (d.kind === "altitude_below") return Number.isFinite(Number(f.altitudeFt)) && Number(f.altitudeFt) < Number(d.value);
    if (d.kind === "area") return distanceNm(Number(d.lat), Number(d.lon), Number(f.latitude), Number(f.longitude)) <= Number(d.radiusNm || 25);
    return false;
  }
  function distanceNm(aLat,aLon,bLat,bLon) {
    if (![aLat,aLon,bLat,bLon].every(Number.isFinite)) return Infinity;
    const r=3440.065, rad=d=>d*Math.PI/180, p1=rad(aLat),p2=rad(bLat),dp=rad(bLat-aLat),dl=rad(bLon-aLon);
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function evaluateAlerts(flights) {
    if (!cloud.authenticated || !has("advanced_aircraft") || !cloud.alerts.length) return;
    const t = Date.now();
    for (const alert of cloud.alerts) {
      const matches = flights.filter(f => alertMatch(f, alert.data || {}));
      for (const f of matches.slice(0, 3)) {
        const key = `${alert.id}:${f.icao24}`; const last = runtime.fired.get(key) || 0;
        if (t - last < 10 * 60_000) continue;
        runtime.fired.set(key, t);
        const target = f.callsign || f.registration || f.icao24;
        toast(`Alert: ${alert.label || describeAlert(alert)} · ${target}`, 7000);
      }
    }
  }

  async function addWatch() {
    const kind = $("watchKind").value, value = normalize($("watchValue").value); if (!value) return toast("Enter a watchlist value.");
    await upsert("watchlist", `${kind}:${value}`, value, { kind, value }); $("watchValue").value="";
  }
  async function addAlert() {
    if (!has("advanced_aircraft")) return toast("Advanced Aircraft or Pro is required for alerts.");
    const kind = $("alertKind").value; let value = $("alertValue").value.trim(); let data = { kind, value };
    if (kind === "area") {
      const map = runtime.map || window.__SKYTRACE_MAP__; if (!map) return toast("Map is not ready yet.");
      const c = map.getCenter(); data = { kind, lat:c.lat, lon:c.lng, radiusNm:Number(value)||25 }; value = `${data.radiusNm}nm`;
    } else if (kind === "emergency") value = "emergency";
    if (!value && kind !== "emergency") return toast("Enter an alert value.");
    await upsert("alert", `${kind}:${normalize(value)}:${Date.now()}`, `${String(kind).replaceAll("_"," ")}: ${value}`, data); $("alertValue").value="";
  }
  async function addBookmark() {
    const kind=$("bookmarkKind").value; let value=$("bookmarkValue").value.trim(); let data={kind,value};
    if (kind === "location") {
      const map=runtime.map||window.__SKYTRACE_MAP__; if(!map)return toast("Map is not ready yet."); const c=map.getCenter();
      data={kind,lat:c.lat,lon:c.lng,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}; value=value||`${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
    }
    if(!value)return toast("Enter an airport or aircraft value.");
    if(kind==="airport") {
      try { const p=await jsonFetch(`/api/airports?q=${encodeURIComponent(value)}&limit=1`); const a=p.airports?.[0]; if(a)data={kind,value:a.icao||a.ident,lat:a.lat,lon:a.lon,zoom:10,name:a.name}; } catch {}
    }
    await upsert("bookmark",`${kind}:${normalize(value)}`,value,data); $("bookmarkValue").value="";
  }
  function openBookmark(item) {
    if(!item)return; const d=item.data||{}; const map=runtime.map||window.__SKYTRACE_MAP__;
    if(d.kind==="location"||d.kind==="airport") { if(map&&Number.isFinite(Number(d.lat))&&Number.isFinite(Number(d.lon))) map.flyTo({center:[Number(d.lon),Number(d.lat)],zoom:Number(d.zoom)||10,duration:900}); }
    else if(d.kind==="aircraft") { const input=document.querySelector('input[type="search"],#searchInput,#globalSearch'); if(input){input.value=d.value||item.label;input.dispatchEvent(new Event("input",{bubbles:true}));} }
  }
  function captureControls() {
    const out={}; document.querySelectorAll("input[id],select[id]").forEach(el=>{if(!/(layer|filter|category|performance|terrain|weather)/i.test(el.id))return;if(el.type==="checkbox")out[el.id]=el.checked;else if(el.tagName==="SELECT")out[el.id]=el.value;}); return out;
  }
  async function saveWorkspace() {
    const name=$("workspaceName").value.trim(); if(!name)return toast("Name this workspace first."); const map=runtime.map||window.__SKYTRACE_MAP__; if(!map)return toast("Map is not ready yet.");
    const c=map.getCenter(); const data={lat:c.lat,lon:c.lng,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),controls:captureControls()};
    await upsert("workspace",name.toLowerCase().replace(/\s+/g,"-").slice(0,60),name,data); $("workspaceName").value="";
  }
  function applyWorkspace(item) {
    if(!item)return; const d=item.data||{}, map=runtime.map||window.__SKYTRACE_MAP__;
    if(map) map.easeTo({center:[Number(d.lon)||0,Number(d.lat)||0],zoom:Number(d.zoom)||5,bearing:Number(d.bearing)||0,pitch:Number(d.pitch)||0,duration:900});
    for(const [id,value] of Object.entries(d.controls||{})){const el=$(id);if(!el)continue;if(el.type==="checkbox"&&el.checked!==Boolean(value)){el.checked=Boolean(value);el.dispatchEvent(new Event("change",{bubbles:true}));}else if(el.tagName==="SELECT"&&el.value!==value){el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));}}
    toast(`Workspace loaded: ${item.label||item.key}`);
  }

  function setDefaultReplayTimes() {
    const to=new Date(), from=new Date(to.getTime()-60*60_000); const fmt=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    if($("replayTo"))$("replayTo").value=fmt(to); if($("replayFrom"))$("replayFrom").value=fmt(from);
  }
  function replayParams() {
    const from=new Date($("replayFrom").value).getTime(), to=new Date($("replayTo").value).getTime(); const p=new URLSearchParams();
    if(Number.isFinite(from))p.set("from",String(from));if(Number.isFinite(to))p.set("to",String(to));const icao=$("replayIcao").value.trim();if(icao)p.set("icao",icao);p.set("limit","25000");return p;
  }
  async function loadReplay() {
    if(!has("replay_plus"))return toast("Replay+ or Pro is required.");
    try { $("replayMeta").textContent="Loading cloud history…"; const p=await jsonFetch(`/api/account/history?${replayParams()}`); drawReplay(p.points||[]); drawReplayChart(p.points||[]); $("replayMeta").textContent=`${(p.points||[]).length.toLocaleString()} points loaded · ${p.retentionDays||30}-day retention · ${p.coverage||"community-collected"} coverage.`; }
    catch(e){$("replayMeta").textContent=e.message;toast(e.message,5500)}
  }
  function drawReplay(points) {
    const map=runtime.map||window.__SKYTRACE_MAP__; if(!map)return toast("Map is not ready yet."); clearReplay();
    const groups=new Map();for(const p of points){if(!Number.isFinite(Number(p.longitude))||!Number.isFinite(Number(p.latitude)))continue;(groups.get(p.icao24)||groups.set(p.icao24,[]).get(p.icao24)).push(p)}
    const features=[];for(const [icao,rows] of groups){rows.sort((a,b)=>a.recordedAt-b.recordedAt);if(rows.length<2)continue;features.push({type:"Feature",properties:{icao,callsign:rows.find(r=>r.callsign)?.callsign||icao},geometry:{type:"LineString",coordinates:rows.map(r=>[r.longitude,r.latitude])}})}
    if(!features.length)return;map.addSource("skytrace-cloud-replay",{type:"geojson",data:{type:"FeatureCollection",features}});map.addLayer({id:"skytrace-cloud-replay",type:"line",source:"skytrace-cloud-replay",paint:{"line-width":2.2,"line-opacity":.72}});runtime.replayLoaded=true;
    const all=features.flatMap(f=>f.geometry.coordinates);if(all.length){let minX=180,maxX=-180,minY=90,maxY=-90;for(const [x,y]of all){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}if(maxX-minX<300)map.fitBounds([[minX,minY],[maxX,maxY]],{padding:55,duration:700,maxZoom:10});}
  }
  function drawReplayChart(points){const canvas=$("replayChart");if(!canvas)return;const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const rows=points.filter(p=>Number.isFinite(Number(p.recordedAt))).sort((a,b)=>a.recordedAt-b.recordedAt);if(rows.length<2)return;const minT=rows[0].recordedAt,maxT=rows[rows.length-1].recordedAt||minT+1;const maxAlt=Math.max(1000,...rows.map(r=>Number(r.altitudeFt)||0));const maxSpd=Math.max(100,...rows.map(r=>Number(r.speedKts)||0));ctx.globalAlpha=.75;ctx.lineWidth=2;ctx.beginPath();rows.forEach((r,i)=>{const x=8+(w-16)*(r.recordedAt-minT)/(maxT-minT||1),y=h-8-(h-16)*(Number(r.altitudeFt)||0)/maxAlt;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.globalAlpha=.35;ctx.beginPath();rows.forEach((r,i)=>{const x=8+(w-16)*(r.recordedAt-minT)/(maxT-minT||1),y=h-8-(h-16)*(Number(r.speedKts)||0)/maxSpd;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.globalAlpha=1;ctx.font="10px system-ui";ctx.fillText("Altitude / speed profile",10,14)}
  function clearReplay(){const map=runtime.map||window.__SKYTRACE_MAP__;if(!map)return;if(map.getLayer("skytrace-cloud-replay"))map.removeLayer("skytrace-cloud-replay");if(map.getSource("skytrace-cloud-replay"))map.removeSource("skytrace-cloud-replay");runtime.replayLoaded=false;if($("replayMeta"))$("replayMeta").textContent="No cloud replay loaded."}
  function exportReplay(format){if(!has("replay_plus"))return toast("Replay+ or Pro is required.");const p=replayParams();p.set("format",format);window.open(`/api/account/history-export?${p.toString()}`,"_blank","noopener")}

  async function loadAirportIntel() {
    if(!has("airport_intelligence"))return toast("Airport Intelligence or Pro is required.");const code=normalize($("airportIntelCode").value);if(!code)return toast("Enter an ICAO or airport code.");
    const out=$("airportIntelResult");out.innerHTML='<p>Analysing live traffic…</p>';
    try {const p=await jsonFetch(`/api/airport-intelligence?icao=${encodeURIComponent(code)}`);renderAirportIntel(p)}catch(e){out.innerHTML=`<div class="cloud-lock">${esc(e.message)}</div>`}
  }
  function renderAirportIntel(p) {
    const a=p.airport||{},o=p.operations||{};const runway=(a.runways||[]).map(r=>`${r.ident} · ${r.lengthFt||"?"}ft ${r.surface||""}`).join("<br>")||"No runway data";
    const freq=(a.frequencies||[]).slice(0,8).map(f=>`${esc(f.type)} ${esc(f.mhz||"")}`).join(" · ")||"No frequency data";
    const moves=(o.movements||[]).slice(0,12).map(m=>`<div class="airport-move"><b>${esc(m.callsign||m.registration||m.icao24)}</b> · ${esc(m.movement)} · ${esc(m.distanceNm)}nm · ${esc(m.altitudeFt??"—")}ft</div>`).join("")||'<div class="replay-meta">No arrival/departure estimates in the current sample.</div>';
    const runwayUse=(o.runwayUseEstimate||[]).map(r=>`${esc(r.runway)} (${r.count})`).join(" · ")||"No strong runway-use signal";
    const types=(o.busiestTypes||[]).slice(0,6).map(t=>`${esc(t.type)} ${t.count}`).join(" · ")||"No type mix yet";
    const maxTraffic=Math.max(1,...(o.trafficProfile||[]).map(x=>Number(x.count)||0));
    const traffic=(o.trafficProfile||[]).map(x=>`<div style="display:grid;grid-template-columns:48px 1fr 24px;gap:5px;align-items:center;font-size:9px;margin:4px 0"><span>${esc(x.label)}</span><i style="display:block;height:6px;border-radius:99px;background:#ffffff22;overflow:hidden"><b style="display:block;height:100%;width:${Math.round((Number(x.count)||0)/maxTraffic*100)}%;background:currentColor"></b></i><b>${x.count||0}</b></div>`).join("");
    $("airportIntelResult").innerHTML=`<h3>${esc(a.icao||a.ident)} · ${esc(a.name)}</h3><p>${esc(a.city||"")} ${esc(a.country||"")}</p><div class="airport-ops"><div><b>${o.nearby||0}</b><span>NEARBY</span></div><div><b>${o.onGround||0}</b><span>ON GROUND</span></div><div><b>${o.inboundEstimate||0}</b><span>INBOUND*</span></div><div><b>${o.outboundEstimate||0}</b><span>OUTBOUND*</span></div></div><p><b>Runway-use estimate</b><br>${runwayUse}</p><p><b>Traffic profile</b>${traffic}</p><p><b>Aircraft mix</b><br>${types}</p><p><b>Runways</b><br>${runway}</p><p><b>Frequencies</b><br>${freq}</p>${moves}<div class="replay-meta">${esc(p.methodology||"")}</div>`;
  }

  function bindUi() {
    $("watchAdd")?.addEventListener("click",()=>void addWatch());$("alertAdd")?.addEventListener("click",()=>void addAlert());$("bookmarkAdd")?.addEventListener("click",()=>void addBookmark());$("workspaceSave")?.addEventListener("click",()=>void saveWorkspace());
    $("replayLoad")?.addEventListener("click",()=>void loadReplay());$("replayClear")?.addEventListener("click",clearReplay);$("replayCsv")?.addEventListener("click",()=>exportReplay("csv"));$("replayGeo")?.addEventListener("click",()=>exportReplay("geojson"));$("replayKml")?.addEventListener("click",()=>exportReplay("kml"));$("airportIntelLoad")?.addEventListener("click",()=>void loadAirportIntel());
    for(const [id,fn] of [["watchValue",addWatch],["alertValue",addAlert],["bookmarkValue",addBookmark],["workspaceName",saveWorkspace],["airportIntelCode",loadAirportIntel]])$(id)?.addEventListener("keydown",e=>{if(e.key==="Enter")void fn()});
  }

  patchFetch(); patchMap();
  const boot=()=>{ensureUi();void loadAccount().then(()=>{if($("cloudView")?.classList.contains("active"))void loadCloud();else renderGates()})};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  setInterval(()=>{if(cloud.authenticated)void loadAccount().then(()=>{if($("cloudView")?.classList.contains("active"))renderAll()})},60_000);
})();
