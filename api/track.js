import { getTrack } from "../lib/opensky.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try { res.status(200).json(await getTrack(req.query?.icao, req.query?.time || 0)); }
  catch (error) { res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({ ok: false, error: error.message || "Track unavailable" }); }
}
