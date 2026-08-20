(() => {
  "use strict";
  const native = window.skytraceNative;
  if (!native?.isMac) return;

  const MAX_OFFLINE_CACHE_MS = 30 * 60_000;
  const state = {
    settings: null,
    map: null,
    cachedFlights: null,
    offline: false,
    localReplay: [],
    paletteOpen: false,
    lastAlertText: ""
  };

  const $ = id => document.getElementById(id);
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);

  function toast(message, ms = 4200) {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), ms);
  }

  function cachedSnapshotAge(snapshot) {
    const at = Number(snapshot?.cachedAt || snapshot?.fetchedAt || 0);
    return Number.isFinite(at) && at > 0 ? Math.max(0, Date.now() - at) : Infinity;
  }

  function readCachedFlights() {
    if (state.cachedFlights) {
      if (cachedSnapshotAge(state.cachedFlights) <= MAX_OFFLINE_CACHE_MS) return state.cachedFlights;
      state.cachedFlights = null;
    }
    try {
      const cached = JSON.parse(localStorage.getItem("skytrace.mac.lastFlightSnapshot") || "null");
      if (cached?.flights?.length && cachedSnapshotAge(cached) <= MAX_OFFLINE_CACHE_MS) {
        state.cachedFlights = cached;
        return cached;
      }
      localStorage.removeItem("skytrace.mac.lastFlightSnapshot");
    } catch {}
    return null;
  }

  function saveCachedFlights(snapshot) {
    const cached = { ...snapshot, cachedAt: Date.now() };
    state.cachedFlights = cached;
    try { localStorage.setItem("skytrace.mac.lastFlightSnapshot", JSON.stringify(cached)); }
    catch {}
  }

  function cachedFlightResponse() {
    const cached = readCachedFlights();
    if (!cached) return null;
    const ageMs = cachedSnapshotAge(cached);
    const payload = {
      ...cached,
      ok: true,
      stale: true,
      degraded: true,
      source: "SkyTrace local fallback",
      staleAgeSeconds: Math.floor(ageMs / 1000),
      fetchedAt: cached.fetchedAt || cached.cachedAt || Date.now()
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-SkyTrace-Degraded": "1" }
    });
  }

  function applySettings(settings) {
    state.settings = settings || {};
    const profile = state.settings.performanceProfile || "balanced";
    try {
      localStorage.setItem("skytrace.performanceProfile", profile);
      localStorage.setItem("skytrace.performanceMode", profile === "accuracy" ? "false" : "true");
    } catch {}
    document.documentElement.dataset.skytracePerformance = profile;
    document.documentElement.dataset.skytraceLabelDensity = state.settings.trafficLabelDensity || "normal";
    document.documentElement.classList.toggle("skytrace-reduced-motion", Boolean(state.settings.reducedMotion));
    document.documentElement.classList.toggle("skytrace-battery-profile", profile === "battery");
    renderMacPanel();
  }

  async function loadSettings() {
    try { applySettings(await native.getSettings()); }
    catch { applySettings({ performanceProfile: "balanced", offlineFallback: true, localReplay: { enabled: true } }); }
  }

  function patchFetch() {
    if (window.__skytraceMacFetchPatched) return;
    window.__skytraceMacFetchPatched = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const isFlights = /\/api\/flights(?:\?|$)/.test(url);
      const batteryIdle = isFlights && state.settings?.performanceProfile === "battery" && document.hidden;
      if (batteryIdle) {
        const cached = cachedFlightResponse();
        if (cached) return cached;
      }
      try {
        const response = await original(...args);
        if (isFlights && response.ok) {
          response.clone().json().then(snapshot => {
            if (Array.isArray(snapshot?.flights)) {
              saveCachedFlights(snapshot);
              state.offline = false;
              native.localReplay.ingest({ flights: snapshot.flights, recordedAt: snapshot.fetchedAt || Date.now() });
              updateNativeStatus(snapshot.flights.length, false);
            }
          }).catch(() => {});
        } else if (isFlights && response.status >= 500 && state.settings?.offlineFallback !== false) {
          const cached = cachedFlightResponse();
          if (cached) {
            state.offline = true;
            updateNativeStatus(readCachedFlights()?.flights?.length || 0, true);
            return cached;
          }
        }
        return response;
      } catch (error) {
        if (isFlights && state.settings?.offlineFallback !== false) {
          const cached = cachedFlightResponse();
          if (cached) {
            state.offline = true;
            updateNativeStatus(readCachedFlights()?.flights?.length || 0, true);
            return cached;
          }
        }
        throw error;
      }
    };
  }

  patchFetch();
  window.__skytraceMacFetchEarly = true;

  function resolveMap() {
    state.map = state.map || window.__SKYTRACE_MAP__ || null;
    return state.map;
  }

  function switchView(name) {
    if (name === "mac") ensureMacPanel();
    const button = q(`.mode-tab[data-view="${CSS.escape(name)}"]`);
    if (button) button.click();
    else if (name === "mac") switchMac();
  }

  function searchMain(value) {
    const input = q('.command-search input[type="search"], .command-search input, input[type="search"]');
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return true;
  }

  function openPalette(seed = "") {
    ensurePalette();
    state.paletteOpen = true;
    $("macCommandPalette")?.classList.remove("hidden");
    const input = $("macCommandInput");
    if (input) {
      input.value = seed;
      renderPalette(seed);
      setTimeout(() => input.focus(), 0);
    }
  }

  function closePalette() {
    state.paletteOpen = false;
    $("macCommandPalette")?.classList.add("hidden");
  }

  const actions = [
    { label: "Open Map", keywords: "map live traffic", run: () => switchView("map") },
    { label: "Open Cloud", keywords: "cloud watchlist bookmarks workspace", run: () => switchView("cloud") },
    { label: "Open Operations", keywords: "ops sigmet weather replay", run: () => switchView("ops") },
    { label: "Open Mac Tools", keywords: "mac native local replay", run: () => switchView("mac") },
    { label: "Open Settings", keywords: "preferences settings", run: () => native.openSettings() },
    { label: "Refresh Flight Data", keywords: "reload refresh", run: () => location.reload() },
    { label: "Performance: High Accuracy", keywords: "performance accuracy", run: () => setPerformance("accuracy") },
    { label: "Performance: Balanced", keywords: "performance balanced", run: () => setPerformance("balanced") },
    { label: "Performance: Battery Saver", keywords: "performance battery", run: () => setPerformance("battery") },
    { label: "Airport Desk", keywords: "airport desk operations", run: () => focusAirportDesk() }
  ];

  function ensurePalette() {
    if ($("macCommandPalette")) return;
    const root = document.createElement("div");
    root.id = "macCommandPalette";
    root.className = "mac-command hidden";
    root.innerHTML = `
      <div class="mac-command-backdrop" data-command-close></div>
      <div class="mac-command-box" role="dialog" aria-modal="true" aria-label="SkyTrace Command Centre">
        <div class="mac-command-field"><span>⌘K</span><input id="macCommandInput" placeholder="Search SkyTrace or run a command" autocomplete="off" spellcheck="false"></div>
        <div id="macCommandResults" class="mac-command-results"></div>
        <div class="mac-command-help">Enter to run · Esc to close · type an aircraft, callsign or airport to search</div>
      </div>`;
    document.body.appendChild(root);
    $("macCommandInput").addEventListener("input", event => renderPalette(event.target.value));
    $("macCommandInput").addEventListener("keydown", event => {
      if (event.key === "Escape") return closePalette();
      if (event.key !== "Enter") return;
      const active = q(".mac-command-result.selected") || q(".mac-command-result");
      if (active) active.click();
      else if (event.target.value.trim()) { searchMain(event.target.value.trim()); closePalette(); }
    });
    root.addEventListener("click", event => { if (event.target.closest("[data-command-close]")) closePalette(); });
    renderPalette("");
  }

  function renderPalette(term = "") {
    const normalized = term.trim().toLowerCase();
    const filtered = actions.filter(action => !normalized || `${action.label} ${action.keywords}`.toLowerCase().includes(normalized)).slice(0, 8);
    const results = $("macCommandResults");
    if (!results) return;
    results.innerHTML = filtered.map((action, index) => `<button class="mac-command-result${index === 0 ? " selected" : ""}" data-command-index="${actions.indexOf(action)}"><span>${esc(action.label)}</span><kbd>↵</kbd></button>`).join("") + (normalized ? `<button class="mac-command-result mac-command-search" data-search-value="${esc(term.trim())}"><span>Search SkyTrace for “${esc(term.trim())}”</span><kbd>↵</kbd></button>` : "");
    results.querySelectorAll("[data-command-index]").forEach(button => button.onclick = () => { actions[Number(button.dataset.commandIndex)]?.run(); closePalette(); });
    results.querySelectorAll("[data-search-value]").forEach(button => button.onclick = () => { searchMain(button.dataset.searchValue); closePalette(); });
  }

  async function setPerformance(profile) {
    const next = { ...(state.settings || {}), performanceProfile: profile };
    try { applySettings(await native.saveSettings(next)); toast(`Performance profile: ${profile}`); }
    catch (error) { toast(error.message || String(error)); }
  }

  function ensureMacPanel() {
    const rail = q(".flightdeck-rail");
    if (rail && !rail.querySelector('[data-view="mac"]')) {
      const button = document.createElement("button");
      button.className = "mode-tab mac-native-mode-tab";
      button.dataset.view = "mac";
      button.innerHTML = "<span>⌘</span><b>Mac</b>";
      rail.appendChild(button);
      button.onclick = () => switchMac();
    }
    const sidebar = $("sidebar");
    if (sidebar && !$("macNativeView")) {
      const section = document.createElement("section");
      section.id = "macNativeView";
      section.className = "side-view";
      section.innerHTML = `
        <div class="sidebar-head"><div><div class="eyebrow">SKYTRACE V3.5</div><h1>Mac Native</h1></div><span class="mac-native-pill" id="macNativeStatus">Ready</span></div>
        <div class="scroll-list mac-native-scroll">
          <article class="mac-native-card"><h3>Command Centre</h3><p>Search aircraft and airports, switch workspaces and run SkyTrace actions from one keyboard-first panel.</p><button class="mac-native-btn" id="macOpenCommand">Open ⌘K</button></article>
          <article class="mac-native-card"><h3>Performance profile</h3><p>High Accuracy keeps maximum detail, Balanced uses adaptive rendering, Battery Saver reduces background work.</p><select class="mac-native-select" id="macPerformance"><option value="accuracy">High Accuracy</option><option value="balanced">Balanced</option><option value="battery">Battery Saver</option></select></article>
          <article class="mac-native-card"><h3>Private Local Replay</h3><p>Stores only observations received by this Mac. Data stays in your SkyTrace Application Support folder.</p><div class="mac-native-row"><select class="mac-native-select" id="macReplayHours"><option value="1">1 hour</option><option value="6" selected>6 hours</option><option value="24">24 hours</option><option value="168">7 days</option></select><input class="mac-native-input" id="macReplayIcao" placeholder="ICAO optional" maxlength="6"></div><div class="mac-native-row"><button class="mac-native-btn" id="macReplayLoad">Load Replay</button><button class="mac-native-btn" id="macReplayClearMap">Clear map</button></div><div class="mac-native-meta" id="macReplayMeta">No local replay loaded.</div></article>
          <article class="mac-native-card"><h3>Detached windows</h3><p>Keep the live map visible while aircraft details or a full Airport Desk stay in separate Mac windows.</p><div class="mac-native-row"><input class="mac-native-input" id="macAircraftId" placeholder="Aircraft ICAO hex"><button class="mac-native-btn" id="macAircraftOpen">Aircraft Window</button></div><div class="mac-native-row"><input class="mac-native-input" id="macAirportId" placeholder="Airport ICAO e.g. EGLL"><button class="mac-native-btn" id="macAirportOpen">Airport Desk</button></div></article>
          <article class="mac-native-card"><h3>Desktop integration</h3><label class="mac-native-check"><input type="checkbox" id="macLaunchLogin"> Launch SkyTrace at login</label><label class="mac-native-check"><input type="checkbox" id="macAlertsPaused"> Pause native alerts</label><div class="mac-native-row"><button class="mac-native-btn" id="macSettingsOpen">Settings…</button><button class="mac-native-btn" id="macReplayFolder">Data folder</button></div></article>
          <article class="mac-native-card"><h3>Connection</h3><p id="macConnectionText">Live aviation data connected.</p></article>
        </div>`;
      const footer = sidebar.querySelector("footer.source-row");
      sidebar.insertBefore(section, footer || null);
      bindMacPanel();
    }
    renderMacPanel();
  }

  function switchMac() {
    document.querySelectorAll(".mode-tab").forEach(button => button.classList.toggle("active", button.dataset.view === "mac"));
    document.querySelectorAll(".side-view").forEach(view => view.classList.toggle("active", view.id === "macNativeView"));
    $("sidebar")?.classList.remove("collapsed");
    renderMacPanel();
  }

  function renderMacPanel() {
    if (!$("macNativeView")) return;
    if ($("macPerformance")) $("macPerformance").value = state.settings?.performanceProfile || "balanced";
    if ($("macConnectionText")) $("macConnectionText").textContent = state.offline ? "Degraded mode: showing a recent cached traffic snapshot while live data reconnects." : "Live aviation data connected.";
    if ($("macNativeStatus")) $("macNativeStatus").textContent = state.offline ? "Degraded" : "Live";
    native.getLaunchAtLogin().then(value => { if ($("macLaunchLogin")) $("macLaunchLogin").checked = Boolean(value); }).catch(() => {});
    native.getAlertsPaused().then(value => { if ($("macAlertsPaused")) $("macAlertsPaused").checked = Boolean(value); }).catch(() => {});
    native.localReplay.stats().then(stats => {
      if ($("macReplayMeta") && !state.localReplay.length) $("macReplayMeta").textContent = `${(Number(stats.bytes || 0) / 1024 / 1024).toFixed(1)} MB local history · ${stats.retentionHours}h retention`;
    }).catch(() => {});
  }

  function bindMacPanel() {
    $("macOpenCommand").onclick = () => openPalette();
    $("macPerformance").onchange = event => setPerformance(event.target.value);
    $("macReplayLoad").onclick = () => loadLocalReplay();
    $("macReplayClearMap").onclick = () => clearLocalReplayMap();
    $("macAircraftOpen").onclick = () => {
      const id = $("macAircraftId").value.trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/i.test(id)) return toast("Enter a 6-character ICAO hex code.");
      native.openDetached("aircraft", id);
    };
    $("macAirportOpen").onclick = () => focusAirportDesk();
    $("macSettingsOpen").onclick = () => native.openSettings();
    $("macReplayFolder").onclick = () => native.showDataFolder();
    $("macLaunchLogin").onchange = event => native.setLaunchAtLogin(event.target.checked);
    $("macAlertsPaused").onchange = event => native.setAlertsPaused(event.target.checked);
    for (const id of ["macReplayIcao", "macAircraftId", "macAirportId"]) $(id).addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      if (id === "macReplayIcao") loadLocalReplay();
      else if (id === "macAircraftId") $("macAircraftOpen").click();
      else focusAirportDesk();
    });
  }

  function focusAirportDesk() {
    const code = ($("macAirportId")?.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(code)) return toast("Enter an airport ICAO code such as EGLL.");
    native.openDetached("airportDesk", code);
  }

  async function loadLocalReplay() {
    const hours = Number($("macReplayHours")?.value || 6);
    const icao = ($("macReplayIcao")?.value || "").trim().toLowerCase();
    try {
      const result = await native.localReplay.query({ from: Date.now() - hours * 3600_000, to: Date.now(), icao, limit: 30000 });
      state.localReplay = result.points || [];
      drawLocalReplay();
      if ($("macReplayMeta")) $("macReplayMeta").textContent = `${state.localReplay.length.toLocaleString()} private observations · last ${hours}h${icao ? ` · ${icao.toUpperCase()}` : ""}`;
    } catch (error) { toast(error.message || String(error)); }
  }

  function drawLocalReplay() {
    const map = resolveMap();
    if (!map || !state.localReplay.length) return;
    const groups = new Map();
    for (const point of state.localReplay) {
      if (!groups.has(point.icao)) groups.set(point.icao, []);
      groups.get(point.icao).push([Number(point.longitude), Number(point.latitude)]);
    }
    const data = {
      type: "FeatureCollection",
      features: [...groups].filter(([, coordinates]) => coordinates.length > 1).map(([icao, coordinates]) => ({ type: "Feature", properties: { icao }, geometry: { type: "LineString", coordinates } }))
    };
    const source = map.getSource("skytrace-local-replay");
    if (source) source.setData(data);
    else {
      map.addSource("skytrace-local-replay", { type: "geojson", data });
      map.addLayer({ id: "skytrace-local-replay", type: "line", source: "skytrace-local-replay", paint: { "line-color": "#8aa4ff", "line-width": 2, "line-opacity": 0.82 } });
    }
  }

  function clearLocalReplayMap() {
    const map = resolveMap();
    if (map?.getLayer("skytrace-local-replay")) map.removeLayer("skytrace-local-replay");
    if (map?.getSource("skytrace-local-replay")) map.removeSource("skytrace-local-replay");
    state.localReplay = [];
    renderMacPanel();
  }

  function watchAlerts() {
    const toastNode = $("toast");
    if (!toastNode) return setTimeout(watchAlerts, 300);
    const inspect = () => {
      const text = String(toastNode.textContent || "").trim();
      if (!text.startsWith("Alert:") || text === state.lastAlertText) return;
      state.lastAlertText = text;
      const target = text.split("·").pop()?.trim() || "";
      native.notify({ title: "SkyTrace Aircraft Alert", body: text.replace(/^Alert:\s*/, ""), navigate: { action: "search", value: target } });
    };
    new MutationObserver(inspect).observe(toastNode, { childList: true, characterData: true, subtree: true, attributes: true });
    inspect();
  }

  function updateNativeStatus(flights, degraded = state.offline) {
    const hits = Number($("cloudWatchHits")?.textContent || 0) || 0;
    native.updateMenuBar({ flights: Number(flights || 0), watchHits: hits, connection: degraded ? "Degraded" : "Live" });
    renderMacPanel();
  }

  function installDetachShortcuts() {
    document.addEventListener("contextmenu", event => {
      const aircraft = event.target.closest?.(".aircraft-row,[data-icao24],[data-aircraft-icao]");
      const airport = event.target.closest?.(".airport-row,[data-airport-icao]");
      if (aircraft) {
        const id = aircraft.dataset.icao24 || aircraft.dataset.aircraftIcao || aircraft.dataset.icao || "";
        if (/^[0-9a-f]{6}$/i.test(id)) { event.preventDefault(); native.openDetached("aircraft", id); }
      } else if (airport) {
        const code = airport.dataset.airportIcao || airport.dataset.icao || airport.dataset.code || "";
        if (/^[a-z0-9]{3,4}$/i.test(code)) { event.preventDefault(); native.openDetached("airportDesk", code.toUpperCase()); }
      }
    });
  }

  function keyboard() {
    document.addEventListener("keydown", event => {
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); return; }
      if (event.key === "Escape" && state.paletteOpen) { event.preventDefault(); closePalette(); return; }
      if (event.metaKey && !event.altKey && /^[1-4]$/.test(event.key)) {
        const views = { "1":"map", "2":"cloud", "3":"ops", "4":"mac" };
        event.preventDefault(); switchView(views[event.key]);
      }
    }, true);
  }

  native.onNavigate(payload => {
    if (payload?.action === "command") return openPalette();
    if (payload?.action === "airportDesk") { switchMac(); return setTimeout(() => $("macAirportId")?.focus(), 50); }
    if (payload?.action === "search" && payload.value) return searchMain(payload.value);
  });
  native.onSettingsChanged(settings => applySettings(settings));
  native.onPowerState(({ onBattery }) => {
    document.documentElement.classList.toggle("skytrace-on-battery", Boolean(onBattery));
  });

  function boot() {
    keyboard();
    installDetachShortcuts();
    watchAlerts();
    ensurePalette();
    ensureMacPanel();
    let panelAttempts = 0;
    const panelTimer = setInterval(() => {
      panelAttempts += 1;
      const panelReady = Boolean($("macNativeView"));
      const buttonReady = Boolean(q('.flightdeck-rail [data-view="mac"]'));
      if ((panelReady && buttonReady) || panelAttempts >= 40) { clearInterval(panelTimer); return; }
      ensureMacPanel();
    }, 250);
    setInterval(() => updateNativeStatus(readCachedFlights()?.flights?.length || document.querySelectorAll(".aircraft-row").length, state.offline), 5000);
    void loadSettings();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
