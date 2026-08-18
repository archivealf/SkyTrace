import { getAirportOperations, isOpenSkyAuthenticated } from "../lib/opensky.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!isOpenSkyAuthenticated()) return res.status(503).json({ ok: false, requiresOpenSkyOAuth: true, error: "Recent airport operations require free OpenSky OAuth credentials on the server." });
  try {
    const q = req.query || {};
    const now = Math.floor(Date.now() / 1000);
    const defaultEnd = Math.floor((now - 86400) / 3600) * 3600;
    const end = Number(q.end || defaultEnd);
    const begin = Number(q.begin || end - 86400);
    res.status(200).json(await getAirportOperations({ airport: q.airport, direction: q.direction, begin, end }));
  } catch (error) { res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({ ok: false, error: error.message || "Airport operations unavailable" }); }
}
