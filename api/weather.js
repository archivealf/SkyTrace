import { getWeather } from "../lib/weather.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try { res.status(200).json(await getWeather(req.query?.lat, req.query?.lon)); }
  catch (error) { res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({ ok: false, error: error.message || "Weather unavailable" }); }
}
