(() => {
  "use strict";

  const root = document.documentElement;
  const nativeMap = window.maplibregl?.Map;
  const nativeFetch = window.fetch.bind(window);
  if (!nativeMap) return;

  const state = {
    map: null,
    flights: [],
    byIcao: new Map(),
    selectedIcao: "",
    profileSerial: 0,
    initTimer: null
  };
  const coarsePointer = window.matchMedia("(pointer:coarse)").matches;
  const EMPTY_FC = { type: "FeatureCollection", features: [] };

  /* Capture the MapLibre instance without changing the stable web runtime. */
  class SkyTraceWebMap extends nativeMap {
    constructor(...args) {
      super(...args);
      state.map = this;
      window.skytraceWebMap = this;
    }
  }
  Object.setPrototypeOf(SkyTraceWebMap, nativeMap);
  window.maplibregl.Map = SkyTraceWebMap;

  function requestPath(input) {
    try {
      if (typeof input === "string") return new URL(input, location.href).pathname;
      if (input instanceof Request) return new URL(input.url, location.href).pathname;
      if (input?.url) return new URL(input.url, location.href).pathname;
    } catch {}
    return "";
  }

  /* Observe only the public live-flight response. Never retain credentials or
     account responses. The original Response is returned untouched. */
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (requestPath(args[0]) === "/v1/v34/live" && response.ok) {
      response.clone().json().then(payload => {
        const flights = Array.isArray(payload?.flights) ? payload.flights : [];
        state.flights = flights;
        state.byIcao = new Map(flights.map(flight => [String(flight?.icao24 || "").toLowerCase(), flight]));
        setTimeout(refreshAircraftExperience, 0);
      }).catch(() => {});
    }
    return response;
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function safeHex(value, fallback) {
    const v = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fallback;
  }

  function labelFor(flight) {
    const call = String(flight?.callsign || "").trim();
    if (call && !/^NO CALLSIGN$/i.test(call)) return call;
    return String(flight?.registration || flight?.icao24 || "Aircraft").trim();
  }

  function airlineIdentity(flight) {
    const call = String(flight?.callsign || "").trim();
    return call && !/^NO CALLSIGN$/i.test(call)
      ? call
      : String(flight?.registration || flight?.icao24 || "GEN");
  }

  function fallbackAirline(identity) {
    const palettes = [
      ["#35D0FF", "#DCEBFA"], ["#7C6CFF", "#E4DEFF"], ["#FF6B8A", "#FFE0E8"],
      ["#34D399", "#D1FAE5"], ["#F59E0B", "#FEF3C7"], ["#0EA5E9", "#BAE6FD"],
      ["#F97316", "#FFEDD5"], ["#8B5CF6", "#EDE9FE"], ["#14B8A6", "#CCFBF1"],
      ["#E11D48", "#FFE4E6"], ["#2563EB", "#DBEAFE"], ["#65A30D", "#ECFCCB"]
    ];
    const raw = String(identity || "GEN").toUpperCase();
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const palette = palettes[(hash >>> 0) % palettes.length];
    return { name: "Unknown operator", code: "GA", primary: palette[0], secondary: palette[1], known: false };
  }

  function operatorFor(flight) {
    let operator;
    try { operator = window.skytraceAirlineFor?.(airlineIdentity(flight)); } catch {}
    operator ||= fallbackAirline(airlineIdentity(flight));
    return {
      ...operator,
      name: String(operator?.name || "Unknown operator"),
      code: String(operator?.code || operator?.icao || "GA"),
      primary: safeHex(operator?.primary, "#35D0FF"),
      secondary: safeHex(operator?.secondary, "#DCEBFA")
    };
  }

  function aircraftKind(typeRaw) {
    const type = String(typeRaw || "").trim().toUpperCase();
    if (/^(H1|H2|H3|H4|EC1|EC2|EC3|EC4|EC5|AS3|AS5|AW1|S76|R22|R44|B06|B47)/.test(type)) return "helicopter";
    if (/^(A38|A35|A34|A33|B74|B77|B78|B76|MD11|DC10|IL9)/.test(type)) return "widebody";
    if (/^(AT4|AT7|DH8|DHC|SF3|F50|C208|PC12|BE20|BE30|JS3)/.test(type)) return "turboprop";
    if (/^(C1|C2|C3|PA|DA|SR|P28|BE3|BE4|M20|AA5|DR4|RV)/.test(type)) return "light";
    return "jet";
  }

  function markerKey(operator, kind) {
    return `skytrace-livery-${kind}-${operator.primary.slice(1).toLowerCase()}-${operator.secondary.slice(1).toLowerCase()}`;
  }

  function polygon(ctx, points, fill, stroke = "#07101D", lineWidth = 2.4) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function createAircraftImage(primary, secondary, kind) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return new ImageData(96, 96);
    ctx.translate(48, 48);
    ctx.shadowColor = "rgba(0,0,0,.42)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    if (kind === "helicopter") {
      ctx.strokeStyle = "#07101D";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-31, 0); ctx.lineTo(31, 0);
      ctx.moveTo(0, -31); ctx.lineTo(0, 31);
      ctx.stroke();
      ctx.fillStyle = primary;
      ctx.strokeStyle = "#07101D";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -3, 10, 20, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      polygon(ctx, [[-4,12],[4,12],[3,31],[-3,31]], secondary);
      polygon(ctx, [[-10,27],[10,27],[9,32],[-9,32]], secondary);
    } else {
      const shapes = {
        jet:[[0,-40],[5,-31],[7,-15],[10,-8],[33,6],[32,13],[9,9],[7,24],[16,31],[15,36],[0,31],[-15,36],[-16,31],[-7,24],[-9,9],[-32,13],[-33,6],[-10,-8],[-7,-15],[-5,-31]],
        widebody:[[0,-41],[6,-32],[8,-14],[11,-7],[38,7],[37,14],[10,9],[8,25],[18,32],[17,37],[0,31],[-17,37],[-18,32],[-8,25],[-10,9],[-37,14],[-38,7],[-11,-7],[-8,-14],[-6,-32]],
        turboprop:[[0,-36],[5,-28],[6,-9],[34,-1],[34,7],[7,6],[6,24],[15,31],[14,35],[0,30],[-14,35],[-15,31],[-6,24],[-7,6],[-34,7],[-34,-1],[-6,-9],[-5,-28]],
        light:[[0,-35],[4,-27],[5,-9],[27,1],[27,8],[6,7],[5,22],[12,29],[11,33],[0,29],[-11,33],[-12,29],[-5,22],[-6,7],[-27,8],[-27,1],[-5,-9],[-4,-27]]
      };
      polygon(ctx, shapes[kind] || shapes.jet, primary);
      ctx.shadowColor = "transparent";
      polygon(ctx, [[-5,20],[5,20],[14,31],[13,35],[0,31],[-13,35],[-14,31]], secondary, "#07101D", 1.7);
      polygon(ctx, [[-33,6],[-24,7],[-24,11],[-32,13]], secondary, "#07101D", 1.4);
      polygon(ctx, [[33,6],[24,7],[24,11],[32,13]], secondary, "#07101D", 1.4);
      ctx.fillStyle = "rgba(239,248,255,.92)";
      ctx.beginPath(); ctx.ellipse(0, -25, 2.2, 5.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.fillRect(-1.1, -14, 2.2, 29);
    }
    return ctx.getImageData(0, 0, 96, 96);
  }

  function miniPlaneSvg(operator) {
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2l3 9 13 8v4l-13-3-1 9 6 5v3l-8-3-8 3v-3l6-5-1-9-13 3v-4l13-8z" fill="${operator.primary}" stroke="#08101d" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 31l5-2 5 2 3 3v3l-8-3-8 3v-3z" fill="${operator.secondary}"/></svg>`;
  }

  function ensureImage(flight) {
    const map = state.map;
    const operator = operatorFor(flight);
    const kind = aircraftKind(flight.aircraftType);
    const key = markerKey(operator, kind);
    if (!map.hasImage(key)) map.addImage(key, createAircraftImage(operator.primary, operator.secondary, kind), { pixelRatio: 2 });
    return { key, operator };
  }

  function removeLegacyDots() {
    const map = state.map;
    if (!map?.isStyleLoaded()) return;
    if (map.getLayer("aircraft") && map.getLayer("aircraft")?.type === "circle") {
      try { map.removeLayer("aircraft"); } catch {}
    }
  }

  function ensureLayers() {
    const map = state.map;
    if (!map?.isStyleLoaded()) return false;
    removeLegacyDots();
    if (!map.getSource("aircraft-mobile")) map.addSource("aircraft-mobile", { type: "geojson", data: EMPTY_FC });
    if (!map.getLayer("aircraft-mobile-hit")) map.addLayer({
      id:"aircraft-mobile-hit",type:"circle",source:"aircraft-mobile",
      paint:{"circle-radius":["interpolate",["linear"],["zoom"],3,13,6,17,10,22],"circle-color":"#000000","circle-opacity":0.01}
    });
    if (!map.getLayer("aircraft-mobile-selected")) map.addLayer({
      id:"aircraft-mobile-selected",type:"circle",source:"aircraft-mobile",filter:["==",["get","icao"],"__none__"],
      paint:{"circle-radius":["interpolate",["linear"],["zoom"],3,14,6,18,10,22],"circle-color":"rgba(255,255,255,.14)","circle-stroke-color":"#ffffff","circle-stroke-width":2}
    });
    if (!map.getLayer("aircraft-mobile-icons")) map.addLayer({
      id:"aircraft-mobile-icons",type:"symbol",source:"aircraft-mobile",
      layout:{"icon-image":["get","markerKey"],"icon-size":["interpolate",["linear"],["zoom"],3,.44,5,.52,8,.68,11,.86],"icon-rotate":["get","heading"],"icon-rotation-alignment":"map","icon-pitch-alignment":"map","icon-allow-overlap":true,"icon-ignore-placement":true,"icon-padding":0},
      paint:{"icon-opacity":["case",["==",["get","onGround"],true],.72,.98]}
    });
    if (!map.getLayer("aircraft-mobile-labels")) map.addLayer({
      id:"aircraft-mobile-labels",type:"symbol",source:"aircraft-mobile",minzoom:7.3,
      layout:{"text-field":["get","label"],"text-size":["interpolate",["linear"],["zoom"],7.3,9,11,11],"text-offset":[0,1.8],"text-anchor":"top","text-optional":true},
      paint:{"text-color":"#f8fafc","text-halo-color":"rgba(4,8,15,.92)","text-halo-width":1.5}
    });
    return true;
  }

  function renderMapAircraft() {
    const map = state.map;
    if (!ensureLayers()) return;
    const features = [];
    for (const flight of state.flights) {
      const lat = Number(flight.latitude), lon = Number(flight.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const { key } = ensureImage(flight);
      features.push({
        type:"Feature",geometry:{type:"Point",coordinates:[lon,lat]},
        properties:{icao:String(flight.icao24||"").toLowerCase(),label:labelFor(flight),markerKey:key,heading:Number.isFinite(Number(flight.heading))?Number(flight.heading):0,onGround:Boolean(flight.onGround)}
      });
    }
    map.getSource("aircraft-mobile")?.setData({ type:"FeatureCollection", features });
    updateSelectedHalo();
  }

  function updateSelectedHalo() {
    const map = state.map;
    if (!map?.getLayer("aircraft-mobile-selected")) return;
    map.setFilter("aircraft-mobile-selected", ["==",["get","icao"],state.selectedIcao || "__none__"]);
  }

  function enhanceList() {
    for (const row of document.querySelectorAll(".flight[data-icao]")) {
      const icao = String(row.dataset.icao || "").toLowerCase();
      const flight = state.byIcao.get(icao);
      if (!flight) continue;
      const operator = operatorFor(flight);
      row.classList.toggle("selected", icao === state.selectedIcao);
      let badge = row.querySelector(":scope > .flight-livery");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "flight-livery";
        row.prepend(badge);
      }
      badge.innerHTML = miniPlaneSvg(operator);
      const copy = [...row.children].find(child => child !== badge && !child.classList.contains("flight-metrics"));
      if (copy) {
        copy.classList.add("flight-copy");
        const small = copy.querySelector("small");
        if (small) small.textContent = `${operator.name} · ${flight.registration || flight.icao24 || "Unknown"} · ${flight.aircraftType || "Unknown type"}${flight.squawk ? ` · SQ ${flight.squawk}` : ""}`;
      }
      row.setAttribute("aria-label", `Open ${labelFor(flight)}, ${operator.name}`);
    }
  }

  function nearestFlight(point) {
    const map = state.map;
    const radius = coarsePointer ? 36 : 20;
    let best = null, bestDistance = radius * radius;
    for (const flight of state.flights) {
      const lat = Number(flight.latitude), lon = Number(flight.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = map.project([lon,lat]);
      const dx = p.x - point.x, dy = p.y - point.y;
      const d = dx*dx + dy*dy;
      if (d < bestDistance) { bestDistance = d; best = flight; }
    }
    return best;
  }

  function fmt(value, suffix="") { return Number.isFinite(Number(value)) ? `${Math.round(Number(value)).toLocaleString()}${suffix}` : "—"; }
  function vertical(value) {
    if (!Number.isFinite(Number(value))) return "—";
    const n = Math.round(Number(value));
    if (Math.abs(n) < 50) return "Level";
    return `${n > 0 ? "↑" : "↓"} ${Math.abs(n).toLocaleString()} fpm`;
  }
  function emergencyFor(flight) {
    const squawk = String(flight?.squawk || "");
    if (flight?.emergency) return String(flight.emergency);
    if (squawk === "7700") return "General emergency";
    if (squawk === "7600") return "Radio failure";
    if (squawk === "7500") return "Unlawful interference";
    return "";
  }

  function detailMarkup(flight, advanced = {}) {
    const operator = operatorFor(flight);
    const emergency = emergencyFor(flight);
    const profile = advanced.profile;
    const summary = profile?.summary;
    const note = profile?.note?.note || "";
    const extra = profile ? `<div class="detail-advanced"><div class="detail-section-title">30-DAY AIRCRAFT HISTORY</div><div class="detail-grid compact"><div><span>SAMPLES</span><b>${fmt(summary?.samples)}</b></div><div><span>MAX ALT</span><b>${fmt(summary?.maxAltitudeFt," ft")}</b></div><div><span>MAX SPEED</span><b>${fmt(summary?.maxSpeedKts," kt")}</b></div><div><span>CALLSIGNS</span><b>${fmt(summary?.callsigns)}</b></div></div><label class="note-field"><span>PRIVATE NOTE</span><textarea id="aircraftNote" maxlength="2000" placeholder="Add a private note for this aircraft">${esc(note)}</textarea></label><button type="button" class="note-save" data-save-note>Save note</button></div>`
      : advanced.loading ? '<div class="detail-message">Loading Advanced Aircraft history…</div>'
      : advanced.forbidden ? '<div class="detail-message muted-detail">Advanced 30-day history is available with Advanced Aircraft or SkyTrace Pro.</div>'
      : advanced.error ? `<div class="detail-message muted-detail">${esc(advanced.error)}</div>` : "";

    return `<article class="aircraft-detail"><div class="detail-head"><div class="detail-identity"><span class="detail-livery">${miniPlaneSvg(operator)}</span><div><small>${esc(operator.name)}${operator.known ? "" : " · inferred"}</small><h3>${esc(labelFor(flight))}</h3><p>${esc(flight.registration || flight.icao24 || "Unknown registration")} · ${esc(flight.aircraftType || "Unknown type")}</p></div></div><button type="button" class="detail-close" data-ios-close-aircraft aria-label="Close aircraft detail">×</button></div>${emergency ? `<div class="detail-alert">${esc(emergency)}${flight.squawk ? ` · SQ ${esc(flight.squawk)}` : ""}</div>` : ""}<div class="detail-grid"><div><span>ALTITUDE</span><b>${fmt(flight.altitudeFt," ft")}</b></div><div><span>GROUND SPEED</span><b>${fmt(flight.speedKts," kt")}</b></div><div><span>HEADING</span><b>${fmt(flight.heading,"°")}</b></div><div><span>VERTICAL RATE</span><b>${vertical(flight.verticalRateFpm)}</b></div></div><div class="detail-meta"><span>ICAO <b>${esc(String(flight.icao24||"").toUpperCase() || "—")}</b></span><span>SQUAWK <b>${esc(flight.squawk || "—")}</b></span><span>${flight.onGround ? "ON GROUND" : "AIRBORNE"}</span></div>${extra}</article>`;
  }

  function authHeaders(body=false) {
    const token = sessionStorage.getItem("skytrace.webToken") || "";
    return { Accept:"application/json", ...(body?{"Content-Type":"application/json"}:{}), ...(token?{Authorization:`Bearer ${token}`}:{}) };
  }

  async function api(path, options={}) {
    const response = await nativeFetch(path, { ...options, cache:"no-store", headers:{...authHeaders(Boolean(options.body)),...(options.headers||{})} });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function drawer() { return document.getElementById("drawer"); }

  function showBasicDetail(flight) {
    const d = drawer();
    if (!d) return;
    state.selectedIcao = String(flight.icao24 || "").toLowerCase();
    updateSelectedHalo();
    enhanceList();
    d.classList.remove("hidden");
    d.setAttribute("aria-label", `Aircraft ${labelFor(flight)}`);
    d.innerHTML = detailMarkup(flight, { loading:true });
    d.scrollTop = 0;
    root.classList.add("detail-open");
    window.skytraceMobileSheet?.expand?.();
  }

  async function selectFlight(flight) {
    if (!flight?.icao24) return;
    showBasicDetail(flight);
    const icao = String(flight.icao24).toLowerCase();
    const serial = ++state.profileSerial;
    try {
      const profile = await api(`/v1/v34/aircraft-profile?icao=${encodeURIComponent(icao)}`);
      if (serial !== state.profileSerial || state.selectedIcao !== icao) return;
      const live = state.byIcao.get(icao) || profile.current || flight;
      drawer().innerHTML = detailMarkup(live, { profile });
    } catch (error) {
      if (serial !== state.profileSerial || state.selectedIcao !== icao) return;
      const live = state.byIcao.get(icao) || flight;
      drawer().innerHTML = detailMarkup(live, { forbidden:error.status===403, error:error.status===403?"":error.message });
    }
  }

  function closeAircraftDetail() {
    state.profileSerial += 1;
    state.selectedIcao = "";
    updateSelectedHalo();
    enhanceList();
    const d = drawer();
    if (d) { d.classList.add("hidden"); d.innerHTML = ""; }
    root.classList.remove("detail-open");
  }

  async function saveNote(button) {
    const note = document.getElementById("aircraftNote");
    if (!note || !state.selectedIcao) return;
    button.disabled = true;
    const old = button.textContent;
    button.textContent = "Saving…";
    try {
      await api("/v1/v34/aircraft-note", { method:"POST", body:JSON.stringify({icao:state.selectedIcao,note:note.value}) });
      button.textContent = "Saved";
      setTimeout(() => { if (document.contains(button)) button.textContent = old; }, 1200);
    } catch (error) {
      button.textContent = "Could not save";
      button.title = error.message;
    } finally { button.disabled = false; }
  }

  function refreshAircraftExperience() {
    if (!state.map?.isStyleLoaded()) return;
    renderMapAircraft();
    enhanceList();
  }

  function bindInteractions() {
    const map = state.map;
    if (!map || map.__skytraceIosAircraftBound) return;
    map.__skytraceIosAircraftBound = true;
    map.on("load", refreshAircraftExperience);
    map.on("styledata", () => { if (map.isStyleLoaded()) refreshAircraftExperience(); });
    map.on("click", event => {
      const flight = nearestFlight(event.point);
      if (flight) selectFlight(flight);
    });
    if (!coarsePointer) map.on("mousemove", event => { map.getCanvas().style.cursor = nearestFlight(event.point) ? "pointer" : ""; });

    document.addEventListener("click", event => {
      const row = event.target.closest?.(".flight[data-icao]");
      if (row) {
        const flight = state.byIcao.get(String(row.dataset.icao || "").toLowerCase());
        if (flight) {
          event.preventDefault();
          event.stopImmediatePropagation();
          selectFlight(flight);
          return;
        }
      }
      if (event.target.closest?.("[data-ios-close-aircraft]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAircraftDetail();
        return;
      }
      const save = event.target.closest?.("[data-save-note]");
      if (save && state.selectedIcao) {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveNote(save);
      }
    }, true);
  }

  function init() {
    if (!state.map) {
      state.initTimer = setTimeout(init, 20);
      return;
    }
    clearTimeout(state.initTimer);
    bindInteractions();
    if (state.map.isStyleLoaded()) refreshAircraftExperience();
    root.classList.add("skytrace-livery-aircraft");
  }

  setTimeout(init, 0);
})();
