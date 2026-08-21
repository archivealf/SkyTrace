(() => {
  'use strict';

  if (typeof map === 'undefined' || typeof flights === 'undefined') return;

  const BUILD = '35.0';
  const root35 = document.documentElement;
  const panel35 = document.querySelector('.panel');
  const drawer35 = document.getElementById('drawer');
  const list35 = document.getElementById('list');
  const isIPad35 = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOS35 = /iPhone|iPad|iPod/i.test(navigator.userAgent) || isIPad35;
  const isIPhone35 = isIOS35 && !isIPad35;
  const STORAGE = Object.freeze({
    watch: 'skytrace.mobile35.watch',
    filters: 'skytrace.mobile35.filters',
    map: 'skytrace.mobile35.map',
    lastFlights: 'skytrace.mobile35.lastFlights',
    theme: 'skytrace.mobile35.theme',
    notify: 'skytrace.mobile35.notify'
  });

  root35.classList.add('skytrace-mobile-35');
  document.body.dataset.skytraceMobile = BUILD;

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function clamp35(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function text35(value) { return String(value ?? '').trim(); }
  function html35(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch]);
  }
  function icao35(flight) { return text35(flight?.icao24).toLowerCase(); }
  function callsign35(flight) { return text35(flight?.callsign).toUpperCase(); }
  function registration35(flight) { return text35(flight?.registration).toUpperCase(); }
  function type35(flight) { return text35(flight?.aircraftType).toUpperCase(); }
  function operator35(flight) {
    try { return operatorFor(flight); } catch { return { name: '', code: '' }; }
  }
  function label35(flight) {
    try { return labelFor(flight); } catch { return callsign35(flight) || registration35(flight) || icao35(flight).toUpperCase() || 'Aircraft'; }
  }
  function haptic35() {
    document.body.classList.remove('mobile35-tap');
    requestAnimationFrame(() => document.body.classList.add('mobile35-tap'));
    try { navigator.vibrate?.(8); } catch {}
  }

  const watchState = loadJSON(STORAGE.watch, {
    icaos: [], registrations: [], callsigns: [], airlines: [], types: [], airports: []
  });
  for (const key of ['icaos', 'registrations', 'callsigns', 'airlines', 'types', 'airports']) {
    if (!Array.isArray(watchState[key])) watchState[key] = [];
  }

  const filterState = Object.assign({
    query: '', minAlt: '', maxAlt: '', airborneOnly: false, watchedOnly: false, type: ''
  }, loadJSON(STORAGE.filters, {}));

  let currentTab = 'map';
  let userPosition = null;
  let locationWatchId = null;
  let followIcao = '';
  let liveActivityIcao = '';
  let lastNativeActivityUpdate = 0;
  let lastWatchMatches = new Set();
  let sheetState = isIPhone35 ? 'half' : 'full';
  let sheetDrag = null;
  let trails = new Map();
  let replayState = { points: [], progress: 1, speed: 1, playing: false, frame: 0, lastFrame: 0 };

  function normalizeList(values) {
    return [...new Set((values || []).map(v => text35(v).toUpperCase()).filter(Boolean))].slice(0, 200);
  }
  function persistWatch() {
    for (const key of Object.keys(watchState)) watchState[key] = normalizeList(watchState[key]);
    saveJSON(STORAGE.watch, watchState);
    updateWatchLayer35();
    applyListFilters35();
  }
  function watched35(flight) {
    const icao = icao35(flight).toUpperCase();
    const reg = registration35(flight);
    const call = callsign35(flight);
    const op = operator35(flight);
    const opCode = text35(op.code).toUpperCase();
    const opName = text35(op.name).toUpperCase();
    const kind = type35(flight);
    const origin = text35(flight?.origin || flight?.originIcao).toUpperCase();
    const destination = text35(flight?.destination || flight?.destinationIcao).toUpperCase();
    return watchState.icaos.includes(icao)
      || watchState.registrations.some(x => reg === x || reg.startsWith(x))
      || watchState.callsigns.some(x => call === x || call.startsWith(x))
      || watchState.airlines.some(x => opCode === x || opName.includes(x) || call.startsWith(x))
      || watchState.types.some(x => kind === x || kind.startsWith(x))
      || watchState.airports.some(x => origin === x || destination === x);
  }
  function toggleWatch35(flight) {
    const key = icao35(flight).toUpperCase();
    if (!key) return;
    const index = watchState.icaos.indexOf(key);
    if (index >= 0) watchState.icaos.splice(index, 1);
    else watchState.icaos.push(key);
    persistWatch();
    haptic35();
    decorateAircraftDetail35();
    showTransient35(index >= 0 ? `${label35(flight)} removed from Watchlist` : `${label35(flight)} added to Watchlist`);
  }

  function flightMatchesFilters35(flight) {
    const q = text35(filterState.query).toUpperCase();
    if (q) {
      const op = operator35(flight);
      const haystack = [
        label35(flight), flight?.icao24, flight?.registration, flight?.callsign,
        flight?.aircraftType, op.name, op.code, flight?.origin, flight?.destination
      ].map(x => text35(x).toUpperCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    const altitude = Number(flight?.altitudeFt);
    if (filterState.minAlt !== '' && Number.isFinite(altitude) && altitude < Number(filterState.minAlt)) return false;
    if (filterState.maxAlt !== '' && Number.isFinite(altitude) && altitude > Number(filterState.maxAlt)) return false;
    if (filterState.airborneOnly && flight?.onGround) return false;
    if (filterState.watchedOnly && !watched35(flight)) return false;
    if (filterState.type && !type35(flight).includes(text35(filterState.type).toUpperCase())) return false;
    return true;
  }
  function filteredFlights35() { return flights.filter(flightMatchesFilters35); }

  function buildChrome35() {
    if (!document.getElementById('mobile35Topbar')) {
      const top = document.createElement('div');
      top.id = 'mobile35Topbar';
      top.className = 'mobile35-topbar';
      top.innerHTML = `
        <div class="mobile35-search-wrap">
          <span class="mobile35-search-icon" aria-hidden="true">⌕</span>
          <input id="mobile35Search" type="search" inputmode="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Aircraft, registration or airport" aria-label="Search SkyTrace">
          <button id="mobile35Filter" type="button" aria-label="Filters">☷</button>
        </div>
        <button id="mobile35Locate" class="mobile35-circle" type="button" aria-label="Show my location">◎</button>`;
      document.body.appendChild(top);
    }

    if (!document.getElementById('mobile35Tabs')) {
      const nav = document.createElement('nav');
      nav.id = 'mobile35Tabs';
      nav.className = 'mobile35-tabs';
      nav.setAttribute('aria-label', 'SkyTrace mobile navigation');
      nav.innerHTML = `
        <button type="button" data-tab="map" class="active"><span>⌖</span><b>Map</b></button>
        <button type="button" data-tab="nearby"><span>◉</span><b>Nearby</b></button>
        <button type="button" data-tab="replay"><span>↶</span><b>Replay</b></button>
        <button type="button" data-tab="more"><span>•••</span><b>More</b></button>`;
      document.body.appendChild(nav);
    }

    const search = document.getElementById('mobile35Search');
    if (search) search.value = filterState.query || '';
  }

  function setSheetState35(next, animate = true) {
    const allowed = isIPhone35 && window.matchMedia('(max-width:700px) and (orientation:portrait)').matches;
    sheetState = allowed ? next : 'full';
    panel35?.classList.toggle('sheet35-peek', sheetState === 'peek');
    panel35?.classList.toggle('sheet35-half', sheetState === 'half');
    panel35?.classList.toggle('sheet35-full', sheetState === 'full');
    panel35?.classList.toggle('sheet35-no-animate', !animate);
    panel35?.style.removeProperty('--sheet35-drag-y');
    root35.dataset.sheet35 = sheetState;
    document.getElementById('sheetHandle')?.setAttribute('aria-label', sheetState === 'full' ? 'Lower controls' : 'Expand controls');
    requestAnimationFrame(() => {
      window.skytraceResizeMap?.();
      setTimeout(() => panel35?.classList.remove('sheet35-no-animate'), 40);
    });
  }

  function installThreePositionSheet35() {
    const targets = [document.getElementById('sheetHandle'), document.querySelector('.panel-head')].filter(Boolean);
    const order = ['peek', 'half', 'full'];
    const start = event => {
      if (!isIPhone35 || !window.matchMedia('(max-width:700px) and (orientation:portrait)').matches) return;
      if (root35.classList.contains('ios-keyboard-open')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.stopImmediatePropagation();
      sheetDrag = { id: event.pointerId, y: event.clientY, lastY: event.clientY, lastT: performance.now(), dy: 0, velocity: 0, state: sheetState };
      panel35?.classList.add('sheet35-dragging');
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    };
    const move = event => {
      if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const now = performance.now();
      const dt = Math.max(1, now - sheetDrag.lastT);
      sheetDrag.velocity = (event.clientY - sheetDrag.lastY) / dt;
      sheetDrag.lastY = event.clientY;
      sheetDrag.lastT = now;
      sheetDrag.dy = event.clientY - sheetDrag.y;
      panel35?.style.setProperty('--sheet35-drag-y', `${clamp35(sheetDrag.dy, -260, 300)}px`);
    };
    const end = event => {
      if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
      event.stopImmediatePropagation();
      const drag = sheetDrag;
      sheetDrag = null;
      panel35?.classList.remove('sheet35-dragging');
      panel35?.style.removeProperty('--sheet35-drag-y');
      const current = order.indexOf(drag.state);
      let next = current;
      if (drag.velocity > .45 || drag.dy > 64) next = Math.max(0, current - 1);
      else if (drag.velocity < -.45 || drag.dy < -52) next = Math.min(order.length - 1, current + 1);
      else if (Math.abs(drag.dy) < 8) next = current === 2 ? 1 : current + 1;
      setSheetState35(order[next]);
      haptic35();
    };
    for (const target of targets) {
      target.addEventListener('pointerdown', start, { capture: true });
      target.addEventListener('pointermove', move, { capture: true, passive: false });
      target.addEventListener('pointerup', end, { capture: true });
      target.addEventListener('pointercancel', end, { capture: true });
    }
    window.skytraceMobileSheet = {
      expand: () => setSheetState35('full'),
      collapse: () => setSheetState35('peek'),
      half: () => setSheetState35('half'),
      isCollapsed: () => sheetState === 'peek',
      state: () => sheetState,
      refresh: () => setSheetState35(root35.classList.contains('ios-keyboard-open') ? 'full' : sheetState, false)
    };
    document.addEventListener('focusin', () => { if (isIOS35) setTimeout(() => setSheetState35('full'), 80); });
  }

  function showTransient35(message) {
    let toast = document.getElementById('mobile35Toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mobile35Toast';
      toast.className = 'mobile35-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showTransient35.timer);
    showTransient35.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function saveMapPosition35() {
    if (followIcao) return;
    try {
      const center = map.getCenter();
      saveJSON(STORAGE.map, { lng: center.lng, lat: center.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    } catch {}
  }
  function restoreMapPosition35() {
    const saved = loadJSON(STORAGE.map, null);
    if (!saved || !Number.isFinite(saved.lat) || !Number.isFinite(saved.lng)) return;
    try { map.jumpTo({ center: [saved.lng, saved.lat], zoom: clamp35(Number(saved.zoom) || 5, 2, 16), bearing: Number(saved.bearing) || 0, pitch: Number(saved.pitch) || 0 }); } catch {}
  }

  function haversineNm35(aLat, aLon, bLat, bLon) {
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLon = (bLon - aLon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 3440.065 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function bearing35(aLat, aLon, bLat, bLon) {
    const rad = Math.PI / 180;
    const y = Math.sin((bLon - aLon) * rad) * Math.cos(bLat * rad);
    const x = Math.cos(aLat * rad) * Math.sin(bLat * rad) - Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLon - aLon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  function compass35(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
  }

  function updateLocationLayer35() {
    if (!userPosition || !map.isStyleLoaded()) return;
    const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [userPosition.lon, userPosition.lat] }, properties: {} }] };
    if (!map.getSource('skytrace-user-location-35')) map.addSource('skytrace-user-location-35', { type: 'geojson', data });
    else map.getSource('skytrace-user-location-35').setData(data);
    if (!map.getLayer('skytrace-user-location-halo-35')) map.addLayer({ id: 'skytrace-user-location-halo-35', type: 'circle', source: 'skytrace-user-location-35', paint: { 'circle-radius': 14, 'circle-color': '#4da3ff', 'circle-opacity': .18 } });
    if (!map.getLayer('skytrace-user-location-35')) map.addLayer({ id: 'skytrace-user-location-35', type: 'circle', source: 'skytrace-user-location-35', paint: { 'circle-radius': 6, 'circle-color': '#4da3ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }

  async function locate35({ center = true, watch = false } = {}) {
    if (!navigator.geolocation) throw new Error('Location is not available on this device.');
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }));
    userPosition = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
    updateLocationLayer35();
    if (center) map.easeTo({ center: [userPosition.lon, userPosition.lat], zoom: Math.max(8, map.getZoom()), duration: 700 });
    if (watch && locationWatchId == null) {
      locationWatchId = navigator.geolocation.watchPosition(pos => {
        userPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
        updateLocationLayer35();
        if (currentTab === 'nearby') renderNearby35();
      }, () => {}, { enableHighAccuracy: false, maximumAge: 20000, timeout: 15000 });
    }
    return userPosition;
  }

  function nearbyFlights35() {
    if (!userPosition) return [];
    return filteredFlights35().map(flight => {
      const lat = Number(flight.latitude), lon = Number(flight.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { flight, distance: haversineNm35(userPosition.lat, userPosition.lon, lat, lon), bearing: bearing35(userPosition.lat, userPosition.lon, lat, lon) };
    }).filter(Boolean).sort((a, b) => a.distance - b.distance);
  }

  function renderNearby35() {
    if (currentTab !== 'nearby') return;
    const rows = nearbyFlights35().slice(0, 40);
    const content = !userPosition
      ? `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>NEARBY</small><h2>Aircraft near you</h2></div></div><div class="mobile35-empty"><p>Use your iPhone location to sort live aircraft by distance and bearing.</p><button type="button" data-nearby-locate class="primary">Use my location</button></div></div>`
      : `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>NEARBY · ±${Math.round(userPosition.accuracy || 0)} m</small><h2>Aircraft near you</h2></div><button type="button" data-nearby-locate>Recenter</button></div><div class="mobile35-nearby-list">${rows.length ? rows.map(({ flight, distance, bearing }) => `<button type="button" class="mobile35-nearby-row${watched35(flight) ? ' watched' : ''}" data-nearby-icao="${html35(icao35(flight))}"><span><b>${html35(label35(flight))}</b><small>${html35(registration35(flight) || type35(flight) || icao35(flight).toUpperCase())}</small></span><span><b>${distance.toFixed(distance < 10 ? 1 : 0)} nm</b><small>${compass35(bearing)} · ${Math.round(bearing)}° · ${Number(flight.altitudeFt || 0).toLocaleString()} ft</small></span></button>`).join('') : '<div class="mobile35-empty">No matching aircraft are visible in the current live feed.</div>'}</div></div>`;
    showDrawer(content, 'Nearby aircraft');
  }

  function addWatchLayer35() {
    if (!map.isStyleLoaded() || !map.getSource('aircraft-live')) return;
    if (!map.getLayer('aircraft-watched-35')) {
      try {
        map.addLayer({
          id: 'aircraft-watched-35', type: 'circle', source: 'aircraft-live',
          filter: ['==', ['get', 'icao'], '__none__'],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 7, 20, 11, 27], 'circle-color': 'rgba(255,205,64,.10)', 'circle-stroke-color': '#ffd45a', 'circle-stroke-width': 2.2 }
        }, map.getLayer('aircraft-icons') ? 'aircraft-icons' : undefined);
      } catch {}
    }
  }
  function updateWatchLayer35() {
    addWatchLayer35();
    if (!map.getLayer('aircraft-watched-35')) return;
    const ids = flights.filter(watched35).map(icao35).filter(Boolean);
    const filter = ids.length ? ['in', ['get', 'icao'], ['literal', ids]] : ['==', ['get', 'icao'], '__none__'];
    try { map.setFilter('aircraft-watched-35', filter); } catch {}
  }

  function applyMapFilters35() {
    const ids = filteredFlights35().map(icao35).filter(Boolean);
    const filter = ids.length ? ['in', ['get', 'icao'], ['literal', ids]] : ['==', ['get', 'icao'], '__none__'];
    for (const layer of ['aircraft-icons', 'aircraft-labels', 'aircraft-hit']) {
      if (map.getLayer(layer)) try { map.setFilter(layer, filter); } catch {}
    }
    updateWatchLayer35();
  }
  function applyListFilters35() {
    if (!list35) return;
    const allowed = new Set(filteredFlights35().map(icao35));
    let visible = 0;
    for (const row of list35.querySelectorAll('.flight[data-icao]')) {
      const show = allowed.has(text35(row.dataset.icao).toLowerCase());
      row.hidden = !show;
      if (show) visible += 1;
      const flight = flightByIcao.get(text35(row.dataset.icao).toLowerCase());
      row.classList.toggle('watched', Boolean(flight && watched35(flight)));
    }
    const counter = document.getElementById('visible');
    if (counter && (filterState.query || filterState.airborneOnly || filterState.watchedOnly || filterState.minAlt !== '' || filterState.maxAlt !== '' || filterState.type)) counter.textContent = String(visible);
    applyMapFilters35();
  }

  function updateTrails35() {
    const now = Date.now();
    for (const flight of flights) {
      const id = icao35(flight);
      const lat = Number(flight.latitude), lon = Number(flight.longitude);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const arr = trails.get(id) || [];
      const last = arr[arr.length - 1];
      if (!last || Math.abs(last[0] - lon) > .00001 || Math.abs(last[1] - lat) > .00001) arr.push([lon, lat, now]);
      if (arr.length > 90) arr.splice(0, arr.length - 90);
      trails.set(id, arr);
    }
    if (!map.isStyleLoaded()) return;
    const interesting = new Set([followIcao, selectedIcao, ...flights.filter(watched35).map(icao35)].filter(Boolean));
    const data = { type: 'FeatureCollection', features: [...interesting].map(id => {
      const coords = (trails.get(id) || []).map(x => [x[0], x[1]]);
      return coords.length > 1 ? { type: 'Feature', properties: { icao: id }, geometry: { type: 'LineString', coordinates: coords } } : null;
    }).filter(Boolean) };
    if (!map.getSource('aircraft-trails-35')) map.addSource('aircraft-trails-35', { type: 'geojson', data });
    else map.getSource('aircraft-trails-35').setData(data);
    if (!map.getLayer('aircraft-trails-35')) {
      try { map.addLayer({ id: 'aircraft-trails-35', type: 'line', source: 'aircraft-trails-35', paint: { 'line-color': '#dbe7ff', 'line-opacity': .55, 'line-width': 2 } }, map.getLayer('aircraft-icons') ? 'aircraft-icons' : undefined); } catch {}
    }
  }

  function followTick35() {
    if (!followIcao) return;
    const flight = flightByIcao.get(followIcao);
    if (!flight) return;
    const lat = Number(flight.latitude), lon = Number(flight.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    try { map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8.2), duration: 650, essential: true }); } catch {}
    updateFollowChip35(flight);
    if (liveActivityIcao === followIcao && Date.now() - lastNativeActivityUpdate > 12000) {
      postLiveActivity35('update', flight);
      lastNativeActivityUpdate = Date.now();
    }
  }
  function setFollow35(flight, enabled) {
    followIcao = enabled ? icao35(flight) : '';
    root35.classList.toggle('mobile35-following', Boolean(followIcao));
    if (followIcao) {
      setSheetState35('peek');
      followTick35();
    } else document.getElementById('mobile35FollowChip')?.remove();
    decorateAircraftDetail35();
  }
  function updateFollowChip35(flight) {
    let chip = document.getElementById('mobile35FollowChip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'mobile35FollowChip';
      chip.className = 'mobile35-follow-chip';
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const current = flightByIcao.get(followIcao);
        if (current) selectFlight(current);
        setSheetState35('full');
      });
      document.body.appendChild(chip);
    }
    chip.innerHTML = `<span><b>${html35(label35(flight))}</b><small>${Number(flight.altitudeFt || 0).toLocaleString()} ft · ${Number(flight.speedKts || 0).toLocaleString()} kt</small></span><span>${Number(flight.verticalRateFpm || 0) > 100 ? '↑' : Number(flight.verticalRateFpm || 0) < -100 ? '↓' : '→'}</span>`;
  }

  function decorateAircraftDetail35() {
    const article = drawer35?.querySelector('.aircraft-detail');
    if (!article || article.querySelector('.mobile35-aircraft-actions')) return;
    const flight = flightByIcao.get(selectedIcao);
    if (!flight) return;
    const watched = watched35(flight);
    const following = followIcao === selectedIcao;
    const nativeLive = Boolean(window.webkit?.messageHandlers?.skytraceLiveActivity);
    const actions = document.createElement('div');
    actions.className = 'mobile35-aircraft-actions';
    actions.innerHTML = `
      <button type="button" data-mobile35-watch class="${watched ? 'active' : ''}">${watched ? '★ Watched' : '☆ Watch'}</button>
      <button type="button" data-mobile35-follow class="${following ? 'active' : ''}">${following ? 'Stop Follow' : '⌖ Follow'}</button>
      <button type="button" data-mobile35-live class="${liveActivityIcao === selectedIcao ? 'active' : ''}">${nativeLive ? '◉ Live Activity' : '◉ Dynamic Island'}</button>
      <button type="button" data-mobile35-share>Share</button>`;
    const advanced = article.querySelector('.detail-advanced');
    article.insertBefore(actions, advanced || null);
  }

  function activityPayload35(action, flight) {
    const op = operator35(flight);
    return {
      action,
      icao: icao35(flight),
      callsign: callsign35(flight) || label35(flight),
      registration: registration35(flight),
      aircraftType: type35(flight),
      operator: text35(op.name),
      origin: text35(flight?.origin || flight?.originIcao),
      destination: text35(flight?.destination || flight?.destinationIcao),
      altitudeFt: Number(flight?.altitudeFt) || 0,
      speedKts: Number(flight?.speedKts) || 0,
      verticalRateFpm: Number(flight?.verticalRateFpm) || 0,
      distanceNm: userPosition && Number.isFinite(Number(flight?.latitude)) && Number.isFinite(Number(flight?.longitude))
        ? haversineNm35(userPosition.lat, userPosition.lon, Number(flight.latitude), Number(flight.longitude)) : null,
      updatedAt: Date.now()
    };
  }
  function postLiveActivity35(action, flight) {
    const handler = window.webkit?.messageHandlers?.skytraceLiveActivity;
    if (!handler) {
      showTransient35('Dynamic Island needs the native SkyTrace iPhone companion');
      return false;
    }
    try { handler.postMessage(activityPayload35(action, flight)); return true; }
    catch { showTransient35('Could not contact the iOS Live Activity bridge'); return false; }
  }
  function toggleLiveActivity35(flight) {
    const id = icao35(flight);
    if (liveActivityIcao === id) {
      postLiveActivity35('end', flight);
      liveActivityIcao = '';
    } else {
      if (postLiveActivity35('start', flight)) {
        liveActivityIcao = id;
        followIcao = id;
        root35.classList.add('mobile35-following');
        followTick35();
      }
    }
    decorateAircraftDetail35();
  }

  async function shareFlight35(flight) {
    const title = `SkyTrace · ${label35(flight)}`;
    const text = `${label35(flight)} · ${registration35(flight) || icao35(flight).toUpperCase()} · ${Number(flight.altitudeFt || 0).toLocaleString()} ft · ${Number(flight.speedKts || 0).toLocaleString()} kt`;
    try {
      if (navigator.share) await navigator.share({ title, text, url: location.href });
      else { await navigator.clipboard.writeText(`${title}\n${text}\n${location.href}`); showTransient35('Aircraft details copied'); }
    } catch {}
  }

  function filtersMarkup35() {
    return `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>MAP FILTERS</small><h2>Traffic filters</h2></div><button type="button" data-filter-reset>Reset</button></div>
      <div class="mobile35-form-grid">
        <label><span>Minimum altitude</span><input data-filter-min type="number" inputmode="numeric" min="0" max="70000" step="1000" value="${html35(filterState.minAlt)}" placeholder="0 ft"></label>
        <label><span>Maximum altitude</span><input data-filter-max type="number" inputmode="numeric" min="0" max="70000" step="1000" value="${html35(filterState.maxAlt)}" placeholder="Any"></label>
        <label><span>Aircraft type</span><input data-filter-type value="${html35(filterState.type)}" placeholder="A320, B78…"></label>
      </div>
      <label class="mobile35-toggle"><input data-filter-airborne type="checkbox" ${filterState.airborneOnly ? 'checked' : ''}><span>Airborne aircraft only</span></label>
      <label class="mobile35-toggle"><input data-filter-watched type="checkbox" ${filterState.watchedOnly ? 'checked' : ''}><span>Watchlist only</span></label>
      <button type="button" data-filter-done class="primary">Apply filters</button></div>`;
  }

  function moreMarkup35() {
    const remember = window.skytraceRememberLogin?.enabled?.() !== false;
    const notify = localStorage.getItem(STORAGE.notify) === '1';
    const theme = localStorage.getItem(STORAGE.theme) || 'liberty';
    return `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>SKYTRACE iPHONE · 35.0</small><h2>More</h2></div></div>
      <div class="mobile35-menu">
        <button type="button" data-more-filters><span>Traffic filters</span><small>Altitude, type, airborne and watched</small></button>
        <button type="button" data-more-watchlist><span>Watchlists</span><small>Aircraft, registrations, airlines, types and airports</small></button>
        <button type="button" data-more-airport><span>Airport Desk</span><small>Search airport intelligence and operations</small></button>
        <button type="button" data-more-location><span>Location</span><small>Nearby aircraft and recentering</small></button>
      </div>
      <div class="mobile35-settings">
        <label class="mobile35-toggle"><input data-remember-login type="checkbox" ${remember ? 'checked' : ''}><span>Keep me signed in on this device</span></label>
        <label class="mobile35-toggle"><input data-notifications type="checkbox" ${notify ? 'checked' : ''}><span>Notify me when watched aircraft appear</span></label>
        <label><span>Map appearance</span><select data-map-theme><option value="liberty" ${theme === 'liberty' ? 'selected' : ''}>Dark / Liberty</option><option value="positron" ${theme === 'positron' ? 'selected' : ''}>Light / Positron</option></select></label>
      </div>
      <p class="mobile35-footnote">Dynamic Island and Lock Screen Live Activities are enabled when this web client is opened inside the native SkyTrace iOS companion.</p></div>`;
  }

  function watchlistMarkup35() {
    const format = key => html35((watchState[key] || []).join(', '));
    return `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>WATCHLISTS</small><h2>Watch rules</h2></div><button type="button" data-watch-clear>Clear</button></div>
      <p class="mobile35-copy">Tap Watch on an aircraft, or add comma-separated rules below.</p>
      <label><span>ICAO hex</span><input data-watch-key="icaos" value="${format('icaos')}" placeholder="40621B, A12345"></label>
      <label><span>Registrations / prefixes</span><input data-watch-key="registrations" value="${format('registrations')}" placeholder="G-EU, N123AB"></label>
      <label><span>Callsigns / prefixes</span><input data-watch-key="callsigns" value="${format('callsigns')}" placeholder="BAW, RYR123"></label>
      <label><span>Airlines</span><input data-watch-key="airlines" value="${format('airlines')}" placeholder="BAW, British Airways"></label>
      <label><span>Aircraft types</span><input data-watch-key="types" value="${format('types')}" placeholder="A388, B789"></label>
      <label><span>Airports</span><input data-watch-key="airports" value="${format('airports')}" placeholder="EGLL, EGCC"></label>
      <button type="button" data-watch-save class="primary">Save watchlist</button></div>`;
  }

  function airportMarkup35() {
    return `<div class="mobile35-page"><div class="mobile35-page-head"><div><small>AIRPORT DESK</small><h2>Airport intelligence</h2></div></div>
      <div class="mobile35-airport-search"><input id="mobile35AirportCode" maxlength="4" autocapitalize="characters" placeholder="ICAO e.g. EGLL"><button type="button" data-airport-search class="primary">Open</button></div>
      <div id="mobile35AirportResult" class="mobile35-airport-result"><div class="mobile35-empty">Search an ICAO airport code to load weather, traffic and operational information available to your account.</div></div></div>`;
  }

  function renderAirportPayload35(icao, payload) {
    const result = document.getElementById('mobile35AirportResult');
    if (!result) return;
    const weather = payload.weather || payload.metar || payload.currentWeather || {};
    const frequencies = payload.frequencies || payload.airport?.frequencies || [];
    const runways = payload.runways || payload.airport?.runways || [];
    const arrivals = payload.arrivals || payload.traffic?.arrivals || [];
    const departures = payload.departures || payload.traffic?.departures || [];
    const name = payload.name || payload.airport?.name || icao;
    result.innerHTML = `<div class="mobile35-airport-card"><small>${html35(icao)}</small><h3>${html35(name)}</h3>
      <div class="mobile35-detail-grid">
        <div><span>METAR</span><b>${html35(text35(weather.raw || weather.rawText || payload.metarRaw) || '—')}</b></div>
        <div><span>WIND</span><b>${html35(text35(weather.wind || weather.windText) || '—')}</b></div>
        <div><span>RUNWAYS</span><b>${Array.isArray(runways) ? runways.length : '—'}</b></div>
        <div><span>TRAFFIC</span><b>${(Array.isArray(arrivals) ? arrivals.length : 0) + (Array.isArray(departures) ? departures.length : 0)}</b></div>
      </div>
      ${Array.isArray(frequencies) && frequencies.length ? `<div class="mobile35-airport-list"><b>Frequencies</b>${frequencies.slice(0, 12).map(x => `<span>${html35(x.name || x.type || 'Frequency')} <strong>${html35(x.frequency || x.freq || '')}</strong></span>`).join('')}</div>` : ''}
      ${payload.error ? `<p>${html35(payload.error)}</p>` : ''}</div>`;
  }

  async function openAirport35(code) {
    const icao = text35(code).toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) { showTransient35('Enter a valid airport ICAO code'); return; }
    showDrawer(airportMarkup35(), 'Airport Desk');
    setSheetState35('full');
    const input = document.getElementById('mobile35AirportCode');
    if (input) input.value = icao;
    const result = document.getElementById('mobile35AirportResult');
    if (result) result.innerHTML = '<div class="mobile35-empty">Loading Airport Desk…</div>';
    const endpoints = [
      `/v1/airport-intelligence?icao=${encodeURIComponent(icao)}`,
      `/v1/v34/airport-intelligence?icao=${encodeURIComponent(icao)}`,
      `/v1/v34/airport?icao=${encodeURIComponent(icao)}`
    ];
    let lastError = null;
    for (const endpoint of endpoints) {
      try { const payload = await api(endpoint); renderAirportPayload35(icao, payload); return; }
      catch (error) { lastError = error; if (error.status !== 404) break; }
    }
    if (result) result.innerHTML = `<div class="mobile35-empty">${html35(lastError?.status === 403 ? 'Airport Intelligence is not unlocked on this account.' : lastError?.message || 'Airport information is unavailable right now.')}</div>`;
  }

  function replayMarkup35() {
    return `<div class="mobile35-page mobile35-replay"><div class="mobile35-page-head"><div><small>REPLAY+</small><h2>Timeline</h2></div><select data-replay-window><option value="1">1 hour</option><option value="6" selected>6 hours</option><option value="24">24 hours</option></select></div>
      <div class="mobile35-replay-controls"><button type="button" data-replay-play>▶</button><input data-replay-slider type="range" min="0" max="1000" value="1000"><select data-replay-speed><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></div>
      <div id="mobile35ReplayMeta" class="mobile35-copy">Choose a time window to load local account replay.</div>
      <button type="button" data-replay-load class="primary">Load Replay</button></div>`;
  }

  function pointTime35(point, index) {
    const raw = Number(point.recordedAt ?? point.timestamp ?? point.time ?? point.at);
    if (Number.isFinite(raw)) return raw < 10_000_000_000 ? raw * 1000 : raw;
    return index;
  }
  function renderReplayAt35(progress) {
    const points = replayState.points;
    if (!points.length || !map.isStyleLoaded()) return;
    const cut = Math.max(1, Math.floor((points.length - 1) * clamp35(progress, 0, 1)));
    const subset = points.slice(0, cut + 1);
    const tracks = new Map();
    for (const p of subset) {
      const id = text35(p.icao || p.icao24).toLowerCase();
      const lat = Number(p.latitude), lon = Number(p.longitude);
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!tracks.has(id)) tracks.set(id, []);
      tracks.get(id).push([lon, lat]);
    }
    const lines = { type: 'FeatureCollection', features: [] };
    const heads = { type: 'FeatureCollection', features: [] };
    for (const [id, coords] of tracks) {
      if (coords.length > 1) lines.features.push({ type: 'Feature', properties: { icao: id }, geometry: { type: 'LineString', coordinates: coords } });
      const head = coords[coords.length - 1];
      if (head) heads.features.push({ type: 'Feature', properties: { icao: id }, geometry: { type: 'Point', coordinates: head } });
    }
    if (!map.getSource('replay35-lines')) map.addSource('replay35-lines', { type: 'geojson', data: lines }); else map.getSource('replay35-lines').setData(lines);
    if (!map.getSource('replay35-heads')) map.addSource('replay35-heads', { type: 'geojson', data: heads }); else map.getSource('replay35-heads').setData(heads);
    if (!map.getLayer('replay35-lines')) map.addLayer({ id: 'replay35-lines', type: 'line', source: 'replay35-lines', paint: { 'line-color': '#6ea8ff', 'line-width': 2.2, 'line-opacity': .64 } });
    if (!map.getLayer('replay35-heads')) map.addLayer({ id: 'replay35-heads', type: 'circle', source: 'replay35-heads', paint: { 'circle-radius': 4.5, 'circle-color': '#eaf2ff', 'circle-stroke-color': '#397bff', 'circle-stroke-width': 1.5 } });
    const meta = document.getElementById('mobile35ReplayMeta');
    const sample = points[cut];
    const t = pointTime35(sample, cut);
    if (meta) meta.textContent = Number.isFinite(t) && t > 1_000_000 ? `${new Date(t).toLocaleString()} · ${heads.features.length} aircraft` : `${Math.round(progress * 100)}% · ${heads.features.length} aircraft`;
  }

  async function loadReplay35(hours = 6) {
    const meta = document.getElementById('mobile35ReplayMeta');
    if (meta) meta.textContent = 'Loading replay observations…';
    const to = Date.now(), from = to - Number(hours) * 3600_000;
    try {
      const payload = await api(`/v1/v34/replay?from=${from}&to=${to}&limit=12000`);
      replayState.points = (payload.points || []).slice().sort((a, b) => pointTime35(a, 0) - pointTime35(b, 0));
      replayState.progress = 1;
      const slider = drawer35?.querySelector('[data-replay-slider]');
      if (slider) slider.value = '1000';
      renderReplayAt35(1);
      if (meta) meta.textContent = `${Number(payload.count ?? replayState.points.length).toLocaleString()} observations loaded`;
    } catch (error) {
      if (meta) meta.textContent = error.status === 403 ? 'Replay+ requires Replay+ or SkyTrace Pro.' : error.message;
    }
  }
  function stopReplayPlayback35() {
    replayState.playing = false;
    cancelAnimationFrame(replayState.frame);
    const button = drawer35?.querySelector('[data-replay-play]');
    if (button) button.textContent = '▶';
  }
  function replayFrame35(now) {
    if (!replayState.playing) return;
    if (!replayState.lastFrame) replayState.lastFrame = now;
    const dt = now - replayState.lastFrame;
    replayState.lastFrame = now;
    replayState.progress += dt / 45000 * replayState.speed;
    if (replayState.progress >= 1) { replayState.progress = 1; stopReplayPlayback35(); }
    renderReplayAt35(replayState.progress);
    const slider = drawer35?.querySelector('[data-replay-slider]');
    if (slider) slider.value = String(Math.round(replayState.progress * 1000));
    if (replayState.playing) replayState.frame = requestAnimationFrame(replayFrame35);
  }
  function toggleReplayPlayback35() {
    if (!replayState.points.length) return;
    replayState.playing = !replayState.playing;
    const button = drawer35?.querySelector('[data-replay-play]');
    if (button) button.textContent = replayState.playing ? 'Ⅱ' : '▶';
    if (replayState.playing) {
      if (replayState.progress >= 1) replayState.progress = 0;
      replayState.lastFrame = 0;
      replayState.frame = requestAnimationFrame(replayFrame35);
    } else cancelAnimationFrame(replayState.frame);
  }

  async function requestWatchNotifications35(enable) {
    if (!enable) { localStorage.setItem(STORAGE.notify, '0'); return false; }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { showTransient35('Notifications are not supported here'); return false; }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    const ok = permission === 'granted';
    localStorage.setItem(STORAGE.notify, ok ? '1' : '0');
    if (!ok) showTransient35('Notification permission was not granted');
    return ok;
  }
  async function evaluateWatchNotifications35() {
    if (localStorage.getItem(STORAGE.notify) !== '1' || Notification.permission !== 'granted') return;
    const matches = new Set(flights.filter(watched35).map(icao35).filter(Boolean));
    const fresh = [...matches].filter(id => !lastWatchMatches.has(id));
    lastWatchMatches = matches;
    if (!fresh.length) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      for (const id of fresh.slice(0, 3)) {
        const flight = flightByIcao.get(id);
        if (!flight) continue;
        await registration.showNotification(`${label35(flight)} is in view`, {
          body: `${registration35(flight) || type35(flight) || id.toUpperCase()} · ${Number(flight.altitudeFt || 0).toLocaleString()} ft`,
          icon: '/app/apple-touch-icon.png', tag: `skytrace-watch-${id}`, renotify: false,
          data: { url: `/app/?aircraft=${encodeURIComponent(id)}` }
        });
      }
    } catch {}
  }

  function cacheFlights35() {
    try {
      const compact = flights.slice(0, 500);
      localStorage.setItem(STORAGE.lastFlights, JSON.stringify({ at: Date.now(), flights: compact }));
    } catch {}
  }
  function restoreOfflineFlights35() {
    const cached = loadJSON(STORAGE.lastFlights, null);
    if (!cached?.flights?.length || Date.now() - Number(cached.at || 0) > 6 * 3600_000) return false;
    flights = cached.flights;
    flightByIcao = new Map(flights.map(f => [icao35(f), f]));
    try { render(); drawFlights(); } catch {}
    const status = document.getElementById('status');
    if (status) { status.textContent = 'Offline cache'; status.title = `Last live traffic from ${new Date(cached.at).toLocaleTimeString()}`; }
    const meta = document.getElementById('trafficMeta');
    if (meta) meta.textContent = `Cached ${new Date(cached.at).toLocaleTimeString()}`;
    return true;
  }

  function setTheme35(theme) {
    const value = theme === 'positron' ? 'positron' : 'liberty';
    localStorage.setItem(STORAGE.theme, value);
    root35.classList.toggle('mobile35-light', value === 'positron');
    try { map.setStyle(`https://tiles.openfreemap.org/styles/${value}`); } catch {}
  }

  function activateTab35(tab) {
    currentTab = tab;
    for (const button of document.querySelectorAll('#mobile35Tabs [data-tab]')) button.classList.toggle('active', button.dataset.tab === tab);
    root35.dataset.mobile35Tab = tab;
    stopReplayPlayback35();
    if (tab === 'map') {
      if (drawer35) { drawer35.classList.add('hidden'); drawer35.innerHTML = ''; }
      setSheetState35(isIPhone35 ? 'peek' : 'full');
    } else if (tab === 'nearby') {
      setSheetState35('half');
      renderNearby35();
      if (!userPosition) locate35({ center: false, watch: true }).then(renderNearby35).catch(() => renderNearby35());
    } else if (tab === 'replay') {
      showDrawer(replayMarkup35(), 'Replay timeline');
      setSheetState35('half');
    } else if (tab === 'more') {
      showDrawer(moreMarkup35(), 'More');
      setSheetState35('half');
    }
    haptic35();
  }

  function openFilters35() { showDrawer(filtersMarkup35(), 'Traffic filters'); setSheetState35('full'); }

  function eventDelegation35() {
    document.getElementById('mobile35Tabs')?.addEventListener('click', event => {
      const button = event.target.closest('[data-tab]');
      if (button) activateTab35(button.dataset.tab);
    });
    document.getElementById('mobile35Locate')?.addEventListener('click', () => locate35({ center: true, watch: true }).catch(error => showTransient35(error.message)));
    document.getElementById('mobile35Filter')?.addEventListener('click', openFilters35);
    document.getElementById('mobile35Search')?.addEventListener('input', event => {
      filterState.query = event.target.value;
      saveJSON(STORAGE.filters, filterState);
      applyListFilters35();
    });
    document.getElementById('mobile35Search')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const first = filteredFlights35()[0];
      if (first) { selectFlight(first); setSheetState35('full'); return; }
      const query = text35(event.currentTarget.value).toUpperCase();
      if (/^[A-Z0-9]{3,4}$/.test(query)) openAirport35(query);
    });

    drawer35?.addEventListener('click', async event => {
      const flight = flightByIcao.get(selectedIcao);
      if (event.target.closest('[data-mobile35-watch]') && flight) { toggleWatch35(flight); return; }
      if (event.target.closest('[data-mobile35-follow]') && flight) { setFollow35(flight, followIcao !== selectedIcao); return; }
      if (event.target.closest('[data-mobile35-live]') && flight) { toggleLiveActivity35(flight); return; }
      if (event.target.closest('[data-mobile35-share]') && flight) { await shareFlight35(flight); return; }
      const nearby = event.target.closest('[data-nearby-icao]');
      if (nearby) { const f = flightByIcao.get(text35(nearby.dataset.nearbyIcao).toLowerCase()); if (f) { selectFlight(f); setSheetState35('full'); } return; }
      if (event.target.closest('[data-nearby-locate]')) { locate35({ center: true, watch: true }).then(renderNearby35).catch(error => showTransient35(error.message)); return; }
      if (event.target.closest('[data-more-filters]')) { openFilters35(); return; }
      if (event.target.closest('[data-more-watchlist]')) { showDrawer(watchlistMarkup35(), 'Watchlists'); setSheetState35('full'); return; }
      if (event.target.closest('[data-more-airport]')) { showDrawer(airportMarkup35(), 'Airport Desk'); setSheetState35('full'); return; }
      if (event.target.closest('[data-more-location]')) { activateTab35('nearby'); return; }
      if (event.target.closest('[data-filter-reset]')) {
        Object.assign(filterState, { minAlt: '', maxAlt: '', airborneOnly: false, watchedOnly: false, type: '' });
        saveJSON(STORAGE.filters, filterState); showDrawer(filtersMarkup35(), 'Traffic filters'); applyListFilters35(); return;
      }
      if (event.target.closest('[data-filter-done]')) {
        filterState.minAlt = drawer35.querySelector('[data-filter-min]')?.value || '';
        filterState.maxAlt = drawer35.querySelector('[data-filter-max]')?.value || '';
        filterState.type = drawer35.querySelector('[data-filter-type]')?.value || '';
        filterState.airborneOnly = Boolean(drawer35.querySelector('[data-filter-airborne]')?.checked);
        filterState.watchedOnly = Boolean(drawer35.querySelector('[data-filter-watched]')?.checked);
        saveJSON(STORAGE.filters, filterState); applyListFilters35(); activateTab35('map'); return;
      }
      if (event.target.closest('[data-watch-save]')) {
        for (const input of drawer35.querySelectorAll('[data-watch-key]')) watchState[input.dataset.watchKey] = input.value.split(',').map(x => x.trim()).filter(Boolean);
        persistWatch(); showTransient35('Watchlist saved'); return;
      }
      if (event.target.closest('[data-watch-clear]')) {
        for (const key of Object.keys(watchState)) watchState[key] = [];
        persistWatch(); showDrawer(watchlistMarkup35(), 'Watchlists'); return;
      }
      if (event.target.closest('[data-airport-search]')) { openAirport35(document.getElementById('mobile35AirportCode')?.value); return; }
      if (event.target.closest('[data-replay-load]')) { await loadReplay35(drawer35.querySelector('[data-replay-window]')?.value || 6); return; }
      if (event.target.closest('[data-replay-play]')) { toggleReplayPlayback35(); return; }
    });

    drawer35?.addEventListener('input', event => {
      if (event.target.matches('[data-replay-slider]')) {
        stopReplayPlayback35(); replayState.progress = Number(event.target.value) / 1000; renderReplayAt35(replayState.progress);
      }
    });
    drawer35?.addEventListener('change', async event => {
      if (event.target.matches('[data-remember-login]')) window.skytraceRememberLogin?.setEnabled?.(event.target.checked);
      if (event.target.matches('[data-notifications]')) event.target.checked = await requestWatchNotifications35(event.target.checked);
      if (event.target.matches('[data-map-theme]')) setTheme35(event.target.value);
      if (event.target.matches('[data-replay-speed]')) replayState.speed = Number(event.target.value) || 1;
      if (event.target.matches('[data-replay-window]')) await loadReplay35(event.target.value);
    });

    list35?.addEventListener('contextmenu', event => {
      const row = event.target.closest('.flight[data-icao]');
      const flight = row && flightByIcao.get(text35(row.dataset.icao).toLowerCase());
      if (flight && isIOS35) { event.preventDefault(); toggleWatch35(flight); }
    });
  }

  const coreRender35 = render;
  render = function skyTraceRender35() {
    coreRender35();
    applyListFilters35();
    if (currentTab === 'nearby') renderNearby35();
  };

  const coreDrawFlights35 = drawFlights;
  drawFlights = function skyTraceDrawFlights35() {
    coreDrawFlights35();
    applyMapFilters35();
    updateWatchLayer35();
    updateTrails35();
    updateLocationLayer35();
    followTick35();
  };

  const coreRefresh35 = refresh;
  refresh = async function skyTraceRefresh35() {
    if (!navigator.onLine) { restoreOfflineFlights35(); return; }
    await coreRefresh35();
    if (flights.length) cacheFlights35();
    evaluateWatchNotifications35();
    if (currentTab === 'nearby') renderNearby35();
  };

  const drawerObserver35 = drawer35 ? new MutationObserver(() => decorateAircraftDetail35()) : null;
  drawerObserver35?.observe(drawer35, { childList: true, subtree: true });

  buildChrome35();
  installThreePositionSheet35();
  eventDelegation35();
  setSheetState35(sheetState, false);

  try { map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'nautical' }), 'bottom-left'); } catch {}
  map.on('moveend', saveMapPosition35);
  map.on('styledata', () => { if (map.isStyleLoaded()) { updateWatchLayer35(); updateLocationLayer35(); updateTrails35(); } });
  if (map.loaded()) restoreMapPosition35(); else map.once('load', restoreMapPosition35);

  const initialTheme = localStorage.getItem(STORAGE.theme) || 'liberty';
  root35.classList.toggle('mobile35-light', initialTheme === 'positron');
  if (initialTheme === 'positron') setTimeout(() => setTheme35('positron'), 50);

  window.addEventListener('offline', restoreOfflineFlights35);
  window.addEventListener('online', () => refresh());
  window.addEventListener('orientationchange', () => setTimeout(() => setSheetState35(isIPhone35 ? 'half' : 'full', false), 180));

  try {
    const params = new URLSearchParams(location.search);
    const requestedTab = text35(params.get('tab')).toLowerCase();
    if (['map', 'nearby', 'replay', 'more'].includes(requestedTab)) setTimeout(() => activateTab35(requestedTab), 120);
    const airport = text35(params.get('airport')).toUpperCase();
    if (/^[A-Z0-9]{3,4}$/.test(airport)) setTimeout(() => openAirport35(airport), 180);
    const aircraft = text35(params.get('aircraft')).toLowerCase();
    if (aircraft) {
      const timer = setInterval(() => {
        const flight = flightByIcao.get(aircraft);
        if (!flight) return;
        clearInterval(timer); selectFlight(flight); setSheetState35('full');
      }, 500);
      setTimeout(() => clearInterval(timer), 15000);
    }
  } catch {}

  if (!navigator.onLine) restoreOfflineFlights35();
})();
