import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SKYTRACE_COMMERCE_CONFIG || path.join(__dirname, 'config.json');
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const dataFile = path.resolve(__dirname, String(rawConfig?.dataFile || 'data/store.json'));
const sqliteFile = path.resolve(__dirname, String(rawConfig?.sqliteFile || dataFile.replace(/\.json$/i, '') + '.sqlite3'));
const db = new DatabaseSync(sqliteFile, { timeout: 5000 });
const previousCreateServer = http.createServer.bind(http);
const cache = new Map();
let airportDatasetPromise = null;

const OUR_AIRPORTS = Object.freeze({
  airports: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
  runways: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv',
  frequencies: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airport-frequencies.csv'
});

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function now() { return Date.now(); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
function auth(req) {
  const match = /^Bearer\s+(.+)$/i.exec(clean(req.headers.authorization));
  if (!match) return null;
  return db.prepare(`SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(match[1]), now()) || null;
}
function requireAuth(req) {
  const user = auth(req);
  if (!user) throw Object.assign(new Error('Sign in to SkyTrace first.'), { status: 401 });
  return user;
}
function effectiveEntitlements(userId) {
  const owned = new Set(db.prepare("SELECT DISTINCT entitlement FROM purchases WHERE user_id=? AND status='paid'").all(userId).map(row => row.entitlement));
  if (owned.has('pro')) for (const key of ['airport_intelligence', 'advanced_aircraft', 'replay_plus', 'themes']) owned.add(key);
  return owned;
}
function requireAirportIntelligence(userId) {
  if (!effectiveEntitlements(userId).has('airport_intelligence')) {
    throw Object.assign(new Error('Airport Intelligence or SkyTrace Pro is required.'), { status: 403 });
  }
}

async function fetchCached(key, url, ttl, type = 'json') {
  const hit = cache.get(key);
  if (hit && now() - hit.at < ttl) return hit.value;
  const response = await fetch(url, {
    headers: { Accept: type === 'json' ? 'application/json' : 'text/csv,text/plain', 'User-Agent': 'SkyTrace/35.0 Airport Desk' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Airport data provider returned ${response.status}`);
  const value = type === 'json' ? await response.json() : await response.text();
  cache.set(key, { at: now(), value });
  return value;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  return rows.filter(values => values.length > 1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function loadAirportDataset() {
  if (airportDatasetPromise) return airportDatasetPromise;
  airportDatasetPromise = (async () => {
    const [airportsText, runwaysText, frequenciesText] = await Promise.all([
      fetchCached('oa:airports', OUR_AIRPORTS.airports, 12 * 3600_000, 'text'),
      fetchCached('oa:runways', OUR_AIRPORTS.runways, 12 * 3600_000, 'text'),
      fetchCached('oa:frequencies', OUR_AIRPORTS.frequencies, 12 * 3600_000, 'text')
    ]);
    const airports = parseCsv(airportsText);
    const runways = parseCsv(runwaysText);
    const frequencies = parseCsv(frequenciesText);
    const byIdent = new Map();
    for (const airport of airports) {
      const ident = clean(airport.ident).toUpperCase();
      if (ident) byIdent.set(ident, airport);
    }
    const runwaysByAirport = new Map();
    for (const runway of runways) {
      const ident = clean(runway.airport_ident).toUpperCase();
      if (!ident) continue;
      if (!runwaysByAirport.has(ident)) runwaysByAirport.set(ident, []);
      runwaysByAirport.get(ident).push(runway);
    }
    const frequenciesByAirport = new Map();
    for (const frequency of frequencies) {
      const ident = clean(frequency.airport_ident).toUpperCase();
      if (!ident) continue;
      if (!frequenciesByAirport.has(ident)) frequenciesByAirport.set(ident, []);
      frequenciesByAirport.get(ident).push(frequency);
    }
    return { byIdent, runwaysByAirport, frequenciesByAirport };
  })().catch(error => { airportDatasetPromise = null; throw error; });
  return airportDatasetPromise;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function normalizeRunway(row) {
  return {
    id: `${clean(row.le_ident) || '—'}/${clean(row.he_ident) || '—'}`,
    lengthFt: number(row.length_ft),
    widthFt: number(row.width_ft),
    surface: clean(row.surface),
    lighted: row.lighted === '1',
    closed: row.closed === '1',
    leIdent: clean(row.le_ident),
    heIdent: clean(row.he_ident),
    leHeadingDegT: number(row.le_heading_degT),
    heHeadingDegT: number(row.he_heading_degT)
  };
}
function normalizeFrequency(row) {
  return { type: clean(row.type), name: clean(row.description) || clean(row.type), frequency: clean(row.frequency_mhz) ? `${clean(row.frequency_mhz)} MHz` : '' };
}
function angularDistance(a, b) {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return delta;
}
function likelyRunway(runways, windDirection) {
  if (!Number.isFinite(windDirection)) return null;
  let best = null;
  for (const runway of runways) {
    if (runway.closed) continue;
    for (const end of [
      { ident: runway.leIdent, heading: runway.leHeadingDegT },
      { ident: runway.heIdent, heading: runway.heHeadingDegT }
    ]) {
      if (!Number.isFinite(end.heading)) continue;
      const score = angularDistance(end.heading, windDirection);
      if (!best || score < best.score) best = { runway: end.ident, heading: end.heading, crosswindAngle: score };
    }
  }
  return best;
}

function normalizeLive(ac) {
  const latitude = number(ac?.lat), longitude = number(ac?.lon);
  if (latitude == null || longitude == null) return null;
  const onGround = String(ac.alt_baro || '').toLowerCase() === 'ground';
  return {
    icao24: clean(ac.hex).replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase(),
    callsign: clean(ac.flight), registration: clean(ac.r), aircraftType: clean(ac.t), latitude, longitude,
    altitudeFt: onGround ? 0 : number(ac.alt_geom ?? ac.alt_baro), speedKts: number(ac.gs), heading: number(ac.true_heading ?? ac.track), onGround
  };
}

async function airportDesk(icao) {
  const dataset = await loadAirportDataset();
  const airport = dataset.byIdent.get(icao);
  if (!airport) throw Object.assign(new Error(`Airport ${icao} was not found in OurAirports.`), { status: 404 });
  const latitude = number(airport.latitude_deg), longitude = number(airport.longitude_deg);
  const runways = (dataset.runwaysByAirport.get(icao) || []).map(normalizeRunway);
  const frequencies = (dataset.frequenciesByAirport.get(icao) || []).map(normalizeFrequency).filter(item => item.frequency);

  const [metarResult, tafResult, trafficResult] = await Promise.allSettled([
    fetchCached(`metar:${icao}`, `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`, 60_000),
    fetchCached(`taf:${icao}`, `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`, 5 * 60_000),
    latitude != null && longitude != null
      ? fetchCached(`traffic:${icao}`, `https://api.adsb.lol/v2/point/${latitude.toFixed(4)}/${longitude.toFixed(4)}/35`, 8_000)
      : Promise.resolve({ ac: [] })
  ]);

  const metar = metarResult.status === 'fulfilled' && Array.isArray(metarResult.value) ? metarResult.value[0] || null : null;
  const taf = tafResult.status === 'fulfilled' && Array.isArray(tafResult.value) ? tafResult.value[0] || null : null;
  const nearbyAircraft = trafficResult.status === 'fulfilled'
    ? (trafficResult.value?.ac || []).map(normalizeLive).filter(Boolean).slice(0, 120)
    : [];
  const windDirection = number(metar?.wdir);

  return {
    ok: true,
    icao,
    name: clean(airport.name) || icao,
    airport: {
      ident: icao,
      name: clean(airport.name),
      type: clean(airport.type),
      latitude, longitude,
      elevationFt: number(airport.elevation_ft),
      municipality: clean(airport.municipality),
      country: clean(airport.iso_country),
      region: clean(airport.iso_region),
      website: clean(airport.home_link),
      wikipedia: clean(airport.wikipedia_link),
      runways,
      frequencies
    },
    weather: metar ? {
      raw: clean(metar.rawOb),
      wind: windDirection == null ? clean(metar.wdir) : `${Math.round(windDirection)}° at ${number(metar.wspd) ?? '—'} kt`,
      windDirection, windSpeedKts: number(metar.wspd), visibilitySm: number(metar.visib), temperatureC: number(metar.temp), dewpointC: number(metar.dewp), altimeterInHg: number(metar.altim)
    } : null,
    metarRaw: clean(metar?.rawOb),
    taf: taf ? { raw: clean(taf.rawTAF || taf.rawOb), issueTime: clean(taf.issueTime) } : null,
    runways,
    frequencies,
    likelyRunway: likelyRunway(runways, windDirection),
    traffic: { count: nearbyAircraft.length, aircraft: nearbyAircraft },
    arrivals: nearbyAircraft,
    departures: [],
    sources: ['OurAirports', 'AviationWeather.gov', 'ADSB.lol'],
    fetchedAt: now()
  };
}

http.createServer = function mobile35CreateServer(...args) {
  const options = typeof args[0] === 'function' ? null : args[0];
  const listener = typeof args[0] === 'function' ? args[0] : args[1];
  const wrapped = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && ['/v1/v35/airport', '/v1/v34/airport', '/v1/v34/airport-intelligence'].includes(url.pathname)) {
      try {
        const user = requireAuth(req);
        requireAirportIntelligence(user.id);
        const icao = clean(url.searchParams.get('icao')).toUpperCase();
        if (!/^[A-Z0-9]{3,4}$/.test(icao)) throw Object.assign(new Error('A valid 3-4 character airport ICAO code is required.'), { status: 400 });
        return json(res, 200, await airportDesk(icao));
      } catch (error) {
        return json(res, error.status >= 400 && error.status < 600 ? error.status : 502, { ok: false, error: error.message || 'Airport Desk failed.' });
      }
    }
    return listener(req, res);
  };
  return options == null ? previousCreateServer(wrapped) : previousCreateServer(options, wrapped);
};
