const $ = id => document.getElementById(id);
const root = document.documentElement;
const panel = document.querySelector('.panel');

let token = sessionStorage.getItem('skytrace.webToken') || '';
let flights = [];
let flightByIcao = new Map();
let ops = null;
let refreshTimer = null;
let refreshDelayTimer = null;
let refreshPromise = null;
let refreshQueued = false;
let panelResizeObserver = null;
let selectedIcao = '';
let selectedProfileSerial = 0;
let aircraftMapEventsBound = false;

const coarsePointer = window.matchMedia('(pointer:coarse)').matches;
const iOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iPadDevice = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iPhoneDevice = iOSDevice && !iPadDevice;

root.classList.toggle('ios-device', iOSDevice);
root.classList.toggle('ios-ipad', iPadDevice);
root.classList.toggle('ios-iphone', iPhoneDevice);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [-0.12, 51.5],
  zoom: 5
});
window.skytraceWebMap = map;
window.skytraceResizeMap = () => requestAnimationFrame(() => {
  try { map.resize(); } catch {}
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

function setStatus(value) {
  const text = String(value || '');
  const node = $('status');
  if (!node) return;
  node.textContent = text;
  node.title = text;
}

function setTrafficMeta(value) {
  const text = String(value || '');
  const node = $('trafficMeta');
  if (!node) return;
  node.textContent = text;
  node.title = text;
}

function updatePanelMetrics() {
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  root.style.setProperty('--skytrace-panel-height', `${Math.max(0, Math.ceil(rect.height))}px`);
}

if ('ResizeObserver' in window && panel) {
  panelResizeObserver = new ResizeObserver(updatePanelMetrics);
  panelResizeObserver.observe(panel);
}

async function api(path, options = {}) {
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || controller?.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Live data request timed out');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function safeHex(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function hashCode(value) {
  let hash = 2166136261;
  const text = String(value || 'GEN');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const FALLBACK_LIVERIES = [
  ['#35D0FF', '#DCEBFA'], ['#7C6CFF', '#E4DEFF'], ['#FF6B8A', '#FFE0E8'],
  ['#34D399', '#D1FAE5'], ['#F59E0B', '#FEF3C7'], ['#0EA5E9', '#BAE6FD'],
  ['#F97316', '#FFEDD5'], ['#8B5CF6', '#EDE9FE'], ['#14B8A6', '#CCFBF1'],
  ['#E11D48', '#FFE4E6'], ['#2563EB', '#DBEAFE'], ['#65A30D', '#ECFCCB']
];

function flightIdentity(flight) {
  const callsign = String(flight?.callsign || '').trim();
  if (callsign && !/^NO CALLSIGN$/i.test(callsign)) return callsign;
  return String(flight?.registration || flight?.icao24 || 'GEN').trim();
}

function operatorFor(flight) {
  const identity = flightIdentity(flight);
  let operator;
  try { operator = window.skytraceAirlineFor?.(identity); } catch {}
  if (!operator) {
    const palette = FALLBACK_LIVERIES[hashCode(identity.toUpperCase()) % FALLBACK_LIVERIES.length];
    operator = { name: 'Unknown operator', code: 'GA', primary: palette[0], secondary: palette[1], known: false };
  }
  return {
    ...operator,
    name: String(operator.name || 'Unknown operator'),
    code: String(operator.code || operator.icao || 'GA').slice(0, 4).toUpperCase(),
    primary: safeHex(operator.primary, '#35D0FF'),
    secondary: safeHex(operator.secondary, '#DCEBFA')
  };
}

function labelFor(flight) {
  const callsign = String(flight?.callsign || '').trim();
  if (callsign && !/^NO CALLSIGN$/i.test(callsign)) return callsign;
  return String(flight?.registration || flight?.icao24 || 'Aircraft').trim();
}

function aircraftKind(typeRaw) {
  const type = String(typeRaw || '').trim().toUpperCase();
  if (/^(H1|H2|H3|H4|EC1|EC2|EC3|EC4|EC5|AS3|AS5|AW1|S76|R22|R44|B06|B47)/.test(type)) return 'helicopter';
  if (/^(A38|A35|A34|A33|B74|B77|B78|B76|MD11|DC10|IL9)/.test(type)) return 'widebody';
  if (/^(AT4|AT7|DH8|DHC|SF3|F50|C208|PC12|BE20|BE30|JS3)/.test(type)) return 'turboprop';
  if (/^(C1|C2|C3|PA|DA|SR|P28|BE3|BE4|M20|AA5|DR4|RV)/.test(type)) return 'light';
  return 'jet';
}

function miniPlaneSvg(operator) {
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2l3 9 13 8v4l-13-3-1 9 6 5v3l-8-3-8 3v-3l6-5-1-9-13 3v-4l13-8z" fill="${operator.primary}" stroke="#08101d" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 31l5-2 5 2 3 3v3l-8-3-8 3v-3z" fill="${operator.secondary}"/></svg>`;
}

function polygon(ctx, points, fill, stroke = '#07101D', lineWidth = 2.4) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function createAircraftImage(operator, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 112;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return new ImageData(112, 112);
  ctx.translate(56, 56);
  ctx.shadowColor = 'rgba(0,0,0,.48)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  if (kind === 'helicopter') {
    ctx.strokeStyle = '#07101D';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-36, 0); ctx.lineTo(36, 0);
    ctx.moveTo(0, -36); ctx.lineTo(0, 36);
    ctx.stroke();
    ctx.fillStyle = operator.primary;
    ctx.strokeStyle = '#07101D';
    ctx.lineWidth = 2.7;
    ctx.beginPath();
    ctx.ellipse(0, -4, 12, 23, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    polygon(ctx, [[-5,13],[5,13],[4,35],[-4,35]], operator.secondary);
    polygon(ctx, [[-12,31],[12,31],[10,37],[-10,37]], operator.secondary);
  } else {
    const shapes = {
      jet:[[0,-47],[6,-37],[8,-18],[12,-9],[38,7],[37,15],[11,10],[8,27],[18,35],[17,41],[0,35],[-17,41],[-18,35],[-8,27],[-11,10],[-37,15],[-38,7],[-12,-9],[-8,-18],[-6,-37]],
      widebody:[[0,-48],[7,-38],[9,-17],[13,-8],[44,8],[43,16],[12,10],[9,28],[21,36],[19,42],[0,35],[-19,42],[-21,36],[-9,28],[-12,10],[-43,16],[-44,8],[-13,-8],[-9,-17],[-7,-38]],
      turboprop:[[0,-43],[6,-34],[7,-11],[40,-2],[40,7],[8,7],[7,28],[18,36],[16,41],[0,35],[-16,41],[-18,36],[-7,28],[-8,7],[-40,7],[-40,-2],[-7,-11],[-6,-34]],
      light:[[0,-41],[5,-32],[6,-11],[32,1],[32,9],[7,8],[6,26],[15,34],[13,39],[0,34],[-13,39],[-15,34],[-6,26],[-7,8],[-32,9],[-32,1],[-6,-11],[-5,-32]]
    };
    polygon(ctx, shapes[kind] || shapes.jet, operator.primary);
    ctx.shadowColor = 'transparent';
    polygon(ctx, [[-6,23],[6,23],[17,35],[15,41],[0,35],[-15,41],[-17,35]], operator.secondary, '#07101D', 1.8);
    polygon(ctx, [[-38,7],[-27,8],[-27,12],[-37,15]], operator.secondary, '#07101D', 1.5);
    polygon(ctx, [[38,7],[27,8],[27,12],[37,15]], operator.secondary, '#07101D', 1.5);
    ctx.fillStyle = 'rgba(245,250,255,.94)';
    ctx.beginPath(); ctx.ellipse(0, -30, 2.5, 6.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(-1.25, -17, 2.5, 35);
  }

  if (kind !== 'helicopter' && operator.code && operator.code !== 'GA') {
    ctx.shadowColor = 'transparent';
    ctx.save();
    ctx.font = '700 8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#07101D';
    ctx.fillText(operator.code.slice(0, 3), 0, 31);
    ctx.restore();
  }
  return ctx.getImageData(0, 0, 112, 112);
}

function aircraftImageKey(operator, kind) {
  const code = operator.code.replace(/[^A-Z0-9]/g, '').toLowerCase() || 'ga';
  return `skytrace-aircraft-${kind}-${code}-${operator.primary.slice(1).toLowerCase()}-${operator.secondary.slice(1).toLowerCase()}`;
}

function ensureAircraftImage(flight) {
  const operator = operatorFor(flight);
  const kind = aircraftKind(flight.aircraftType);
  const key = aircraftImageKey(operator, kind);
  if (!map.hasImage(key)) map.addImage(key, createAircraftImage(operator, kind), { pixelRatio: 2 });
  return { key, operator, kind };
}

function removeLegacyAircraftLayer() {
  if (!map.isStyleLoaded()) return;
  if (map.getLayer('aircraft')) {
    try { map.removeLayer('aircraft'); } catch {}
  }
  if (map.getSource('aircraft')) {
    try { map.removeSource('aircraft'); } catch {}
  }
}

function nearestFlight(point, radius = 24) {
  let best = null;
  let bestDistance = radius * radius;
  for (const flight of flights) {
    const lat = Number(flight.latitude);
    const lon = Number(flight.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const projected = map.project([lon, lat]);
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = flight;
    }
  }
  return best;
}

function bindAircraftMapEvents() {
  if (aircraftMapEventsBound) return;
  aircraftMapEventsBound = true;
  map.on('click', event => {
    const flight = nearestFlight(event.point, coarsePointer ? 40 : 24);
    if (flight) selectFlight(flight);
  });
  if (!coarsePointer) {
    map.on('mousemove', event => {
      map.getCanvas().style.cursor = nearestFlight(event.point, 24) ? 'pointer' : '';
    });
  }
}

function ensureAircraftLayers() {
  if (!map.isStyleLoaded()) return false;
  removeLegacyAircraftLayer();
  if (!map.getSource('aircraft-live')) map.addSource('aircraft-live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  if (!map.getLayer('aircraft-selected')) map.addLayer({
    id: 'aircraft-selected', type: 'circle', source: 'aircraft-live', filter: ['==', ['get', 'icao'], '__none__'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 16, 6, 20, 10, 25],
      'circle-color': 'rgba(255,255,255,.12)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2
    }
  });

  if (!map.getLayer('aircraft-icons')) map.addLayer({
    id: 'aircraft-icons', type: 'symbol', source: 'aircraft-live',
    layout: {
      'icon-image': ['get', 'markerKey'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 3, .56, 5, .66, 8, .82, 11, 1.0],
      'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-padding': 0
    },
    paint: { 'icon-opacity': ['case', ['==', ['get', 'onGround'], true], .74, 1] }
  });

  if (!map.getLayer('aircraft-labels')) map.addLayer({
    id: 'aircraft-labels', type: 'symbol', source: 'aircraft-live', minzoom: 7.2,
    layout: { 'text-field': ['get', 'label'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7.2, 9, 11, 11], 'text-offset': [0, 2.2], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#f8fafc', 'text-halo-color': 'rgba(4,8,15,.92)', 'text-halo-width': 1.5 }
  });

  if (!map.getLayer('aircraft-hit')) map.addLayer({
    id: 'aircraft-hit', type: 'circle', source: 'aircraft-live',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 16, 6, 21, 10, 26], 'circle-color': '#000000', 'circle-opacity': 0.01 }
  });

  bindAircraftMapEvents();
  return true;
}

