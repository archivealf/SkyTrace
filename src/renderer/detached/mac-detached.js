(() => {
  "use strict";
  const native = window.skytraceNative;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const type = params.get("type") || "aircraft";
  const id = String(params.get("id") || "").trim();
  let timer = null;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);
  const num = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

  async function api(url) {
    const response = await fetch(url);
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }

  function setStatus(text) { $("status").textContent = text; }
  function error(message) { $("content").innerHTML = `<div class="error">${esc(message)}</div>`; setStatus("Error"); }

  function bars(points, key) {
    const values = points.map(p => Number(p[key])).filter(Number.isFinite);
    if (values.length < 2) return '<div class="empty">Not enough local history yet.</div>';
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
    return `<div class="chart">${values.slice(-120).map(value => `<i class="bar" style="height:${Math.max(3, ((value - min) / span) * 100)}%" title="${esc(num(value))}"></i>`).join("")}</div>`;
  }

  function phase(point) {
    const vr = Number(point.verticalRateFpm || 0);
    const altitude = Number(point.altitudeFt || 0);
    if (altitude < 400 && Number(point.speedKts || 0) < 80) return "Ground";
    if (vr > 500) return "Climb";
    if (vr < -500) return "Descent";
    return altitude > 10000 ? "Cruise" : "Level";
  }

  function orbitEstimate(points) {
    if (points.length < 8) return false;
    const recent = points.slice(-25);
    let headingChange = 0;
    for (let i = 1; i < recent.length; i++) {
      const a = Number(recent[i - 1].heading), b = Number(recent[i].heading);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      headingChange += Math.abs((((b - a) + 540) % 360) - 180);
    }
    const lats = recent.map(p => Number(p.latitude)).filter(Number.isFinite);
    const lons = recent.map(p => Number(p.longitude)).filter(Number.isFinite);
    const compact = lats.length && lons.length && (Math.max(...lats) - Math.min(...lats)) < 0.35 && (Math.max(...lons) - Math.min(...lons)) < 0.45;
    return compact && headingChange > 420;
  }

  async function loadAircraft() {
    const hex = id.toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error("A 6-character ICAO hex code is required.");
    $("title").textContent = hex.toUpperCase();
    $("subtitle").textContent = "Detached aircraft analysis";
    setStatus("Loading");

    const [flightResult, metadataResult, profileResult, localResult] = await Promise.allSettled([
      api(`/api/flights?icao=${encodeURIComponent(hex)}`),
      api(`/api/aircraft?icao=${encodeURIComponent(hex)}`),
      api(`/api/v34/aircraft-profile?icao=${encodeURIComponent(hex)}`),
      native?.localReplay?.query({ from: Date.now() - 24 * 3600_000, to: Date.now(), icao: hex, limit: 30000 })
    ]);

    const flight = flightResult.status === "fulfilled" ? (flightResult.value.flights?.[0] || null) : null;
    const metadata = metadataResult.status === "fulfilled" ? (metadataResult.value.aircraft || metadataResult.value) : {};
    const profile = profileResult.status === "fulfilled" ? profileResult.value : {};
    const points = localResult.status === "fulfilled" ? (localResult.value.points || []) : [];
    const current = profile.current || flight || {};
    const name = current.callsign || current.registration || metadata.registration || hex.toUpperCase();
    $("title").textContent = name;
    $("subtitle").textContent = `${current.registration || metadata.registration || hex.toUpperCase()} · ${current.aircraftType || metadata.type || metadata.typeCode || "Unknown type"}`;

    const latestPhase = points.length ? phase(points[points.length - 1]) : phase(current);
    const orbiting = orbitEstimate(points);
    const maxAlt = points.length ? Math.max(...points.map(p => Number(p.altitudeFt)).filter(Number.isFinite), 0) : Number(profile.summary?.maxAltitudeFt || 0);
    const maxSpeed = points.length ? Math.max(...points.map(p => Number(p.speedKts)).filter(Number.isFinite), 0) : Number(profile.summary?.maxSpeedKts || 0);

    $("content").innerHTML = `
      <div class="hero-grid">
        <div class="stat"><strong>${num(current.altitudeFt)}</strong><span>ALTITUDE FT</span></div>
        <div class="stat"><strong>${num(current.speedKts)}</strong><span>SPEED KT</span></div>
        <div class="stat"><strong>${num(current.heading)}</strong><span>HEADING</span></div>
        <div class="stat"><strong>${esc(latestPhase)}</strong><span>FLIGHT PHASE</span></div>
      </div>
      <div class="two-col">
        <article class="card"><h2>Aircraft profile</h2><dl class="meta-list">
          <dt>ICAO</dt><dd>${esc(hex.toUpperCase())}</dd>
          <dt>Registration</dt><dd>${esc(current.registration || metadata.registration || "—")}</dd>
          <dt>Type</dt><dd>${esc(current.aircraftType || metadata.type || metadata.typeCode || "—")}</dd>
          <dt>Manufacturer</dt><dd>${esc(metadata.manufacturer || metadata.manufacturerName || "—")}</dd>
          <dt>Model</dt><dd>${esc(metadata.model || metadata.modelName || "—")}</dd>
          <dt>Squawk</dt><dd>${esc(current.squawk || "—")}</dd>
          <dt>Vertical rate</dt><dd>${num(current.verticalRateFpm)} fpm</dd>
          <dt>Orbit / hold estimate</dt><dd>${orbiting ? "Possible orbit/holding pattern" : "No strong pattern detected"}</dd>
        </dl></article>
        <article class="card"><h2>24-hour private Mac history</h2><div class="stat-grid">
          <div class="stat"><strong>${points.length.toLocaleString()}</strong><span>SAMPLES</span></div>
          <div class="stat"><strong>${num(maxAlt)}</strong><span>MAX FT</span></div>
          <div class="stat"><strong>${num(maxSpeed)}</strong><span>MAX KT</span></div>
          <div class="stat"><strong>${points.length ? new Date(points[0].recordedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}</strong><span>FIRST</span></div>
          <div class="stat"><strong>${points.length ? new Date(points.at(-1).recordedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}</strong><span>LAST</span></div>
        </div><p style="margin-top:10px">Private Local Replay contains only observations received by this Mac and may be incomplete.</p></article>
      </div>
      <div class="two-col">
        <article class="card"><h2>Altitude profile</h2>${bars(points,"altitudeFt")}</article>
        <article class="card"><h2>Speed profile</h2>${bars(points,"speedKts")}</article>
      </div>
      <article class="card" style="margin-top:12px"><h2>Observed identifiers</h2>
        ${[current.callsign && `Callsign ${current.callsign}`, current.registration && `Registration ${current.registration}`, current.aircraftType && `Type ${current.aircraftType}`, current.emergency && `Emergency ${current.emergency}`].filter(Boolean).map(value => `<span class="tag">${esc(value)}</span>`).join("") || '<span class="tag">No enriched identifiers</span>'}
      </article>`;
    setStatus(flight ? "Live" : points.length ? "Local history" : "Reference");
  }

  function movementRows(movements = []) {
    if (!movements.length) return '<div class="empty">No strong movement estimates right now.</div>';
    return `<div class="movement-list">${movements.map(m => `<div class="movement"><strong>${esc(m.callsign || m.registration || m.icao24 || "Aircraft")}</strong><span>${esc(m.movement || "Observed")}</span><span>${num(m.distanceNm,1)} nm</span><span>${num(m.altitudeFt)} ft</span></div>`).join("")}</div>`;
  }

  function weatherSummary(weather) {
    if (!weather) return "Aviation weather unavailable.";
    const metar = weather.metar?.rawOb || weather.metar?.raw || weather.metar || "";
    const taf = weather.taf?.rawTAF || weather.taf?.raw || weather.taf || "";
    return `<p><strong>METAR</strong><br>${esc(typeof metar === "string" ? metar : JSON.stringify(metar))}</p>${taf ? `<p style="margin-top:10px"><strong>TAF</strong><br>${esc(typeof taf === "string" ? taf : JSON.stringify(taf))}</p>` : ""}`;
  }

  async function loadAirport() {
    const code = id.toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(code)) throw new Error("A valid airport ICAO code is required.");
    $("title").textContent = code;
    $("subtitle").textContent = "Airport Desk · observed operations";
    setStatus("Loading");
    const p = await api(`/api/airport-intelligence?icao=${encodeURIComponent(code)}`);
    const airport = p.airport || {};
    const ops = p.operations || {};
    $("title").textContent = `${airport.icao || airport.ident || code} · ${airport.name || "Airport"}`;
    $("subtitle").textContent = [airport.city, airport.country].filter(Boolean).join(" · ") || "Observed airport operations";
    const runways = (airport.runways || []).map(r => `<span class="tag">${esc(r.ident || "RWY")} · ${num(r.lengthFt)} ft · ${esc(r.surface || "")}</span>`).join("");
    const frequencies = (airport.frequencies || []).slice(0, 18).map(f => `<span class="tag">${esc(f.type || f.desc || "")}&nbsp;${esc(f.freq || f.mhz || "")}</span>`).join("");
    const types = (ops.busiestTypes || []).map(x => `<span class="tag">${esc(x.type)} ×${num(x.count)}</span>`).join("");
    const runwayUse = (ops.runwayUseEstimate || []).map(x => `<span class="tag">${esc(x.runway)} · ${num(x.count)} observed</span>`).join("");
    const profile = ops.trafficProfile || [];
    const maxProfile = Math.max(1, ...profile.map(x => Number(x.count) || 0));
    $("content").innerHTML = `
      <div class="stat-grid">
        <div class="stat"><strong>${num(ops.nearby)}</strong><span>NEARBY</span></div>
        <div class="stat"><strong>${num(ops.airborne)}</strong><span>AIRBORNE</span></div>
        <div class="stat"><strong>${num(ops.onGround)}</strong><span>ON GROUND</span></div>
        <div class="stat"><strong>${num(ops.inboundEstimate)}</strong><span>INBOUND EST.</span></div>
        <div class="stat"><strong>${num(ops.outboundEstimate)}</strong><span>OUTBOUND EST.</span></div>
      </div>
      <div class="two-col">
        <article class="card"><h2>Runway-use estimate</h2>${runwayUse || '<p>No strong live runway-use estimate.</p>'}<h2 style="margin-top:16px">Runway reference</h2>${runways || '<p>No runway reference available.</p>'}</article>
        <article class="card"><h2>Observed aircraft mix</h2>${types || '<p>No enriched type data in the current sample.</p>'}<h2 style="margin-top:16px">Frequencies</h2>${frequencies || '<p>No frequency reference available.</p>'}</article>
      </div>
      <div class="two-col">
        <article class="card"><h2>Traffic by distance</h2><div class="chart">${profile.map(x => `<i class="bar" style="height:${Math.max(3,(Number(x.count||0)/maxProfile)*100)}%" title="${esc(x.label)}: ${num(x.count)}"></i>`).join("")}</div><p style="margin-top:8px">${profile.map(x => `${esc(x.label)} ${num(x.count)}`).join(" · ")}</p></article>
        <article class="card"><h2>Aviation weather</h2>${weatherSummary(p.weather)}</article>
      </div>
      <article class="card" style="margin-top:12px"><h2>Observed movements</h2>${movementRows(ops.movements)}</article>
      <article class="card" style="margin-top:12px"><h2>Methodology</h2><p>${esc(p.methodology || "Values are derived from observed public ADS-B traffic and are not licensed schedule truth.")}</p></article>`;
    setStatus("Live estimate");
  }

  async function load() {
    try {
      if (type === "aircraft") await loadAircraft();
      else await loadAirport();
    } catch (e) { error(e.message || String(e)); }
  }

  $("refresh").onclick = load;
  load();
  timer = setInterval(load, type === "aircraft" ? 15000 : 30000);
  window.addEventListener("beforeunload", () => clearInterval(timer));
})();
