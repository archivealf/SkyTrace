const CACHE = new Map();
const CACHE_TTL = 10 * 60_000;
const MET_ROOT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const USER_AGENT = "SkyTrace/3.3 https://github.com/archivealf/SkyTrace";

function toKnots(ms) {
  const value = Number(ms);
  return Number.isFinite(value) ? value * 1.9438444924 : null;
}

export async function getWeather(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw Object.assign(new Error("Invalid weather coordinates."), { status: 400 });
  }

  const roundedLat = Number(latitude.toFixed(4));
  const roundedLon = Number(longitude.toFixed(4));
  const key = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached.payload, cache: "HIT" };

  const url = new URL(MET_ROOT);
  url.searchParams.set("lat", String(roundedLat));
  url.searchParams.set("lon", String(roundedLon));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT
    }
  });
  if (!response.ok) {
    throw Object.assign(new Error(`MET Norway weather provider failed (${response.status}).`), { status: response.status });
  }

  const raw = await response.json();
  const first = raw?.properties?.timeseries?.[0] || null;
  const instant = first?.data?.instant?.details || {};
  const nextHour = first?.data?.next_1_hours || {};
  const precipitation = Number(nextHour?.details?.precipitation_amount);
  const current = first ? {
    time: first.time || null,
    temperature_2m: Number.isFinite(Number(instant.air_temperature)) ? Number(instant.air_temperature) : null,
    relative_humidity_2m: Number.isFinite(Number(instant.relative_humidity)) ? Number(instant.relative_humidity) : null,
    apparent_temperature: null,
    precipitation: Number.isFinite(precipitation) ? precipitation : 0,
    rain: Number.isFinite(precipitation) ? precipitation : 0,
    weather_code: nextHour?.summary?.symbol_code || null,
    cloud_cover: Number.isFinite(Number(instant.cloud_area_fraction)) ? Number(instant.cloud_area_fraction) : null,
    wind_speed_10m: toKnots(instant.wind_speed),
    wind_direction_10m: Number.isFinite(Number(instant.wind_from_direction)) ? Number(instant.wind_from_direction) : null,
    wind_gusts_10m: toKnots(instant.wind_speed_of_gust),
    pressure_msl_hpa: Number.isFinite(Number(instant.air_pressure_at_sea_level)) ? Number(instant.air_pressure_at_sea_level) : null
  } : null;

  const payload = {
    ok: true,
    source: "MET Norway Locationforecast",
    attribution: "Data from MET Norway (CC BY 4.0 / NLOD 2.0)",
    current,
    units: {
      temperature_2m: "°C",
      relative_humidity_2m: "%",
      precipitation: "mm",
      rain: "mm",
      cloud_cover: "%",
      wind_speed_10m: "kn",
      wind_direction_10m: "°",
      wind_gusts_10m: "kn",
      pressure_msl_hpa: "hPa"
    },
    timezone: "UTC",
    updatedAt: first?.time || null,
    cache: "MISS"
  };

  CACHE.set(key, { at: Date.now(), payload });
  if (CACHE.size > 250) CACHE.delete(CACHE.keys().next().value);
  return payload;
}
