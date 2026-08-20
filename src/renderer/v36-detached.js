(() => {
  "use strict";
  const native = window.skytraceNative;
  if (!native?.isMac) return;
  const params = new URLSearchParams(location.search);
  const type = params.get("type") || "aircraft";
  const id = String(params.get("id") || "").trim();
  const $ = x => document.getElementById(x);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[ch]);
  const get = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
  const set = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

  function addAircraftWorkspace(content) {
    if (document.getElementById("v36DetachedWorkspace")) return;
    const notes = get("skytrace.v36.aircraft-notes", {});
    const saved = notes[id.toLowerCase()] || { note: "", tags: "" };
    const card = document.createElement("article");
    card.id = "v36DetachedWorkspace";
    card.className = "card v36-detached-workspace";
    card.innerHTML = `<div class="v36-detached-head"><div><span>WORKSPACE</span><h2>Aircraft tools</h2></div><div><button id="v36DetachedWatch">Watch aircraft</button><button id="v36DetachedTimeline">Open Timeline</button></div></div><label>Notes<textarea id="v36AircraftNote" placeholder="Private note stored on this Mac">${esc(saved.note)}</textarea></label><label>Tags<input id="v36AircraftTags" value="${esc(saved.tags)}" placeholder="training, cargo, favourite…"></label><p>Notes and tags are local to SkyTrace on this Mac.</p>`;
    content.appendChild(card);
    const save = () => { notes[id.toLowerCase()] = { note: $("v36AircraftNote").value.slice(0, 2000), tags: $("v36AircraftTags").value.slice(0, 250) }; set("skytrace.v36.aircraft-notes", notes); };
    $("v36AircraftNote").addEventListener("input", save);
    $("v36AircraftTags").addEventListener("input", save);
    $("v36DetachedTimeline").onclick = () => native.focusMain?.("timeline");
    $("v36DetachedWatch").onclick = () => {
      const lists = get("skytrace.v36.watchlists", []);
      let quick = lists.find(list => list.name === "Quick Watch");
      if (!quick) { quick = { id: `quick-${Date.now()}`, name: "Quick Watch", enabled: true, rules: [] }; lists.unshift(quick); }
      if (!(quick.rules || []).some(rule => rule.type === "icao" && String(rule.value).toLowerCase() === id.toLowerCase())) quick.rules.push({ id: `rule-${Date.now()}`, type: "icao", value: id.toUpperCase() });
      set("skytrace.v36.watchlists", lists);
      $("v36DetachedWatch").textContent = "Watching";
    };
  }

  function addAirportWorkspace(content) {
    if (document.getElementById("v36DetachedWorkspace")) return;
    const favorites = get("skytrace.v36.airport-favorites", []);
    const code = id.toUpperCase();
    const card = document.createElement("article");
    card.id = "v36DetachedWorkspace";
    card.className = "card v36-detached-workspace";
    card.innerHTML = `<div class="v36-detached-head"><div><span>AIRPORT WORKSPACE</span><h2>Desk shortcuts</h2></div><div><button id="v36AirportFavorite">${favorites.includes(code) ? "Favorited" : "Favorite airport"}</button><button id="v36AirportMain">Open main app</button></div></div><p>Airport Desk combines observed traffic, runway-use estimates, runway reference, frequencies, METAR/TAF and the current public-data movement picture. Estimates are labelled as estimates rather than schedule truth.</p>`;
    content.appendChild(card);
    $("v36AirportFavorite").onclick = () => {
      const index = favorites.indexOf(code);
      if (index >= 0) favorites.splice(index, 1); else favorites.unshift(code);
      set("skytrace.v36.airport-favorites", favorites.slice(0, 50));
      $("v36AirportFavorite").textContent = favorites.includes(code) ? "Favorited" : "Favorite airport";
    };
    $("v36AirportMain").onclick = () => native.focusMain?.("command");
  }

  function ensureWorkspace() {
    const content = $("content");
    if (!content || document.getElementById("v36DetachedWorkspace")) return;
    const rendered = type === "aircraft" ? content.querySelector(".hero-grid") : content.querySelector(".stat-grid");
    if (!rendered) return;
    if (type === "aircraft") addAircraftWorkspace(content); else addAirportWorkspace(content);
  }

  function boot() {
    ensureWorkspace();
    const timer = setInterval(ensureWorkspace, 750);
    window.addEventListener("beforeunload", () => clearInterval(timer), { once: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
