const $ = id => document.getElementById(id);
const root = document.documentElement;
const panel = document.querySelector(".panel");

let token = sessionStorage.getItem("skytrace.webToken") || "";
let flights = [];
let ops = null;
let refreshTimer = null;
let viewportFrame = 0;
let panelResizeObserver = null;
let viewportOrientation = window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
let restingViewportHeight = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || 1));

const iOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const iPadDevice = /iPad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const iPhoneDevice = iOSDevice && !iPadDevice;

root.classList.toggle("ios-device", iOSDevice);
root.classList.toggle("ios-ipad", iPadDevice);
root.classList.toggle("ios-iphone", iPhoneDevice);

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

function setStatus(value) {
  const text = String(value || "");
  const node = $("status");
  node.textContent = text;
  node.title = text;
}

function setTrafficMeta(value) {
  const text = String(value || "");
  const node = $("trafficMeta");
  node.textContent = text;
  node.title = text;
}

function updatePanelMetrics() {
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  root.style.setProperty("--skytrace-panel-height", `${Math.max(0, Math.ceil(rect.height))}px`);
}

function isEditingControl() {
  const active = document.activeElement;
  return Boolean(active && (active.matches?.("input,textarea,select") || active.isContentEditable));
}

function updateViewportMetrics() {
  const vv = window.visualViewport;
  const height = Math.max(1, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 1));
  const width = Math.max(1, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 1));
  const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0));
  const orientation = window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";

  if (orientation !== viewportOrientation) {
    viewportOrientation = orientation;
    restingViewportHeight = height;
  }

  const editing = isEditingControl();
  const keyboardOpen = iOSDevice && editing && (restingViewportHeight - height) > 90;
  if (!editing) restingViewportHeight = Math.max(restingViewportHeight, height);
  else if (!keyboardOpen && height > restingViewportHeight) restingViewportHeight = height;

  root.style.setProperty("--skytrace-vvh", `${height}px`);
  root.style.setProperty("--skytrace-vvw", `${width}px`);
  root.style.setProperty("--skytrace-vv-top", `${offsetTop}px`);
  root.classList.toggle("ios-keyboard-open", keyboardOpen);

  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    updatePanelMetrics();
    try { map.resize(); } catch {}
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportMetrics, { passive: true });
  window.visualViewport.addEventListener("scroll", updateViewportMetrics, { passive: true });
}
window.addEventListener("resize", updateViewportMetrics, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(updateViewportMetrics, 100), { passive: true });

if ("ResizeObserver" in window && panel) {
  panelResizeObserver = new ResizeObserver(() => updatePanelMetrics());
  panelResizeObserver.observe(panel);
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
  root.classList.toggle("signed-in", inward);
  setStatus(inward ? "Connected" : "Offline");
  if (!inward) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    flights = [];
    $("visible").textContent = "0";
    $("alerts").textContent = "0";
    $("drawer").classList.add("hidden");
  } else {
    startAutoRefresh();
  }
  requestAnimationFrame(updatePanelMetrics);
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
    document.activeElement?.blur?.();
    await refresh();
  } catch (e) {
    $("loginMsg").textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
    updateViewportMetrics();
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
    if (!navigator.onLine) setStatus("Offline");
    return;
  }
  const g = geo();
  setTrafficMeta("Refreshing…");
  try {
    const p = await api(`/v1/v34/live?lat=${g.lat}&lon=${g.lon}&radius=${g.radius}`);
    flights = p.flights || [];
    $("visible").textContent = flights.length;
    setTrafficMeta(trafficMetaText(g));
    render();
    drawFlights();
    setStatus(`${p.source} · ${p.cache}`);
  } catch (e) {
    setTrafficMeta("Refresh failed");
    setStatus(e.message);
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

function showDrawer(content, label) {
  const d = $("drawer");
  d.classList.remove("hidden");
  d.setAttribute("aria-label", label || "SkyTrace detail");
  if (typeof content === "string") d.innerHTML = content;
  requestAnimationFrame(updatePanelMetrics);
  return d;
}

async function profile(icao) {
  const d = showDrawer("Loading aircraft profile…", "Aircraft profile");
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
  const d = showDrawer("Loading operations…", "Operations");
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
  const d = showDrawer("Loading Replay+…", "Replay plus");
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
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  $("installHint").classList.toggle("hidden", !iOSDevice || standalone);
  root.classList.toggle("standalone-webapp", standalone);
  updateViewportMetrics();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {}));
}

$("loginBtn").onclick = login;
$("username").onkeydown = e => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("password").focus();
  }
};
$("password").onkeydown = e => { if (e.key === "Enter") login(); };
$("refreshBtn").onclick = refresh;
$("opsBtn").onclick = loadOps;
$("replayBtn").onclick = replay;
$("logoutBtn").onclick = () => {
  token = "";
  sessionStorage.removeItem("skytrace.webToken");
  setSigned(false);
};

document.addEventListener("focusin", () => { if (iOSDevice) setTimeout(updateViewportMetrics, 60); });
document.addEventListener("focusout", () => { if (iOSDevice) setTimeout(updateViewportMetrics, 160); });
map.on("moveend", () => token && refresh());
map.on("load", () => token && refresh());
window.addEventListener("focus", () => token && refresh());
window.addEventListener("online", () => token && refresh());
window.addEventListener("offline", () => setStatus("Offline"));
window.addEventListener("pageshow", () => {
  updateViewportMetrics();
  if (token && !document.hidden) refresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateViewportMetrics();
  if (!document.hidden && token) refresh();
});

setupInstallMode();
setSigned(Boolean(token));
if (token) refresh();
