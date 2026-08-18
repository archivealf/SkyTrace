const CACHE = new Map();

export async function getWeather(lat, lon) {
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw Object.assign(new Error("Invalid weather coordinates."), { status: 400 });
  }
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < 5 * 60_000) return { ...cached.payload, cache: "HIT" };

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SkyTrace/2.0" } });
  if (!response.ok) throw Object.assign(new Error(`Weather provider failed (${response.status}).`), { status: response.status });
  const raw = await response.json();
  const payload = { ok: true, source: "Open-Meteo", current: raw.current || null, units: raw.current_units || null, timezone: raw.timezone || null, cache: "MISS" };
  CACHE.set(key, { at: Date.now(), payload });
  return payload;
}
