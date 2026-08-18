import { getAirport, listAirports, searchAirports } from "../lib/airports.js";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const q = req.query || {};
  if (q.code) {
    const airport = getAirport(q.code);
    return airport ? res.status(200).json({ ok: true, source: "OurAirports", airport }) : res.status(404).json({ ok: false, error: "Airport not found" });
  }
  if (q.q) return res.status(200).json({ ok: true, source: "OurAirports", airports: searchAirports(q.q, q.limit) });
  const airports = listAirports({ bounds: { lamin: q.lamin, lomin: q.lomin, lamax: q.lamax, lomax: q.lomax }, zoom: q.zoom, limit: q.limit });
  res.status(200).json({ ok: true, source: "OurAirports", airports });
}
