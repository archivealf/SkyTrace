import { listNavaids } from "../lib/airports.js";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const q = req.query || {};
  const navaids = listNavaids({ bounds: { lamin: q.lamin, lomin: q.lomin, lamax: q.lamax, lomax: q.lomax }, limit: q.limit });
  res.status(200).json({ ok: true, source: "OurAirports", navaids });
}
