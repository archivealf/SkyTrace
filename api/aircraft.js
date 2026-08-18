import { getAircraftMetadata } from "../lib/aircraft.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try { res.status(200).json(await getAircraftMetadata(req.query?.icao)); }
  catch (error) { res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({ ok: false, error: error.message || "Aircraft metadata unavailable" }); }
}
