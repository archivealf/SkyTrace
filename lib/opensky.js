import { config, hasOpenSkyCredentials } from "./config.js";

const API_ROOT = "https://opensky-network.org/api";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const caches = {
  states: new Map(),
  tracks: new Map(),
  ops: new Map()
};
let oauthToken = null;
let oauthTokenExpiresAt = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function categoryName(category) {
  const names = {
    0: "Unknown", 1: "No category", 2: "Light aircraft", 3: "Small aircraft",
    4: "Large aircraft", 5: "High-vortex large", 6: "Heavy aircraft",
    7: "High-performance", 8: "Rotorcraft", 9: "Glider", 10: "Lighter-than-air",
    11: "Parachutist", 12: "Ultralight", 14: "UAV", 15: "Space vehicle",
    16: "Emergency surface vehicle", 17: "Service surface vehicle",
    18: "Point obstacle", 19: "Cluster obstacle", 20: "Line obstacle"
  };
  return names[category] || "Unknown";
}

function sanitizeBounds(input) {
  if (!input) return null;
  let lamin = Number(input.lamin);
  let lomin = Number(input.lomin);
  let lamax = Number(input.lamax);
  let lomax = Number(input.lomax);
  if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) return null;
  lamin = clamp(lamin, -90, 90);
  lamax = clamp(lamax, -90, 90);
  lomin = clamp(lomin, -180, 180);
  lomax = clamp(lomax, -180, 180);
  if (lamin > lamax) [lamin, lamax] = [lamax, lamin];
  if (lomin > lomax) { lomin = -180; lomax = 180; }
  return { lamin, lomin, lamax, lomax };
}

export function isOpenSkyAuthenticated() {
  return hasOpenSkyCredentials();
}

async function getOAuthToken() {
  const clientId = config.opensky.clientId;
  const clientSecret = config.opensky.clientSecret;
  if (!clientId || !clientSecret) return null;
  const now = Date.now();
  if (oauthToken && now < oauthTokenExpiresAt - 30_000) return oauthToken;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SkyTrace/2.0" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret })
  });
  if (!response.ok) throw new Error(`OpenSky OAuth failed (${response.status})`);
  const payload = await response.json();
  oauthToken = payload.access_token;
  oauthTokenExpiresAt = now + Math.max(60, Number(payload.expires_in || 1800)) * 1000;
  return oauthToken;
}

async function authHeaders() {
  const token = await getOAuthToken();
  return {
    Accept: "application/json",
    "User-Agent": "SkyTrace/2.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function openskyFetch(url, { cache, key, ttl = 15_000 } = {}) {
  const now = Date.now();
  const cached = cache?.get(key);
  if (cached && now - cached.savedAt < ttl) return { data: cached.data, cache: "HIT", rateRemaining: cached.rateRemaining ?? null };

  const response = await fetch(url, { headers: await authHeaders() });
  if (!response.ok) {
    const retryAfter = response.headers.get("x-rate-limit-retry-after-seconds") || response.headers.get("retry-after");
    const error = new Error(
      response.status === 429 ? "OpenSky API quota has been reached." :
      response.status === 401 || response.status === 403 ? "This OpenSky feature requires authenticated API credentials." :
      `OpenSky request failed (${response.status}).`
    );
    error.status = response.status;
    error.retryAfter = retryAfter ? Number(retryAfter) : null;
    throw error;
  }

  const data = await response.json();
  const rateRemaining = response.headers.get("x-rate-limit-remaining");
  if (cache && key) cache.set(key, { savedAt: now, data, rateRemaining });
  return { data, cache: "MISS", rateRemaining };
}

function normalizeState(state) {
  if (!Array.isArray(state) || state.length < 17) return null;
  const [icao24, callsign, originCountry, timePosition, lastContact, longitude, latitude,
    baroAltitude, onGround, velocity, trueTrack, verticalRate, _sensors, geoAltitude,
    squawk, spi, positionSource, category] = state;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const altitudeMeters = Number.isFinite(geoAltitude) ? geoAltitude : Number.isFinite(baroAltitude) ? baroAltitude : null;
  return {
    icao24: String(icao24 || "").toLowerCase(),
    callsign: String(callsign || "").trim() || "NO CALLSIGN",
    originCountry: originCountry || "Unknown",
    timePosition: timePosition || null,
    lastContact: lastContact || null,
    longitude, latitude,
    altitudeFt: altitudeMeters === null ? null : Math.round(altitudeMeters * 3.28084),
    baroAltitudeFt: Number.isFinite(baroAltitude) ? Math.round(baroAltitude * 3.28084) : null,
    speedKts: Number.isFinite(velocity) ? Math.round(velocity * 1.94384) : null,
    heading: Number.isFinite(trueTrack) ? Math.round(trueTrack) : 0,
    verticalRateFpm: Number.isFinite(verticalRate) ? Math.round(verticalRate * 196.8504) : null,
    onGround: Boolean(onGround), squawk: squawk || null, spi: Boolean(spi),
    positionSource: Number.isFinite(positionSource) ? positionSource : null,
    category: Number.isFinite(category) ? category : 0,
    categoryName: categoryName(category)
  };
}

export async function getFlightSnapshot({ bounds: rawBounds, icao24 = null } = {}) {
  const bounds = sanitizeBounds(rawBounds);
  const cleanIcaos = Array.isArray(icao24)
    ? icao24.map((x) => String(x).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6)).filter((x) => x.length === 6)
    : String(icao24 || "").split(",").map((x) => x.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6)).filter((x) => x.length === 6);
  const key = cleanIcaos.length ? `icao:${cleanIcaos.sort().join(",")}` : bounds
    ? [round(bounds.lamin), round(bounds.lomin), round(bounds.lamax), round(bounds.lomax)].join(":") : "global";

  const url = new URL(`${API_ROOT}/states/all`);
  url.searchParams.set("extended", "1");
  if (cleanIcaos.length) cleanIcaos.slice(0, 50).forEach((icao) => url.searchParams.append("icao24", icao));
  else if (bounds) Object.entries(bounds).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const result = await openskyFetch(url, { cache: caches.states, key, ttl: 12_000 });
  const raw = result.data || {};
  const flights = (raw.states || []).map(normalizeState).filter(Boolean);
  return {
    ok: true,
    source: "OpenSky Network",
    sourceTime: raw.time || Math.floor(Date.now() / 1000),
    fetchedAt: Date.now(),
    authMode: isOpenSkyAuthenticated() ? "oauth" : "anonymous",
    rateRemaining: result.rateRemaining,
    flights,
    cache: result.cache
  };
}

