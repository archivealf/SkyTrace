import { getFlightSnapshot } from "../lib/opensky.js";

const requestTimes = new Map();
function clientKey(req) { return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"; }
function rateLimited(req) {
  const key = clientKey(req), now = Date.now(), previous = requestTimes.get(key) || 0;
  requestTimes.set(key, now);
  if (requestTimes.size > 2000) for (const [k, v] of requestTimes) if (now - v > 60_000) requestTimes.delete(k);
  return now - previous < 2200;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: "Refreshing too quickly. Wait a few seconds." });
  const { lamin, lomin, lamax, lomax, icao } = req.query || {};
  try {
    const snapshot = await getFlightSnapshot({ bounds: lamin !== undefined ? { lamin, lomin, lamax, lomax } : null, icao24: icao || null });
    res.status(200).json(snapshot);
  } catch (error) {
    res.status(error.status === 429 ? 429 : error.status >= 400 && error.status < 500 ? error.status : 502).json({ ok: false, error: error.message || "Flight data unavailable", retryAfter: error.retryAfter || null });
  }
}
