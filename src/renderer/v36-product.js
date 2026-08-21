(() => {
  "use strict";

  const native = window.skytraceNative;
  if (!native?.isMac) return;

  const STORAGE = {
    onboarding: "skytrace.v36.onboarding",
    whatsNew: "skytrace.v36.whats-new",
    watchlists: "skytrace.v36.watchlists",
    geofences: "skytrace.v36.geofences",
    alerts: "skytrace.v36.alerts",
    airportFavorites: "skytrace.v36.airport-favorites"
  };
  const ALERT_LIMIT = 250;
  const RELEASE_API = "https://api.github.com/repos/archivealf/SkyTrace/releases/latest";

  const state = {
    map: null,
    initialMap: null,
    snapshot: null,
    watchlists: readStore(STORAGE.watchlists, []),
    geofences: readStore(STORAGE.geofences, []),
    alerts: readStore(STORAGE.alerts, []),
    airportFavorites: readStore(STORAGE.airportFavorites, []),
    lastRuleHits: new Map(),
    fencePresence: new Map(),
    timeline: { points: [], from: 0, to: 0, at: 0, speed: 1, playing: false, timer: null, filter: "" },
    polygonDraft: null,
    update: null,
    commandOpen: false,
    activeDrawer: ""
  };

  const q = selector => document.querySelector(selector);
  const qa = selector => [...document.querySelectorAll(selector)];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch { return fallback; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function uid(prefix = "item") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function toast(text) {
    const node = $("toast");
    if (!node) return;
    node.textContent = text;
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), 3600);
  }

  function resolveMap() {
    state.map = state.map || window.__SKYTRACE_MAP__ || null;
    if (state.map && !state.initialMap) {
      try {
        const center = state.map.getCenter();
        state.initialMap = { center: [center.lng, center.lat], zoom: state.map.getZoom(), bearing: state.map.getBearing(), pitch: state.map.getPitch() };
      } catch {}
    }
    return state.map;
  }

  function mainSearch(value) {
    const input = q('.command-search input[type="search"], .command-search input, input[type="search"]');
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return true;
  }

  function normalize(value) { return String(value || "").trim().toLowerCase(); }

  function flightValue(flight, type) {
    const map = {
      icao: flight?.icao24 || flight?.icao,
      registration: flight?.registration,
      callsign: flight?.callsign,
      airline: flight?.airline || flight?.operator || String(flight?.callsign || "").slice(0, 3),
      type: flight?.aircraftType || flight?.typeCode || flight?.type,
      airport: [flight?.origin, flight?.destination, flight?.from, flight?.to].filter(Boolean).join(" ")
    };
    return normalize(map[type]);
  }

  function ruleMatchesFlight(rule, flight) {
    const expected = normalize(rule?.value);
    if (!expected) return false;
    const actual = flightValue(flight, rule?.type || "icao");
    if (!actual) return false;
    return rule?.type === "icao" || rule?.type === "registration" ? actual === expected : actual.includes(expected);
  }

  function matchingWatchlists(flight) {
    return state.watchlists.filter(list => list.enabled !== false && (list.rules || []).some(rule => ruleMatchesFlight(rule, flight)));
  }

  function alertTarget(flight = {}) {
    return String(flight.callsign || flight.registration || flight.icao24 || flight.icao || "").trim();
  }

  function addAlert({ title = "SkyTrace Alert", body = "", type = "system", target = "", nativeNotify = true } = {}) {
    const fingerprint = `${type}|${title}|${body}|${target}`;
    const recent = state.alerts[0];
    if (recent?.fingerprint === fingerprint && Date.now() - Number(recent.at || 0) < 20_000) return recent;
    const item = { id: uid("alert"), fingerprint, title, body, type, target, at: Date.now(), read: false };
    state.alerts.unshift(item);
    state.alerts = state.alerts.slice(0, ALERT_LIMIT);
    writeStore(STORAGE.alerts, state.alerts);
    renderAlertBadge();
    if (state.activeDrawer === "alerts") renderAlerts();
    if (nativeNotify) native.notify({ title, body, navigate: target ? { action: "search", value: target } : {} }).catch?.(() => {});
    return item;
  }

  function renderAlertBadge() {
    const unread = state.alerts.filter(item => !item.read).length;
    const badge = $("v36AlertBadge");
    if (!badge) return;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
  }

  function evaluateWatchlists(flights) {
    const now = Date.now();
    for (const flight of flights) {
      const target = alertTarget(flight);
      if (!target) continue;
      for (const list of matchingWatchlists(flight)) {
        const key = `${list.id}|${normalize(flight.icao24 || flight.icao || target)}`;
        const last = Number(state.lastRuleHits.get(key) || 0);
        if (now - last < 5 * 60_000) continue;
        state.lastRuleHits.set(key, now);
        addAlert({
          title: `${list.name || "Watchlist"} match`,
          body: `${target} matched ${list.name || "a SkyTrace watchlist"}${Number.isFinite(Number(flight.altitudeFt)) ? ` · ${Math.round(Number(flight.altitudeFt)).toLocaleString()} ft` : ""}`,
          type: "watchlist",
          target
        });
      }
    }
  }

  function haversineNm(aLat, aLon, bLat, bLon) {
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLon = (bLon - aLon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 3440.065 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function pointInPolygon(lon, lat, coordinates = []) {
    let inside = false;
    for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
      const xi = Number(coordinates[i]?.[0]), yi = Number(coordinates[i]?.[1]);
      const xj = Number(coordinates[j]?.[0]), yj = Number(coordinates[j]?.[1]);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function fenceContains(fence, flight) {
    const lat = Number(flight?.latitude), lon = Number(flight?.longitude), altitude = Number(flight?.altitudeFt);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (Number.isFinite(Number(fence.minAltitudeFt)) && altitude < Number(fence.minAltitudeFt)) return false;
    if (Number.isFinite(Number(fence.maxAltitudeFt)) && Number(fence.maxAltitudeFt) > 0 && altitude > Number(fence.maxAltitudeFt)) return false;
    if (fence.matchType && fence.matchValue && !ruleMatchesFlight({ type: fence.matchType, value: fence.matchValue }, flight)) return false;
    if (fence.shape === "polygon") return pointInPolygon(lon, lat, fence.coordinates || []);
    return haversineNm(Number(fence.center?.[1]), Number(fence.center?.[0]), lat, lon) <= Number(fence.radiusNm || 10);
  }

  function evaluateGeofences(flights) {
    for (const fence of state.geofences.filter(item => item.enabled !== false)) {
      for (const flight of flights) {
        const id = normalize(flight.icao24 || flight.icao || alertTarget(flight));
        if (!id) continue;
        const key = `${fence.id}|${id}`;
        const inside = fenceContains(fence, flight);
        const previous = state.fencePresence.get(key);
        state.fencePresence.set(key, inside);
        if (previous === undefined) continue;
        const entered = !previous && inside;
        const exited = previous && !inside;
        const wants = fence.trigger || "enter";
        if ((wants === "enter" && !entered) || (wants === "exit" && !exited) || (!entered && !exited)) continue;
        const target = alertTarget(flight);
        addAlert({
          title: `${fence.name || "Geofence"} ${entered ? "entry" : "exit"}`,
          body: `${target || id.toUpperCase()} ${entered ? "entered" : "left"} ${fence.name || "a SkyTrace geofence"}`,
          type: "geofence",
          target
        });
      }
    }
  }

  function captureSnapshot(snapshot) {
    if (!Array.isArray(snapshot?.flights)) return;
    state.snapshot = snapshot;
    evaluateWatchlists(snapshot.flights);
    evaluateGeofences(snapshot.flights);
    refreshPriorityLabels();
  }

  function installFetchCapture() {
    if (window.__skytraceV36FetchCapture) return;
    window.__skytraceV36FetchCapture = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (/\/api\/flights(?:\?|$)/.test(url) && response.ok) response.clone().json().then(captureSnapshot).catch(() => {});
      return response;
    };
  }

  function priorityTerms() {
    const terms = new Set();
    for (const list of state.watchlists) for (const rule of list.rules || []) if (rule.value) terms.add(normalize(rule.value));
    return [...terms].filter(Boolean);
  }

  function refreshPriorityLabels() {
    const terms = priorityTerms();
    for (const label of qa(".aircraft-label")) {
      const text = normalize(label.textContent);
      label.classList.toggle("skytrace-priority-label", terms.some(term => text.includes(term)));
    }
  }

  function updateZoomBand() {
    const map = resolveMap();
    if (!map) return;
    const zoom = Number(map.getZoom());
    document.documentElement.dataset.skytraceZoomBand = zoom < 5.4 ? "far" : zoom < 6.6 ? "mid" : "near";
  }

  function ensureDock() {
    if ($("v36ProductDock")) return;
    const dock = document.createElement("div");
    dock.id = "v36ProductDock";
    dock.className = "v36-dock";
    dock.innerHTML = `
      <button data-v36-open="timeline" title="SkyTrace Timeline (⌘⇧T)"><span>↺</span><small>Timeline</small></button>
      <button data-v36-open="watchlists" title="Watchlists (⌘⇧W)"><span>◎</span><small>Watch</small></button>
      <button data-v36-open="alerts" title="Alert Center (⌘⇧A)"><span>◌</span><small>Alerts</small><b id="v36AlertBadge" hidden>0</b></button>`;
    document.body.appendChild(dock);
    dock.addEventListener("click", event => {
      const button = event.target.closest?.("[data-v36-open]");
      if (button) openFeature(button.dataset.v36Open);
    });
    renderAlertBadge();
  }

  function ensureDrawer() {
    if ($("v36Drawer")) return;
    const root = document.createElement("div");
    root.id = "v36Drawer";
    root.className = "v36-drawer hidden";
    root.innerHTML = `<header><div><span class="v36-eyebrow">SKYTRACE PRODUCT TOOLS</span><h2 id="v36DrawerTitle">SkyTrace</h2></div><button id="v36DrawerClose" aria-label="Close">×</button></header><div id="v36DrawerBody" class="v36-drawer-body"></div>`;
    document.body.appendChild(root);
    $("v36DrawerClose").onclick = closeDrawer;
  }

  function closeDrawer() {
    state.activeDrawer = "";
    $("v36Drawer")?.classList.add("hidden");
  }

  function openDrawer(name, title) {
    ensureDrawer();
    state.activeDrawer = name;
    $("v36DrawerTitle").textContent = title;
    $("v36Drawer").classList.remove("hidden");
  }

  function openFeature(name) {
    if (name === "timeline") return openTimeline();
    if (name === "watchlists") { openDrawer("watchlists", "Watchlists & Geofences"); renderWatchlists(); return; }
    if (name === "alerts") { openDrawer("alerts", "Notification Center"); state.alerts.forEach(item => { item.read = true; }); writeStore(STORAGE.alerts, state.alerts); renderAlerts(); renderAlertBadge(); return; }
    if (name === "updates") { openDrawer("updates", "SkyTrace Updates"); renderUpdates(); return; }
  }

  function renderWatchlists() {
    const body = $("v36DrawerBody");
    if (!body) return;
    body.innerHTML = `
      <div class="v36-tabs"><button class="active" data-v36-watch-tab="lists">Watchlists</button><button data-v36-watch-tab="fences">Geofences</button></div>
      <section id="v36WatchLists"></section><section id="v36FenceLists" hidden></section>`;
    body.querySelectorAll("[data-v36-watch-tab]").forEach(button => button.onclick = () => {
      body.querySelectorAll("[data-v36-watch-tab]").forEach(x => x.classList.toggle("active", x === button));
      $("v36WatchLists").hidden = button.dataset.v36WatchTab !== "lists";
      $("v36FenceLists").hidden = button.dataset.v36WatchTab !== "fences";
    });
    renderWatchlistTab();
    renderFenceTab();
  }

  function renderWatchlistTab() {
    const root = $("v36WatchLists");
    if (!root) return;
    root.innerHTML = `
      <div class="v36-card v36-create"><h3>New watchlist</h3><div class="v36-row"><input id="v36ListName" placeholder="Name, e.g. Heathrow heavies"><button id="v36CreateList">Create</button></div></div>
      ${state.watchlists.map(list => `<article class="v36-card" data-list-id="${esc(list.id)}"><div class="v36-card-head"><div><h3>${esc(list.name)}</h3><small>${(list.rules || []).length} rule${(list.rules || []).length === 1 ? "" : "s"}</small></div><div><label class="v36-mini-switch"><input type="checkbox" data-list-enabled ${list.enabled !== false ? "checked" : ""}><span></span></label><button class="v36-icon danger" data-delete-list>×</button></div></div><div class="v36-rules">${(list.rules || []).map(rule => `<div class="v36-rule"><span>${esc(rule.type)}</span><strong>${esc(rule.value)}</strong><button data-rule-id="${esc(rule.id)}">×</button></div>`).join("") || '<p class="v36-muted">No rules yet.</p>'}</div><div class="v36-row"><select data-new-rule-type><option value="icao">ICAO hex</option><option value="registration">Registration</option><option value="callsign">Callsign</option><option value="airline">Airline / prefix</option><option value="type">Aircraft type</option><option value="airport">Origin / destination</option></select><input data-new-rule-value placeholder="Value"><button data-add-rule>Add</button></div></article>`).join("")}`;
    $("v36CreateList").onclick = () => {
      const name = $("v36ListName").value.trim();
      if (!name) return;
      state.watchlists.push({ id: uid("list"), name: name.slice(0, 60), enabled: true, rules: [] });
      writeStore(STORAGE.watchlists, state.watchlists);
      renderWatchlistTab();
    };
    root.querySelectorAll("[data-list-id]").forEach(card => {
      const list = state.watchlists.find(item => item.id === card.dataset.listId);
      card.querySelector("[data-list-enabled]").onchange = event => { list.enabled = event.target.checked; writeStore(STORAGE.watchlists, state.watchlists); };
      card.querySelector("[data-delete-list]").onclick = () => { state.watchlists = state.watchlists.filter(item => item.id !== list.id); writeStore(STORAGE.watchlists, state.watchlists); renderWatchlistTab(); refreshPriorityLabels(); };
      card.querySelector("[data-add-rule]").onclick = () => {
        const type = card.querySelector("[data-new-rule-type]").value;
        const value = card.querySelector("[data-new-rule-value]").value.trim();
        if (!value) return;
        list.rules.push({ id: uid("rule"), type, value: value.slice(0, 60) });
        writeStore(STORAGE.watchlists, state.watchlists);
        renderWatchlistTab();
        refreshPriorityLabels();
      };
      card.querySelectorAll("[data-rule-id]").forEach(button => button.onclick = () => { list.rules = list.rules.filter(rule => rule.id !== button.dataset.ruleId); writeStore(STORAGE.watchlists, state.watchlists); renderWatchlistTab(); refreshPriorityLabels(); });
    });
  }

  function fenceGeoJson() {
    const features = [];
    for (const fence of state.geofences) {
      if (fence.shape === "polygon") {
        const coords = [...(fence.coordinates || [])];
        if (coords.length >= 3) features.push({ type: "Feature", properties: { id: fence.id, name: fence.name }, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } });
      } else if (Array.isArray(fence.center)) {
        const points = [];
        const lat = Number(fence.center[1]), lon = Number(fence.center[0]), rNm = Number(fence.radiusNm || 10);
        for (let i = 0; i <= 64; i++) {
          const angle = i / 64 * Math.PI * 2;
          const dLat = (rNm / 60) * Math.sin(angle);
          const dLon = (rNm / (60 * Math.max(.2, Math.cos(lat * Math.PI / 180)))) * Math.cos(angle);
          points.push([lon + dLon, lat + dLat]);
        }
        features.push({ type: "Feature", properties: { id: fence.id, name: fence.name }, geometry: { type: "Polygon", coordinates: [points] } });
      }
    }
    if (state.polygonDraft?.length) features.push({ type: "Feature", properties: { id: "draft", name: "Draft" }, geometry: { type: "LineString", coordinates: state.polygonDraft } });
    return { type: "FeatureCollection", features };
  }

  function drawGeofences() {
    const map = resolveMap();
    if (!map) return;
    const data = fenceGeoJson();
    const source = map.getSource("skytrace-v36-geofences");
    if (source) source.setData(data);
    else {
      try {
        map.addSource("skytrace-v36-geofences", { type: "geojson", data });
        map.addLayer({ id: "skytrace-v36-geofence-fill", type: "fill", source: "skytrace-v36-geofences", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#8aa4ff", "fill-opacity": .08 } });
        map.addLayer({ id: "skytrace-v36-geofence-line", type: "line", source: "skytrace-v36-geofences", paint: { "line-color": "#a8b8ff", "line-width": 1.5, "line-opacity": .8 } });
      } catch {}
    }
  }

  function renderFenceTab() {
    const root = $("v36FenceLists");
    if (!root) return;
    root.innerHTML = `
      <div class="v36-card"><h3>Create geofence</h3><p class="v36-muted">Circle uses the current map centre. Polygon lets you click points directly on the map and double-click to finish.</p><div class="v36-grid2"><input id="v36FenceName" placeholder="Geofence name"><input id="v36FenceRadius" type="number" min="1" max="300" value="25" placeholder="Radius nm"><select id="v36FenceTrigger"><option value="enter">Alert on entry</option><option value="exit">Alert on exit</option></select><select id="v36FenceMatchType"><option value="">Any aircraft</option><option value="icao">ICAO</option><option value="registration">Registration</option><option value="callsign">Callsign</option><option value="airline">Airline</option><option value="type">Type</option></select><input id="v36FenceMatchValue" placeholder="Optional match value"><input id="v36FenceMinAlt" type="number" min="0" placeholder="Min altitude ft"><input id="v36FenceMaxAlt" type="number" min="0" placeholder="Max altitude ft"></div><div class="v36-row"><button id="v36CreateCircle">Circle at map centre</button><button id="v36DrawPolygon">Draw polygon</button></div></div>
      ${state.geofences.map(fence => `<article class="v36-card" data-fence-id="${esc(fence.id)}"><div class="v36-card-head"><div><h3>${esc(fence.name)}</h3><small>${esc(fence.shape)} · ${esc(fence.trigger || "enter")}${fence.radiusNm ? ` · ${esc(fence.radiusNm)} nm` : ""}</small></div><div><label class="v36-mini-switch"><input type="checkbox" data-fence-enabled ${fence.enabled !== false ? "checked" : ""}><span></span></label><button class="v36-icon danger" data-delete-fence>×</button></div></div></article>`).join("")}`;
    $("v36CreateCircle").onclick = () => {
      const map = resolveMap();
      if (!map) return toast("Map is not ready yet.");
      const center = map.getCenter();
      createFenceFromForm({ shape: "circle", center: [center.lng, center.lat], radiusNm: clamp(Number($("v36FenceRadius").value || 25), 1, 300) });
    };
    $("v36DrawPolygon").onclick = startPolygonDraw;
    root.querySelectorAll("[data-fence-id]").forEach(card => {
      const fence = state.geofences.find(item => item.id === card.dataset.fenceId);
      card.querySelector("[data-fence-enabled]").onchange = e => { fence.enabled = e.target.checked; writeStore(STORAGE.geofences, state.geofences); drawGeofences(); };
      card.querySelector("[data-delete-fence]").onclick = () => { state.geofences = state.geofences.filter(item => item.id !== fence.id); writeStore(STORAGE.geofences, state.geofences); renderFenceTab(); drawGeofences(); };
    });
  }

  function fenceFormData() {
    return {
      name: $("v36FenceName")?.value.trim().slice(0, 60) || "Geofence",
      trigger: $("v36FenceTrigger")?.value || "enter",
      matchType: $("v36FenceMatchType")?.value || "",
      matchValue: $("v36FenceMatchValue")?.value.trim().slice(0, 60) || "",
      minAltitudeFt: $("v36FenceMinAlt")?.value ? Number($("v36FenceMinAlt").value) : null,
      maxAltitudeFt: $("v36FenceMaxAlt")?.value ? Number($("v36FenceMaxAlt").value) : null
    };
  }

  function createFenceFromForm(extra) {
    state.geofences.push({ id: uid("fence"), enabled: true, ...fenceFormData(), ...extra });
    writeStore(STORAGE.geofences, state.geofences);
    state.fencePresence.clear();
    renderFenceTab();
    drawGeofences();
    toast("Geofence saved.");
  }

  function startPolygonDraw() {
    const map = resolveMap();
    if (!map) return toast("Map is not ready yet.");
    state.polygonDraft = [];
    closeDrawer();
    drawGeofences();
    toast("Click polygon points on the map. Double-click to finish.");
    try { map.doubleClickZoom.disable(); } catch {}
    const click = event => { state.polygonDraft.push([event.lngLat.lng, event.lngLat.lat]); drawGeofences(); };
    const finish = event => {
      event.preventDefault?.();
      map.off("click", click);
      map.off("dblclick", finish);
      try { map.doubleClickZoom.enable(); } catch {}
      const coords = state.polygonDraft || [];
      state.polygonDraft = null;
      if (coords.length >= 3) createFenceFromForm({ shape: "polygon", coordinates: coords });
      else { drawGeofences(); toast("Polygon cancelled: at least 3 points are required."); }
      openFeature("watchlists");
      setTimeout(() => $("v36DrawerBody")?.querySelector('[data-v36-watch-tab="fences"]')?.click(), 0);
    };
    map.on("click", click);
    map.on("dblclick", finish);
  }

  function renderAlerts() {
    const body = $("v36DrawerBody");
    if (!body) return;
    body.innerHTML = `<div class="v36-row v36-toolbar"><button id="v36PauseNative">Pause native alerts</button><button id="v36ClearAlerts">Clear history</button></div>${state.alerts.length ? state.alerts.map(item => `<article class="v36-alert" data-alert-id="${esc(item.id)}"><div><strong>${esc(item.title)}</strong><time>${new Date(item.at).toLocaleString()}</time></div><p>${esc(item.body)}</p>${item.target ? `<button data-alert-target="${esc(item.target)}">Open ${esc(item.target)}</button>` : ""}</article>`).join("") : '<div class="v36-empty">No alerts yet.</div>'}`;
    $("v36PauseNative").onclick = async () => { const paused = await native.getAlertsPaused(); await native.setAlertsPaused(!paused); $("v36PauseNative").textContent = paused ? "Pause native alerts" : "Resume native alerts"; };
    $("v36ClearAlerts").onclick = () => { state.alerts = []; writeStore(STORAGE.alerts, state.alerts); renderAlerts(); renderAlertBadge(); };
    body.querySelectorAll("[data-alert-target]").forEach(button => button.onclick = () => { mainSearch(button.dataset.alertTarget); closeDrawer(); });
  }

  function semverParts(value) {
    return String(value || "").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map(x => Number(x) || 0);
  }

  function isNewer(latest, current) {
    const a = semverParts(latest), b = semverParts(current);
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
    return false;
  }

  async function checkForUpdates(force = false) {
    if (state.update && !force && Date.now() - state.update.checkedAt < 15 * 60_000) return state.update;
    const current = await native.getVersion?.().catch(() => "3.5.0") || "3.5.0";
    try {
      const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json();
      state.update = { ok: true, current, latest: release.tag_name || release.name || current, name: release.name || release.tag_name || "Latest release", notes: String(release.body || "").slice(0, 4000), url: release.html_url || "https://github.com/archivealf/SkyTrace/releases", newer: isNewer(release.tag_name || release.name, current), checkedAt: Date.now() };
    } catch (error) {
      state.update = { ok: false, current, error: error.message || String(error), checkedAt: Date.now() };
    }
    if (state.activeDrawer === "updates") renderUpdates();
    return state.update;
  }

  async function renderUpdates() {
    const body = $("v36DrawerBody");
    if (!body) return;
    const info = state.update || await checkForUpdates();
    body.innerHTML = info.ok ? `<div class="v36-card"><span class="v36-status ${info.newer ? "attention" : "good"}">${info.newer ? "UPDATE AVAILABLE" : "UP TO DATE"}</span><h3>${esc(info.name)}</h3><dl class="v36-kv"><dt>Installed</dt><dd>${esc(info.current)}</dd><dt>Latest</dt><dd>${esc(info.latest)}</dd><dt>Channel</dt><dd>Verified GitHub release</dd><dt>Install mode</dt><dd>Manual verified update (unsigned build)</dd></dl><div class="v36-release-notes">${esc(info.notes || "No release notes.")}</div><div class="v36-row"><button id="v36CheckAgain">Check again</button><button class="primary" id="v36OpenRelease">Open verified release</button></div></div>` : `<div class="v36-card"><span class="v36-status attention">CHECK FAILED</span><h3>Could not check for updates</h3><p>${esc(info.error)}</p><button id="v36CheckAgain">Try again</button></div>`;
    $("v36CheckAgain").onclick = () => checkForUpdates(true);
    if ($("v36OpenRelease")) $("v36OpenRelease").onclick = () => native.openExternal?.(info.url);
  }

  function ensureTimeline() {
    if ($("v36Timeline")) return;
    const root = document.createElement("div");
    root.id = "v36Timeline";
    root.className = "v36-timeline hidden";
    root.innerHTML = `<div class="v36-timeline-top"><div><span class="v36-eyebrow">PRIVATE LOCAL REPLAY</span><strong>SkyTrace Timeline</strong></div><div class="v36-row"><select id="v36TimelineWindow"><option value="1">1h</option><option value="6" selected>6h</option><option value="24">24h</option></select><input id="v36TimelineFilter" placeholder="ICAO optional" maxlength="6"><button id="v36TimelineReload">Reload</button><button id="v36TimelineExport">Export</button><button id="v36TimelineClose">LIVE</button></div></div><div class="v36-timeline-controls"><button id="v36TimelinePlay">▶</button><select id="v36TimelineSpeed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select><input id="v36TimelineSlider" type="range" min="0" max="1000" value="1000"><time id="v36TimelineTime">—</time></div><div id="v36TimelineMeta" class="v36-timeline-meta">Load local history to rewind the airspace.</div>`;
    document.body.appendChild(root);
    $("v36TimelineClose").onclick = closeTimeline;
    $("v36TimelineReload").onclick = loadTimeline;
    $("v36TimelinePlay").onclick = toggleTimelinePlay;
    $("v36TimelineSpeed").onchange = e => { state.timeline.speed = Number(e.target.value) || 1; };
    $("v36TimelineSlider").oninput = e => setTimelineRatio(Number(e.target.value) / 1000);
    $("v36TimelineFilter").onchange = e => { state.timeline.filter = normalize(e.target.value); void loadTimeline(); };
    $("v36TimelineExport").onclick = exportTimeline;
  }

  async function openTimeline(options = {}) {
    ensureTimeline();
    $("v36Timeline").classList.remove("hidden");
    document.documentElement.classList.add("skytrace-timeline-active");
    if (options.hours) $("v36TimelineWindow").value = String(options.hours);
    if (options.icao) { $("v36TimelineFilter").value = options.icao; state.timeline.filter = normalize(options.icao); }
    await loadTimeline();
  }

  function closeTimeline() {
    state.timeline.playing = false;
    clearInterval(state.timeline.timer);
    $("v36TimelinePlay") && ($("v36TimelinePlay").textContent = "▶");
    $("v36Timeline")?.classList.add("hidden");
    document.documentElement.classList.remove("skytrace-timeline-active");
    const map = resolveMap();
    try { if (map?.getLayer("skytrace-v36-timeline-labels")) map.removeLayer("skytrace-v36-timeline-labels"); } catch {}
    try { if (map?.getLayer("skytrace-v36-timeline-points")) map.removeLayer("skytrace-v36-timeline-points"); } catch {}
    try { if (map?.getLayer("skytrace-v36-timeline-trail")) map.removeLayer("skytrace-v36-timeline-trail"); } catch {}
    try { if (map?.getSource("skytrace-v36-timeline")) map.removeSource("skytrace-v36-timeline"); } catch {}
    try { if (map?.getSource("skytrace-v36-timeline-trail")) map.removeSource("skytrace-v36-timeline-trail"); } catch {}
  }

  async function loadTimeline() {
    const hours = Number($("v36TimelineWindow")?.value || 6);
    const filter = normalize($("v36TimelineFilter")?.value || state.timeline.filter);
    state.timeline.filter = filter;
    const to = Date.now(), from = to - hours * 3600_000;
    $("v36TimelineMeta").textContent = "Loading private history…";
    try {
      const result = await native.localReplay.query({ from, to, icao: filter, limit: 50000 });
      state.timeline.points = (result.points || []).sort((a, b) => Number(a.recordedAt) - Number(b.recordedAt));
      state.timeline.from = from;
      state.timeline.to = to;
      state.timeline.at = state.timeline.points.length ? Number(state.timeline.points.at(-1).recordedAt) : to;
      $("v36TimelineSlider").value = state.timeline.points.length ? "1000" : "0";
      $("v36TimelineMeta").textContent = `${state.timeline.points.length.toLocaleString()} private observations · last ${hours}h${filter ? ` · ${filter.toUpperCase()}` : ""}`;
      renderTimelineFrame();
    } catch (error) { $("v36TimelineMeta").textContent = error.message || String(error); }
  }

  function setTimelineRatio(ratio) {
    state.timeline.at = state.timeline.from + clamp(ratio, 0, 1) * (state.timeline.to - state.timeline.from);
    renderTimelineFrame();
  }

  function timelineFeatures() {
    const latest = new Map();
    for (const point of state.timeline.points) {
      if (Number(point.recordedAt) > state.timeline.at) break;
      latest.set(point.icao, point);
    }
    const features = [...latest.values()].map(point => ({ type: "Feature", properties: { icao: point.icao, callsign: point.callsign || point.registration || point.icao?.toUpperCase(), altitudeFt: point.altitudeFt, speedKts: point.speedKts }, geometry: { type: "Point", coordinates: [Number(point.longitude), Number(point.latitude)] } })).filter(f => f.geometry.coordinates.every(Number.isFinite));
    return { type: "FeatureCollection", features };
  }

  function renderTimelineFrame() {
    if (!state.timeline.points.length) return;
    const map = resolveMap();
    if (!map) return;
    const data = timelineFeatures();
    let source = map.getSource("skytrace-v36-timeline");
    try {
      if (source) source.setData(data);
      else {
        map.addSource("skytrace-v36-timeline", { type: "geojson", data });
        map.addLayer({ id: "skytrace-v36-timeline-points", type: "circle", source: "skytrace-v36-timeline", paint: { "circle-radius": 4.5, "circle-color": "#dbe2ff", "circle-stroke-color": "#26345e", "circle-stroke-width": 1.5, "circle-opacity": .95 } });
        map.addLayer({ id: "skytrace-v36-timeline-labels", type: "symbol", source: "skytrace-v36-timeline", layout: { "text-field": ["get", "callsign"], "text-size": 9, "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": "#eef1ff", "text-halo-color": "#07090d", "text-halo-width": 1 } });
      }
    } catch {}
    if (state.timeline.filter) drawTimelineTrail();
    const slider = $("v36TimelineSlider");
    if (slider) slider.value = String(Math.round(clamp((state.timeline.at - state.timeline.from) / Math.max(1, state.timeline.to - state.timeline.from), 0, 1) * 1000));
    if ($("v36TimelineTime")) $("v36TimelineTime").textContent = new Date(state.timeline.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if ($("v36TimelineMeta")) $("v36TimelineMeta").textContent = `${data.features.length.toLocaleString()} aircraft at this moment · ${state.timeline.points.length.toLocaleString()} stored observations${state.timeline.filter ? ` · ${state.timeline.filter.toUpperCase()}` : ""}`;
  }

  function drawTimelineTrail() {
    const map = resolveMap();
    if (!map) return;
    const coords = state.timeline.points.filter(point => Number(point.recordedAt) <= state.timeline.at).map(point => [Number(point.longitude), Number(point.latitude)]).filter(pair => pair.every(Number.isFinite));
    const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
    try {
      const source = map.getSource("skytrace-v36-timeline-trail");
      if (source) source.setData(data);
      else {
        map.addSource("skytrace-v36-timeline-trail", { type: "geojson", data });
        map.addLayer({ id: "skytrace-v36-timeline-trail", type: "line", source: "skytrace-v36-timeline-trail", paint: { "line-color": "#91a7ff", "line-width": 2.2, "line-opacity": .85 } });
      }
    } catch {}
  }

  function toggleTimelinePlay() {
    state.timeline.playing = !state.timeline.playing;
    $("v36TimelinePlay").textContent = state.timeline.playing ? "❚❚" : "▶";
    clearInterval(state.timeline.timer);
    if (!state.timeline.playing) return;
    state.timeline.timer = setInterval(() => {
      state.timeline.at += 1000 * state.timeline.speed;
      if (state.timeline.at >= state.timeline.to) { state.timeline.at = state.timeline.to; toggleTimelinePlay(); }
      renderTimelineFrame();
    }, 1000);
  }

  async function exportTimeline() {
    if (!state.timeline.points.length) return toast("Load timeline data first.");
    const rows = ["recordedAt,icao,callsign,registration,aircraftType,altitudeFt,speedKts,heading,verticalRateFpm,longitude,latitude"];
    for (const p of state.timeline.points) rows.push([new Date(p.recordedAt).toISOString(), p.icao, p.callsign, p.registration, p.aircraftType, p.altitudeFt, p.speedKts, p.heading, p.verticalRateFpm, p.longitude, p.latitude].map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
    const name = `SkyTrace-Timeline-${new Date().toISOString().slice(0, 10)}${state.timeline.filter ? `-${state.timeline.filter.toUpperCase()}` : ""}.csv`;
    const saved = await native.saveTextFile?.({ defaultName: name, content: rows.join("\n"), filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (saved?.ok) toast("Timeline exported.");
  }

  function ensureCommand() {
    if ($("v36Command")) return;
    const root = document.createElement("div");
    root.id = "v36Command";
    root.className = "v36-command hidden";
    root.innerHTML = `<div class="v36-command-backdrop"></div><div class="v36-command-box"><div class="v36-command-input"><kbd>⌘K</kbd><input id="v36CommandInput" placeholder="Search SkyTrace or type a command"><button id="v36CommandClose">×</button></div><div id="v36CommandHints" class="v36-command-hints"></div></div>`;
    document.body.appendChild(root);
    $("v36CommandClose").onclick = closeCommand;
    root.querySelector(".v36-command-backdrop").onclick = closeCommand;
    $("v36CommandInput").oninput = renderCommandHints;
    $("v36CommandInput").onkeydown = e => { if (e.key === "Escape") closeCommand(); else if (e.key === "Enter") executeCommand(e.target.value); };
  }

  const commandExamples = ["aircraft 40621a", "airport EGLL", "replay last hour", "replay 6h", "watchlists", "geofences", "alerts", "updates", "performance battery", "show airports", "hide airports", "settings", "clear map"];

  function openCommand(seed = "") {
    ensureCommand();
    state.commandOpen = true;
    $("macCommandPalette")?.classList.add("hidden");
    $("v36Command").classList.remove("hidden");
    $("v36CommandInput").value = seed;
    renderCommandHints();
    setTimeout(() => $("v36CommandInput")?.focus(), 0);
  }

  function closeCommand() { state.commandOpen = false; $("v36Command")?.classList.add("hidden"); }

  function renderCommandHints() {
    const value = normalize($("v36CommandInput")?.value);
    const choices = commandExamples.filter(x => !value || x.includes(value)).slice(0, 8);
    $("v36CommandHints").innerHTML = choices.map(text => `<button data-command-example="${esc(text)}"><span>${esc(text)}</span><kbd>↵</kbd></button>`).join("") || `<div class="v36-command-search">Press Enter to search SkyTrace for “${esc($("v36CommandInput")?.value || "")}”</div>`;
    $("v36CommandHints").querySelectorAll("[data-command-example]").forEach(button => button.onclick = () => executeCommand(button.dataset.commandExample));
  }

  function setMapLayer(label, enabled) {
    const candidates = qa("label,button,div").filter(node => normalize(node.textContent) === normalize(label));
    for (const node of candidates) {
      const labelNode = node.matches("label") ? node : node.closest("label");
      const input = labelNode?.querySelector('input[type="checkbox"]') || node.parentElement?.querySelector?.('input[type="checkbox"]');
      if (!input) continue;
      if (input.checked !== enabled) input.click();
      return true;
    }
    return false;
  }

  async function executeCommand(raw) {
    const text = String(raw || "").trim();
    const lower = text.toLowerCase();
    closeCommand();
    let match;
    if ((match = lower.match(/^aircraft\s+([0-9a-f]{6})$/i))) return native.openDetached("aircraft", match[1]);
    if ((match = text.match(/^airport\s+([a-z0-9]{3,4})$/i))) return native.openDetached("airportDesk", match[1].toUpperCase());
    if (/^replay\s+last\s+hour$/i.test(text)) return openTimeline({ hours: 1 });
    if ((match = lower.match(/^replay\s+(1|6|24)h$/))) return openTimeline({ hours: Number(match[1]) });
    if ((match = lower.match(/^performance\s+(accuracy|balanced|battery)$/))) {
      const settings = await native.getSettings();
      await native.saveSettings({ ...settings, performanceProfile: match[1] });
      return toast(`Performance: ${match[1]}`);
    }
    if (lower === "watchlists") return openFeature("watchlists");
    if (lower === "geofences") { openFeature("watchlists"); return setTimeout(() => $("v36DrawerBody")?.querySelector('[data-v36-watch-tab="fences"]')?.click(), 0); }
    if (lower === "alerts" || lower === "notifications") return openFeature("alerts");
    if (lower === "updates" || lower === "update") return openFeature("updates");
    if (lower === "whats new" || lower === "whatsnew") return showWhatsNewIfNeeded(true);
    if (lower === "settings") return native.openSettings();
    if (lower === "show airports") return setMapLayer("Airports", true) || toast("Airport layer control not found.");
    if (lower === "hide airports") return setMapLayer("Airports", false) || toast("Airport layer control not found.");
    if (lower === "show weather") return setMapLayer("Precipitation", true) || toast("Weather layer control not found.");
    if (lower === "hide weather") return setMapLayer("Precipitation", false) || toast("Weather layer control not found.");
    if (lower === "clear map") { closeTimeline(); return toast("Timeline overlays cleared."); }
    return mainSearch(text);
  }

  function ensureModal() {
    if ($("v36Modal")) return;
    const root = document.createElement("div");
    root.id = "v36Modal";
    root.className = "v36-modal hidden";
    root.innerHTML = `<div class="v36-modal-backdrop"></div><div id="v36ModalCard" class="v36-modal-card"></div>`;
    document.body.appendChild(root);
  }

  function hideModal() { $("v36Modal")?.classList.add("hidden"); }

  function showOnboarding(step = 0) {
    ensureModal();
    const modal = $("v36Modal"), card = $("v36ModalCard");
    modal.classList.remove("hidden");
    const steps = [
      { title: "Welcome to SkyTrace", body: `<p>SkyTrace now has a private Timeline, advanced watchlists, geofence alerts, a richer Command Centre and a local MapLibre runtime.</p><div class="v36-feature-grid"><span>⌘K Command Centre</span><span>Private Timeline</span><span>Watchlists 2.0</span><span>Geofence alerts</span></div>` },
      { title: "Choose how SkyTrace runs", body: `<label class="v36-field">Performance<select id="v36OnboardPerf"><option value="accuracy">High Accuracy</option><option value="balanced" selected>Balanced</option><option value="battery">Battery Saver</option></select></label><label class="v36-field">Traffic labels<select id="v36OnboardDensity"><option value="low">Low</option><option value="normal" selected>Adaptive</option><option value="high">High</option></select></label>` },
      { title: "Desktop integration", body: `<label class="v36-check"><input id="v36OnboardNotifications" type="checkbox" checked> Notification Center alerts</label><label class="v36-check"><input id="v36OnboardLogin" type="checkbox"> Launch SkyTrace at login</label><p class="v36-muted">You can change these later in Settings.</p>` }
    ];
    const current = steps[step];
    card.innerHTML = `<span class="v36-eyebrow">FIRST RUN · ${step + 1} OF ${steps.length}</span><h1>${current.title}</h1>${current.body}<div class="v36-modal-actions"><button id="v36OnboardSkip">Skip setup</button><button class="primary" id="v36OnboardNext">${step === steps.length - 1 ? "Finish" : "Continue"}</button></div>`;
    $("v36OnboardSkip").onclick = finishOnboarding;
    $("v36OnboardNext").onclick = async () => {
      if (step === 1) {
        const settings = await native.getSettings();
        await native.saveSettings({ ...settings, performanceProfile: $("v36OnboardPerf").value, trafficLabelDensity: $("v36OnboardDensity").value });
      }
      if (step === 2) {
        const settings = await native.getSettings();
        await native.saveSettings({ ...settings, notifications: $("v36OnboardNotifications").checked, launchAtLogin: $("v36OnboardLogin").checked });
      }
      if (step < steps.length - 1) showOnboarding(step + 1); else finishOnboarding();
    };
  }

  function finishOnboarding() {
    writeStore(STORAGE.onboarding, { completedAt: Date.now(), version: 1 });
    hideModal();
    setTimeout(showWhatsNewIfNeeded, 250);
  }

  function showWhatsNewIfNeeded(force = false) {
    if (!force && readStore(STORAGE.whatsNew, null)?.version === 1) return;
    ensureModal();
    $("v36Modal").classList.remove("hidden");
    $("v36ModalCard").innerHTML = `<span class="v36-eyebrow">WHAT'S NEW</span><h1>SkyTrace Product Preview</h1><div class="v36-whats-grid"><article><strong>SkyTrace Timeline</strong><p>Rewind the private airspace history stored on this Mac.</p></article><article><strong>Watchlists & Geofences</strong><p>Create named aircraft rules and location-based alerts.</p></article><article><strong>Command Centre 2.0</strong><p>Open aircraft, airports, replay, settings and map layers from ⌘K.</p></article><article><strong>Local Map Engine</strong><p>MapLibre JS/CSS is packaged with SkyTrace instead of loaded from a CDN.</p></article></div><div class="v36-modal-actions"><button id="v36WhatsUpdates">Check updates</button><button class="primary" id="v36WhatsDone">Done</button></div>`;
    $("v36WhatsUpdates").onclick = () => { writeStore(STORAGE.whatsNew, { version: 1, seenAt: Date.now() }); hideModal(); openFeature("updates"); };
    $("v36WhatsDone").onclick = () => { writeStore(STORAGE.whatsNew, { version: 1, seenAt: Date.now() }); hideModal(); };
  }

  function installKeyboard() {
    document.addEventListener("keydown", event => {
      const typing = event.target?.matches?.("input,textarea,select,[contenteditable=true]");
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); event.stopImmediatePropagation(); openCommand(); return; }
      if (event.key === "Escape" && state.commandOpen) { event.preventDefault(); closeCommand(); return; }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); openTimeline(); return; }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "w") { event.preventDefault(); openFeature("watchlists"); return; }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "a") { event.preventDefault(); openFeature("alerts"); return; }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "g") { event.preventDefault(); openFeature("watchlists"); setTimeout(() => $("v36DrawerBody")?.querySelector('[data-v36-watch-tab="fences"]')?.click(), 0); return; }
      if (event.metaKey && !event.shiftKey && event.key === ",") { event.preventDefault(); native.openSettings(); return; }
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); q('.command-search input[type="search"], .command-search input, input[type="search"]')?.focus(); return; }
      if (event.metaKey && event.key === "0") { event.preventDefault(); const map = resolveMap(); if (map && state.initialMap) map.easeTo(state.initialMap); return; }
      if (!typing && event.code === "Space" && !$("v36Timeline")?.classList.contains("hidden")) { event.preventDefault(); toggleTimelinePlay(); }
    }, true);
  }

  function captureLegacyAlerts() {
    let last = "";
    setInterval(() => {
      const text = String($("toast")?.textContent || "").trim();
      if (!text.startsWith("Alert:") || text === last) return;
      last = text;
      const target = text.split("·").pop()?.trim() || "";
      addAlert({ title: "SkyTrace Aircraft Alert", body: text.replace(/^Alert:\s*/, ""), type: "legacy", target, nativeNotify: false });
    }, 750);
  }

  function bindMap() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const map = resolveMap();
      if (!map) { if (attempts > 80) clearInterval(timer); return; }
      clearInterval(timer);
      updateZoomBand();
      drawGeofences();
      map.on("zoomend", updateZoomBand);
    }, 250);
  }

  function boot() {
    native.onNavigate?.(payload => {
      if (payload?.action === "timeline") return openTimeline(payload || {});
      if (payload?.action === "watchlists") return openFeature("watchlists");
      if (payload?.action === "alerts") return openFeature("alerts");
      if (payload?.action === "updates") return openFeature("updates");
      if (payload?.action === "whatsNew") return showWhatsNewIfNeeded(true);
    });
    installFetchCapture();
    installKeyboard();
    ensureDock();
    ensureDrawer();
    ensureTimeline();
    ensureCommand();
    bindMap();
    captureLegacyAlerts();
    setInterval(refreshPriorityLabels, 2000);
    setTimeout(() => {
      if (!readStore(STORAGE.onboarding, null)?.completedAt) showOnboarding(0);
      else showWhatsNewIfNeeded(false);
    }, 900);
    setTimeout(() => { void checkForUpdates(false); }, 5000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
