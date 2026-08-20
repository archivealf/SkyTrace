import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB = path.resolve(__dirname, "../data/aircraft.csv.gz");
const ADSB_ROOT = "https://api.adsb.lol";
const ROUTE_ROOT = "https://vrs-standing-data.adsb.lol/routes";
const AIRCRAFT_TTL = 12 * 60 * 60_000;
const ROUTE_TTL = 24 * 60 * 60_000;
const CACHE = new Map();
let localAircraft = null;
let localAircraftPromise = null;

function cleanHex(value) {
  const key = String(value || "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 6);
  return key.length === 6 ? key : "";
}

function cleanCallsign(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function gunzip(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (error, output) => error ? reject(error) : resolve(output));
  });
}

async function loadLocalAircraftDb() {
  if (localAircraft) return localAircraft;
  if (localAircraftPromise) return localAircraftPromise;

  localAircraftPromise = (async () => {
    const index = new Map();
    if (!fs.existsSync(LOCAL_DB)) {
      localAircraft = index;
      return index;
    }

    try {
      const compressed = await fs.promises.readFile(LOCAL_DB);
      const text = (await gunzip(compressed)).toString("utf8");
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const fields = line.split(";");
        const hex = cleanHex(fields[0]);
        if (!hex) continue;
        index.set(hex, {
          icao24: hex,
          registration: fields[1] || null,
          typeCode: fields[2] || null,
          flags: numberOrNull(fields[3]) || 0,
          model: fields[4] || null,
          operator: fields[5] || null,
          year: numberOrNull(fields[6])
        });
        // Parsing the full aircraft database used to block Electron's main process.
        // Yield periodically so window/input work remains responsive during first use.
        if (i > 0 && i % 5000 === 0) await new Promise(resolve => setImmediate(resolve));
      }
    } catch (error) {
      console.warn(`[SkyTrace] Could not load Mictronics aircraft database: ${error.message}`);
    }

    localAircraft = index;
    return index;
  })();

  try {
    return await localAircraftPromise;
  } finally {
    if (localAircraft) localAircraftPromise = null;
  }
}

async function localLookup(hex) {
  return (await loadLocalAircraftDb()).get(hex) || null;
}

function mergeAircraft(local, remote) {
  if (!local && !remote) return null;
  return {
    icao24: remote?.icao24 || local?.icao24 || null,
    registration: remote?.registration || local?.registration || null,
    manufacturer: remote?.manufacturer || null,
    model: remote?.model || local?.model || null,
    typeCode: remote?.typeCode || local?.typeCode || null,
    operator: remote?.operator || local?.operator || null,
    operatorCode: remote?.operatorCode || null,
    country: remote?.country || null,
    countryIso: remote?.countryIso || null,
    year: remote?.year || local?.year || null,
    flags: remote?.flags ?? local?.flags ?? 0,
    photoUrl: null,
    photoThumbnailUrl: null
  };
}

function normalizeLiveAircraft(ac, hex) {
  if (!ac || typeof ac !== "object") return null;
  const foundHex = cleanHex(ac.hex) || hex;
  return {
    icao24: foundHex,
    registration: ac.r || null,
    manufacturer: ac.manufacturer || null,
    model: ac.desc || ac.model || null,
    typeCode: ac.t || null,
    operator: ac.ownOp || ac.operator || null,
    operatorCode: ac.operatorCode || null,
    country: ac.country || null,
    countryIso: ac.countryIso || null,
    year: numberOrNull(ac.year),
    flags: numberOrNull(ac.dbFlags) || 0
  };
}

async function fetchCached(url, cacheKey, ttl) {
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) return { value: cached.value, cache: "HIT" };

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SkyTrace/3.3" },
    signal: AbortSignal.timeout(12_000)
  });
  if (response.status === 404) return { value: null, cache: "MISS" };
  if (!response.ok) {
    const error = new Error(
      response.status === 429
        ? "Aircraft enrichment provider is temporarily rate limiting requests."
        : `Aircraft enrichment provider failed (${response.status}).`
    );
    error.status = response.status;
    throw error;
  }

  const value = await response.json();
  CACHE.set(cacheKey, { at: Date.now(), value });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  return { value, cache: "MISS" };
}

