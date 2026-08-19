(() => {
  "use strict";

  const state = { movements: [], mode: "arrivals", source: "", updatedAt: 0 };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[ch]);
  }

  function ensureStyles() {
    if (document.getElementById("airportTrafficFixStyles")) return;
    const style = document.createElement("style");
    style.id = "airportTrafficFixStyles";
    style.textContent = `
      .skytrace-observed-list{display:flex;flex-direction:column;gap:6px;margin-top:9px;max-height:220px;overflow:auto;padding-right:2px}
      .skytrace-observed-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid #ffffff14;border-radius:11px;background:#ffffff08}
      .skytrace-observed-row strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;letter-spacing:.01em}
      .skytrace-observed-row small{display:block;margin-top:2px;color:var(--muted,#969daa);font-size:8px;line-height:1.35}
      .skytrace-observed-metrics{text-align:right;white-space:nowrap;color:var(--muted,#a1a7b3);font-size:8px;line-height:1.45}
      .skytrace-observed-empty{padding:12px 10px;border:1px dashed #ffffff18;border-radius:11px;color:var(--muted,#9298a6);font-size:9px;line-height:1.45;text-align:center}
      .skytrace-observed-meta{display:flex;justify-content:space-between;gap:8px;margin-top:7px;color:var(--muted,#9298a6);font-size:8px}
      .skytrace-observed-tab-active{background:#ffffff16!important;border-color:#ffffff2e!important;color:#fff!important}
    `;
    document.head.appendChild(style);
  }

  function normMovement(value) {
    const text = String(value || "").toLowerCase();
    return text.includes("arrival") || text.includes("inbound") ? "arrivals" :
      text.includes("departure") || text.includes("outbound") ? "departures" : "other";
  }

  function findControls() {
    const buttons = [...document.querySelectorAll("button")];
    const arrivals = buttons.find(b => b.textContent.trim().toLowerCase() === "arrivals");
    const departures = buttons.find(b => b.textContent.trim().toLowerCase() === "departures");
    const refresh = buttons.find(b => b.textContent.trim().toLowerCase().includes("refresh observed traffic"));
    if (!arrivals || !departures || !refresh) return null;

    let host = refresh.parentElement;
    for (let i = 0; host && i < 4; i++, host = host.parentElement) {
      if (host.contains(arrivals) && host.contains(departures)) return { host, arrivals, departures, refresh };
    }
    return { host: refresh.parentElement, arrivals, departures, refresh };
  }

  function render() {
    ensureStyles();
    const controls = findControls();
    if (!controls?.host) return;

    let list = controls.host.querySelector(".skytrace-observed-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "skytrace-observed-list";
      controls.refresh.insertAdjacentElement("afterend", list);
    }

    let meta = controls.host.querySelector(".skytrace-observed-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "skytrace-observed-meta";
      list.insertAdjacentElement("afterend", meta);
    }

    controls.arrivals.classList.toggle("skytrace-observed-tab-active", state.mode === "arrivals");
    controls.departures.classList.toggle("skytrace-observed-tab-active", state.mode === "departures");

    const rows = state.movements.filter(m => normMovement(m.movement) === state.mode);
    if (!state.movements.length) {
      list.innerHTML = '<div class="skytrace-observed-empty">Refresh observed traffic to load live movement estimates for this airport.</div>';
    } else if (!rows.length) {
      list.innerHTML = `<div class="skytrace-observed-empty">No live ${state.mode === "arrivals" ? "arrival" : "departure"} estimates are currently visible around this airport.</div>`;
    } else {
      list.innerHTML = rows.slice(0, 30).map(m => {
        const title = m.callsign || m.registration || m.icao24 || "Unknown aircraft";
        const subtitle = [m.registration && m.registration !== title ? m.registration : "", m.aircraftType || ""].filter(Boolean).join(" · ") || (m.icao24 || "Unknown type");
        const distance = Number.isFinite(Number(m.distanceNm)) ? `${Number(m.distanceNm).toFixed(1)} nm` : "";
        const altitude = Number.isFinite(Number(m.altitudeFt)) ? `${Math.round(Number(m.altitudeFt)).toLocaleString()} ft` : "—";
        const speed = Number.isFinite(Number(m.speedKts)) ? `${Math.round(Number(m.speedKts))} kt` : "—";
        return `<div class="skytrace-observed-row" data-observed-icao="${esc(m.icao24 || "")}"><div><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div><div class="skytrace-observed-metrics">${esc(distance)}<br>${esc(altitude)} · ${esc(speed)}</div></div>`;
      }).join("");
    }

    meta.innerHTML = `<span>${rows.length} ${state.mode}</span><span>${state.source ? esc(state.source) + " · " : ""}derived live</span>`;
  }

  function bindControls() {
    const controls = findControls();
    if (!controls) return;
    if (!controls.arrivals.dataset.skytraceObservedBound) {
      controls.arrivals.dataset.skytraceObservedBound = "1";
      controls.arrivals.addEventListener("click", () => { state.mode = "arrivals"; render(); });
    }
    if (!controls.departures.dataset.skytraceObservedBound) {
      controls.departures.dataset.skytraceObservedBound = "1";
      controls.departures.addEventListener("click", () => { state.mode = "departures"; render(); });
    }
    render();
  }

  if (!window.__skytraceAirportTrafficFetchPatched) {
    window.__skytraceAirportTrafficFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        if (/\/api\/airport-intelligence(?:\?|$)/.test(url) && response.ok) {
          const clone = response.clone();
          clone.json().then(payload => {
            state.movements = Array.isArray(payload?.operations?.movements) ? payload.operations.movements : [];
            state.source = String(payload?.source || "");
            state.updatedAt = Number(payload?.generatedAt || Date.now());
            render();
          }).catch(() => {});
        }
      } catch {}
      return response;
    };
  }

  ensureStyles();
  bindControls();
  new MutationObserver(bindControls).observe(document.documentElement, { childList: true, subtree: true });
})();
