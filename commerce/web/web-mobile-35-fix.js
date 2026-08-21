(() => {
  'use strict';

  if (typeof map === 'undefined' || typeof flights === 'undefined' || typeof drawFlights === 'undefined') return;

  const FILTER_KEY = 'skytrace.mobile35.filters';
  const AIRCRAFT_LAYERS = ['aircraft-icons', 'aircraft-labels', 'aircraft-hit'];
  let repairQueued = false;

  function readFilters() {
    try {
      return Object.assign({ query: '', minAlt: '', maxAlt: '', airborneOnly: false, watchedOnly: false, type: '' }, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'));
    } catch {
      return { query: '', minAlt: '', maxAlt: '', airborneOnly: false, watchedOnly: false, type: '' };
    }
  }

  function text(value) { return String(value ?? '').trim(); }
  function icao(flight) { return text(flight?.icao24).toLowerCase(); }
  function activeFilter(filters) {
    return Boolean(text(filters.query) || text(filters.minAlt) || text(filters.maxAlt) || filters.airborneOnly || filters.watchedOnly || text(filters.type));
  }

  function watched(flight) {
    try {
      const raw = JSON.parse(localStorage.getItem('skytrace.mobile35.watch') || '{}');
      const state = Object.assign({ icaos: [], registrations: [], callsigns: [], airlines: [], types: [], airports: [] }, raw || {});
      const upper = value => text(value).toUpperCase();
      const id = upper(flight?.icao24);
      const reg = upper(flight?.registration);
      const call = upper(flight?.callsign);
      const kind = upper(flight?.aircraftType);
      let op = { name: '', code: '' };
      try { op = operatorFor(flight) || op; } catch {}
      const opCode = upper(op.code), opName = upper(op.name);
      const origin = upper(flight?.origin || flight?.originIcao);
      const destination = upper(flight?.destination || flight?.destinationIcao);
      const list = key => Array.isArray(state[key]) ? state[key].map(upper) : [];
      return list('icaos').includes(id)
        || list('registrations').some(x => reg === x || reg.startsWith(x))
        || list('callsigns').some(x => call === x || call.startsWith(x))
        || list('airlines').some(x => opCode === x || opName.includes(x) || call.startsWith(x))
        || list('types').some(x => kind === x || kind.startsWith(x))
        || list('airports').some(x => origin === x || destination === x);
    } catch { return false; }
  }

  function matches(flight, filters) {
    const query = text(filters.query).toUpperCase();
    if (query) {
      let op = { name: '', code: '' };
      try { op = operatorFor(flight) || op; } catch {}
      const haystack = [flight?.callsign, flight?.registration, flight?.icao24, flight?.aircraftType, op.name, op.code, flight?.origin, flight?.destination]
        .map(value => text(value).toUpperCase()).join(' ');
      if (!haystack.includes(query)) return false;
    }
    const altitude = Number(flight?.altitudeFt);
    if (text(filters.minAlt) && Number.isFinite(altitude) && altitude < Number(filters.minAlt)) return false;
    if (text(filters.maxAlt) && Number.isFinite(altitude) && altitude > Number(filters.maxAlt)) return false;
    if (filters.airborneOnly && flight?.onGround) return false;
    if (filters.watchedOnly && !watched(flight)) return false;
    if (text(filters.type) && !text(flight?.aircraftType).toUpperCase().includes(text(filters.type).toUpperCase())) return false;
    return true;
  }

  function ensureFallbackLayer() {
    if (!map.isStyleLoaded() || !map.getSource('aircraft-live') || map.getLayer('aircraft-visible-fallback-35')) return;
    try {
      map.addLayer({
        id: 'aircraft-visible-fallback-35',
        type: 'circle',
        source: 'aircraft-live',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 7, 3.0, 11, 4.0],
          'circle-color': '#dce9ff',
          'circle-stroke-color': '#315ea8',
          'circle-stroke-width': 1.1,
          'circle-opacity': .9
        }
      }, map.getLayer('aircraft-icons') ? 'aircraft-icons' : undefined);
    } catch {}
  }

  function applySafeAircraftFilter() {
    if (!map.isStyleLoaded()) return;
    const filters = readFilters();
    let filter = null;
    if (activeFilter(filters)) {
      const ids = flights.filter(flight => matches(flight, filters)).map(icao).filter(Boolean);
      filter = ids.length ? ['match', ['get', 'icao'], ids, true, false] : ['==', ['get', 'icao'], '__none__'];
    }
    for (const layer of [...AIRCRAFT_LAYERS, 'aircraft-visible-fallback-35']) {
      if (!map.getLayer(layer)) continue;
      try { map.setFilter(layer, filter); } catch {}
    }
  }

  function repairAircraft() {
    repairQueued = false;
    if (!map.isStyleLoaded()) return;
    ensureFallbackLayer();
    applySafeAircraftFilter();
  }

  function queueRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(repairAircraft);
  }

  const previousDrawFlights = drawFlights;
  drawFlights = function skyTraceDrawFlightsVisibilityFix() {
    const result = previousDrawFlights();
    queueRepair();
    return result;
  };

  map.on('load', queueRepair);
  map.on('idle', queueRepair);
  map.on('styledata', queueRepair);
  window.addEventListener('pageshow', queueRepair);
  window.addEventListener('online', queueRepair);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueRepair(); });

  // Repair any filter left at "__none__" during the first empty pre-refresh render.
  setTimeout(queueRepair, 80);
  setTimeout(queueRepair, 600);
  setTimeout(queueRepair, 1800);
})();
