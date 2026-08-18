import { config, hasSkyLinkKey } from "./config.js";

const CACHE = new Map();
const TTL = 24 * 60 * 60 * 1000;

export function isAircraftEnrichmentConfigured() {
  return hasSkyLinkKey();
}

export async function getAircraftMetadata(icao24) {
  const key = String(icao24 || "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 6);
  if (key.length !== 6) throw Object.assign(new Error("Invalid ICAO24."), { status: 400 });
  if (!config.skylink.apiKey) return { ok: true, configured: false, found: false, aircraft: null };

  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL) return { ...cached.payload, cache: "HIT" };

  const url = new URL(`https://data.skylinkapi.com/v3/aircraft/icao24/${key}`);
  url.searchParams.set("photos", "true");
  const response = await fetch(url, { headers: { "x-api-key": config.skylink.apiKey, Accept: "application/json", "User-Agent": "SkyTrace/2.0" } });
  if (!response.ok) throw Object.assign(new Error(`Aircraft metadata provider failed (${response.status}).`), { status: response.status });
  const data = await response.json();
  const payload = { ok: true, configured: true, found: Boolean(data.found), aircraft: data.aircraft || null, cache: "MISS" };
  CACHE.set(key, { at: Date.now(), payload });
  return payload;
}