function drawFlights() {
  if (!ensureAircraftLayers()) return;
  const features = [];
  for (const flight of flights) {
    const lat = Number(flight.latitude);
    const lon = Number(flight.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const { key, operator, kind } = ensureAircraftImage(flight);
    features.push({
      type: 'Feature', id: String(flight.icao24 || ''), geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        icao: String(flight.icao24 || '').toLowerCase(), label: labelFor(flight), markerKey: key,
        operator: operator.name, aircraftKind: kind,
        heading: Number.isFinite(Number(flight.heading)) ? Number(flight.heading) : 0, onGround: Boolean(flight.onGround)
      }
    });
  }
  map.getSource('aircraft-live')?.setData({ type: 'FeatureCollection', features });
  updateSelectedAircraft();
}

function updateSelectedAircraft() {
  if (!map.getLayer('aircraft-selected')) return;
  map.setFilter('aircraft-selected', ['==', ['get', 'icao'], selectedIcao || '__none__']);
}

function fmt(value, suffix = '') {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value)).toLocaleString()}${suffix}` : '—';
}

function vertical(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Math.round(Number(value));
  if (Math.abs(n) < 50) return 'Level';
  return `${n > 0 ? '↑' : '↓'} ${Math.abs(n).toLocaleString()} fpm`;
}

function emergencyFor(flight) {
  const squawk = String(flight?.squawk || '');
  if (flight?.emergency) return String(flight.emergency);
  if (squawk === '7700') return 'General emergency';
  if (squawk === '7600') return 'Radio failure';
  if (squawk === '7500') return 'Unlawful interference';
  return '';
}

function detailMarkup(flight, advanced = {}) {
  const operator = operatorFor(flight);
  const emergency = emergencyFor(flight);
  const profile = advanced.profile;
  const summary = profile?.summary;
  const note = profile?.note?.note || '';
  const extra = profile
    ? `<div class="detail-advanced"><div class="detail-section-title">30-DAY AIRCRAFT HISTORY</div><div class="detail-grid compact"><div><span>SAMPLES</span><b>${fmt(summary?.samples)}</b></div><div><span>MAX ALT</span><b>${fmt(summary?.maxAltitudeFt, ' ft')}</b></div><div><span>MAX SPEED</span><b>${fmt(summary?.maxSpeedKts, ' kt')}</b></div><div><span>CALLSIGNS</span><b>${fmt(summary?.callsigns)}</b></div></div><label class="note-field"><span>PRIVATE NOTE</span><textarea id="aircraftNote" maxlength="2000" placeholder="Add a private note for this aircraft">${esc(note)}</textarea></label><button type="button" class="note-save" data-save-note>Save note</button></div>`
    : advanced.loading ? '<div class="detail-message">Loading Advanced Aircraft history…</div>'
      : advanced.forbidden ? '<div class="detail-message muted-detail">Live aircraft details are available here. Advanced 30-day history requires Advanced Aircraft or SkyTrace Pro.</div>'
        : advanced.error ? `<div class="detail-message muted-detail">${esc(advanced.error)}</div>` : '';

  return `<article class="aircraft-detail"><div class="detail-head"><div class="detail-identity"><span class="detail-livery">${miniPlaneSvg(operator)}</span><div><small>${esc(operator.name)}${operator.known ? '' : ' · inferred livery'}</small><h3>${esc(labelFor(flight))}</h3><p>${esc(flight.registration || flight.icao24 || 'Unknown registration')} · ${esc(flight.aircraftType || 'Unknown type')}</p></div></div><button type="button" class="detail-close" data-close-aircraft aria-label="Close aircraft detail">×</button></div>${emergency ? `<div class="detail-alert">${esc(emergency)}${flight.squawk ? ` · SQ ${esc(flight.squawk)}` : ''}</div>` : ''}<div class="detail-grid"><div><span>ALTITUDE</span><b>${fmt(flight.altitudeFt, ' ft')}</b></div><div><span>GROUND SPEED</span><b>${fmt(flight.speedKts, ' kt')}</b></div><div><span>HEADING</span><b>${fmt(flight.heading, '°')}</b></div><div><span>VERTICAL RATE</span><b>${vertical(flight.verticalRateFpm)}</b></div></div><div class="detail-meta"><span>ICAO <b>${esc(String(flight.icao24 || '').toUpperCase() || '—')}</b></span><span>SQUAWK <b>${esc(flight.squawk || '—')}</b></span><span>${flight.onGround ? 'ON GROUND' : 'AIRBORNE'}</span></div>${extra}</article>`;
}

function showDrawer(content, label) {
  const drawer = $('drawer');
  if (!drawer) return null;
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-label', label || 'SkyTrace detail');
  if (typeof content === 'string') drawer.innerHTML = content;
  requestAnimationFrame(updatePanelMetrics);
  return drawer;
}

function closeAircraftDetail() {
  selectedProfileSerial += 1;
  selectedIcao = '';
  updateSelectedAircraft();
  render();
  const drawer = $('drawer');
  if (drawer) { drawer.classList.add('hidden'); drawer.innerHTML = ''; }
  root.classList.remove('detail-open');
  requestAnimationFrame(updatePanelMetrics);
}

async function selectFlight(flight) {
  if (!flight?.icao24) return;
  selectedIcao = String(flight.icao24).toLowerCase();
  const serial = ++selectedProfileSerial;
  updateSelectedAircraft();
  render();
  const drawer = showDrawer(detailMarkup(flight, { loading: true }), `Aircraft ${labelFor(flight)}`);
  if (drawer) drawer.scrollTop = 0;
  root.classList.add('detail-open');
  window.skytraceMobileSheet?.expand?.();

  try {
    const profile = await api(`/v1/v34/aircraft-profile?icao=${encodeURIComponent(selectedIcao)}`);
    if (serial !== selectedProfileSerial || selectedIcao !== String(flight.icao24).toLowerCase()) return;
    const live = flightByIcao.get(selectedIcao) || profile.current || flight;
    if ($('drawer')) $('drawer').innerHTML = detailMarkup(live, { profile });
  } catch (error) {
    if (serial !== selectedProfileSerial || selectedIcao !== String(flight.icao24).toLowerCase()) return;
    const live = flightByIcao.get(selectedIcao) || flight;
    if ($('drawer')) $('drawer').innerHTML = detailMarkup(live, { forbidden: error.status === 403, error: error.status === 403 ? '' : error.message });
  }
}

async function saveSelectedNote(button) {
  const note = $('aircraftNote');
  if (!note || !selectedIcao) return;
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await api('/v1/v34/aircraft-note', { method: 'POST', body: JSON.stringify({ icao: selectedIcao, note: note.value }) });
    button.textContent = 'Saved';
    setTimeout(() => { if (document.contains(button)) button.textContent = oldText; }, 1200);
  } catch (error) {
    button.textContent = 'Could not save';
    button.title = error.message;
  } finally { button.disabled = false; }
}

function render() {
  const list = $('list');
  if (!list) return;
  const rows = flights.slice().sort((a, b) => (b.altitudeFt || 0) - (a.altitudeFt || 0)).slice(0, 100);
  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">No observed aircraft in this map area right now.<br>Pan or zoom the map, then press Refresh.</div>';
    return;
  }
  list.innerHTML = rows.map(flight => {
    const operator = operatorFor(flight);
    const icao = String(flight.icao24 || '').toLowerCase();
    return `<button type="button" class="flight${icao === selectedIcao ? ' selected' : ''}" data-icao="${esc(icao)}" aria-label="Open ${esc(labelFor(flight))}, ${esc(operator.name)}"><span class="flight-livery">${miniPlaneSvg(operator)}</span><span class="flight-copy"><strong>${esc(labelFor(flight))}</strong><small>${esc(operator.name)} · ${esc(flight.registration || flight.icao24 || 'Unknown')} · ${esc(flight.aircraftType || 'Unknown type')}${flight.squawk ? ` · SQ ${esc(flight.squawk)}` : ''}</small></span><span class="flight-metrics">${fmt(flight.altitudeFt, ' ft')}<small>${fmt(flight.speedKts, ' kt')}</small></span></button>`;
  }).join('');
}

function setSigned(inward) {
  $('login')?.classList.toggle('hidden', inward);
  $('app')?.classList.toggle('hidden', !inward);
  root.classList.toggle('signed-in', inward);
  setStatus(inward ? 'Connected' : 'Offline');
  if (!inward) {
    clearInterval(refreshTimer);
    clearTimeout(refreshDelayTimer);
    refreshTimer = null;
    refreshDelayTimer = null;
    refreshQueued = false;
    flights = [];
    flightByIcao = new Map();
    if ($('visible')) $('visible').textContent = '0';
    if ($('alerts')) $('alerts').textContent = '0';
    closeAircraftDetail();
    render();
    drawFlights();
  } else startAutoRefresh();
  requestAnimationFrame(updatePanelMetrics);
}

async function login() {
  const button = $('loginBtn');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const payload = await api('/v1/auth/login', {
      method: 'POST', body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value })
    });
    token = payload.token;
    sessionStorage.setItem('skytrace.webToken', token);
    $('password').value = '';
    setSigned(true);
    document.activeElement?.blur?.();
    await refresh();
  } catch (error) {
    $('loginMsg').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
    window.skytraceMobileSheet?.refresh?.();
    window.skytraceResizeMap?.();
  }
}

function geo() {
  const center = map.getCenter();
  return { lat: center.lat, lon: center.lng, radius: Math.max(30, Math.min(245, Math.round(260 / Math.pow(1.45, map.getZoom() - 3)))) };
}

function trafficMetaText(g) { return `${Math.round(g.radius)} nm around map centre`; }

function scheduleRefresh(delay = 180) {
  if (!token || document.hidden || !navigator.onLine) return;
  clearTimeout(refreshDelayTimer);
  refreshDelayTimer = setTimeout(() => { refreshDelayTimer = null; refresh(); }, delay);
}

async function refresh() {
  if (!token || !navigator.onLine) {
    if (!navigator.onLine) setStatus('Offline');
    return;
  }
  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }
  const g = geo();
  setTrafficMeta('Refreshing…');
  refreshPromise = (async () => {
    try {
      const payload = await api(`/v1/v34/live?lat=${g.lat}&lon=${g.lon}&radius=${g.radius}`);
      flights = Array.isArray(payload.flights) ? payload.flights : [];
      flightByIcao = new Map(flights.map(flight => [String(flight.icao24 || '').toLowerCase(), flight]));
      if ($('visible')) $('visible').textContent = String(flights.length);
      setTrafficMeta(trafficMetaText(g));
      render();
      drawFlights();
      setStatus(`${payload.source || 'Live'} · ${payload.cache || 'fresh'}`);
    } catch (error) {
      setTrafficMeta('Refresh failed');
      setStatus(error.message);
      if (error.status === 401 || /sign in|session/i.test(error.message)) {
        token = '';
        sessionStorage.removeItem('skytrace.webToken');
        setSigned(false);
      }
    }
  })();
  try { await refreshPromise; }
  finally {
    refreshPromise = null;
    if (refreshQueued) { refreshQueued = false; scheduleRefresh(240); }
  }
}

function addGeoLayer(id, data, paint) {
  if (!data?.features || !map.isStyleLoaded()) return;
  if (map.getSource(id)) map.getSource(id).setData(data);
  else { map.addSource(id, { type: 'geojson', data }); map.addLayer({ id, type: 'line', source: id, paint }); }
}

async function loadOps() {
  const drawer = showDrawer('<div class="operations-detail"><div class="detail-message">Loading operations…</div></div>', 'Operations');
  window.skytraceMobileSheet?.expand?.();
  try {
    ops = await api('/v1/v34/operations');
    const groups = [['International SIGMET', ops.internationalSigmets], ['Domestic SIGMET', ops.domesticSigmets], ['G-AIRMET', ops.graphicalAirmets], ['PIREP', ops.pireps]];
    if ($('alerts')) $('alerts').textContent = String(groups.reduce((n, [, group]) => n + (group?.geojson?.features?.length || 0), 0));
    if (drawer) drawer.innerHTML = `<div class="operations-detail"><div class="detail-section-title">OPERATIONS</div><div class="ops-list">${groups.map(([name, group]) => `<div><span>${esc(name)}</span><b>${group?.geojson?.features?.length || 0}</b></div>`).join('')}<div><span>NOTAM</span><b>${ops.notams?.configured ? (ops.notams.ok ? 'Connected' : 'Feed error') : 'Not configured'}</b></div></div></div>`;
    addGeoLayer('sigmet-int', ops.internationalSigmets?.geojson, { 'line-color': '#ef4444', 'line-width': 2 });
    addGeoLayer('sigmet-dom', ops.domesticSigmets?.geojson, { 'line-color': '#f97316', 'line-width': 2 });
    addGeoLayer('gairmet', ops.graphicalAirmets?.geojson, { 'line-color': '#eab308', 'line-width': 1.5 });
  } catch (error) { if (drawer) drawer.innerHTML = `<div class="detail-message">${esc(error.message)}</div>`; }
}

async function replay() {
  const drawer = showDrawer('<div class="replay-detail"><div class="detail-message">Loading Replay+…</div></div>', 'Replay plus');
  window.skytraceMobileSheet?.expand?.();
  try {
    const to = Date.now();
    const from = to - 6 * 3600_000;
    const payload = await api(`/v1/v34/replay?from=${from}&to=${to}&limit=8000`);
    const lines = new Map();
    for (const point of payload.points || []) {
      if (!lines.has(point.icao)) lines.set(point.icao, []);
      lines.get(point.icao).push([Number(point.longitude), Number(point.latitude)]);
    }
    const fc = { type: 'FeatureCollection', features: [...lines].filter(([, coords]) => coords.length > 1).map(([icao, coords]) => ({ type: 'Feature', properties: { icao }, geometry: { type: 'LineString', coordinates: coords } })) };
    if (map.isStyleLoaded()) {
      if (map.getSource('replay')) map.getSource('replay').setData(fc);
      else { map.addSource('replay', { type: 'geojson', data: fc }); map.addLayer({ id: 'replay', type: 'line', source: 'replay', paint: { 'line-color': '#60a5fa', 'line-width': 2, 'line-opacity': .65 } }); }
    }
    if (drawer) drawer.innerHTML = `<div class="replay-detail"><div class="detail-section-title">REPLAY+</div><div class="detail-message">Loaded <b>${Number(payload.count || 0).toLocaleString()}</b> globally aggregated observations from the last six hours.</div></div>`;
  } catch (error) {
    if (drawer) drawer.innerHTML = `<div class="detail-message">${esc(error.status === 403 ? 'Replay+ requires Replay+ or SkyTrace Pro.' : error.message)}</div>`;
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (token && !document.hidden && navigator.onLine) refresh(); }, 12000);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/app/sw.js', { scope: '/app/', updateViaCache: 'none' }).catch(() => {}));
}

$('loginBtn').onclick = login;
$('username').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('password').focus(); } };
$('password').onkeydown = event => { if (event.key === 'Enter') login(); };
$('refreshBtn').onclick = () => refresh();
$('opsBtn').onclick = loadOps;
$('replayBtn').onclick = replay;
$('logoutBtn').onclick = () => { token = ''; sessionStorage.removeItem('skytrace.webToken'); setSigned(false); };

$('list').addEventListener('click', event => {
  const row = event.target.closest?.('.flight[data-icao]');
  if (!row) return;
  const flight = flightByIcao.get(String(row.dataset.icao || '').toLowerCase());
  if (flight) selectFlight(flight);
});

$('drawer').addEventListener('click', event => {
  if (event.target.closest?.('[data-close-aircraft]')) { event.preventDefault(); closeAircraftDetail(); return; }
  const save = event.target.closest?.('[data-save-note]');
  if (save) { event.preventDefault(); saveSelectedNote(save); }
});

map.on('dragend', () => scheduleRefresh(120));
map.on('zoomend', () => scheduleRefresh(120));
map.on('load', () => {
  ensureAircraftLayers();
  drawFlights();
  window.skytraceResizeMap?.();
  if (token) refresh();
});
map.on('styledata', () => { if (map.isStyleLoaded()) drawFlights(); });

window.addEventListener('resize', () => window.skytraceResizeMap?.(), { passive: true });
window.addEventListener('orientationchange', () => setTimeout(() => window.skytraceResizeMap?.(), 120), { passive: true });
window.addEventListener('focus', () => token && scheduleRefresh(80));
window.addEventListener('online', () => token && scheduleRefresh(80));
window.addEventListener('offline', () => setStatus('Offline'));
window.addEventListener('pageshow', () => { window.skytraceResizeMap?.(); if (token && !document.hidden) scheduleRefresh(80); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.skytraceResizeMap?.(); if (!document.hidden && token) scheduleRefresh(80); });

setSigned(Boolean(token));
updatePanelMetrics();
if (token && map.loaded()) refresh();
