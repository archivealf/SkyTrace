const $ = id => document.getElementById(id);
let token = sessionStorage.getItem("skytrace.webToken") || "";
let flights = [];
let ops = null;
let refreshTimer = null;

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-0.12, 51.5],
  zoom: 5
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  let p = {};
  try { p = await r.json(); } catch {}
  if (!r.ok || p.ok === false) {
    const e = new Error(p.error || `Request failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return p;
}

function setSigned(inward) {
  $("login").classList.toggle("hidden", inward);
  $("app").classList.toggle("hidden", !inward);
  $("status").textContent = inward ? "Connected" : "Offline";
  if (!inward) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    flights = [];
    $("visible").textContent = "0";
    $("alerts").textContent = "0";
  } else {
    startAutoRefresh();
  }
}

async function login() {
  const button = $("loginBtn");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const p = await api("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("username").value.trim(), password: $("password").value })
    });
    token = p.token;
    sessionStorage.setItem("skytrace.webToken", token);
    $("password").value = "";
    setSigned(true);
    await refresh();
  } catch (e) {
    $("loginMsg").textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

function geo() {
  const c = map.getCenter();
  return {
    lat: c.lat,
    lon: c.lng,
    radius: Math.max(30, Math.min(245, Math.round(260 / Math.pow(1.45, map.getZoom() - 3))))
  };
}

function trafficMetaText(g) {
  return `${Math.round(g.radius)} nm around map centre`;
}

async function refresh() {
  if (!token || !navigator.onLine) {
    if (!navigator.onLine) $("status").textContent = "Offline";
    return;
  }
  const g = geo();
  $("trafficMeta").textContent = "Refreshing…";
  try {
    const p = await api(`/v1/v34/live?lat=${g.lat}&lon=${g.lon}&radius=${g.radius}`);
    flights = p.flights || [];
    $("visible").textContent = flights.length;
    $("trafficMeta").textContent = trafficMetaText(g);
    render();
    drawFlights();
    $("status").textContent = `${p.source} · ${p.cache}`;
  } catch (e) {
    $("trafficMeta").textContent = "Refresh failed";
    $("status").textContent = e.message;
    if (e.status === 401 || /sign in|session/i.test(e.message)) {
      token = "";
      sessionStorage.removeItem("skytrace.webToken");
      setSigned(false);
    }
  }
}

function render() {
  const list = $("list");
  const rows = flights.slice().sort((a, b) => (b.altitudeFt || 0) - (a.altitudeFt || 0)).slice(0, 80);
  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">No observed aircraft in this map area right now.<br>Pan or zoom the map, then press Refresh.</div>';
    return;
  }
  list.innerHTML = rows.map(f => `
    <button type="button" class="flight" data-icao="${esc(f.icao24)}" aria-label="Open aircraft ${esc(f.callsign || f.registration || f.icao24)}">
      <span><strong>${esc(f.callsign || f.registration || f.icao24)}</strong><small>${esc(f.registration || f.icao24)} · ${esc(f.aircraftType || "Unknown type")}${f.squawk ? ` · SQ ${esc(f.squawk)}` : ""}</small></span>
      <small class="flight-metrics">${Number.isFinite(Number(f.altitudeFt)) ? Number(f.altitudeFt).toLocaleString() : "—"} ft<br>${Number.isFinite(Number(f.speedKts)) ? Math.round(Number(f.speedKts)) : "—"} kt</small>
    </button>`).join("");
  document.querySelectorAll("[data-icao]").forEach(n => n.onclick = () => profile(n.dataset.icao));
}

function drawFlights() {
  const fc = {
    type: "FeatureCollection",
    features: flights
      .filter(f => Number.isFinite(Number(f.longitude)) && Number.isFinite(Number(f.latitude)))
      .map(f => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(f.longitude), Number(f.latitude)] },
        properties: { icao: f.icao24, callsign: f.callsign, heading: f.heading || 0 }
      }))
  };
  if (map.getSource("aircraft")) map.getSource("aircraft").setData(fc);
  else {
    map.addSource("aircraft", { type: "geojson", data: fc });
    map.addLayer({
      id: "aircraft",
      type: "circle",
      source: "aircraft",
      paint: { "circle-radius": 5, "circle-stroke-width": 1.5, "circle-color": "#ffffff", "circle-stroke-color": "#111827" }
    });
  }
}

async function profile(icao) {
  const d = $("drawer");
  d.classList.remove("hidden");
  d.textContent = "Loading aircraft profile…";
  try {
    const p = await api(`/v1/v34/aircraft-profile?icao=${encodeURIComponent(icao)}`);
    const c = p.current || {};
    d.innerHTML = `<b>${esc(c.callsign || c.registration || icao)}</b><br>${esc(c.registration || icao)} · ${esc(c.aircraftType || "Unknown type")}<br>30-day samples: ${Number(p.summary?.samples || 0).toLocaleString()}<br>Max observed altitude: ${Math.round(p.summary?.maxAltitudeFt || 0).toLocaleString()} ft<br>Max observed speed: ${Math.round(p.summary?.maxSpeedKts || 0)} kt<br><small>${esc(p.note?.note || "No private note")}</small>`;
  } catch (e) {
    d.textContent = e.status === 403 ? "Aircraft Profiles require Advanced Aircraft or SkyTrace Pro." : e.message;
  }
}

function addGeoLayer(id, data, paint) {
  if (!data?.features) return;
  if (map.getSource(id)) map.getSource(id).setData(data);
  else {
    map.addSource(id, { type: "geojson", data });
    map.addLayer({ id, type: "line", source: id, paint });
  }
}

async function loadOps() {
  const d = $("drawer");
  d.classList.remove("hidden");
  d.textContent = "Loading operations…";
  try {
    ops = await api("/v1/v34/operations");
    const groups = [
      ["International SIGMET", ops.internationalSigmets],
      ["Domestic SIGMET", ops.domesticSigmets],
      ["G-AIRMET", ops.graphicalAirmets],
      ["PIREP", ops.pireps]
    ];
    $("alerts").textContent = groups.reduce((n, [, g]) => n + (g?.geojson?.features?.length || 0), 0);
    d.innerHTML = groups.map(([n, g]) => `<b>${esc(n)}</b>: ${g?.geojson?.features?.length || 0}<br>`).join("") + `<br><b>NOTAM</b>: ${ops.notams?.configured ? (ops.notams.ok ? "connected" : "feed error") : "official feed not configured"}`;
    addGeoLayer("sigmet-int", ops.internationalSigmets?.geojson, { "line-color": "#ef4444", "line-width": 2 });
    addGeoLayer("sigmet-dom", ops.domesticSigmets?.geojson, { "line-color": "#f97316", "line-width": 2 });
    addGeoLayer("gairmet", ops.graphicalAirmets?.geojson, { "line-color": "#eab308", "line-width": 1.5 });
  } catch (e) {
    d.textContent = e.message;
  }
}

async function replay() {
  const d = $("drawer");
  d.classList.remove("hidden");
  d.textContent = "Loading Replay+…";
  try {
    const to = Date.now();
    const from = to - 6 * 3600_000;
    const p = await api(`/v1/v34/replay?from=${from}&to=${to}&limit=8000`);
    const lines = new Map();
    for (const x of p.points || []) {
      if (!lines.has(x.icao)) lines.set(x.icao, []);
      lines.get(x.icao).push([Number(x.longitude), Number(x.latitude)]);
    }
    const fc = {
      type: "FeatureCollection",
      features: [...lines]
        .filter(([, c]) => c.length > 1)
        .map(([icao, c]) => ({ type: "Feature", properties: { icao }, geometry: { type: "LineString", coordinates: c } }))
    };
    if (map.getSource("replay")) map.getSource("replay").setData(fc);
    else {
      map.addSource("replay", { type: "geojson", data: fc });
      map.addLayer({ id: "replay", type: "line", source: "replay", paint: { "line-color": "#60a5fa", "line-width": 2, "line-opacity": .65 } });
    }
    d.innerHTML = `Loaded <b>${Number(p.count || 0).toLocaleString()}</b> globally aggregated observations from the last six hours.`;
  } catch (e) {
    d.textContent = e.status === 403 ? "Replay+ requires Replay+ or SkyTrace Pro." : e.message;
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (token && !document.hidden && navigator.onLine) refresh();
  }, 12000);
}

function setupInstallMode() {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  $("installHint").classList.toggle("hidden", !isIOS || standalone);
  document.documentElement.classList.toggle("standalone-webapp", standalone);
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {}));
}

$("loginBtn").onclick = login;
$("password").onkeydown = e => { if (e.key === "Enter") login(); };
$("refreshBtn").onclick = refresh;
$("opsBtn").onclick = loadOps;
$("replayBtn").onclick = replay;
$("logoutBtn").onclick = () => {
  token = "";
  sessionStorage.removeItem("skytrace.webToken");
  setSigned(false);
};

map.on("moveend", () => token && refresh());
map.on("load", () => token && refresh());
window.addEventListener("focus", () => token && refresh());
window.addEventListener("online", () => token && refresh());
window.addEventListener("offline", () => { $("status").textContent = "Offline"; });
window.addEventListener("pageshow", () => { if (token && !document.hidden) refresh(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && token) refresh(); });

setupInstallMode();
setSigned(Boolean(token));
if (token) refresh();