export async function getTrack(icao24, time = 0) {
  const icao = String(icao24 || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
  if (icao.length !== 6) throw Object.assign(new Error("Invalid ICAO24."), { status: 400 });
  const t = Number.isFinite(Number(time)) ? Math.max(0, Math.floor(Number(time))) : 0;
  const url = new URL(`${API_ROOT}/tracks/all`);
  url.searchParams.set("icao24", icao);
  url.searchParams.set("time", String(t));
  const result = await openskyFetch(url, { cache: caches.tracks, key: `${icao}:${t}`, ttl: 30_000 });
  const raw = result.data || {};
  const path = (raw.path || []).map((p) => ({
    time: p[0], lat: p[1], lon: p[2], altitudeFt: Number.isFinite(p[3]) ? Math.round(p[3] * 3.28084) : null,
    heading: Number.isFinite(p[4]) ? Math.round(p[4]) : null, onGround: Boolean(p[5])
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  return { ok: true, source: "OpenSky Network", icao24: raw.icao24 || icao, callsign: String(raw.callsign || raw.calllsign || "").trim(), startTime: raw.startTime, endTime: raw.endTime, path, cache: result.cache, rateRemaining: result.rateRemaining };
}

export async function getAirportOperations({ airport, direction = "arrival", begin, end }) {
  const code = String(airport || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (code.length < 3) throw Object.assign(new Error("Invalid airport ICAO code."), { status: 400 });
  const dir = direction === "departure" ? "departure" : "arrival";
  const b = Math.floor(Number(begin));
  const e = Math.floor(Number(end));
  if (!Number.isFinite(b) || !Number.isFinite(e) || b >= e || e - b > 172800) throw Object.assign(new Error("Invalid operations time range."), { status: 400 });
  const url = new URL(`${API_ROOT}/flights/${dir}`);
  url.searchParams.set("airport", code);
  url.searchParams.set("begin", String(b));
  url.searchParams.set("end", String(e));
  const result = await openskyFetch(url, { cache: caches.ops, key: `${dir}:${code}:${b}:${e}`, ttl: 300_000 });
  const raw = result.data;
  const items = (Array.isArray(raw) ? raw : []).map((f) => ({
    icao24: f.icao24, callsign: String(f.callsign || "").trim(), firstSeen: f.firstSeen,
    lastSeen: f.lastSeen, departure: f.estDepartureAirport || null, arrival: f.estArrivalAirport || null
  }));
  return { ok: true, source: "OpenSky Network", historical: true, direction: dir, airport: code, flights: items };
}