async function getLiveAircraft(hex) {
  const result = await fetchCached(`${ADSB_ROOT}/v2/icao/${hex.toLowerCase()}`, `aircraft:${hex}`, AIRCRAFT_TTL);
  const ac = Array.isArray(result.value?.ac) ? result.value.ac[0] : null;
  return { aircraft: normalizeLiveAircraft(ac, hex), cache: result.cache };
}

function normalizeRouteAirport(a) {
  if (!a) return null;
  return {
    name: a.name || null,
    icao: a.icao || null,
    iata: a.iata || null,
    city: a.location || null,
    country: a.countryiso2 || null,
    lat: numberOrNull(a.lat),
    lon: numberOrNull(a.lon),
    elevationFt: numberOrNull(a.alt_feet)
  };
}

function normalizeVrsRoute(route) {
  if (!route || typeof route !== "object") return null;
  const airports = Array.isArray(route._airports) ? route._airports.map(normalizeRouteAirport).filter(Boolean) : [];
  const origin = airports[0] || null;
  const destination = airports.length > 1 ? airports.at(-1) : null;
  const midpoint = airports.length > 2 ? airports[1] : null;
  return {
    callsign: route.callsign || null,
    callsignIcao: route.callsign || null,
    callsignIata: null,
    airline: route.airline_code ? { name: null, icao: route.airline_code, iata: null, country: null } : null,
    origin,
    midpoint,
    destination,
    airportCodes: route.airport_codes || null,
    airportCodesIata: route._airport_codes_iata || null
  };
}

async function fetchRoute(callsign) {
  if (callsign.length < 2) return { route: null, cache: "MISS" };
  const prefix = callsign.slice(0, 2);
  const url = `${ROUTE_ROOT}/${prefix}/${encodeURIComponent(callsign)}.json`;
  const result = await fetchCached(url, `route:${callsign}`, ROUTE_TTL);
  return { route: normalizeVrsRoute(result.value), cache: result.cache };
}

export function isAircraftEnrichmentConfigured() {
  return true;
}

export async function getAircraftMetadata(icao24, callsign = "") {
  const hex = cleanHex(icao24);
  if (!hex) throw Object.assign(new Error("Invalid ICAO24."), { status: 400 });
  const call = cleanCallsign(callsign);
  const localPromise = localLookup(hex);

  const [local, liveResult, routeResult] = await Promise.all([
    localPromise,
    getLiveAircraft(hex).catch(error => ({ __error: error })),
    call ? fetchRoute(call).catch(error => ({ __error: error })) : Promise.resolve({ route: null, cache: "MISS" })
  ]);

  const liveError = liveResult?.__error || null;
  const routeError = routeResult?.__error || null;
  const live = liveError ? null : liveResult.aircraft;
  const route = routeError ? null : routeResult.route;
  const aircraft = mergeAircraft(local, live);
  const warnings = [];
  if (liveError) warnings.push(liveError.message || "Live aircraft enrichment unavailable.");
  if (routeError) warnings.push(routeError.message || "Route enrichment unavailable.");

  return {
    ok: true,
    configured: true,
    found: Boolean(aircraft || route),
    source: "Mictronics aircraft database + ADSB.lol + VRS Standing Data",
    aircraft,
    route,
    warning: warnings.length ? warnings.join(" ") : null
  };
}

export async function getFlightRoute(callsign) {
  const call = cleanCallsign(callsign);
  if (!call) throw Object.assign(new Error("A valid callsign is required."), { status: 400 });
  const result = await fetchRoute(call);
  return {
    ok: true,
    found: Boolean(result.route),
    source: "VRS Standing Data via ADSB.lol",
    route: result.route || null,
    cache: result.cache
  };
}
