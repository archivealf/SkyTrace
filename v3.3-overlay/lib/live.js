const ADSB_ROOT = "https://api.adsb.lol";
const CACHE = new Map();
const FRESH_TTL = 10_000;
const STALE_TTL = 5 * 60_000;
const MAX_CACHE_ENTRIES = 300;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function cleanHex(value) {
  const v = String(value || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
  return v.length === 6 ? v : "";
}

function categoryFromEmitter(category) {
  const c = String(category || "").toUpperCase();
  const map = {
    A1: [2, "Light aircraft"], A2: [3, "Small aircraft"], A3: [4, "Large aircraft"],
    A4: [5, "High-vortex large"], A5: [6, "Heavy aircraft"], A6: [7, "High-performance"],
    A7: [8, "Rotorcraft"], B1: [9, "Glider"], B2: [10, "Lighter-than-air"],
    B4: [12, "Ultralight"], B6: [14, "UAV"], B7: [15, "Space vehicle"],
    C1: [16, "Emergency surface vehicle"], C2: [17, "Service surface vehicle"],
    C3: [18, "Point obstacle"], C4: [19, "Cluster obstacle"], C5: [20, "Line obstacle"]
  };
  return map[c] || [0, "Unknown"];
}

function normalizeAc(ac, nowSeconds) {
  if (!ac || typeof ac !== "object") return null;
  const latitude = Number(ac.lat);
  const longitude = Number(ac.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const altRaw = ac.alt_geom ?? ac.alt_baro;
  const onGround = String(ac.alt_baro || "").toLowerCase() === "ground";
  const altitudeFt = onGround ? 0 : Number.isFinite(Number(altRaw)) ? Math.round(Number(altRaw)) : null;
  const [category, categoryName] = categoryFromEmitter(ac.category);
  const seen = Number(ac.seen);
  const lastContact = Number.isFinite(seen) ? Math.max(0, Math.floor(nowSeconds - seen)) : Math.floor(nowSeconds);

  return {
    icao24: cleanHex(ac.hex),
    callsign: String(ac.flight || "").trim() || "NO CALLSIGN",
    originCountry: "Unknown",
    timePosition: Number.isFinite(Number(ac.seen_pos)) ? Math.max(0, Math.floor(nowSeconds - Number(ac.seen_pos))) : lastContact,
    lastContact,
    longitude,
    latitude,
    altitudeFt,
    baroAltitudeFt: onGround ? 0 : Number.isFinite(Number(ac.alt_baro)) ? Math.round(Number(ac.alt_baro)) : null,
    speedKts: Number.isFinite(Number(ac.gs)) ? Math.round(Number(ac.gs)) : null,
    heading: Number.isFinite(Number(ac.true_heading)) ? Math.round(Number(ac.true_heading)) :
      Number.isFinite(Number(ac.track)) ? Math.round(Number(ac.track)) : 0,
    verticalRateFpm: Number.isFinite(Number(ac.geom_rate)) ? Math.round(Number(ac.geom_rate)) :
      Number.isFinite(Number(ac.baro_rate)) ? Math.round(Number(ac.baro_rate)) : null,
    onGround,
    squawk: ac.squawk || null,
    spi: Boolean(ac.spi),
    positionSource: ac.type || null,
    category,
    categoryName,
    registration: ac.r || null,
    aircraftType: ac.t || null,
    dbFlags: Number.isFinite(Number(ac.dbFlags)) ? Number(ac.dbFlags) : 0,
    emergency: ac.emergency && ac.emergency !== "none" ? ac.emergency : null,
    navAltitudeFt: Number.isFinite(Number(ac.nav_altitude_fms)) ? Number(ac.nav_altitude_fms) :
      Number.isFinite(Number(ac.nav_altitude_mcp)) ? Number(ac.nav_altitude_mcp) : null,
    indicatedAirspeedKts: Number.isFinite(Number(ac.ias)) ? Number(ac.ias) : null,
    trueAirspeedKts: Number.isFinite(Number(ac.tas)) ? Number(ac.tas) : null,
    mach: Number.isFinite(Number(ac.mach)) ? Number(ac.mach) : null,
    source: "ADSB.lol"
  };
}

function trimCache() {
  if (CACHE.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...CACHE.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, Math.max(1, CACHE.size - MAX_CACHE_ENTRIES));
  for (const [key] of oldest) CACHE.delete(key);
}

async function adsbFetch(pathname, key, ttl = FRESH_TTL) {
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && now - cached.at < ttl) {
    return { payload: cached.payload, cache: "HIT", staleAgeSeconds: 0 };
  }

  try {
    const response = await fetch(`${ADSB_ROOT}${pathname}`, {
      headers: { Accept: "application/json", "User-Agent": "SkyTrace/3.3" }
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 429
          ? "ADSB.lol is temporarily rate limiting requests."
          : `ADSB.lol request failed (${response.status}).`
      );
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    CACHE.set(key, { at: now, payload });
    trimCache();
    return { payload, cache: "MISS", staleAgeSeconds: 0 };
  } catch (error) {
    if (cached && now - cached.at <= STALE_TTL) {
      return {
        payload: cached.payload,
        cache: "STALE",
        staleAgeSeconds: Math.max(1, Math.floor((now - cached.at) / 1000)),
        warning: error.message
      };
    }
    throw error;
  }
}

function cleanBounds(input) {
  if (!input) return null;
  let lamin = clamp(Number(input.lamin), -90, 90);
  let lamax = clamp(Number(input.lamax), -90, 90);
  let lomin = clamp(Number(input.lomin), -180, 180);
  let lomax = clamp(Number(input.lomax), -180, 180);
  if (![lamin, lamax, lomin, lomax].every(Number.isFinite)) return null;
  if (lamin > lamax) [lamin, lamax] = [lamax, lamin];
  if (lomin > lomax) return null;
  return { lamin, lamax, lomin, lomax };
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = (d) => d * Math.PI / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dP = toRad(lat2 - lat1);
  const dL = toRad(lon2 - lon1);
  const a = Math.sin(dP / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getByHexList(icaos) {
  const cleaned = [...new Set(icaos.map(cleanHex).filter(Boolean))].slice(0, 40);
  const results = await Promise.allSettled(
    cleaned.map(async (icao) => {
      const result = await adsbFetch(`/v2/icao/${icao}`, `icao:${icao}`, 8_000);
      return result;
    })
  );

  const all = [];
  let cache = "MISS";
  let staleAgeSeconds = 0;
  let firstError = null;
  for (const r of results) {
    if (r.status === "fulfilled") {
      all.push(...(r.value.payload?.ac || []));
      if (r.value.cache === "STALE") cache = "STALE";
      else if (cache !== "STALE" && r.value.cache === "HIT") cache = "HIT";
      staleAgeSeconds = Math.max(staleAgeSeconds, r.value.staleAgeSeconds || 0);
    } else if (!firstError) {
      firstError = r.reason;
    }
  }
  if (!all.length && cleaned.length && results.every((r) => r.status === "rejected")) throw firstError;
  return { ac: all, cache, staleAgeSeconds };
}

async function getByBounds(bounds) {
  const centerLat = (bounds.lamin + bounds.lamax) / 2;
  const centerLon = (bounds.lomin + bounds.lomax) / 2;
  const requestedRadiusNm = Math.ceil(Math.max(
    haversineNm(centerLat, centerLon, bounds.lamin, bounds.lomin),
    haversineNm(centerLat, centerLon, bounds.lamin, bounds.lomax),
    haversineNm(centerLat, centerLon, bounds.lamax, bounds.lomin),
    haversineNm(centerLat, centerLon, bounds.lamax, bounds.lomax)
  ));

  const radiusNm = Math.max(1, Math.min(245, requestedRadiusNm));
  const lat = Number(centerLat.toFixed(4));
  const lon = Number(centerLon.toFixed(4));
  const result = await adsbFetch(
    `/v2/point/${lat}/${lon}/${radiusNm}`,
    `point:${lat}:${lon}:${radiusNm}`,
    10_000
  );
  return {
    ac: result.payload?.ac || [],
    now: Number(result.payload?.now) / 1000 || Date.now() / 1000,
    cache: result.cache,
    staleAgeSeconds: result.staleAgeSeconds || 0,
    requestedRadiusNm,
    radiusNm
  };
}

export async function getFreeFlightSnapshot({ bounds: rawBounds, icao24 = null, callsign = null } = {}) {
  const bounds = cleanBounds(rawBounds);
  const nowSeconds = Date.now() / 1000;
  let rawAircraft = [];
  let sourceTime = nowSeconds;
  let cache = "MISS";
  let staleAgeSeconds = 0;
  let coverage = null;

  const icaos = Array.isArray(icao24)
    ? icao24
    : String(icao24 || "").split(",").filter(Boolean);

  if (icaos.length) {
    const result = await getByHexList(icaos);
    rawAircraft = result.ac;
    cache = result.cache;
    staleAgeSeconds = result.staleAgeSeconds;
  } else if (callsign) {
    const clean = String(callsign).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!clean) throw Object.assign(new Error("A valid callsign is required."), { status: 400 });
    const result = await adsbFetch(`/v2/callsign/${encodeURIComponent(clean)}`, `call:${clean}`, 8_000);
    rawAircraft = result.payload?.ac || [];
    sourceTime = Number(result.payload?.now) / 1000 || nowSeconds;
    cache = result.cache;
    staleAgeSeconds = result.staleAgeSeconds || 0;
  } else if (bounds) {
    const result = await getByBounds(bounds);
    rawAircraft = result.ac;
    sourceTime = result.now;
    cache = result.cache;
    staleAgeSeconds = result.staleAgeSeconds;
    coverage = {
      radiusNm: result.radiusNm,
      requestedRadiusNm: result.requestedRadiusNm,
      viewportClamped: result.requestedRadiusNm > result.radiusNm
    };
  } else {
    throw Object.assign(new Error("A map viewport is required for live aircraft."), { status: 400 });
  }

  const flights = rawAircraft.map((ac) => normalizeAc(ac, sourceTime || nowSeconds)).filter(Boolean);
  const stale = cache === "STALE";
  return {
    ok: true,
    source: stale ? "ADSB.lol (cached)" : "ADSB.lol",
    sourceTime: Math.floor(sourceTime || nowSeconds),
    fetchedAt: Date.now(),
    authMode: "no-key",
    rateRemaining: null,
    providerMode: stale ? "stale-cache" : "primary",
    cache,
    stale,
    staleAgeSeconds,
    coverage,
    flights
  };
}
